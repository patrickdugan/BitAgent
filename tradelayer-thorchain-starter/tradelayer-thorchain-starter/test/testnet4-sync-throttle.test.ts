import assert from "node:assert/strict";
import test from "node:test";
import {
  decideTestnet4SyncControl,
  formatBitcoinPeerEndpoint,
  isUnsyncedTestnet4RecoveryPeer,
  recoveryPeerIdsToDisconnect,
  selectTestnet4RecoveryPeer,
  shouldInspectStalledTestnet4Peer
} from "../src/launch/testnet4SyncThrottle.js";

const policy = { lowWatermark: 25, highWatermark: 250, stopHeight: 60_000, minFreeBytes: 750 * 1024 * 1024 };
const base = {
  bitcoinHeight: 58_000,
  headerHeight: 147_000,
  pruneHeight: 55_000,
  initialBlockDownload: true,
  networkActive: true,
  connections: 1,
  trackHeight: 57_900,
  listenerPhase: "realtime",
  listenerError: null,
  freeBytes: 2_000_000_000
};

test("holds inside the lag corridor", () => {
  assert.equal(decideTestnet4SyncControl(base, policy).action, "hold");
});

test("pauses at the high-water lag", () => {
  const result = decideTestnet4SyncControl({ ...base, trackHeight: 57_750 }, policy);
  assert.deepEqual(result, { action: "disable_network", reason: "listener_lag_high_watermark", lag: 250 });
});

test("resumes only below the low-water lag", () => {
  const result = decideTestnet4SyncControl({ ...base, networkActive: false, trackHeight: 57_975 }, policy);
  assert.equal(result.action, "enable_network");
});

test("fails closed when pruning overtakes the listener", () => {
  const result = decideTestnet4SyncControl({ ...base, pruneHeight: 57_902 }, policy);
  assert.equal(result.action, "fail");
  assert.equal(result.reason, "prune_horizon_overtook_listener");
});

test("fails before the configured lag corridor can cross the retained prune window", () => {
  const result = decideTestnet4SyncControl({ ...base, pruneHeight: 57_650 }, policy);
  assert.deepEqual(result, { action: "fail", reason: "unsafe_prune_lag_corridor", lag: 100 });
});

test("fails closed on a listener error", () => {
  assert.equal(decideTestnet4SyncControl({ ...base, listenerPhase: "error", listenerError: "pruned" }, policy).action, "fail");
});

test("fails closed before the filesystem reserve drops below its reviewed floor", () => {
  const result = decideTestnet4SyncControl({ ...base, freeBytes: policy.minFreeBytes - 1 }, policy);
  assert.deepEqual(result, { action: "fail", reason: "disk_reserve_below_floor", lag: 100 });
});

test("fails closed while a listener is recovering from transient RPC loss", () => {
  const result = decideTestnet4SyncControl({ ...base, listenerPhase: "recovering" }, policy);
  assert.deepEqual(result, { action: "fail", reason: "listener_error", lag: 100 });
});

test("fails closed when a persisted checkpoint is ahead of Bitcoin", () => {
  const result = decideTestnet4SyncControl({ ...base, bitcoinHeight: 57_000 }, policy);
  assert.equal(result.reason, "listener_checkpoint_ahead_of_bitcoin");
});

test("pauses downloads at the bounded target until the listener catches up", () => {
  const result = decideTestnet4SyncControl({ ...base, bitcoinHeight: 60_000, trackHeight: 59_900 }, policy);
  assert.equal(result.action, "disable_network");
  assert.equal(result.reason, "bounded_target_waiting_for_listener");
});

test("completes only when the bounded target is caught up exactly", () => {
  const result = decideTestnet4SyncControl({ ...base, bitcoinHeight: 60_000, trackHeight: 60_000 }, policy);
  assert.equal(result.action, "complete");
});

test("fails closed when peer delivery overshoots the bounded target", () => {
  assert.deepEqual(
    decideTestnet4SyncControl({
      ...base,
      bitcoinHeight: policy.stopHeight + 1,
      trackHeight: policy.stopHeight
    }, policy),
    { action: "fail", reason: "bounded_target_overshot", lag: 1 }
  );
  assert.deepEqual(
    decideTestnet4SyncControl({
      ...base,
      bitcoinHeight: policy.stopHeight + 1,
      trackHeight: policy.stopHeight + 1
    }, policy),
    { action: "fail", reason: "bounded_target_overshot", lag: 0 }
  );
});

test("rejects an unsafe prune-node high-watermark", () => {
  assert.throws(
    () => decideTestnet4SyncControl(base, { ...policy, highWatermark: 2_001 }),
    /must not exceed 2000/
  );
});

