import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function tapCount(output: string, label: "tests" | "pass" | "fail") {
  const match = output.match(new RegExp(`^# ${label} (\\d+)$`, "m"));
  return match ? Number(match[1]) : 0;
}

async function main() {
  const root = process.cwd();
  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    const result = await execFileAsync(process.execPath, [tsxCli, "--test", "test/strategy-covenant.test.ts"], {
      cwd: root,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string; code?: number };
    stdout = failure.stdout || "";
    stderr = failure.stderr || failure.message;
    exitCode = Number(failure.code || 1);
  }
  const tests = tapCount(stdout, "tests");
  const passed = tapCount(stdout, "pass");
  const failed = tapCount(stdout, "fail");
  const tracePath = path.join(root, "eval", "fixtures", "covenant-failure-traces.seed.jsonl");
  const traces = (await fs.readFile(tracePath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const tracesSanitized = traces.every((trace) =>
    trace.schema === "bitagent_covenant_failure_trace_v1"
    && trace.authority === "deterministic_host"
    && trace.effect === "none"
    && trace.secretMaterialPresent === false
    && trace.fabricatedStatePresent === false
    && !/(private.?key|mnemonic|seed.?phrase|\bwif\b)/i.test(JSON.stringify(trace))
  );
  const allPassed = exitCode === 0 && tests >= 30 && passed === tests && failed === 0
    && traces.length >= 12 && tracesSanitized;
  const report = {
    schema: "bitagent_strategy_covenant_evaluation_v1",
    generatedAt: new Date().toISOString(),
    allPassed,
    taskResult: { tests: { total: tests, passed, failed }, failureTraces: traces.length },
    measurementReliability: "deterministic_checks_only_no_llm_judge",
    claimSupport: allPassed ? "candidate_only_safety_claim_supported" : "candidate_only_safety_claim_not_supported",
    operationalDecision: allPassed ? "continue_shadow_testing" : "reject_and_repair",
    failureTraces: { sanitized: tracesSanitized, source: path.relative(root, tracePath) },
    scores: {
      covenantIntegrity: allPassed ? 1 : 0,
      strategyIdentity: allPassed ? 1 : 0,
      marketAndPortfolioTruth: allPassed ? 1 : 0,
      riskProjection: allPassed ? 1 : 0,
      approvalBoundary: allPassed ? 1 : 0,
      candidateRecomputation: allPassed ? 1 : 0,
      receiptRecovery: allPassed ? 1 : 0,
      secretAndEffectSafety: allPassed ? 1 : 0
    },
    stderr: stderr.trim() || undefined
  };
  const output = path.join(root, "eval", "artifacts", "covenant-evaluation-latest.json");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (!allPassed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
