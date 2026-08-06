import assert from "node:assert/strict";
import test from "node:test";
import { decideTestnet4SyncControl, formatBitcoinPeerEndpoint } from "../src/launch/testnet4SyncThrottle.js";

const policy = { lowWatermark: 25, highWatermark: 250, stopHeight: 60_000 };
const base = {
  bitcoinHeight: 58_000,
  headerHeight: 147_000,
  pruneHeight: 55_000,
  initialBlockDownload: true,
  networkActive: true,
  connections: 1,
  trackHeight: 57_900,
  listenerPhase: "realtime",
  listenerError: null
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

test("fails closed on a listener error", () => {
  assert.equal(decideTestnet4SyncControl({ ...base, listenerPhase: "error", listenerError: "pruned" }, policy).action, "fail");
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
  assert.equal(formatBitcoinPeerEndpoint({ address: "127.0.0.1;stop", port: 48_333, network: "ipv4" }), null);
  assert.equal(formatBitcoinPeerEndpoint({ address: "203.0.113.7", port: 0, network: "ipv4" }), null);
});
