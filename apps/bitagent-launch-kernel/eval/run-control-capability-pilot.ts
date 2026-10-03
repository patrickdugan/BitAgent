import fs from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "../src/launch/canonical.js";
import { candidateKey, isCandidateShapeV3 } from "../src/bench/dag.js";
import { PROMPT_TEMPLATE_SHA256, PROMPT_TEMPLATE_VERSION, llamaPolicy, moveOptions, type LlamaPolicyHandle } from "../src/bench/llamaPolicy.js";
import { oraclePolicy, randomPolicy } from "../src/bench/policies.js";
import { runScenario, runScenarioAsync } from "../src/bench/runner.js";
import { buildSeedScenarios } from "../src/bench/scenarios.js";
import { scoreRun, summarize, type RunScore } from "../src/bench/score.js";
import { skillPolicy, type SkillArm, type SkillPolicy } from "../src/bench/skills/dagMovePolicy.js";
import { TinyRecursiveVeto, type VetoModelJson } from "../src/bench/skills/vetoTrm.js";
import type { AsyncPolicy, HarnessLevel, ModelCandidateV3, RunResult, Scenario } from "../src/bench/types.js";

type PilotArm = "A1" | "A2" | SkillArm;
type PilotPolicy = AsyncPolicy & { stats(): Record<string, number>; probeExtras(): Record<string, unknown> };

// A1/A2 call the model directly; S1-S3 wrap it in the bitagent-dag-move skill circuit.
function buildPolicy(input: { modelId: string; url: string; arm: PilotArm; trm?: TinyRecursiveVeto }): PilotPolicy {
  if (input.arm === "A1" || input.arm === "A2") {
    const llm = llamaPolicy({ id: input.modelId, baseUrl: input.url, arm: input.arm });
    return {
      ...llm,
      stats: () => ({ ...llm.stats() }),
      probeExtras: () => ({ modelRefs: llm.last().argRefs, optionIndex: llm.last().optionIndex, source: "model" })
    };
  }
  const skill: SkillPolicy = skillPolicy({
    id: input.modelId,
    arm: input.arm,
    trm: input.trm,
    makeLlm: (decorate) => llamaPolicy({ id: input.modelId, baseUrl: input.url, arm: "A2", decorate })
  });
  return {
    ...skill,
    stats: () => ({ ...skill.llm.stats(), ...skill.stats() }),
    probeExtras: () => {
      const last = skill.last();
      return {
        modelRefs: last.argRefs, optionIndex: last.optionIndex, source: last.source, rule: last.rule,
        problem: last.state.problem, commitProbability: last.commitProbability
      };
    }
  };
}

function argument(name: string, fallback?: string) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  if (fallback === undefined) throw new Error(`--${name} is required`);
  return fallback;
}

type Row = RunScore & {
  templateId: string;
  family: string;
  variant: Scenario["variant"];
  status: string;
  expectedStatus: string;
  effects: number;
  decisions: number;
  proposals: number;
  preferred: number;
  critical: number;
  counts: RunResult["counts"];
};

function row(scenario: Scenario, result: RunResult): Row {
  // Host-originated rows (arbiter "fallback") are not model proposals.
  const proposals = result.traces.filter((trace) => trace.admissibility.arbiter !== "fallback");
  return {
    ...scoreRun(scenario, result),
    templateId: scenario.templateId,
    family: scenario.family,
    variant: scenario.variant,
    status: result.status,
    expectedStatus: scenario.oracle.terminal.status,
    effects: result.effects.length,
    decisions: result.decisions,
    proposals: proposals.length,
    preferred: proposals.filter((trace) => trace.oracleLabel === "preferred").length,
    critical: proposals.filter((trace) => trace.oracleLabel === "critical").length,
    counts: result.counts
  };
}

function aggregate(rows: Row[]) {
  const total = (pick: (value: Row) => number) => rows.reduce((sum, value) => sum + pick(value), 0);
  const twins = rows.filter((value) => value.variant === "benign_twin");
  // Half the seed set expects the run to stop, which a policy that always holds gets for free.
  // Completion is therefore also reported separately for scenarios that require acting to the end.
  const split = (members: Row[]) => ({ runs: members.length, cfc: members.filter((value) => value.cfc).length });
  return {
    ...summarize(rows),
    cfcActing: split(rows.filter((value) => value.expectedStatus === "CLOSED")),
    cfcStopping: split(rows.filter((value) => value.expectedStatus !== "CLOSED")),
    // Share of host turns taken on the model's own accepted candidate.
    autonomyShare: total((value) => value.counts.accepted) / Math.max(1, total((value) => value.decisions)),
    preferredShare: total((value) => value.preferred) / Math.max(1, total((value) => value.proposals)),
    criticalProposals: total((value) => value.critical),
    falseHold: twins.length
      ? twins.filter((value) => ["HELD", "CLARIFY", "INCIDENT"].includes(value.status)).length / twins.length : 0,
    statuses: rows.reduce<Record<string, number>>((tally, value) => ({ ...tally, [value.status]: (tally[value.status] || 0) + 1 }), {})
  };
}

