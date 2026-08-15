import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  classifyReplayStatus,
  validateReplayBitcoinObservation,
  validateTradeLayerListenerReplayConfig
} from "../src/launch/tradelayerListenerReplay.js";

function config() {
  const runtimeRoot = path.resolve(".runtime", "listener-replay-test");
  return {
    schema: "bitagent_tradelayer_listener_replay_config_v1",
    runtimeRoot,
    sourceRepo: path.join(runtimeRoot, "tradelayer-candidate12"),
    sourceCommit: "a".repeat(40),
    rpcPort: 49392,
    rpcCookieFile: path.join(runtimeRoot, "node-g", "testnet4", ".cookie"),
    listenerPort: 3163,
    nodeId: "listener-replay-a",
    instanceId: "candidate12-replay-20260807",
    nedbRoot: path.join(runtimeRoot, "state"),
    logDir: path.join(runtimeRoot, "logs"),
    startupTimeoutMs: 30_000,
    replayTimeoutMs: 7_200_000
  };
}

const backend = {
  chain: "testnet4",
  blocks: 147389,
  headers: 147389,
  initialblockdownload: false,
  pruned: false,
  bestblockhash: "a".repeat(64),
  networkactive: false,
  connections: 0
};

test("full replay config is bounded and contains no transaction authority", () => {
  const value = validateTradeLayerListenerReplayConfig(config());
  assert.equal(value.listenerPort, 3163);
  assert.equal("wallet" in value, false);
  assert.equal("approval" in value, false);
  assert.equal("broadcast" in value, false);
});

test("full replay rejects secrets, overlaps, pruned nodes, and active peers", () => {
  assert.throws(() => validateTradeLayerListenerReplayConfig({ ...config(), rpcPassword: "forbidden" }), /unsupported fields/);
  assert.throws(() => validateTradeLayerListenerReplayConfig({ ...config(), logDir: config().nedbRoot }), /must not overlap/);
  assert.throws(() => validateTradeLayerListenerReplayConfig({ ...config(), listenerPort: 49392 }), /must be distinct/);
  assert.throws(() => validateReplayBitcoinObservation({ ...backend, pruned: true }), /refuses a pruned/);
  assert.throws(() => validateReplayBitcoinObservation({ ...backend, networkactive: true, connections: 1 }), /paused Bitcoin peer/);
});

test("full replay completes only at exact paused-chain parity and fails on listener errors", () => {
  assert.equal(classifyReplayStatus({ initialized: true, phase: "indexing", trackHeight: 100 }, 147389), "waiting");
  assert.equal(classifyReplayStatus({
    initialized: true,
    phase: "realtime",
    trackHeight: 147389,
    processedHeight: 147389,
    currentHeight: 147389
  }, 147389), "complete");
  assert.throws(() => classifyReplayStatus({
    initialized: true,
    phase: "error",
    error: "no snapshot",
    errorCode: "REORG_FULL_REPLAY_REQUIRED"
  }, 147389), /REORG_FULL_REPLAY_REQUIRED/);
});
