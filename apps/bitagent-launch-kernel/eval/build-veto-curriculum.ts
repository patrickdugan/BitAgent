import fs from "node:fs/promises";
import path from "node:path";
import { canonicalJson, hashObject } from "../src/launch/canonical.js";
import { moveOptions } from "../src/bench/llamaPolicy.js";
import { oraclePolicy } from "../src/bench/policies.js";
import { runScenario } from "../src/bench/runner.js";
import { buildSeedScenarios } from "../src/bench/scenarios.js";
import { gateState, scriptRoute } from "../src/bench/skills/dagMoveGates.js";
import { VETO_FEATURE_DIM, TinyRecursiveVeto, vetoFeatures, vetoMetrics, type VetoRow } from "../src/bench/skills/vetoTrm.js";
import type { HarnessLevel, Scenario, TaskPacketV3 } from "../src/bench/types.js";

// Near-miss repair curriculum for the bitagent-dag-move veto gate.
//
// Every decision a model made in a T0 probe becomes one typed row: the host's gate state, the
// proposal, the script route (the repair target), and whether the proposal matched the oracle
// (the commit/veto label). The split is leakage-aware: whole families are held out as the
// unseen-family split, one scenario per remaining family as the seen-family holdout, and the
// rest is divided into train and validation by scenario, never by row.
//
//   tsx eval/build-veto-curriculum.ts --probes=<dir>[,<dir>...] [--level=H3] [--train]

function argument(name: string, fallback?: string) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  if (fallback === undefined) throw new Error(`--${name} is required`);
  return fallback;
}

const UNSEEN_FAMILIES = ["hidden_slippage", "deceptive_data", "approval_binding"];

type Split = "train" | "validation" | "holdout_seen" | "holdout_unseen";

type CurriculumRow = {
  schema: "bitagent.veto_curriculum_row.v1";
  proposer: string;
  scenarioId: string;
  family: string;
  split: Split;
  step: number;
  node: string;
  problem: string;
  proposal: { key: string | null; argRefs: Record<string, string>; margin: number | null; optionCount: number };
  repairTarget: { key: string; argRefs: Record<string, string>; rule: string } | { open: true; rule: string };
  verifier: { matchesOracle: boolean };
  commit: 0 | 1;
  features: number[];
};

function assignSplit(scenario: Scenario, seenHoldout: Set<string>): Split {
  if (UNSEEN_FAMILIES.includes(scenario.family)) return "holdout_unseen";
  if (seenHoldout.has(scenario.id)) return "holdout_seen";
  return parseInt(hashObject(scenario.id).slice(0, 4), 16) % 5 === 0 ? "validation" : "train";
}

// Packets along the oracle trajectory, keyed by step, so a probe row can be re-featurised.
function oraclePackets(scenario: Scenario, level: HarnessLevel) {
  const packets = new Map<number, TaskPacketV3>();
  const oracle = oraclePolicy(scenario);
  runScenario(scenario, {
    id: "M0",
    propose(packet, context) {
      packets.set(packet.run.step, packet);
      return oracle.propose(packet, context);
    }
  }, { harnessLevel: level });
  return packets;
}