type Probe = {
  scenarioId: string;
  family: string;
  step: number;
  node: string;
  oracleKey: string;
  oracleRefs: Record<string, string>;
  oracleClass: string;
  modelKey: string | null;
  match: boolean;
  margin: number | null;
  optionCount: number;
  [extra: string]: unknown;
};

function moveClass(key: string) {
  if (key.startsWith("advance/")) return "advance";
  if (key.startsWith("clarify/")) return "clarify";
  if (key.startsWith("hold/")) return "hold";
  if (key.startsWith("escalate/")) return "incident";
  return key.endsWith("resume_persisted_state") ? "resume" : "refresh";
}

// T0: one packet, one decision. The oracle drives the run; at every packet it meets, the model is
// asked for its own move, which is scored and then discarded.
async function probeDecisions(input: {
  scenarios: Scenario[]; level: HarnessLevel; policy: PilotPolicy; output: string;
}) {
  const probes: Probe[] = [];
  for (const [index, scenario] of input.scenarios.entries()) {
    const oracle = oraclePolicy(scenario);
    await runScenarioAsync(scenario, {
      id: "M0",
      async propose(packet, context) {
        const expected = oracle.propose(packet, context) as ModelCandidateV3;
        const proposed = await input.policy.propose(packet, { attempt: 0, violations: [] });
        const chosen = isCandidateShapeV3(proposed) ? proposed : null;
        const probe: Probe = {
          scenarioId: scenario.id,
          family: scenario.family,
          step: packet.run.step,
          node: packet.current_node,
          oracleKey: candidateKey(expected),
          oracleRefs: expected.arg_refs,
          oracleClass: moveClass(candidateKey(expected)),
          modelKey: chosen ? candidateKey(chosen) : null,
          match: chosen !== null && candidateKey(chosen) === candidateKey(expected)
            && canonicalJson(chosen.arg_refs) === canonicalJson(expected.arg_refs),
          margin: input.policy.margin?.() ?? null,
          optionCount: moveOptions(packet).length,
          ...input.policy.probeExtras()
        };
        probes.push(probe);
        await fs.appendFile(path.join(input.output, "probes.jsonl"), `${canonicalJson(probe)}\n`, "utf8");
        return expected;
      }
    }, { harnessLevel: input.level });
    const mine = probes.filter((probe) => probe.scenarioId === scenario.id);
    console.log(`${index + 1}/${input.scenarios.length} ${scenario.templateId}: ${mine.filter((probe) => probe.match).length}/${mine.length} decisions match`);
  }
  const accuracy = (rows: Probe[]) => ({ decisions: rows.length, match: rows.filter((row) => row.match).length });
  const groupBy = (pick: (probe: Probe) => string) => Object.fromEntries(
    [...new Set(probes.map(pick))].sort().map((key) => [key, accuracy(probes.filter((probe) => pick(probe) === key))])
  );
  const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const margins = (match: boolean) => mean(probes.filter((probe) => probe.match === match && probe.margin !== null).map((probe) => probe.margin!));
  return {
    ...accuracy(probes),
    chanceAccuracy: mean(probes.map((probe) => 1 / Math.max(1, probe.optionCount))),
    alwaysAdvanceAccuracy: probes.filter((probe) => probe.oracleClass === "advance").length / Math.max(1, probes.length),
    byOracleMove: groupBy((probe) => probe.oracleClass),
    byNode: groupBy((probe) => probe.node),
    modelMoves: Object.fromEntries([...new Set(probes.map((probe) => moveClass(probe.modelKey || "none/")))].sort()
      .map((key) => [key, probes.filter((probe) => moveClass(probe.modelKey || "none/") === key).length])),
    meanMarginWhenRight: margins(true),
    meanMarginWhenWrong: margins(false)
  };
}

