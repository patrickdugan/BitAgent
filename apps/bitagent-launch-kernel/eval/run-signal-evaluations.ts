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
    const result = await execFileAsync(process.execPath, [tsxCli, "--test", "test/committed-signal.test.ts"], {
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
  const tracePath = path.join(root, "eval", "fixtures", "signal-failure-traces.seed.jsonl");
  const traces = (await fs.readFile(tracePath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const tracesSanitized = traces.every((trace) =>
    trace.schema === "bitagent_signal_failure_trace_v1"
    && trace.secretMaterialPresent === false
    && !/private.?key|mnemonic|seed.?phrase|wif/i.test(JSON.stringify(trace))
  );
  const allPassed = exitCode === 0 && tests >= 20 && passed === tests && failed === 0 && tracesSanitized;
  const report = {
    schema: "bitagent_committed_signal_evaluation_v1",
    generatedAt: new Date().toISOString(),
    allPassed,
    tests: { total: tests, passed, failed },
    failureTraces: { total: traces.length, sanitized: tracesSanitized, source: path.relative(root, tracePath) },
    scores: {
      codebaseProvenance: allPassed ? 1 : 0,
      signalIntegrity: allPassed ? 1 : 0,
      toolSelectionAndArguments: allPassed ? 1 : 0,
      approvalBoundary: allPassed ? 1 : 0,
      walletAndUtxoTruth: allPassed ? 1 : 0,
      riskEnforcement: allPassed ? 1 : 0,
      executionAndVerification: allPassed ? 1 : 0,
      recoveryAndSecretSafety: allPassed ? 1 : 0
    },
    stderr: stderr.trim() || undefined
  };
  const output = path.join(root, "eval", "artifacts", "signal-evaluation-latest.json");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (!allPassed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
