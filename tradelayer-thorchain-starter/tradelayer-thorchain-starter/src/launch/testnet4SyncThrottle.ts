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
};

export type BitcoinAddrmanEntry = {
  address: string;
  port: number;
  network: string;
};

export type Testnet4SyncThrottlePolicy = {
  lowWatermark: number;
  highWatermark: number;
  stopHeight: number;
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
  if (lowWatermark >= highWatermark) throw new Error("lowWatermark must be less than highWatermark");
  if (highWatermark > 2_000) throw new Error("highWatermark must not exceed 2000 blocks on a pruned recovery node");
  return { lowWatermark, highWatermark, stopHeight };
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
    trackHeight: height(rawSnapshot.trackHeight, "trackHeight")
  };
  const lag = snapshot.bitcoinHeight - snapshot.trackHeight;

  if (snapshot.listenerPhase === "error" || snapshot.listenerError) {
    return { action: "fail", reason: "listener_error", lag };
  }
  if (lag < 0) return { action: "fail", reason: "listener_checkpoint_ahead_of_bitcoin", lag };
  if (snapshot.pruneHeight > snapshot.trackHeight + 1) {
    return { action: "fail", reason: "prune_horizon_overtook_listener", lag };
  }
  if (snapshot.bitcoinHeight >= policy.stopHeight) {
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
  if (raw.network === "ipv4" && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return address + ":" + port;
  if (raw.network === "ipv6" && /^[a-fA-F0-9:]+$/.test(address) && address.includes(":")) {
    return "[" + address + "]:" + port;
  }
  return null;
}
