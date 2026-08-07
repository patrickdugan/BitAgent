import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  classifyTestnet4BlockSubmission,
  planTestnet4TipAlignment,
  validateTestnet4TipAlignmentConfig
} from "../src/launch/testnet4TipAlignment.js";

const hash = (digit: string) => digit.repeat(64);
const observation = (blocks: number, bestblockhash: string) => ({
  chain: "testnet4",
  blocks,
  bestblockhash,
  networkactive: false,
  connections: 0
});

test("block relay accepts only null or an exactly observed known block", () => {
  assert.equal(classifyTestnet4BlockSubmission({
    result: null,
    expectedHash: hash("a"),
    expectedHeight: 12
  }), "accepted");
  assert.equal(classifyTestnet4BlockSubmission({
    result: "inconclusive",
    expectedHash: hash("a"),
    expectedHeight: 12,
    observed: { hash: hash("a"), height: 12, confirmations: -1 }
  }), "known_valid_candidate");
  assert.equal(classifyTestnet4BlockSubmission({
    result: "duplicate",
    expectedHash: hash("a"),
    expectedHeight: 12,
    observed: { hash: hash("a"), height: 12, confirmations: -1 }
  }), "known_valid_candidate");
  assert.throws(() => classifyTestnet4BlockSubmission({
    result: "inconclusive",
    expectedHash: hash("a"),
    expectedHeight: 12,
    observed: { hash: hash("b"), height: 12, confirmations: -1 }
  }), /rejected block 12/);
  assert.throws(() => classifyTestnet4BlockSubmission({
    result: "duplicate-invalid",
    expectedHash: hash("a"),
    expectedHeight: 12,
    observed: { hash: hash("a"), height: 12, confirmations: -1 }
  }), /duplicate-invalid/);
});

test("tip alignment config binds two independent loopback Bitcoin nodes without authority", () => {
  const runtimeRoot = path.resolve(".runtime", "tip-alignment-test");
  const value = validateTestnet4TipAlignmentConfig({
    schema: "bitagent_testnet4_tip_alignment_config_v1",
    runtimeRoot,
    sourceRpcUrl: "http://127.0.0.1:49372",
    sourceCookieFile: path.join(runtimeRoot, "a", ".cookie"),
    targetRpcUrl: "http://127.0.0.1:49382",
    targetCookieFile: path.join(runtimeRoot, "b", ".cookie"),
    maxBlocks: 8
  });
  assert.equal(value.maxBlocks, 8);
  assert.equal("wallet" in value, false);
  assert.equal("sign" in value, false);
});

test("tip alignment plans only a bounded active-chain suffix with networking paused", () => {
  const plan = planTestnet4TipAlignment({
    source: observation(107606, hash("a")),
    target: observation(107604, hash("b")),
    sourceHashAtTargetHeight: hash("b"),
    maxBlocks: 8
  });
  assert.deepEqual(plan, {
    fromHeight: 107605,
    toHeight: 107606,
    blockCount: 2,
    expectedTipHash: hash("a")
  });
});

test("tip alignment retry is an idempotent no-op when both nodes already match", () => {
  const tip = hash("a");
  assert.deepEqual(planTestnet4TipAlignment({
    source: observation(107606, tip),
    target: observation(107606, tip),
    sourceHashAtTargetHeight: tip,
    maxBlocks: 8
  }), {
    fromHeight: 107607,
    toHeight: 107606,
    blockCount: 0,
    expectedTipHash: tip
  });
});

test("tip alignment accepts a bounded fork only with matching common-ancestor evidence", () => {
  assert.deepEqual(planTestnet4TipAlignment({
    source: observation(18, hash("a")),
    target: observation(11, hash("b")),
    sourceHashAtTargetHeight: hash("c"),
    commonAncestorHeight: 10,
    sourceHashAtCommonAncestor: hash("d"),
    targetHashAtCommonAncestor: hash("d"),
    maxBlocks: 8
  }), {
    fromHeight: 11,
    toHeight: 18,
    blockCount: 8,
    expectedTipHash: hash("a"),
    commonAncestorHeight: 10,
    commonAncestorHash: hash("d"),
    targetReorgDepth: 1
  });
  assert.throws(() => planTestnet4TipAlignment({
    source: observation(18, hash("a")),
    target: observation(11, hash("b")),
    sourceHashAtTargetHeight: hash("c"),
    commonAncestorHeight: 10,
    sourceHashAtCommonAncestor: hash("d"),
    targetHashAtCommonAncestor: hash("e"),
    maxBlocks: 8
  }), /not on the source active chain/);
});

test("tip alignment rejects forks, active networking, and an oversized suffix", () => {
  assert.throws(() => planTestnet4TipAlignment({
    source: observation(12, hash("a")),
    target: observation(10, hash("b")),
    sourceHashAtTargetHeight: hash("c"),
    maxBlocks: 8
  }), /not on the source active chain/);
  assert.throws(() => planTestnet4TipAlignment({
    source: { ...observation(12, hash("a")), networkactive: true, connections: 1 },
    target: observation(10, hash("b")),
    sourceHashAtTargetHeight: hash("b"),
    maxBlocks: 8
  }), /networking must be paused/);
  assert.throws(() => planTestnet4TipAlignment({
    source: observation(20, hash("a")),
    target: observation(10, hash("b")),
    sourceHashAtTargetHeight: hash("b"),
    maxBlocks: 8
  }), /exceeds maxBlocks/);
});
