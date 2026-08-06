import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  decideTestnet4SyncControl,
  formatBitcoinPeerEndpoint,
  validateTestnet4SyncThrottlePolicy,
  type BitcoinAddrmanEntry,
  type Testnet4SyncSnapshot
} from "../src/launch/testnet4SyncThrottle.js";

type Pair = {
  name: string;
  listenerUrl: string;
  rpcUrl: string;
  cookieFile: string;
};

type RpcResponse<T> = { result?: T; error?: { code?: number; message?: string } | null };

const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function boundedInteger(value: string | undefined, fallback: number, label: string): number {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} must be a non-negative safe integer`);
  return number;
}

function requestTimeoutMs(): number {
  const timeout = boundedInteger(process.env.BITAGENT_SYNC_REQUEST_TIMEOUT_MS, 15_000, "BITAGENT_SYNC_REQUEST_TIMEOUT_MS");
  if (timeout < 1_000 || timeout > 60_000) {
    throw new Error("BITAGENT_SYNC_REQUEST_TIMEOUT_MS must be between 1000 and 60000");
  }
  return timeout;
}

function loopbackUrl(value: string, label: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || !loopbackHosts.has(url.hostname)) {
    throw new Error(`${label} must be an unauthenticated loopback HTTP URL`);
  }
  if (url.username || url.password) throw new Error(`${label} must not contain credentials`);
  return url.toString().replace(/\/$/, "");
}

function parsePairs(raw: string | undefined): Pair[] {
  if (!raw) throw new Error("BITAGENT_TESTNET4_SYNC_PAIRS_JSON is required");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 4) {
    throw new Error("BITAGENT_TESTNET4_SYNC_PAIRS_JSON must contain one to four pairs");
  }
  const names = new Set<string>();
  return parsed.map((value, index) => {
    const item = value as Partial<Pair>;
    const name = String(item.name || "").trim();
    if (!/^[A-Za-z0-9._:-]{1,64}$/.test(name) || names.has(name)) throw new Error(`pair ${index} has an invalid or duplicate name`);
    names.add(name);
    const cookieFile = String(item.cookieFile || "").trim();
    if (!cookieFile) throw new Error(`pair ${name} is missing cookieFile`);
    return {
      name,
      listenerUrl: loopbackUrl(String(item.listenerUrl || ""), `pair ${name} listenerUrl`),
      rpcUrl: loopbackUrl(String(item.rpcUrl || ""), `pair ${name} rpcUrl`),
      cookieFile
    };
  });
}

async function bitcoinRpc<T>(pair: Pair, method: string, params: unknown[] = []): Promise<T> {
  const cookie = (await fs.readFile(pair.cookieFile, "utf8")).trim();
  if (!cookie.includes(":")) throw new Error(`pair ${pair.name} has an invalid RPC cookie`);
  const response = await fetch(pair.rpcUrl, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(cookie).toString("base64")}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ jsonrpc: "1.0", id: "bitagent-sync-throttle", method, params }),
    signal: AbortSignal.timeout(requestTimeoutMs())
  });
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error(`pair ${pair.name} RPC response exceeded size limit`);
  if (!response.ok) throw new Error(`pair ${pair.name} RPC ${method} returned HTTP ${response.status}`);
  const body = JSON.parse(text) as RpcResponse<T>;
  if (body.error) throw new Error(`pair ${pair.name} RPC ${method} failed: ${body.error.message || body.error.code || "unknown"}`);
  return body.result as T;
}

async function listenerStatus(pair: Pair): Promise<{ phase: string; error?: string | null; trackHeight: number }> {
  const response = await fetch(`${pair.listenerUrl}/tl_getSyncStatus`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(requestTimeoutMs())
  });
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error(`pair ${pair.name} listener response exceeded size limit`);
  if (!response.ok) throw new Error(`pair ${pair.name} listener returned HTTP ${response.status}`);
  const body = JSON.parse(text) as { phase?: unknown; error?: unknown; trackHeight?: unknown };
  if (!Number.isSafeInteger(body.trackHeight) || Number(body.trackHeight) < 0) {
    throw new Error(`pair ${pair.name} listener returned an invalid trackHeight`);
  }
  return {
    phase: String(body.phase || ""),
    error: body.error ? String(body.error) : null,
    trackHeight: Number(body.trackHeight)
  };
}

async function snapshot(pair: Pair): Promise<Testnet4SyncSnapshot> {
  const [chain, network, listener] = await Promise.all([
    bitcoinRpc<{ chain: string; blocks: number; headers: number; pruned: boolean; pruneheight?: number; initialblockdownload: boolean }>(pair, "getblockchaininfo"),
    bitcoinRpc<{ networkactive: boolean; connections: number }>(pair, "getnetworkinfo"),
    listenerStatus(pair)
  ]);
  if (chain.chain !== "testnet4") throw new Error(`pair ${pair.name} Bitcoin backend is not testnet4`);
  return {
    bitcoinHeight: chain.blocks,
    headerHeight: chain.headers,
    pruneHeight: chain.pruned ? Number(chain.pruneheight || 0) : 0,
    initialBlockDownload: chain.initialblockdownload === true,
    networkActive: network.networkactive === true,
    connections: Number(network.connections || 0),
    trackHeight: listener.trackHeight,
    listenerPhase: listener.phase,
    listenerError: listener.error
  };
}

async function kickAddrmanPeers(pair: Pair): Promise<number> {
  const entries = await bitcoinRpc<BitcoinAddrmanEntry[]>(pair, "getnodeaddresses", [16]);
  const endpoints = entries.map(formatBitcoinPeerEndpoint)
    .filter((value): value is string => Boolean(value))
    .slice(0, 1);
  const attempts = await Promise.allSettled(
    endpoints.map((endpoint) => bitcoinRpc(pair, "addnode", [endpoint, "onetry"]))
  );
  return attempts.filter((attempt) => attempt.status === "fulfilled").length;
}

async function setNetwork(pair: Pair, active: boolean): Promise<void> {
  await bitcoinRpc(pair, "setnetworkactive", [active]);
}

async function pauseAll(pairs: Pair[]): Promise<void> {
  await Promise.allSettled(pairs.map((pair) => setNetwork(pair, false)));
}

async function writeStatus(outputPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = outputPath + "." + process.pid + ".tmp";
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(temporary, outputPath);
}

async function main() {
  const pairs = parsePairs(process.env.BITAGENT_TESTNET4_SYNC_PAIRS_JSON);
  const policy = validateTestnet4SyncThrottlePolicy({
    lowWatermark: boundedInteger(process.env.BITAGENT_SYNC_LOW_WATERMARK, 25, "BITAGENT_SYNC_LOW_WATERMARK"),
    highWatermark: boundedInteger(process.env.BITAGENT_SYNC_HIGH_WATERMARK, 250, "BITAGENT_SYNC_HIGH_WATERMARK"),
    stopHeight: boundedInteger(process.env.BITAGENT_SYNC_STOP_HEIGHT, 0, "BITAGENT_SYNC_STOP_HEIGHT")
  });
  if (policy.stopHeight < 1) throw new Error("BITAGENT_SYNC_STOP_HEIGHT is required and must be positive");
  const pollMs = boundedInteger(process.env.BITAGENT_SYNC_POLL_MS, 1_000, "BITAGENT_SYNC_POLL_MS");
  const maxRuntimeMs = boundedInteger(process.env.BITAGENT_SYNC_MAX_RUNTIME_MS, 1_800_000, "BITAGENT_SYNC_MAX_RUNTIME_MS");
  const statusPath = path.resolve(process.env.BITAGENT_SYNC_STATUS_PATH
    || path.join(".runtime", "testnet-agent", "sync-throttle-status.json"));
  if (pollMs < 250 || pollMs > 30_000) throw new Error("BITAGENT_SYNC_POLL_MS must be between 250 and 30000");
  const startedAt = Date.now();
  const lastPeerKick = new Map<string, number>();
  let interrupted = false;
  process.once("SIGINT", () => { interrupted = true; });
  process.once("SIGTERM", () => { interrupted = true; });

  try {
    while (!interrupted) {
      if (Date.now() - startedAt > maxRuntimeMs) throw new Error("sync throttle exceeded BITAGENT_SYNC_MAX_RUNTIME_MS");
      const states = await Promise.all(pairs.map(async (pair) => {
        const observed = await snapshot(pair);
        const decision = decideTestnet4SyncControl(observed, policy);
        let peerKickAttempts = 0;
        if (decision.action === "enable_network" && !observed.networkActive) {
          await setNetwork(pair, true);
          peerKickAttempts = await kickAddrmanPeers(pair);
          lastPeerKick.set(pair.name, Date.now());
        } else if (observed.networkActive && observed.connections === 0 && decision.lag <= policy.lowWatermark
          && Date.now() - (lastPeerKick.get(pair.name) || 0) >= 15_000) {
          peerKickAttempts = await kickAddrmanPeers(pair);
          lastPeerKick.set(pair.name, Date.now());
        }
        if ((decision.action === "disable_network" || decision.action === "fail") && observed.networkActive) await setNetwork(pair, false);
        const event = { at: new Date().toISOString(), pair: pair.name, ...observed, ...decision, peerKickAttempts };
        console.log(JSON.stringify(event));
        return { pair, decision, event };
      }));
      await writeStatus(statusPath, {
        schema: "bitagent_testnet4_sync_throttle_status_v1",
        authority: "bitcoin_peer_network_control_only",
        effect: "setnetworkactive_and_addrman_onetry",
        updatedAt: new Date().toISOString(),
        stopHeight: policy.stopHeight,
        states: states.map((state) => state.event)
      });
      const failed = states.find((state) => state.decision.action === "fail");
      if (failed) throw new Error(`pair ${failed.pair.name} failed closed: ${failed.decision.reason}`);
      if (states.every((state) => state.decision.action === "complete")) {
        await pauseAll(pairs);
        console.log(JSON.stringify({ ok: true, status: "bounded_target_caught_up", stopHeight: policy.stopHeight }));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new Error("sync throttle interrupted");
  } catch (error) {
    await pauseAll(pairs);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