test("formats only bounded IPv4 and IPv6 addrman peers", () => {
  assert.equal(formatBitcoinPeerEndpoint({ address: "203.0.113.7", port: 48_333, network: "ipv4" }), "203.0.113.7:48333");
  assert.equal(formatBitcoinPeerEndpoint({ address: "2001:db8::7", port: 48_333, network: "ipv6" }), "[2001:db8::7]:48333");
});

test("rejects unsupported or injection-shaped addrman entries", () => {
  assert.equal(formatBitcoinPeerEndpoint({ address: "peer.example", port: 48_333, network: "ipv4" }), null);
  assert.equal(formatBitcoinPeerEndpoint({ address: "999.999.999.999", port: 48_333, network: "ipv4" }), null);
  assert.equal(formatBitcoinPeerEndpoint({ address: "127.0.0.1;stop", port: 48_333, network: "ipv4" }), null);
  assert.equal(formatBitcoinPeerEndpoint({ address: "203.0.113.7", port: 0, network: "ipv4" }), null);
});

test("selects one sanitized synchronized peer from a reviewed testnet4 source", () => {
  const source = {
    chain: "testnet4",
    blocks: 100,
    initialblockdownload: false,
    networkactive: true
  };
  const peers = [
    { id: 1, addr: "127.0.0.1:1;bad", synced_headers: 100, synced_blocks: 100, inbound: false, network: "ipv4" },
    { id: 11, addr: "999.999.999.999:48333", synced_headers: 100, synced_blocks: 100, inbound: false, network: "ipv4" },
    { id: 2, addr: "198.51.100.20:48333", synced_headers: 99, synced_blocks: 99, inbound: false, network: "ipv4" },
    { id: 3, addr: "198.51.100.21:48333", synced_headers: 100, synced_blocks: 100, inbound: false, network: "ipv4" }
  ];
  assert.equal(selectTestnet4RecoveryPeer(source, peers), "198.51.100.21:48333");
  assert.equal(selectTestnet4RecoveryPeer(source, peers, new Set(["198.51.100.21:48333"])), null);
  assert.equal(selectTestnet4RecoveryPeer({ ...source, initialblockdownload: true }, peers), null);
  assert.equal(selectTestnet4RecoveryPeer({ ...source, chain: "main" }, peers), null);
});

test("keeps one best synchronized outbound recovery peer and trims the rest", () => {
  const peers = [
    { id: 8, addr: "198.51.100.8:48333", synced_headers: 120, synced_blocks: 119, inbound: true, network: "ipv4" },
    { id: 4, addr: "198.51.100.4:48333", synced_headers: 118, synced_blocks: 118, inbound: false, network: "ipv4" },
    { id: 6, addr: "198.51.100.6:48333", synced_headers: 120, synced_blocks: 120, inbound: false, network: "ipv4" }
  ];
  assert.deepEqual(recoveryPeerIdsToDisconnect(peers), [4, 8]);
  assert.throws(() => recoveryPeerIdsToDisconnect(peers, 0), /positive safe integer/);
});

test("classifies a connected peer with no synchronized headers or blocks as stale", () => {
  assert.equal(isUnsyncedTestnet4RecoveryPeer({
    id: 41,
    addr: "203.0.113.7:48333",
    synced_headers: -1,
    synced_blocks: -1
  }, base), true);
});

test("preserves a peer synchronized beyond the local recovery checkpoint", () => {
  assert.equal(isUnsyncedTestnet4RecoveryPeer({
    id: 42,
    addr: "198.51.100.7:48333",
    synced_headers: base.headerHeight,
    synced_blocks: base.bitcoinHeight + 40
  }, base), false);
});

test("inspects a connected peer only after a caught-up recovery node stalls below the target", () => {
  const decision = decideTestnet4SyncControl({ ...base, trackHeight: 57_990 }, policy);
  const input = {
    snapshot: { ...base, trackHeight: 57_990 },
    decision,
    policy,
    nowMs: 130_000,
    lastProgressAtMs: 10_000,
    peerStallMs: 120_000
  };
  assert.equal(shouldInspectStalledTestnet4Peer(input), true);
  assert.equal(shouldInspectStalledTestnet4Peer({ ...input, nowMs: 129_999 }), false);
  assert.equal(shouldInspectStalledTestnet4Peer({
    ...input,
    decision: { action: "hold", reason: "within_lag_corridor", lag: 100 }
  }), false);
  assert.equal(shouldInspectStalledTestnet4Peer({
    ...input,
    snapshot: { ...input.snapshot, bitcoinHeight: policy.stopHeight }
  }), false);
});
