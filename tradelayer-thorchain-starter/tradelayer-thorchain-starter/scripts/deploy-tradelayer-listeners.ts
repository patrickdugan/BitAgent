import { execFile, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import {
  hashTradeLayerListenerSnapshot,
  validateTradeLayerListenerDeploymentConfig,
  type TradeLayerListenerDeploymentTarget
} from "../src/launch/tradelayerListenerDeployment.js";
import { validateTx11ReleaseManifest, verifyLocalTx11Release } from "../src/launch/tradelayerRelease.js";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const manifestPath = path.join(root, "config", "tradelayer-tx11-release.json");
const outputPath = path.resolve(process.env.BITAGENT_TRADELAYER_LISTENER_DEPLOYMENT_RECEIPT
  || path.join(".runtime", "testnet-agent", "listener-deployments", "latest.json"));

async function git(sourceRepo: string, args: string[]) {
  const { stdout } = await execFileAsync("git", ["-C", sourceRepo, ...args], { windowsHide: true });
  return stdout.trim();
}

async function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function publicEnvironment(target: TradeLayerListenerDeploymentTarget, releaseCommit: string): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries([
    "SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "Path", "ComSpec", "PATHEXT"
  ].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []));
  return {
    ...inherited,
    CHAIN: "BTCTEST",
    AUTODETECT: "0",
    RPC_HOST: "127.0.0.1",
    RPC_PORT: String(target.rpcPort),
    RPC_COOKIE_FILE: target.rpcCookieFile,
    TL_NEDB_ROOT: target.nedbRoot,
    TL_GENESIS_BLOCK: "1",
    TL_DECODE_BLOCK_TRANSACTIONS: "1",
    TL_ACTIVATION_NETWORK: "BTCTEST",
    TL_LISTENER_PORT: String(target.port),
    TL_LISTENER_NODE_ID: target.nodeId,
    TL_LISTENER_INSTANCE_ID: target.instanceId,
    TL_RELEASE_COMMIT: releaseCommit
  };
}

