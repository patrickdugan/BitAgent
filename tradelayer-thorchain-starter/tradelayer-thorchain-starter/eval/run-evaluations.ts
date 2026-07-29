import fs from "node:fs/promises";
import path from "node:path";
import { runAgentEvaluation } from "./harness.js";

async function main() {
  const report = await runAgentEvaluation();
  const outputDir = path.resolve("eval", "artifacts");
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, "agent-evaluation-latest.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  const failures = report.traces
    .filter((trace) => !trace.passed)
    .map((trace) => JSON.stringify({
      kind: "bitagent_failure_trace_v1",
      ...trace
    }))
    .join("\n");
  await fs.writeFile(
    path.join(outputDir, "failure-traces.jsonl"),
    failures ? `${failures}\n` : "",
    "utf8"
  );
  console.log(JSON.stringify({
    cases: report.caseCount,
    passed: report.passed,
    failed: report.failed,
    scores: report.scores,
    report: path.join(outputDir, "agent-evaluation-latest.json")
  }, null, 2));
  if (report.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
