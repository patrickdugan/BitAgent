import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  goldMarketingMultiTurnTrajectory,
  marketingMultiTurnScenarios
} from "../eval/marketing-multiturn-scenarios.js";
import {
  evaluateMarketingMultiTurnPredictions,
  runMarketingMultiTurnZeroModelGate,
  validateMarketingMultiTurnPrediction
} from "../eval/marketing-multiturn-harness.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const datasetDir = path.join(root, "training", "datasets", "bitagent-marketing-multiturn-v1");
const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const rows = (text: string) => text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

test("multi-turn matrix covers 120 eight-turn conversations and frozen splits", () => {
  assert.equal(marketingMultiTurnScenarios.length, 120);
  assert.equal(new Set(marketingMultiTurnScenarios.map((item) => item.id)).size, 120);
  assert.equal(new Set(marketingMultiTurnScenarios.map((item) => item.family_id)).size, 12);
  assert.deepEqual(Object.fromEntries((["train", "validation", "held_out"] as const).map((split) => [
    split,
    marketingMultiTurnScenarios.filter((item) => item.split === split).length
  ])), { train: 60, validation: 30, held_out: 30 });
  for (const scenario of marketingMultiTurnScenarios) {
    assert.equal(scenario.steps.length, 8);
    assert.equal(scenario.steps[0]?.expected.act, "explain_k_factor");
    assert.equal(scenario.steps[1]?.expected.act, "calculate_k_factor");
    assert.equal(scenario.steps[7]?.expected.act, "improve_k_safely");
    assert.deepEqual(scenario.steps.map((step) => step.turn_index), [1, 2, 3, 4, 5, 6, 7, 8]);
  }
});

test("multi-turn zero-model gate accepts gold and rejects every trajectory mutation", () => {
  const report = runMarketingMultiTurnZeroModelGate();
  assert.equal(report.passed, true, JSON.stringify(report.failures.slice(0, 3), null, 2));
  assert.equal(report.turn_count, 960);
  assert.equal(report.safe_trajectories_passed, 120);
  assert.equal(report.unsafe_trajectories_total, 840);
  assert.equal(report.unsafe_trajectories_rejected, 840);
});

test("multi-turn evaluation fails every missing held-out scenario", () => {
  const scenario = marketingMultiTurnScenarios.find((item) => item.split === "held_out")!;
  const report = evaluateMarketingMultiTurnPredictions({
    candidateId: "candidate",
    split: "held_out",
    predictions: [{ scenario_id: scenario.id, candidate: "candidate", turns: goldMarketingMultiTurnTrajectory(scenario) }]
  });
  assert.equal(report.scenarios, 30);
  assert.equal(report.passed_trajectories, 1);
  assert.equal(report.failed_trajectories, 29);
  assert.equal(report.passed, false);
});

test("exported multi-turn corpus is hash-bound, alternating, and answer-free on held-out", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(datasetDir, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.countsBySplit, { train: 60, validation: 30, held_out: 30 });
  assert.deepEqual(manifest.turnsBySplit, { train: 480, validation: 240, held_out: 240 });
  assert.deepEqual(manifest.preferencePairs, { train: 420, validation: 210 });
  assert.equal(manifest.rewardSignals, 90);
  assert.deepEqual(manifest.kFactorPromptTurns, [1, 2, 8]);
  assert.equal(manifest.heldoutAssistantAnswersIncluded, false);
  for (const source of manifest.sources) {
    assert.equal(source.sha256, sha256(await fs.readFile(path.join(root, source.path), "utf8")), source.path);
  }
  const contents: Record<string, string> = {};
  for (const entry of Object.values(manifest.files) as Array<{ path: string; sha256: string }>) {
    contents[entry.path] = await fs.readFile(path.join(datasetDir, entry.path), "utf8");
    assert.equal(entry.sha256, sha256(contents[entry.path]), entry.path);
  }
  const train = rows(contents["train.jsonl"]);
  const validation = rows(contents["validation.jsonl"]);
  const heldOut = rows(contents["heldout-scenarios.jsonl"]);
  assert.ok([...train, ...validation].every((row) => row.messages.length === 17));
  assert.ok([...train, ...validation].every((row) => row.messages.slice(1).every((message: { role: string }, index: number) => message.role === (index % 2 === 0 ? "user" : "assistant"))));
  assert.ok(heldOut.every((row) => row.turns.length === 8 && !JSON.stringify(row).includes("assistant")));
  assert.doesNotMatch(contents["train.jsonl"] + contents["validation.jsonl"], /phone_number|email_address|display_name_local_only/);
  const byId = new Map(marketingMultiTurnScenarios.map((scenario) => [scenario.id, scenario]));
  for (const pair of [...rows(contents["preference-train.jsonl"]), ...rows(contents["preference-validation.jsonl"])]) {
    const scenario = byId.get(pair.chosen.scenario_id)!;
    assert.equal(validateMarketingMultiTurnPrediction(scenario, pair.chosen).passed, true, pair.id);
    assert.equal(validateMarketingMultiTurnPrediction(scenario, pair.rejected).passed, false, pair.id);
  }
  const runtime = JSON.parse(await fs.readFile(path.join(root, "config", "bitagent-bonsai-dag-runtime.json"), "utf8"));
  const extension = runtime.candidateTrainingExtensions.marketingComplianceV1;
  assert.equal(extension.multiTurnDatasetManifest, "training/datasets/bitagent-marketing-multiturn-v1/manifest.json");
  assert.equal(extension.multiTurnEvaluationManifest, "eval/marketing-multiturn-eval-manifest.json");
});
