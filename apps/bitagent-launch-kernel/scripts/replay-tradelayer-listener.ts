import { execFile, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { writeAtomicStatusFile } from "../src/launch/atomicStatusFile.js";
import {
  classifyReplayStatus,
  validateReplayBitcoinObservation,
  validateTradeLayerListenerReplayConfig,
  type ReplayBitcoinObservation,
  type ReplayListenerStatus
} from "../src/launch/tradelayerListenerReplay.js";

type RpcEnvelope<T> = { result?: T; error?: { code?: number; message?: string } | null };

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const root = process.cwd();
const outputPath = path.resolve(process.env.BITAGENT_TRADELAYER_LISTENER_REPLAY_RECEIPT
  || path.join(".runtime", "testnet-agent", "listener-replays", "latest.json"));

async function git(repo: string, args: string[]) {
  return (await execFileAsync("git", ["-C", repo, ...args], { windowsHide: true })).stdout.trim();
}

async function exists(target: string) {
  try { await fs.access(target); return true; } catch { return false; }
}

async function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE" ? resolve(false) : reject(error));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function bitcoinRpc<T>(rpcPort: number, cookieFile: string, method: string): Promise<T> {
  if (!["getblockchaininfo", "getnetworkinfo"].includes(method)) throw new Error("unsupported replay RPC method");
  const cookie = (await fs.readFile(cookieFile, "utf8")).trim();
  if (!cookie.includes(":")) throw new Error("Bitcoin RPC cookie is invalid");
  const response = await fetch(`http://127.0.0.1:${rpcPort}`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(cookie).toString("base64")}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ jsonrpc: "1.0", id: "bitagent-listener-replay", method, params: [] }),
    signal: AbortSignal.timeout(15_000)
  });
  const text = await response.text();
  if (!response.ok || Buffer.byteLength(text, "utf8") > 1_000_000) throw new Error(`Bitcoin RPC ${method} failed`);
  const envelope = JSON.parse(text) as RpcEnvelope<T>;
  if (envelope.error) throw new Error(`Bitcoin RPC ${method} failed: ${envelope.error.message || envelope.error.code}`);
  return envelope.result as T;
}

async function observeBitcoin(rpcPort: number, cookieFile: string): Promise<ReplayBitcoinObservation> {
  const [chain, network] = await Promise.all([
    bitcoinRpc<Omit<ReplayBitcoinObservation, "networkactive" | "connections">>(rpcPort, cookieFile, "getblockchaininfo"),
    bitcoinRpc<Pick<ReplayBitcoinObservation, "networkactive" | "connections">>(rpcPort, cookieFile, "getnetworkinfo")
  ]);
  return validateReplayBitcoinObservation({
    chain: String(chain.chain || ""),
    blocks: Number(chain.blocks),
    headers: Number(chain.headers),
    initialblockdownload: chain.initialblockdownload === true,
    pruned: chain.pruned === true,
    bestblockhash: String(chain.bestblockhash || "").toLowerCase(),
    networkactive: network.networkactive === true,
    connections: Number(network.connections)
  });
}

async function listenerStatus(port: number): Promise<ReplayListenerStatus> {
  const response = await fetch(`http://127.0.0.1:${port}/tl_getSyncStatus`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(5_000)
  });
  const text = await response.text();
  if (!response.ok || Buffer.byteLength(text, "utf8") > 1_000_000) throw new Error("listener status request failed");
  return JSON.parse(text) as ReplayListenerStatus;
}

async function waitUntilReachable(port: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return await listenerStatus(port); } catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  throw new Error("listener startup timed out");
}

async function requestInitialization(port: number) {
  try {
    await fetch(`http://127.0.0.1:${port}/tl_initmain`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5_000)
    });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "TimeoutError")) throw error;
  }
}

