import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  hasExactHeightRelayDiskReserve,
  planTestnet4ExactHeightRelay,
  validateTestnet4ExactHeightRelayConfig
} from "../src/launch/testnet4ExactHeightRelay.js";

const hash = (digit: string) => digit.repeat(64);
const observation = (blocks: number, bestblockhash: string, networkactive = false) => ({
  chain: "testnet4",
  blocks,
  bestblockhash,
  initialblockdownload: false,
  networkactive,
  connections: networkactive ? 1 : 0
});

test("exact-height relay config binds independent loopback nodes without wallet authority", () => {
  const runtimeRoot = path.resolve(".runtime", "exact-height-relay-test");
  const value = validateTestnet4ExactHeightRelayConfig({
    schema: "bitagent_testnet4_exact_height_relay_config_v1",
    runtimeRoot,
    sourceRpcUrl: "http://127.0.0.1:48332",
    sourceCookieFile: path.join(runtimeRoot, "source", ".cookie"),
    targetRpcUrl: "http://127.0.0.1:49392",
    targetCookieFile: path.join(runtimeRoot, "target", ".cookie"),
    targetHeight: 147389,
    maxBlocks: 1024
  });
  assert.equal(value.targetHeight, 147389);
  assert.equal(value.minFreeBytes, 750 * 1024 * 1024);
  assert.equal("wallet" in value, false);
  assert.equal("signing" in value, false);
  assert.equal("broadcast" in value, false);
});

test("exact-height relay reserves room for the next validated block", () => {
  assert.equal(hasExactHeightRelayDiskReserve({
    freeBytes: 800,
    minFreeBytes: 700,
    pendingBlockBytes: 50
  }), true);
  assert.equal(hasExactHeightRelayDiskReserve({
    freeBytes: 799,
    minFreeBytes: 700,
    pendingBlockBytes: 50
  }), false);
  assert.equal(hasExactHeightRelayDiskReserve({
    freeBytes: 699,
    minFreeBytes: 700
  }), false);
});

test("plans only the exact bounded suffix from an active synchronized source", () => {
  assert.deepEqual(planTestnet4ExactHeightRelay({
    source: observation(147396, hash("a"), true),
    target: observation(147000, hash("b")),
    sourceHashAtTargetTip: hash("b"),
    sourceHashAtExactHeight: hash("c"),
    config: { targetHeight: 147389, maxBlocks: 512 }
  }), {
    fromHeight: 147001,
    toHeight: 147389,
    blockCount: 389,
    expectedTipHash: hash("c")
  });
});

test("exact-height relay retry is an idempotent empty plan", () => {
  assert.deepEqual(planTestnet4ExactHeightRelay({
    source: observation(147396, hash("a"), true),
    target: observation(147389, hash("c")),
    sourceHashAtTargetTip: hash("c"),
    sourceHashAtExactHeight: hash("c"),
    config: { targetHeight: 147389, maxBlocks: 512 }
  }), {
    fromHeight: 147390,
    toHeight: 147389,
    blockCount: 0,
    expectedTipHash: hash("c")
  });
});

test("rejects overshoot, fork mismatch, unsafe target networking, and oversized suffix", () => {
  const base = {
    source: observation(147396, hash("a"), true),
    target: observation(147000, hash("b")),
    sourceHashAtTargetTip: hash("b"),
    sourceHashAtExactHeight: hash("c"),
    config: { targetHeight: 147389, maxBlocks: 512 }
  };
  assert.throws(() => planTestnet4ExactHeightRelay({
    ...base,
    target: observation(147390, hash("d"))
  }), /overshot/);
  assert.throws(() => planTestnet4ExactHeightRelay({
    ...base,
    sourceHashAtTargetTip: hash("d")
  }), /not on the source active chain/);
  assert.throws(() => planTestnet4ExactHeightRelay({
    ...base,
    target: observation(147000, hash("b"), true)
  }), /networking must be paused/);
  assert.throws(() => planTestnet4ExactHeightRelay({
    ...base,
    config: { targetHeight: 147389, maxBlocks: 128 }
  }), /exceeds maxBlocks/);
});
