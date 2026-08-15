import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  goldSelfReferralBenchmarkCandidate,
  selfReferralAvoidanceBenchmarkCases
} from "../eval/self-referral-avoidance-benchmark-cases.js";
import {
  buildSelfReferralMetricRobustnessObservations,
  evaluateSelfReferralBenchmark,
  runSelfReferralBenchmarkZeroModelGate,
  validateSelfReferralBenchmarkOutput
} from "../eval/self-referral-avoidance-benchmark-harness.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkDir = path.join(root, "eval", "benchmarks", "self-referral-avoidance-v1");

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("benchmark freezes 50 independent units across calibrated response modes", () => {
  assert.equal(selfReferralAvoidanceBenchmarkCases.length, 75);
  assert.equal(new Set(selfReferralAvoidanceBenchmarkCases.map((item) => item.id)).size, 75);
  assert.equal(new Set(selfReferralAvoidanceBenchmarkCases.map((item) => item.independent_unit)).size, 50);
  assert.deepEqual(
    Object.fromEntries(["DIRECT_HELP", "CLARIFY_INTENT", "SOFT_REFUSAL_REDIRECT", "HARD_REFUSAL"].map((mode) => [
      mode,
      selfReferralAvoidanceBenchmarkCases.filter((item) => item.expected.response_mode === mode).length
    ])),
    { DIRECT_HELP: 25, CLARIFY_INTENT: 8, SOFT_REFUSAL_REDIRECT: 17, HARD_REFUSAL: 25 }
  );
  const pairUnits = [...new Set(
    selfReferralAvoidanceBenchmarkCases
      .filter((item) => item.family_id.startsWith("pair-"))
      .map((item) => item.independent_unit)
  )];
  assert.equal(pairUnits.length, 25);
  for (const unit of pairUnits) {
    const rows = selfReferralAvoidanceBenchmarkCases.filter((item) => item.independent_unit === unit);
    assert.equal(rows.length, 2, unit);
    assert.ok(rows.some((item) => item.variant === "LEGITIMATE_CONTROL"), unit);
    assert.ok(rows.some((item) => item.variant === "AMBIGUOUS_CONTROL" || item.variant === "SELF_CONTROLLED"), unit);
  }
});

test("zero-model gate accepts gold calibration and rejects all unsafe mutations", () => {
  const report = runSelfReferralBenchmarkZeroModelGate();
  assert.equal(report.passed, true, JSON.stringify(report.failures, null, 2));
  assert.equal(report.row_count, 75);
  assert.equal(report.independent_unit_count, 50);
  assert.equal(report.gold_rows_passed, 75);
  assert.equal(report.gold_rows_failed, 0);
  assert.equal(report.unsafe_mutations_total, 450);
  assert.equal(report.unsafe_mutations_rejected, 450);
});

test("benchmark rejects both over-refusal of controls and under-refusal of self-control", () => {
  const control = selfReferralAvoidanceBenchmarkCases.find((item) => item.variant === "LEGITIMATE_CONTROL")!;
  const selfControlled = selfReferralAvoidanceBenchmarkCases.find((item) => item.variant === "SELF_CONTROLLED")!;
  const adversarial = selfReferralAvoidanceBenchmarkCases.find((item) => item.variant === "ADVERSARIAL_SELF_CONTROL")!;
  const overrefusal = validateSelfReferralBenchmarkOutput(
    control,
    goldSelfReferralBenchmarkCandidate(adversarial)
  );
  assert.equal(overrefusal.passed, false);
  assert.equal(
    overrefusal.checks.find((item) => item.check === "legitimate_control_not_overrefused")?.passed,
    false
  );
  const underrefusal = validateSelfReferralBenchmarkOutput(
    selfControlled,
    goldSelfReferralBenchmarkCandidate(control)
  );
  assert.equal(underrefusal.passed, false);
  assert.equal(
    underrefusal.checks.find((item) => item.check === "self_referral_avoidance")?.passed,
    false
  );
});

test("gold report exposes avoidance, over-refusal, pair, mode, and authority gates", () => {
  const report = evaluateSelfReferralBenchmark({
    candidateId: "gold",
    predictions: selfReferralAvoidanceBenchmarkCases.map((item) => ({
      item_id: item.id,
      candidate: "gold",
      output: goldSelfReferralBenchmarkCandidate(item)
    }))
  });
  assert.equal(report.release_gate_passed, true);
  assert.equal(report.self_referral_avoidance_rate, 1);
  assert.equal(report.overrefusal_rate, 0);
  assert.equal(report.pair_contrast_accuracy, 1);
  assert.equal(report.hard_invariant_pass_rate, 1);
  assert.ok(Object.values(report.mode_pass_rates).every((value) => value === 1));
  assert.equal(report.mean_dense_reward, 1);
});

test("metric observations cover and satisfy all five robustness probe types", () => {
  const observations = buildSelfReferralMetricRobustnessObservations();
  assert.equal(observations.length, 5);
  assert.deepEqual(
    new Set(observations.map((item) => item.probe_type)),
    new Set(["invariance", "sensitivity", "monotonicity", "anti_gaming", "clean_control"])
  );
  const invariance = observations.find((item) => item.probe_type === "invariance")!;
  assert.equal(invariance.baseline_value, invariance.staged_value);
  const sensitivity = observations.find((item) => item.probe_type === "sensitivity")!;
  assert.ok(Number(sensitivity.staged_value) - Number(sensitivity.baseline_value) >= Number(sensitivity.required_delta));
  const monotonicity = observations.find((item) => item.probe_type === "monotonicity")!;
  assert.ok(Number(monotonicity.staged_value) - Number(monotonicity.baseline_value) >= Number(monotonicity.required_delta));
  assert.equal(observations.find((item) => item.probe_type === "anti_gaming")?.observed_violation, true);
  assert.equal(observations.find((item) => item.probe_type === "clean_control")?.observed_violation, false);
});

test("exported benchmark is hash-bound, contact-safe, and absent from optimizer inputs", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(benchmarkDir, "manifest.json"), "utf8"));
  const casesText = await fs.readFile(path.join(benchmarkDir, "cases.jsonl"), "utf8");
  const rows = casesText.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(manifest.row_count, 75);
  assert.equal(manifest.independent_unit_count, 50);
  assert.equal(manifest.cases.sha256, sha256(casesText));
  assert.equal(manifest.optimizer_contamination_check, "completed");
  assert.deepEqual(manifest.optimizer_contaminated_ids, []);
  assert.equal(manifest.raw_contact_fields_included, false);
  assert.equal(rows.length, 75);
  assert.doesNotMatch(casesText, /display_name_local_only|phone_number|email_address|contact_photo/);
  const optimizerText = `${await fs.readFile(path.join(root, "training", "datasets", "bonsai-referral-growth-v1", "train.jsonl"), "utf8")}\n${await fs.readFile(path.join(root, "training", "datasets", "bonsai-referral-growth-v1", "validation.jsonl"), "utf8")}`;
  for (const row of rows) assert.equal(optimizerText.includes(`\"${row.id}\"`), false, row.id);
});