async function main() {
  const level = argument("level", "H3") as HarnessLevel;
  const probeDirs = argument("probes").split(",").map((value) => value.trim()).filter(Boolean);
  const scenarios = buildSeedScenarios();
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const seenHoldout = new Set<string>();
  for (const family of new Set(scenarios.map((scenario) => scenario.family))) {
    if (UNSEEN_FAMILIES.includes(family)) continue;
    const members = scenarios.filter((scenario) => scenario.family === family).sort((a, b) => hashObject(a.id).localeCompare(hashObject(b.id)));
    if (members.length > 1) seenHoldout.add(members[0]!.id);
  }
  const packetCache = new Map<string, Map<number, TaskPacketV3>>();

  const rows: CurriculumRow[] = [];
  let skipped = 0;
  for (const dir of probeDirs) {
    const summary = JSON.parse(await fs.readFile(path.join(dir, "summary.json"), "utf8")) as { modelId: string; harnessLevel: string };
    if (summary.harnessLevel !== level) throw new Error(`${dir} is a ${summary.harnessLevel} probe; expected ${level}`);
    const lines = (await fs.readFile(path.join(dir, "probes.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const probe = JSON.parse(line) as Record<string, unknown>;
      const scenario = byId.get(String(probe.scenarioId));
      if (!scenario) { skipped += 1; continue; }
      if (!packetCache.has(scenario.id)) packetCache.set(scenario.id, oraclePackets(scenario, level));
      const packet = packetCache.get(scenario.id)!.get(Number(probe.step));
      if (!packet) { skipped += 1; continue; }
      const state = gateState(packet);
      const route = scriptRoute(state, packet);
      const key = (probe.modelKey as string | null) ?? null;
      // Older probes did not record the chosen references. They are recoverable when the move matched
      // the oracle, or when the packet offered only one way to validate; otherwise the row is dropped.
      let argRefs = probe.modelRefs as Record<string, string> | undefined;
      if (!argRefs) {
        const validateOptions = moveOptions(packet).filter((option) => option.key === key && Object.keys(option.argRefs).length > 0);
        if (probe.match) argRefs = { ...(probe.oracleRefs as Record<string, string> | undefined) || { intent: packet.intent_id!, quote: packet.cycle.quote_id! } };
        else if (validateOptions.length <= 1) argRefs = validateOptions[0]?.argRefs || {};
        else { skipped += 1; continue; }
        if (!key?.includes("/validate/")) argRefs = {};
      }
      const proposal = {
        key,
        argRefs,
        margin: (probe.margin as number | null) ?? null,
        optionCount: moveOptions(packet).length
      };
      rows.push({
        schema: "bitagent.veto_curriculum_row.v1",
        proposer: summary.modelId,
        scenarioId: scenario.id,
        family: scenario.family,
        split: assignSplit(scenario, seenHoldout),
        step: Number(probe.step),
        node: packet.current_node,
        problem: state.problem,
        proposal,
        repairTarget: route.closed ? { key: route.key, argRefs: route.argRefs, rule: route.rule } : { open: true, rule: route.rule },
        verifier: { matchesOracle: Boolean(probe.match) },
        commit: probe.match ? 1 : 0,
        features: vetoFeatures({ packet, state, proposalKey: proposal.key, proposalRefs: proposal.argRefs, margin: proposal.margin, optionCount: proposal.optionCount })
      });
    }
  }

  const output = path.join(process.cwd(), "training", "datasets", "control-capability-veto-v1");
  await fs.mkdir(output, { recursive: true });
  const bySplit = (split: Split) => rows.filter((row) => row.split === split);
  for (const split of ["train", "validation", "holdout_seen", "holdout_unseen"] as Split[]) {
    await fs.writeFile(path.join(output, `${split}.jsonl`), bySplit(split).map((row) => canonicalJson(row)).join("\n") + "\n", "utf8");
  }
  const manifest = {
    schema: "bitagent.veto_curriculum_manifest.v1",
    builtAt: new Date().toISOString(),
    level,
    featureDim: VETO_FEATURE_DIM,
    probeDirs: probeDirs.map((dir) => path.relative(process.cwd(), dir)),
    proposers: [...new Set(rows.map((row) => row.proposer))],
    unseenFamilies: UNSEEN_FAMILIES,
    seenHoldoutScenarios: [...seenHoldout].sort(),
    rows: Object.fromEntries((["train", "validation", "holdout_seen", "holdout_unseen"] as Split[]).map((split) => {
      const members = bySplit(split);
      return [split, { rows: members.length, commit: members.filter((row) => row.commit === 1).length, sha256: hashObject(members) }];
    })),
    skippedProbeRows: skipped,
    leakage: "splits are by scenario; oracle moves are labels only and are never a feature"
  };
  await fs.writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(manifest, null, 2));

  if (!process.argv.includes("--train")) return;
  const toRows = (split: Split): VetoRow[] => bySplit(split).map((row) => ({ features: row.features, commit: row.commit }));
  const train = toRows("train");
  const model = TinyRecursiveVeto.init(VETO_FEATURE_DIM, 24, 4, 7);
  const history = model.train(train, { epochs: Number(argument("epochs", "400")), learningRate: 0.05, seed: 7 });
  const calibration = model.calibrate(toRows("validation"));
  const evaluate = (split: Split) => {
    const members = toRows(split);
    const predicted = members.map((row) => ({ commit: row.commit, predicted: model.commits(row.features) ? 1 as const : 0 as const }));
    const metrics = vetoMetrics(predicted);
    // What the proposer alone would score, and what proposer plus veto with the script substitute scores.
    const proposerAccuracy = members.filter((row) => row.commit === 1).length / Math.max(1, members.length);
    const substitutes = bySplit(split);
    const jointRight = substitutes.filter((row, index) => {
      const committed = predicted[index]!.predicted === 1;
      return committed ? row.commit === 1 : !("open" in row.repairTarget);
    }).length;
    return { ...metrics, proposerAccuracy, jointAccuracyWithScriptSubstitute: jointRight / Math.max(1, substitutes.length) };
  };
  const report = {
    schema: "bitagent.veto_trm_training_report.v1",
    trainedAt: new Date().toISOString(),
    parameters: model.parameterCount(),
    epochs: history.length,
    finalLoss: history[history.length - 1],
    threshold: calibration.threshold,
    validation: evaluate("validation"),
    holdoutSeen: evaluate("holdout_seen"),
    holdoutUnseen: evaluate("holdout_unseen"),
    curriculumSha256: hashObject(manifest.rows)
  };
  const modelDir = path.join(process.cwd(), "training", "artifacts", "control-capability-veto-trm-v1");
  await fs.mkdir(modelDir, { recursive: true });
  await fs.writeFile(path.join(modelDir, "model.json"), `${JSON.stringify(model.toJSON({ rows: train.length, seed: 7, epochs: history.length, sha256: hashObject(train) }), null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(modelDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
