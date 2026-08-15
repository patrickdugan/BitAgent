import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { writeAtomicStatusFile } from "../src/launch/atomicStatusFile.js";
import {
  decideTestnet4SyncControl,
  formatBitcoinPeerEndpoint,
  isUnsyncedTestnet4RecoveryPeer,
  recoveryPeerIdsToDisconnect,
  selectTestnet4RecoveryPeer,
  shouldInspectStalledTestnet4Peer,
  validateTestnet4SyncThrottlePolicy,
  type BitcoinAddrmanEntry,
  type BitcoinPeerSourceObservation,
  type BitcoinRecoveryPeer,
  type Testnet4SyncSnapshot
} from "../src/launch/testnet4SyncThrottle.js";

type RpcEndpoint = {
  name: string;
  rpcUrl: string;
  cookieFile: string;
};

type Pair = RpcEndpoint & {
  name: string;
  listenerUrl: string;
};

type PeerSource = RpcEndpoint;

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

function parsePeerSources(raw: string | undefined, pairs: Pair[]): Map<string, PeerSource> {
  if (!raw) return new Map();
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > pairs.length) {
    throw new Error("BITAGENT_TESTNET4_SYNC_PEER_SOURCES_JSON must contain one source per selected pair at most");
  }
  const pairNames = new Set(pairs.map((pair) => pair.name));
  const sources = new Map<string, PeerSource>();
  for (const [index, value] of parsed.entries()) {
    const item = value as Partial<PeerSource>;
    const name = String(item.name || "").trim();
    if (!pairNames.has(name) || sources.has(name)) {
      throw new Error(`peer source ${index} has an unknown or duplicate pair name`);
    }
    const cookieFile = String(item.cookieFile || "").trim();
    if (!cookieFile) throw new Error(`peer source ${name} is missing cookieFile`);
    sources.set(name, {
      name,
      rpcUrl: loopbackUrl(String(item.rpcUrl || ""), `peer source ${name} rpcUrl`),
      cookieFile
    });
  }
  return sources;
}

async function bitcoinRpc<T>(endpoint: RpcEndpoint, method: string, params: unknown[] = []): Promise<T> {
  const cookie = (await fs.readFile(endpoint.cookieFile, "utf8")).trim();
  if (!cookie.includes(":")) throw new Error(`endpoint ${endpoint.name} has an invalid RPC cookie`);
  let response: Response;
  try {
    response = await fetch(endpoint.rpcUrl, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(cookie).toString("base64")}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ jsonrpc: "1.0", id: "bitagent-sync-throttle", method, params }),
      signal: AbortSignal.timeout(requestTimeoutMs())
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`endpoint ${endpoint.name} RPC ${method} request failed: ${detail}`);
  }
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error(`endpoint ${endpoint.name} RPC response exceeded size limit`);
  if (!response.ok) throw new Error(`endpoint ${endpoint.name} RPC ${method} returned HTTP ${response.status}`);
  const body = JSON.parse(text) as RpcResponse<T>;
  if (body.error) throw new Error(`endpoint ${endpoint.name} RPC ${method} failed: ${body.error.message || body.error.code || "unknown"}`);
  return body.result as T;
}

