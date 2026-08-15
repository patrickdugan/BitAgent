import fs from "node:fs/promises";
import path from "node:path";
import {
  evaluateMarketingMultiTurnPredictions,
  parseMarketingMultiTurnPredictions,
  runMarketingMultiTurnZeroModelGate
} from "./marketing-multiturn-harness.js";
import type { MarketingMultiTurnSplit } from "./marketing-multiturn-scenarios.js";

function argument(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const positional = process.argv.slice(2).filter((value) => !value.startsWith("--"));
  const predictionsPath = argument("predictions") || positional[0];
  const outputDir = path.resolve(argument("output-dir") || ".runtime/marketing-multiturn");
  await fs.mkdir(outputDir, { recursive: true });

  if (!predictionsPath) {
    const report = runMarketingMultiTurnZeroModelGate();
    const reportPath = path.join(outputDir, "zero-model-report.json");
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ ...report, failures: report.failures.slice(0, 10), report: reportPath }, null, 2));
    if (!report.passed) process.exitCode = 1;
    return;
  }

  const candidateId = argument("candidate") || positional[1];
  if (!candidateId) throw new Error("--candidate is required with --predictions");
  const splitValue = argument("split") || positional[2] || "held_out";
  if (!["train", "validation", "held_out"].includes(splitValue)) {
    throw new Error("--split must be train, validation, or held_out");
  }
  const predictions = parseMarketingMultiTurnPredictions(
    await fs.readFile(path.resolve(predictionsPath), "utf8")
  );
  const report = evaluateMarketingMultiTurnPredictions({
    predictions,
    candidateId,
    split: splitValue as MarketingMultiTurnSplit
  });
  const reportPath = path.join(outputDir, `${candidateId}-${splitValue}-report.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    candidate: candidateId,
    split: splitValue,
    scenarios: report.scenarios,
    expectedTurns: report.expected_turns,
    passedTrajectories: report.passed_trajectories,
    failedTrajectories: report.failed_trajectories,
    turnPassRate: report.turn_pass_rate,
    kFactorAccuracy: report.k_factor_accuracy,
    stateContinuityRate: report.state_continuity_rate,
    challengeRecoveryRate: report.challenge_recovery_rate,
    toolSequenceAccuracy: report.tool_sequence_accuracy,
    hardFailRate: report.hard_fail_rate,
    report: reportPath
  }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