async function main() {
  const config = validateTradeLayerListenerReplayConfig(JSON.parse(
    process.env.BITAGENT_TRADELAYER_LISTENER_REPLAY_JSON || "null"
  ));
  const commit = (await git(config.sourceRepo, ["rev-parse", "HEAD"])).toLowerCase();
  if (commit !== config.sourceCommit) throw new Error("listener replay source commit mismatch");
  if (await git(config.sourceRepo, ["status", "--porcelain", "--untracked-files=no"])) {
    throw new Error("listener replay source has tracked changes");
  }
  if (await exists(path.join(config.sourceRepo, ".env"))) throw new Error("listener replay source contains a .env file");
  if (await exists(config.nedbRoot)) throw new Error("listener replay state root already exists");
  if (await exists(config.logDir)) throw new Error("listener replay log root already exists");
  if (!await exists(config.rpcCookieFile)) throw new Error("listener replay RPC cookie is unavailable");
  if (!await portIsFree(config.listenerPort)) throw new Error("listener replay port is occupied");

  const bitcoin = await observeBitcoin(config.rpcPort, config.rpcCookieFile);
  const profile = require(path.join(config.sourceRepo, "scripts", "testnetActivationProfile.js")) as {
    codeHashFromSource(sourceDirectory?: string): string;
  };
  const codeHash = profile.codeHashFromSource(path.join(config.sourceRepo, "src"));
  await fs.mkdir(config.nedbRoot, { recursive: false });
  await fs.mkdir(config.logDir, { recursive: true });

  const inherited = Object.fromEntries([
    "SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "Path", "ComSpec", "PATHEXT"
  ].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []));
  const env = {
    ...inherited,
    NODE_PATH: path.join(config.sourceRepo, "node_modules"),
    CHAIN: "BTCTEST",
    AUTODETECT: "0",
    RPC_HOST: "127.0.0.1",
    RPC_PORT: String(config.rpcPort),
    RPC_COOKIE_FILE: config.rpcCookieFile,
    TL_NEDB_ROOT: config.nedbRoot,
    TL_GENESIS_BLOCK: "1",
    TL_DECODE_BLOCK_TRANSACTIONS: "1",
    TL_ACTIVATION_NETWORK: "BTCTEST",
    TL_LISTENER_PORT: String(config.listenerPort),
    TL_LISTENER_NODE_ID: config.nodeId,
    TL_LISTENER_INSTANCE_ID: config.instanceId,
    TL_RELEASE_COMMIT: commit
  };
  const stdout = openSync(path.join(config.logDir, "listener.stdout.log"), "a");
  const stderr = openSync(path.join(config.logDir, "listener.stderr.log"), "a");
  let child;
  try {
    child = spawn(process.execPath, ["src/walletListener.js"], {
      cwd: config.sourceRepo,
      env,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", stdout, stderr]
    });
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
  if (!child.pid) throw new Error("listener replay process has no PID");
  child.unref();
  const started = {
    schema: "bitagent_tradelayer_listener_replay_receipt_v1",
    status: "replay_in_progress",
    authority: "operator_host",
    effect: "listener_process_and_isolated_state_only",
    sourceCommit: commit,
    sourceCodeHash: codeHash,
    bitcoin,
    listener: { pid: child.pid, port: config.listenerPort, nodeId: config.nodeId, instanceId: config.instanceId },
    walletEffects: false,
    signingPerformed: false,
    broadcastPerformed: false,
    recovery: "Stop only the recorded PID; preserve the isolated state and logs for inspection."
  };
  await writeAtomicStatusFile(outputPath, started);

  try {
    await waitUntilReachable(config.listenerPort, config.startupTimeoutMs);
    await requestInitialization(config.listenerPort);
    const deadline = Date.now() + config.replayTimeoutMs;
    let status: ReplayListenerStatus = {};
    let lastBackendCheck = 0;
    while (Date.now() < deadline) {
      status = await listenerStatus(config.listenerPort);
      if (Date.now() - lastBackendCheck >= 60_000) {
        const observed = await observeBitcoin(config.rpcPort, config.rpcCookieFile);
        if (observed.bestblockhash !== bitcoin.bestblockhash || observed.blocks !== bitcoin.blocks) {
          throw new Error("sealed Bitcoin replay target changed");
        }
        lastBackendCheck = Date.now();
      }
      if (classifyReplayStatus(status, bitcoin.blocks) === "complete") {
        const bitcoinAfter = await observeBitcoin(config.rpcPort, config.rpcCookieFile);
        if (bitcoinAfter.bestblockhash !== bitcoin.bestblockhash || bitcoinAfter.blocks !== bitcoin.blocks) {
          throw new Error("sealed Bitcoin replay target changed");
        }
        await writeAtomicStatusFile(outputPath, {
          ...started,
          status: "replay_complete_unpromoted",
          completedAt: new Date().toISOString(),
          finalListenerStatus: status,
          bitcoinAfter,
          recovery: "Snapshot the quiescent state, then deploy an isolated pair and run challenge-bound preflight before promotion."
        });
        console.log(JSON.stringify({ output: outputPath, status: "replay_complete_unpromoted", pid: child.pid, codeHash }, null, 2));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error("listener full replay timed out");
  } catch (error) {
    const lastListenerStatus = await listenerStatus(config.listenerPort).catch(() => null);
    try { process.kill(child.pid); } catch { /* already stopped */ }
    await writeAtomicStatusFile(outputPath, {
      ...started,
      status: "failed",
      failedAt: new Date().toISOString(),
      ownedPidStopped: child.pid,
      lastListenerStatus,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
