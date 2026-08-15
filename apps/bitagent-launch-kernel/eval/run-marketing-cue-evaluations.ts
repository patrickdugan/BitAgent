import fs from "node:fs/promises";
import path from "node:path";
import {
  evaluateMarketingCuePredictions,
  parseMarketingCuePredictions,
  runMarketingCueZeroModelGate
} from "./marketing-cue-harness.js";
import type { MarketingTrajectorySplit } from "./marketing-cue-trajectories.js";

function argument(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const predictionsPath = argument("predictions");
  const outputDir = path.resolve(argument("output-dir") || ".runtime/marketing-cues");
  await fs.mkdir(outputDir, { recursive: true });

  if (!predictionsPath) {
    const report = runMarketingCueZeroModelGate();
    const reportPath = path.join(outputDir, "zero-model-report.json");
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ ...report, report: reportPath }, null, 2));
    if (!report.passed) process.exitCode = 1;
    return;
  }

  const candidateId = argument("candidate");
  if (!candidateId) throw new Error("--candidate is required with --predictions");
  const splitValue = argument("split") || "held_out";
  if (!["train", "validation", "held_out"].includes(splitValue)) {
    throw new Error("--split must be train, validation, or held_out");
  }
  const predictions = parseMarketingCuePredictions(
    await fs.readFile(path.resolve(predictionsPath), "utf8")
  );
  const report = evaluateMarketingCuePredictions({
    predictions,
    split: splitValue as MarketingTrajectorySplit,
    candidateId
  });
  const reportPath = path.join(outputDir, `${candidateId}-${splitValue}-report.json`);
  const rewardsPath = path.join(outputDir, `${candidateId}-${splitValue}-rewards.jsonl`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(rewardsPath, report.traces.map((trace) => JSON.stringify({
    item_id: trace.item_id,
    candidate: candidateId,
    passed: trace.passed,
    reward: trace.reward
  })).join("\n") + "\n", "utf8");
  console.log(JSON.stringify({
    candidate: candidateId,
    split: splitValue,
    cases: report.cases,
    passed: report.passed_cases,
    failed: report.failed_cases,
    meanDenseReward: report.mean_dense_reward,
    hardFailCaseRate: report.hard_fail_case_rate,
    report: reportPath,
    rewards: rewardsPath
  }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
