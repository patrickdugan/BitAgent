import { isIP } from "node:net";

export type Testnet4SyncSnapshot = {
  bitcoinHeight: number;
  headerHeight: number;
  pruneHeight: number;
  initialBlockDownload: boolean;
  networkActive: boolean;
  connections: number;
  trackHeight: number;
  listenerPhase: string;
  listenerError?: string | null;
  freeBytes: number;
};

export type BitcoinAddrmanEntry = {
  address: string;
  port: number;
  network: string;
};

export type BitcoinRecoveryPeer = {
  id: number;
  addr: string;
  synced_headers: number;
  synced_blocks: number;
  inbound?: boolean;
  network?: string;
};

export type BitcoinPeerSourceObservation = {
  chain: string;
  blocks: number;
  initialblockdownload: boolean;
  networkactive: boolean;
};

export type Testnet4SyncThrottlePolicy = {
  lowWatermark: number;
  highWatermark: number;
  stopHeight: number;
  minFreeBytes: number;
};

export type Testnet4SyncThrottleDecision = {
  action: "enable_network" | "disable_network" | "hold" | "complete" | "fail";
  reason: string;
  lag: number;
};

function height(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
  return value;
}

export function validateTestnet4SyncThrottlePolicy(input: Testnet4SyncThrottlePolicy): Testnet4SyncThrottlePolicy {
  const lowWatermark = height(input.lowWatermark, "lowWatermark");
  const highWatermark = height(input.highWatermark, "highWatermark");
  const stopHeight = height(input.stopHeight, "stopHeight");
  const minFreeBytes = height(input.minFreeBytes, "minFreeBytes");
  if (lowWatermark >= highWatermark) throw new Error("lowWatermark must be less than highWatermark");
  if (highWatermark > 2_000) throw new Error("highWatermark must not exceed 2000 blocks on a pruned recovery node");
  return { lowWatermark, highWatermark, stopHeight, minFreeBytes };
}

export function decideTestnet4SyncControl(
  rawSnapshot: Testnet4SyncSnapshot,
  rawPolicy: Testnet4SyncThrottlePolicy
): Testnet4SyncThrottleDecision {
  const policy = validateTestnet4SyncThrottlePolicy(rawPolicy);
  const snapshot = {
    ...rawSnapshot,
    bitcoinHeight: height(rawSnapshot.bitcoinHeight, "bitcoinHeight"),
    headerHeight: height(rawSnapshot.headerHeight, "headerHeight"),
    pruneHeight: height(rawSnapshot.pruneHeight, "pruneHeight"),
    trackHeight: height(rawSnapshot.trackHeight, "trackHeight"),
    freeBytes: height(rawSnapshot.freeBytes, "freeBytes")
  };
  const lag = snapshot.bitcoinHeight - snapshot.trackHeight;

  if (snapshot.listenerPhase !== "realtime" || snapshot.listenerError) {
    return { action: "fail", reason: "listener_error", lag };
  }
  if (snapshot.freeBytes < policy.minFreeBytes) {
    return { action: "fail", reason: "disk_reserve_below_floor", lag };
  }
  if (lag < 0) return { action: "fail", reason: "listener_checkpoint_ahead_of_bitcoin", lag };
  if (snapshot.pruneHeight > snapshot.trackHeight + 1) {
    return { action: "fail", reason: "prune_horizon_overtook_listener", lag };
  }
  const retainedBlockMargin = snapshot.trackHeight - snapshot.pruneHeight;
  if (snapshot.pruneHeight > 0 && retainedBlockMargin <= policy.highWatermark) {
    return { action: "fail", reason: "unsafe_prune_lag_corridor", lag };
  }
  if (snapshot.bitcoinHeight > policy.stopHeight) {
    return { action: "fail", reason: "bounded_target_overshot", lag };
  }
  if (snapshot.bitcoinHeight === policy.stopHeight) {
    if (lag === 0) return { action: "complete", reason: "bounded_target_caught_up", lag };
    return { action: "disable_network", reason: "bounded_target_waiting_for_listener", lag };
  }
  if (lag >= policy.highWatermark) {
    return { action: "disable_network", reason: "listener_lag_high_watermark", lag };
  }
  if (!snapshot.networkActive && lag <= policy.lowWatermark) {
    return { action: "enable_network", reason: "listener_caught_up_low_watermark", lag };
  }
  return { action: "hold", reason: "within_lag_corridor", lag };
}

