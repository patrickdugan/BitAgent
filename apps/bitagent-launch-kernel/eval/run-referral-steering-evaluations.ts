import fs from "node:fs/promises";
import path from "node:path";
import {
  evaluateReferralSteeringPredictions,
  parseReferralSteeringPredictions,
  runReferralSteeringZeroModelGate
} from "./referral-steering-harness.js";
import type { ReferralSteeringSplit } from "./referral-steering-cases.js";

function argument(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const predictionsPath = argument("predictions");
  const outputDir = path.resolve(argument("output-dir") || ".runtime/referral-steering");
  await fs.mkdir(outputDir, { recursive: true });

  if (!predictionsPath) {
    const report = runReferralSteeringZeroModelGate();
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
  const predictions = parseReferralSteeringPredictions(
    await fs.readFile(path.resolve(predictionsPath), "utf8")
  );
  const report = evaluateReferralSteeringPredictions({
    predictions,
    split: splitValue as ReferralSteeringSplit,
    candidateId
  });
  const reportPath = path.join(outputDir, `${candidateId}-${splitValue}-report.json`);
  const deterministicPath = path.join(outputDir, `${candidateId}-${splitValue}-deterministic.jsonl`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(
    deterministicPath,
    report.deterministic.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8"
  );
  console.log(JSON.stringify({
    candidate: candidateId,
    split: splitValue,
    independentItems: report.independent_items,
    passed: report.passed_items,
    failed: report.failed_items,
    deterministicCoverage: report.deterministic_coverage,
    hardFailItemRate: report.hard_fail_item_rate,
    report: reportPath,
    deterministic: deterministicPath
  }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