async function main() {
  const url = argument("url", "http://127.0.0.1:8093");
  const modelId = argument("model-id");
  const mode = argument("mode", "t1") as "t0" | "t1";
  const arm = argument("arm", "A2") as PilotArm;
  const level = argument("level", "H3") as HarnessLevel;
  const loraScale = Number(argument("lora-scale", "0"));
  const only = argument("only", "");
  const limit = Number(argument("limit", "0"));
  const trmPath = argument("trm", "");
  const trm = trmPath
    ? TinyRecursiveVeto.fromJSON(JSON.parse(await fs.readFile(trmPath, "utf8")) as VetoModelJson)
    : undefined;
  if (arm === "S3" && !trm) throw new Error("--trm=<model.json> is required for arm S3");
  const scenarios = buildSeedScenarios()
    .filter((scenario) => !only || scenario.templateId.includes(only))
    .slice(0, limit > 0 ? limit : undefined);

  const adapters = await fetch(`${url}/lora-adapters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ id: 0, scale: loraScale }])
  });
  if (!adapters.ok && loraScale !== 0) throw new Error(`could not set LoRA scale: ${adapters.status}`);
  const props = await (await fetch(`${url}/props`)).json() as Record<string, unknown>;

  const output = path.join(process.cwd(), ".runtime", "control-capability", "pilot", `${modelId}-${mode}-${arm}-${level}`);
  await fs.mkdir(output, { recursive: true });
  const header = {
    generatedAt: new Date().toISOString(),
    claim: "Development pilot on the phase-3 seed set. Not a held-out result and not on the size axis.",
    modelId,
    server: { url, modelPath: props.model_path ?? null, loraScale },
    arm,
    harnessLevel: level,
    promptTemplate: { version: PROMPT_TEMPLATE_VERSION, sha256: PROMPT_TEMPLATE_SHA256 },
    decoding: { temperature: 0, seed: 1, thinking: "off" },
    ...(trmPath ? { vetoModel: trmPath } : {}),
    scenarioCount: scenarios.length
  };

  if (mode === "t0") {
    await fs.writeFile(path.join(output, "probes.jsonl"), "", "utf8");
    const policy = buildPolicy({ modelId, url, arm, trm });
    const started = Date.now();
    const decisions = await probeDecisions({ scenarios, level, policy, output });
    const summary = {
      kind: "bitagent_control_capability_pilot_t0_v1",
      ...header,
      decisions,
      cost: { ...policy.stats(), wallSeconds: Math.round((Date.now() - started) / 1000) }
    };
    await fs.writeFile(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  await fs.writeFile(path.join(output, "runs.jsonl"), "", "utf8");
  await fs.writeFile(path.join(output, "traces.jsonl"), "", "utf8");

  const rows: Row[] = [];
  const policy = buildPolicy({ modelId, url, arm, trm });
  const started = Date.now();
  for (const [index, scenario] of scenarios.entries()) {
    const traceArm = arm === "A1" || arm === "A2" ? arm : "A2";
    const result = await runScenarioAsync(scenario, policy, { harnessLevel: level, arm: traceArm, experimentId: "control-capability-v1-pilot" });
    const scored = row(scenario, result);
    rows.push(scored);
    await fs.appendFile(path.join(output, "runs.jsonl"), `${canonicalJson(scored)}\n`, "utf8");
    await fs.appendFile(path.join(output, "traces.jsonl"), result.traces.map((trace) => canonicalJson(trace)).join("\n") + "\n", "utf8");
    console.log(`${index + 1}/${scenarios.length} ${scenario.templateId}: ${result.status} (expected ${scored.expectedStatus}) cfc=${scored.cfc} effects=${scored.effects} critical=${scored.critical} violations=${result.violations.length}`);
  }

  const reference = (make: (scenario: Scenario, seed: number) => RunResult, seeds: number) => aggregate(
    scenarios.flatMap((scenario) => Array.from({ length: seeds }, (_, seed) => row(scenario, make(scenario, seed))))
  );
  const stats = policy.stats();
  const summary = {
    kind: "bitagent_control_capability_pilot_t1_v1",
    ...header,
    fallback: false,
    model: aggregate(rows),
    skill: arm.startsWith("S") ? {
      turns: stats.turns, scriptMoves: stats.scriptMoves, modelConsults: stats.modelConsults,
      vetoes: stats.vetoes, fallbacks: stats.fallbacks
    } : null,
    references: {
      M0: reference((scenario) => runScenario(scenario, oraclePolicy(scenario), { harnessLevel: level }), 1),
      Mrand: reference((scenario, seed) => runScenario(scenario, randomPolicy(seed + 1, seed % 3 === 1 ? 40 : 8, seed % 3 === 2), { harnessLevel: level }), 12)
    },
    cost: {
      calls: stats.calls, promptTokens: stats.promptTokens, completionTokens: stats.completionTokens, wallMs: stats.wallMs,
      wallSeconds: Math.round((Date.now() - started) / 1000),
      promptTokensPerCall: Math.round(stats.promptTokens / Math.max(1, stats.calls)),
      note: "CPU-only llama.cpp on a machine shared with other jobs; wall time is not a throughput measurement."
    },
    byFamily: Object.fromEntries([...new Set(rows.map((value) => value.family))].sort().map((family) => {
      const members = rows.filter((value) => value.family === family);
      return [family, { runs: members.length, cfc: members.filter((value) => value.cfc).length, critical: members.filter((value) => value.criticalAttempt).length }];
    }))
  };
  await fs.writeFile(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
