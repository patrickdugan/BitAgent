import assert from "node:assert/strict";
import test from "node:test";
import { encodeSegwitAddress } from "../src/launch/bitcoin.js";
import { buildStarterOrderPlan } from "../src/launch/tradelayerTool.js";
import {
  buildStarterOrderPreflightEvidence,
  sealStarterOrderNodeSnapshot,
  verifyStarterOrderPreflightEvidence
} from "../src/launch/starterOrderPreflight.js";

const NOW = new Date("2026-08-09T18:00:00.000Z");
const CODE_HASH = "a1".repeat(32);
const ADDRESS = encodeSegwitAddress(Buffer.alloc(20, 91), "bitcoin-testnet4");
const PLAN = buildStarterOrderPlan({
  workflowId: "workflow_starter_preflight_0001",
  walletSessionId: "wallet_session_starter_preflight_0001",
  walletAddress: ADDRESS,
  network: "bitcoin-testnet4",
  amountSats: "50000",
  quote: {
    quoteId: "quote_starter_preflight_0001",
    source: "independent-test-quote",
    priceUsd: "50000.00",
    quotedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 60000).toISOString()
  }
});

function node(index: number) {
  return sealStarterOrderNodeSnapshot({
    schema: "bitagent_tradelayer_starter_order_node_snapshot_v1",
    nodeId: `listener-${index}`,
    instanceId: `listener-instance-${index}`,
    capturedAt: NOW.toISOString(),
    blockHeight: 100000,
    synchronized: true,
    tx5: {
      active: true,
      activationSource: "bitcoin_transaction",
      activationBlock: 90000,
      codeHash: CODE_HASH
    },
    properties: {
      offeredPropertyId: 1,
      offeredSymbol: "tlBTC",
      desiredPropertyId: 2,
      desiredSymbol: "tlUSD"
    },
    balance: { address: ADDRESS, tlBtcAvailableSats: "50000" }
  });
}

test("starter-order preflight verifies exact independent tx5, inventory, and quote evidence", () => {
  const evidence = buildStarterOrderPreflightEvidence({
    plan: PLAN,
    nodes: [node(1), node(2)],
    expectedCodeHash: CODE_HASH,
    now: NOW
  });
  assert.equal(evidence.status, "verified");
  assert.ok(Object.values(evidence.gates).every(Boolean));
  assert.equal(verifyStarterOrderPreflightEvidence(evidence, PLAN), true);
});

test("starter-order preflight fails closed on stale quote, local activation, or insufficient inventory", () => {
  const { snapshotHash: _snapshotHash, ...base } = node(2);
  const local = sealStarterOrderNodeSnapshot({
    ...base,
    tx5: { ...base.tx5, activationSource: "local_seed" },
    balance: { ...base.balance, tlBtcAvailableSats: "49999" }
  });
  const evidence = buildStarterOrderPreflightEvidence({
    plan: PLAN,
    nodes: [node(1), local],
    expectedCodeHash: CODE_HASH,
    now: new Date(NOW.getTime() + 61000)
  });
  assert.equal(evidence.status, "failed");
  assert.equal(evidence.gates.quoteFresh, false);
  assert.equal(evidence.gates.tx5ChainDerived, false);
  assert.equal(evidence.gates.walletTlBtcBalance, false);
  assert.equal(verifyStarterOrderPreflightEvidence(evidence, PLAN), true);
});
