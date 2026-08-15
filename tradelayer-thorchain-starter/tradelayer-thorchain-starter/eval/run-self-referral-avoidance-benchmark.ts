import fs from "node:fs/promises";
import path from "node:path";
import {
  buildSelfReferralMetricRobustnessObservations,
  evaluateSelfReferralBenchmark,
  parseSelfReferralBenchmarkPredictions,
  runSelfReferralBenchmarkZeroModelGate
} from "./self-referral-avoidance-benchmark-harness.js";

function argument(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const outputDir = path.resolve(argument("output-dir") || ".runtime/self-referral-avoidance");
  const predictionsPath = argument("predictions");
  await fs.mkdir(outputDir, { recursive: true });
  const observations = buildSelfReferralMetricRobustnessObservations();
  const observationsPath = path.join(outputDir, "metric-robustness-observations.jsonl");
  await fs.writeFile(
    observationsPath,
    `${observations.map((item) => JSON.stringify(item)).join("\n")}\n`,
    "utf8"
  );

  if (!predictionsPath) {
    const report = runSelfReferralBenchmarkZeroModelGate();
    const reportPath = path.join(outputDir, "zero-model-report.json");
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({
      rowCount: report.row_count,
      independentUnitCount: report.independent_unit_count,
      goldRowsPassed: report.gold_rows_passed,
      goldRowsFailed: report.gold_rows_failed,
      unsafeMutationsRejected: report.unsafe_mutations_rejected,
      unsafeMutationsTotal: report.unsafe_mutations_total,
      releaseGatePassed: report.gold_release_gate_passed,
      passed: report.passed,
      report: reportPath,
      robustnessObservations: observationsPath
    }, null, 2));
    if (!report.passed) process.exitCode = 1;
    return;
  }

  const candidateId = argument("candidate");
  if (!candidateId) throw new Error("--candidate is required with --predictions");
  const predictions = parseSelfReferralBenchmarkPredictions(
    await fs.readFile(path.resolve(predictionsPath), "utf8")
  );
  const report = evaluateSelfReferralBenchmark({ predictions, candidateId });
  const reportPath = path.join(outputDir, `${candidateId}-report.json`);
  const deterministicPath = path.join(outputDir, `${candidateId}-deterministic.jsonl`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(
    deterministicPath,
    `${report.deterministic.map((item) => JSON.stringify(item)).join("\n")}\n`,
    "utf8"
  );
  console.log(JSON.stringify({
    candidate: candidateId,
    rowCount: report.row_count,
    independentUnitCount: report.independent_unit_count,
    selfReferralAvoidanceRate: report.self_referral_avoidance_rate,
    overrefusalRate: report.overrefusal_rate,
    pairContrastAccuracy: report.pair_contrast_accuracy,
    modePassRates: report.mode_pass_rates,
    hardInvariantPassRate: report.hard_invariant_pass_rate,
    meanDenseReward: report.mean_dense_reward,
    releaseGatePassed: report.release_gate_passed,
    report: reportPath,
    deterministic: deterministicPath,
    robustnessObservations: observationsPath
  }, null, 2));
  if (!report.release_gate_passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