export function formatBitcoinPeerEndpoint(raw: BitcoinAddrmanEntry): string | null {
  const port = height(raw.port, "peer port");
  if (port < 1 || port > 65_535) return null;
  const address = String(raw.address || "").trim();
  if (raw.network === "ipv4" && isIP(address) === 4) return address + ":" + port;
  if (raw.network === "ipv6" && isIP(address) === 6) {
    return "[" + address + "]:" + port;
  }
  return null;
}

export function selectTestnet4RecoveryPeer(
  source: BitcoinPeerSourceObservation,
  peers: BitcoinRecoveryPeer[],
  excluded = new Set<string>()
): string | null {
  if (source.chain !== "testnet4" || source.initialblockdownload || !source.networkactive
    || !Number.isSafeInteger(source.blocks) || source.blocks < 1) return null;
  for (const peer of peers) {
    if (peer.inbound || !["ipv4", "ipv6"].includes(String(peer.network || ""))
      || !Number.isSafeInteger(peer.synced_headers) || peer.synced_headers < source.blocks) continue;
    const endpoint = String(peer.addr || "").trim();
    const ipv4 = /^([^:]+):(\d{1,5})$/.exec(endpoint);
    const ipv6 = /^\[([^\]]+)\]:(\d{1,5})$/.exec(endpoint);
    const validAddress = (ipv4 && isIP(ipv4[1]) === 4) || (ipv6 && isIP(ipv6[1]) === 6);
    const port = Number(ipv4?.[2] || ipv6?.[2]);
    if (!validAddress || !Number.isSafeInteger(port) || port < 1 || port > 65_535
      || excluded.has(endpoint)) continue;
    return endpoint;
  }
  return null;
}

export function recoveryPeerIdsToDisconnect(
  peers: BitcoinRecoveryPeer[],
  maximumPeers = 1
): number[] {
  if (!Number.isSafeInteger(maximumPeers) || maximumPeers < 1) {
    throw new Error("maximumPeers must be a positive safe integer");
  }
  const valid = peers.filter((peer) => Number.isSafeInteger(peer.id) && peer.id >= 0);
  const ranked = [...valid].sort((left, right) => {
    const leftOutbound = left.inbound === false ? 1 : 0;
    const rightOutbound = right.inbound === false ? 1 : 0;
    return rightOutbound - leftOutbound
      || Number(right.synced_headers || -1) - Number(left.synced_headers || -1)
      || Number(right.synced_blocks || -1) - Number(left.synced_blocks || -1)
      || left.id - right.id;
  });
  return ranked.slice(maximumPeers).map((peer) => peer.id).sort((a, b) => a - b);
}

export function isUnsyncedTestnet4RecoveryPeer(
  rawPeer: BitcoinRecoveryPeer,
  snapshot: Pick<Testnet4SyncSnapshot, "bitcoinHeight" | "headerHeight">
): boolean {
  const id = Number(rawPeer.id);
  const syncedHeaders = Number(rawPeer.synced_headers);
  const syncedBlocks = Number(rawPeer.synced_blocks);
  if (!Number.isSafeInteger(id) || id < 0) return true;
  if (!Number.isSafeInteger(syncedHeaders) || !Number.isSafeInteger(syncedBlocks)) return true;
  return syncedHeaders < snapshot.headerHeight || syncedBlocks < snapshot.bitcoinHeight;
}

export function shouldInspectStalledTestnet4Peer(input: {
  snapshot: Pick<Testnet4SyncSnapshot, "bitcoinHeight" | "networkActive" | "connections">;
  decision: Testnet4SyncThrottleDecision;
  policy: Testnet4SyncThrottlePolicy;
  nowMs: number;
  lastProgressAtMs: number;
  peerStallMs: number;
}): boolean {
  const policy = validateTestnet4SyncThrottlePolicy(input.policy);
  return input.snapshot.networkActive
    && input.snapshot.connections > 0
    && input.snapshot.bitcoinHeight < policy.stopHeight
    && input.decision.lag <= policy.lowWatermark
    && input.nowMs - input.lastProgressAtMs >= input.peerStallMs;
}