async function listenerStatus(pair: Pair): Promise<{ phase: string; error?: string | null; trackHeight: number }> {
  let response: Response;
  try {
    response = await fetch(`${pair.listenerUrl}/tl_getSyncStatus`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(requestTimeoutMs())
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`pair ${pair.name} listener sync request failed: ${detail}`);
  }
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
  const [chain, network, listener, fileSystem] = await Promise.all([
    bitcoinRpc<{ chain: string; blocks: number; headers: number; pruned: boolean; pruneheight?: number; initialblockdownload: boolean }>(pair, "getblockchaininfo"),
    bitcoinRpc<{ networkactive: boolean; connections: number }>(pair, "getnetworkinfo"),
    listenerStatus(pair),
    fs.statfs(path.dirname(pair.cookieFile))
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
    listenerError: listener.error,
    freeBytes: Number(fileSystem.bavail) * Number(fileSystem.bsize)
  };
}

async function kickAddrmanPeers(pair: Pair, excluded = new Set<string>()): Promise<number> {
  const entries = await bitcoinRpc<BitcoinAddrmanEntry[]>(pair, "getnodeaddresses", [16]);
  const endpoints = entries.map(formatBitcoinPeerEndpoint)
    .filter((value): value is string => Boolean(value))
    .filter((value) => !excluded.has(value))
    .slice(0, 1);
  const attempts = await Promise.allSettled(
    endpoints.map((endpoint) => bitcoinRpc(pair, "addnode", [endpoint, "onetry"]))
  );
  return attempts.filter((attempt) => attempt.status === "fulfilled").length;
}

async function kickRecoveryPeer(
  pair: Pair,
  source: PeerSource | undefined,
  excluded: Set<string>
): Promise<{ peerKickAttempts: number; sourcePeerKickAttempts: number; sourcePeerFallbacks: number }> {
  if (source) {
    try {
      const [chain, network, peers] = await Promise.all([
        bitcoinRpc<{ chain: string; blocks: number; initialblockdownload: boolean }>(source, "getblockchaininfo"),
        bitcoinRpc<{ networkactive: boolean }>(source, "getnetworkinfo"),
        bitcoinRpc<BitcoinRecoveryPeer[]>(source, "getpeerinfo")
      ]);
      const observation: BitcoinPeerSourceObservation = {
        chain: chain.chain,
        blocks: chain.blocks,
        initialblockdownload: chain.initialblockdownload === true,
        networkactive: network.networkactive === true
      };
      const selected = selectTestnet4RecoveryPeer(observation, peers, excluded);
      if (selected) {
        await bitcoinRpc(pair, "addnode", [selected, "onetry"]);
        return { peerKickAttempts: 1, sourcePeerKickAttempts: 1, sourcePeerFallbacks: 0 };
      }
    } catch {
      // A read-only peer source is optional. Target addrman remains the bounded fallback.
    }
    const peerKickAttempts = await kickAddrmanPeers(pair, excluded);
    return { peerKickAttempts, sourcePeerKickAttempts: 0, sourcePeerFallbacks: 1 };
  }
  const peerKickAttempts = await kickAddrmanPeers(pair, excluded);
  return { peerKickAttempts, sourcePeerKickAttempts: 0, sourcePeerFallbacks: 0 };
}

async function rotateUnsyncedPeers(
  pair: Pair,
  observed: Testnet4SyncSnapshot,
  excluded: Set<string>
): Promise<number> {
  const peers = await bitcoinRpc<BitcoinRecoveryPeer[]>(pair, "getpeerinfo");
  const stale = peers.filter((peer) => isUnsyncedTestnet4RecoveryPeer(peer, observed));
  let disconnected = 0;
  for (const peer of stale) {
    if (typeof peer.addr === "string" && peer.addr) excluded.add(peer.addr);
    await bitcoinRpc(pair, "disconnectnode", ["", peer.id]);
    disconnected += 1;
  }
  return disconnected;
}

async function trimExcessRecoveryPeers(pair: Pair): Promise<number> {
  const peers = await bitcoinRpc<BitcoinRecoveryPeer[]>(pair, "getpeerinfo");
  const ids = recoveryPeerIdsToDisconnect(peers, 1);
  for (const id of ids) await bitcoinRpc(pair, "disconnectnode", ["", id]);
  return ids.length;
}

async function setNetwork(pair: Pair, active: boolean): Promise<void> {
  await bitcoinRpc(pair, "setnetworkactive", [active]);
}

async function pauseAll(pairs: Pair[]) {
  const outcomes = await Promise.allSettled(pairs.map((pair) => setNetwork(pair, false)));
  return outcomes.map((outcome, index) => ({
    pair: pairs[index].name,
    status: outcome.status === "fulfilled" ? "paused" as const : "pause_failed" as const,
    error: outcome.status === "rejected"
      ? (outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason))
      : null
  }));
}

async function writeStatus(outputPath: string, value: unknown): Promise<void> {
  await writeAtomicStatusFile(outputPath, value);
}

