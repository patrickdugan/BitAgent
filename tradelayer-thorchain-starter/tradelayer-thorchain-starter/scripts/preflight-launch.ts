import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildLaunchPreflightReceipt,
  sha256,
  type AgentEvaluationSummary,
  type LaunchPreflightCommand
} from "../src/launch/preflight.js";
import { readDagRuntimeManifest } from "../src/launch/dagRuntimeManifest.js";

const root = process.cwd();
const outputPath = path.join(root, ".runtime", "launch-preflight", "latest.json");
const evaluationPath = path.join(root, "eval", "artifacts", "agent-evaluation-latest.json");
const failureTracePath = path.join(root, "eval", "artifacts", "failure-traces.jsonl");
const releaseVerificationPath = path.join(root, ".runtime", "testnet-agent", "tx11-release-verification.json");
const dagRuntimeManifestPath = path.resolve(
  process.env.BITAGENT_DAG_RUNTIME_MANIFEST
    || path.join(root, "config", "bitagent-bonsai-dag-runtime.json")
);
const commandTimeoutMs = 180_000;

async function runNpmScript(name: LaunchPreflightCommand["name"]) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error("npm_execpath is unavailable; run this check with npm run preflight:launch");
  }

  const startedAt = Date.now();
  let output = "";
  let timedOut = false;
  const child = spawn(process.execPath, [npmCli, "run", name], {
    cwd: root,
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    output += text;
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    output += text;
    process.stderr.write(text);
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, commandTimeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  const command: LaunchPreflightCommand = {
    name,
    exitCode,
    durationMs: Date.now() - startedAt,
    outputSha256: sha256(output),
    passed: exitCode === 0 && !timedOut,
    timedOut
  };
  return { command, output };
}

async function readEvaluation() {
  try {
    return JSON.parse(await fs.readFile(evaluationPath, "utf8")) as AgentEvaluationSummary;
  } catch {
    return null;
  }
}

async function readReleaseVerification() {
  try {
    return JSON.parse(await fs.readFile(releaseVerificationPath, "utf8"));
  } catch {
    return null;
  }
}

async function readDagRuntimeEvidence() {
  try {
    const runtime = await readDagRuntimeManifest(dagRuntimeManifestPath) as Record<string, any>;
    const status = String(runtime.status || "unavailable");
    return {
      status,
      adapterArtifactAccepted: [
        "adapter_packaged_gpu_screening_required",
        "ready"
      ].includes(status),
      modelAvailable: runtime.modelAvailable === true,
      registrationId: typeof runtime.environment?.registrationId === "string"
        ? runtime.environment.registrationId
        : null,
      hermesCommit: typeof runtime.hermesLite?.commit === "string"
        ? runtime.hermesLite.commit
        : null
    };
  } catch {
    return null;
  }
}

async function countFailureTraces() {
  try {
    return (await fs.readFile(failureTracePath, "utf8"))
      .split(/\r?\n/)
      .filter((line) => line.trim()).length;
  } catch {
    return -1;
  }
}

async function writeAtomic(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function main() {
  const launchTests = await runNpmScript("test:launch");
  const agentEvaluation = await runNpmScript("eval:launch");
  const releaseVerification = await runNpmScript("verify:tradelayer-release");
  const receipt = buildLaunchPreflightReceipt({
    generatedAt: new Date().toISOString(),
    launchTests: launchTests.command,
    agentEvaluation: agentEvaluation.command,
    releaseVerification: releaseVerification.command,
    launchTestOutput: launchTests.output,
    evaluation: await readEvaluation(),
    release: await readReleaseVerification(),
    dagRuntime: await readDagRuntimeEvidence(),
    failureTraceCount: await countFailureTraces()
  });
  await writeAtomic(outputPath, receipt);
  console.log(JSON.stringify({
    receipt: path.relative(root, outputPath),
    decision: receipt.decision,
    evidence: receipt.evidence,
    authorityBoundary: receipt.authorityBoundary
  }, null, 2));
  if (!receipt.decision.scriptedLaunchReady) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