async function waitForSyncStatus(endpoint: string, timeoutMs: number, requireInitialized = false) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "listener did not respond";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/tl_getSyncStatus`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(5_000)
      });
      const text = await response.text();
      if (!response.ok || Buffer.byteLength(text, "utf8") > 1_000_000) throw new Error(`HTTP ${response.status}`);
      const value = JSON.parse(text) as Record<string, unknown>;
      if (!Number.isSafeInteger(Number(value.trackHeight))) throw new Error("invalid trackHeight");
      if (requireInitialized && (value.initialized !== true || String(value.phase || "") === "idle"
        || Number(value.trackHeight) < 1)) {
        throw new Error("listener main index is not initialized");
      }
      return {
        initialized: value.initialized === true,
        phase: String(value.phase || ""),
        trackHeight: Number(value.trackHeight),
        indexedHeight: Number(value.indexedHeight || 0),
        processedHeight: Number(value.processedHeight || 0),
        error: value.error ?? null
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`listener startup timed out: ${lastError}`);
}

async function requestInitialization(endpoint: string) {
  try {
    const response = await fetch(`${endpoint}/tl_initmain`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return "completed" as const;
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") return "in_progress" as const;
    throw error;
  }
}

async function writeReceipt(value: unknown) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, outputPath);
}

async function main() {
  const config = validateTradeLayerListenerDeploymentConfig(JSON.parse(
    process.env.BITAGENT_TRADELAYER_LISTENER_DEPLOYMENT_JSON || "null"
  ));
  const manifest = validateTx11ReleaseManifest(JSON.parse(await fs.readFile(manifestPath, "utf8")));
  const sourceCommit = (await git(config.sourceRepo, ["rev-parse", "HEAD"])).toLowerCase();
  const trackedStatus = await git(config.sourceRepo, ["status", "--porcelain", "--untracked-files=no"]);
  if (trackedStatus) throw new Error("TradeLayer listener source has tracked changes");
  if (await exists(path.join(config.sourceRepo, ".env"))) {
    throw new Error("TradeLayer listener source contains a .env file; refusing implicit credential loading");
  }
  const source = verifyLocalTx11Release({ manifest, tradelayerRepo: config.sourceRepo, currentCommit: sourceCommit });
  if (!source.sourceVerified) throw new Error(`TradeLayer release source failed verification: ${source.reasons.join(",")}`);

  const staged: Array<{
    target: TradeLayerListenerDeploymentTarget;
    snapshot: Awaited<ReturnType<typeof hashTradeLayerListenerSnapshot>>;
    copy: Awaited<ReturnType<typeof hashTradeLayerListenerSnapshot>>;
  }> = [];
  for (const target of config.listeners) {
    if (!await portIsFree(target.port)) throw new Error(`listener port ${target.port} is already in use`);
    if (!await exists(target.rpcCookieFile)) throw new Error(`listener ${target.name} RPC cookie is unavailable`);
    if (await exists(target.nedbRoot)) throw new Error(`listener ${target.name} state target already exists`);
    const snapshot = await hashTradeLayerListenerSnapshot(target.snapshotDir);
    const databaseTarget = path.join(target.nedbRoot, "btc-test");
    await fs.mkdir(target.nedbRoot, { recursive: true });
    await fs.cp(target.snapshotDir, databaseTarget, { recursive: true, force: false, errorOnExist: true });
    const copy = await hashTradeLayerListenerSnapshot(databaseTarget);
    if (copy.inventoryHash !== snapshot.inventoryHash) throw new Error(`listener ${target.name} state copy hash mismatch`);
    await fs.mkdir(target.logDir, { recursive: true });
    staged.push({ target, snapshot, copy });
  }

  const started: Array<{ pid: number; name: string }> = [];
  try {
    const listeners = [];
    for (const item of staged) {
      const stdoutPath = path.join(item.target.logDir, "listener.stdout.log");
      const stderrPath = path.join(item.target.logDir, "listener.stderr.log");
      const stdout = openSync(stdoutPath, "a");
      const stderr = openSync(stderrPath, "a");
      let child;
      try {
        child = spawn(process.execPath, ["src/walletListener.js"], {
          cwd: config.sourceRepo,
          env: publicEnvironment(item.target, manifest.deploymentCommit),
          detached: true,
          windowsHide: true,
          stdio: ["ignore", stdout, stderr]
        });
      } finally {
        closeSync(stdout);
        closeSync(stderr);
      }
      if (!child.pid) throw new Error(`listener ${item.target.name} did not receive a process id`);
      child.unref();
      started.push({ pid: child.pid, name: item.target.name });
      const endpoint = `http://127.0.0.1:${item.target.port}`;
      await waitForSyncStatus(endpoint, config.startupTimeoutMs);
      const initializationRequest = await requestInitialization(endpoint);
      const sync = await waitForSyncStatus(endpoint, config.startupTimeoutMs, true);
      listeners.push({
        name: item.target.name,
        nodeId: item.target.nodeId,
        instanceId: item.target.instanceId,
        endpoint,
        rpcPort: item.target.rpcPort,
        pid: child.pid,
        nedbRoot: item.target.nedbRoot,
        logDir: item.target.logDir,
        snapshotInventoryHash: item.snapshot.inventoryHash,
        copiedInventoryHash: item.copy.inventoryHash,
        snapshotFiles: item.snapshot.files,
        snapshotBytes: item.snapshot.bytes,
        initializationRequest,
        sync
      });
    }
    const receipt = {
      schema: "bitagent_tradelayer_listener_deployment_receipt_v1",
      status: "candidate_pair_started_unverified",
      authority: "operator_host",
      effect: "listener_process_start_and_state_copy_no_wallet_effect",
      releaseId: manifest.releaseId,
      releaseStatus: manifest.status,
      sourceCommit,
      sourceCodeHash: source.currentCodeHash,
      startedAt: new Date().toISOString(),
      listenerCount: listeners.length,
      listeners,
      walletEffects: false,
      approvalRequested: false,
      signingPerformed: false,
      broadcastPerformed: false,
      recovery: "Stop only the recorded listener PIDs; preserve copied state and logs for inspection."
    };
    await writeReceipt(receipt);
    console.log(JSON.stringify({ output: outputPath, ...receipt }, null, 2));
  } catch (error) {
    for (const owned of started) {
      try { process.kill(owned.pid); } catch { /* already exited */ }
    }
    await writeReceipt({
      schema: "bitagent_tradelayer_listener_deployment_receipt_v1",
      status: "failed",
      authority: "operator_host",
      effect: "listener_process_start_and_state_copy_no_wallet_effect",
      releaseId: manifest.releaseId,
      sourceCommit,
      ownedPidsStopped: started.map((item) => item.pid),
      error: error instanceof Error ? error.message : String(error),
      walletEffects: false,
      signingPerformed: false,
      broadcastPerformed: false
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