async function main() {
  const pairs = parsePairs(process.env.BITAGENT_TESTNET4_SYNC_PAIRS_JSON);
  const peerSources = parsePeerSources(process.env.BITAGENT_TESTNET4_SYNC_PEER_SOURCES_JSON, pairs);
  const quietValue = process.env.BITAGENT_SYNC_QUIET;
  if (quietValue !== undefined && quietValue !== "0" && quietValue !== "1") {
    throw new Error("BITAGENT_SYNC_QUIET must be 0 or 1");
  }
  const quiet = quietValue === "1";
  const policy = validateTestnet4SyncThrottlePolicy({
    lowWatermark: boundedInteger(process.env.BITAGENT_SYNC_LOW_WATERMARK, 25, "BITAGENT_SYNC_LOW_WATERMARK"),
    highWatermark: boundedInteger(process.env.BITAGENT_SYNC_HIGH_WATERMARK, 250, "BITAGENT_SYNC_HIGH_WATERMARK"),
    stopHeight: boundedInteger(process.env.BITAGENT_SYNC_STOP_HEIGHT, 0, "BITAGENT_SYNC_STOP_HEIGHT"),
    minFreeBytes: boundedInteger(process.env.BITAGENT_SYNC_MIN_FREE_BYTES, 750 * 1024 * 1024, "BITAGENT_SYNC_MIN_FREE_BYTES")
  });
  if (policy.stopHeight < 1) throw new Error("BITAGENT_SYNC_STOP_HEIGHT is required and must be positive");
  const pollMs = boundedInteger(process.env.BITAGENT_SYNC_POLL_MS, 1_000, "BITAGENT_SYNC_POLL_MS");
  const maxRuntimeMs = boundedInteger(process.env.BITAGENT_SYNC_MAX_RUNTIME_MS, 1_800_000, "BITAGENT_SYNC_MAX_RUNTIME_MS");
  const peerStallMs = boundedInteger(process.env.BITAGENT_SYNC_PEER_STALL_MS, 120_000, "BITAGENT_SYNC_PEER_STALL_MS");
  const statusPath = path.resolve(process.env.BITAGENT_SYNC_STATUS_PATH
    || path.join(".runtime", "testnet-agent", "sync-throttle-status.json"));
  if (pollMs < 250 || pollMs > 30_000) throw new Error("BITAGENT_SYNC_POLL_MS must be between 250 and 30000");
  if (peerStallMs < 30_000 || peerStallMs > 600_000) {
    throw new Error("BITAGENT_SYNC_PEER_STALL_MS must be between 30000 and 600000");
  }
  const startedAt = Date.now();
  const lastPeerKick = new Map<string, number>();
  const lastBitcoinHeight = new Map<string, number>();
  const lastBitcoinProgressAt = new Map<string, number>();
  const excludedPeerAddresses = new Map<string, Set<string>>();
  let lastEvents: Array<Record<string, unknown>> = [];
  let interrupted = false;
  process.once("SIGINT", () => { interrupted = true; });
  process.once("SIGTERM", () => { interrupted = true; });

  try {
    while (!interrupted) {
      if (Date.now() - startedAt > maxRuntimeMs) throw new Error("sync throttle exceeded BITAGENT_SYNC_MAX_RUNTIME_MS");
      const states = await Promise.all(pairs.map(async (pair) => {
        const observed = await snapshot(pair);
        const decision = decideTestnet4SyncControl(observed, policy);
        const now = Date.now();
        const previousHeight = lastBitcoinHeight.get(pair.name);
        if (previousHeight === undefined || observed.bitcoinHeight > previousHeight) {
          lastBitcoinHeight.set(pair.name, observed.bitcoinHeight);
          lastBitcoinProgressAt.set(pair.name, now);
        }
        let peerKickAttempts = 0;
        let sourcePeerKickAttempts = 0;
        let sourcePeerFallbacks = 0;
        let peerDisconnectAttempts = 0;
        let peerTrimAttempts = 0;
        const excluded = excludedPeerAddresses.get(pair.name) || new Set<string>();
        excludedPeerAddresses.set(pair.name, excluded);
        if (observed.networkActive && observed.connections > 1) {
          peerTrimAttempts = await trimExcessRecoveryPeers(pair);
        }
        if (decision.action === "enable_network" && !observed.networkActive) {
          await setNetwork(pair, true);
          ({ peerKickAttempts, sourcePeerKickAttempts, sourcePeerFallbacks } = await kickRecoveryPeer(
            pair, peerSources.get(pair.name), excluded
          ));
          lastPeerKick.set(pair.name, Date.now());
        } else if (observed.networkActive && observed.connections === 0 && decision.lag <= policy.lowWatermark
          && Date.now() - (lastPeerKick.get(pair.name) || 0) >= 15_000) {
          ({ peerKickAttempts, sourcePeerKickAttempts, sourcePeerFallbacks } = await kickRecoveryPeer(
            pair, peerSources.get(pair.name), excluded
          ));
          lastPeerKick.set(pair.name, Date.now());
        } else if (shouldInspectStalledTestnet4Peer({
          snapshot: observed,
          decision,
          policy,
          nowMs: now,
          lastProgressAtMs: lastBitcoinProgressAt.get(pair.name) || startedAt,
          peerStallMs
        })) {
          peerDisconnectAttempts = await rotateUnsyncedPeers(pair, observed, excluded);
          if (peerDisconnectAttempts > 0) {
            ({ peerKickAttempts, sourcePeerKickAttempts, sourcePeerFallbacks } = await kickRecoveryPeer(
              pair, peerSources.get(pair.name), excluded
            ));
            lastPeerKick.set(pair.name, now);
            lastBitcoinProgressAt.set(pair.name, now);
          }
        }
        if ((decision.action === "disable_network" || decision.action === "fail") && observed.networkActive) await setNetwork(pair, false);
        const event = {
          at: new Date().toISOString(),
          pair: pair.name,
          ...observed,
          ...decision,
          peerKickAttempts,
          sourcePeerKickAttempts,
          sourcePeerFallbacks,
          peerDisconnectAttempts,
          peerTrimAttempts
        };
        if (!quiet) console.log(JSON.stringify(event));
        return { pair, decision, event };
      }));
      lastEvents = states.map((state) => state.event);
      await writeStatus(statusPath, {
        schema: "bitagent_testnet4_sync_throttle_status_v1",
        status: "running",
        authority: "bitcoin_peer_network_control_only",
        effect: "setnetworkactive_and_bounded_onetry",
        peerSourceMode: peerSources.size > 0 ? "independent_loopback_bitcoin" : "target_addrman_only",
        updatedAt: new Date().toISOString(),
        stopHeight: policy.stopHeight,
        states: states.map((state) => state.event)
      });
      const failed = states.find((state) => state.decision.action === "fail");
      if (failed) throw new Error(`pair ${failed.pair.name} failed closed: ${failed.decision.reason}`);
      if (states.every((state) => state.decision.action === "complete")) {
        const networkPauseResults = await pauseAll(pairs);
        const pauseFailure = networkPauseResults.find((result) => result.status === "pause_failed");
        if (pauseFailure) throw new Error(`pair ${pauseFailure.pair} could not be paused: ${pauseFailure.error}`);
        await writeStatus(statusPath, {
          schema: "bitagent_testnet4_sync_throttle_status_v1",
          status: "completed",
          authority: "bitcoin_peer_network_control_only",
          effect: "setnetworkactive_and_bounded_onetry",
          peerSourceMode: peerSources.size > 0 ? "independent_loopback_bitcoin" : "target_addrman_only",
          updatedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          stopHeight: policy.stopHeight,
          states: lastEvents,
          networkPauseResults
        });
        console.log(JSON.stringify({ ok: true, status: "bounded_target_caught_up", stopHeight: policy.stopHeight }));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new Error("sync throttle interrupted");
  } catch (error) {
    const networkPauseResults = await pauseAll(pairs);
    await writeStatus(statusPath, {
      schema: "bitagent_testnet4_sync_throttle_status_v1",
      status: "failed",
      authority: "bitcoin_peer_network_control_only",
      effect: "setnetworkactive_and_bounded_onetry",
      peerSourceMode: peerSources.size > 0 ? "independent_loopback_bitcoin" : "target_addrman_only",
      updatedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      stopHeight: policy.stopHeight,
      states: lastEvents,
      error: error instanceof Error ? error.message : String(error),
      networkPauseResults
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
