import test from "node:test";
import assert from "node:assert/strict";
import { ScriptedQuoteProvider } from "../src/launch/broker.js";
import { encodeSegwitAddress } from "../src/launch/bitcoin.js";
import { buildReserveIntakePlan, verifyReserveIntakePlan } from "../src/launch/reserveIntake.js";
import {
  ScriptedStrategyFundingSource,
  verifyStrategyFundingEvidence
} from "../src/launch/strategyFunding.js";
import { simulateStarterStrategy } from "../src/launch/tradelayerTool.js";
import type { BitAgentWorkflowState } from "../src/launch/types.js";

const OPERATOR = "04d7f4188a5cbc5335aee6600ad8e327730d73de961534e23b4b91b7d64b6ae4";
const GUARDIAN = "d1517d4cbf81891b1c360554cb5352f1d9e307cfb08d493125450147ad01260c";

function state(): BitAgentWorkflowState {
  return {
    id: "strategy-funding-test",
    version: 1,
    createdAt: "2026-08-06T09:00:00.000Z",
    updatedAt: "2026-08-06T09:00:00.000Z",
    stage: "deposit_confirmed",
    currentIntent: "starter_strategy",
    wallet: {
      status: "connected",
      mode: "create",
      walletSessionId: "wallet-session-funding-test",
      bitcoinAddress: encodeSegwitAddress(Buffer.alloc(20, 7), "bitcoin-testnet4"),
      network: "bitcoin-testnet4",
      confirmedBalanceSats: "250000",
      capabilities: ["deposit", "strategy", "withdraw", "psbt_approval"],
      connectedAt: "2026-08-06T09:00:00.000Z"
    },
    deposit: {
      status: "confirmed",
      address: encodeSegwitAddress(Buffer.alloc(20, 7), "bitcoin-testnet4"),
      scriptPubKeyHex: `0014${Buffer.alloc(20, 7).toString("hex")}`,
      txid: "11".repeat(32),
      vout: 0,
      amountSats: "250000",
      blockHeight: 100,
      confirmations: 2,
      requiredConfirmations: 2,
      observedAt: "2026-08-06T09:00:00.000Z"
    },
    recoveryInstructions: [],
    events: []
  };
}

test("reserve intake plan binds a UTXORef P2TR output to the exact tx11 grant", () => {
  const plan = buildReserveIntakePlan({
    workflowId: "strategy-funding-test",
    walletSessionId: "wallet-session-funding-test",
    walletAddress: state().wallet.bitcoinAddress!,
    amountSats: "100000",
    operatorXonly: OPERATOR,
    guardianXonly: GUARDIAN,
    propertyId: 1,
    dlcTemplateId: "starter-utxoref-v1",
    dlcContractId: "starter-utxoref-contract-001",
    settlementState: "FUNDED",
    dlcHash: "ab".repeat(32)
  });

  assert.equal(verifyReserveIntakePlan(plan), true);
  assert.equal(plan.requiredOutputOrder[0].vout, 0);
  assert.equal(plan.requiredOutputOrder[0].amountSats, "100000");
  assert.equal(plan.requiredOutputOrder[1].vout, 1);
  assert.equal(plan.tradeLayer.transactionType, 11);
  assert.equal(plan.tradeLayer.payload.startsWith("tlb"), true);
  assert.equal(plan.tradeLayer.payloadBytes, Buffer.byteLength(plan.tradeLayer.payload, "utf8"));
  assert.equal(plan.preconditions.some((item) => /data-carrier policy/i.test(item)), true);
  assert.equal(plan.reserve.scriptPubKeyHex.startsWith("5120"), true);
});

test("reserve intake binding changes with the public wallet session and rejects mutation", () => {
  const base = {
    workflowId: "strategy-funding-test",
    walletAddress: state().wallet.bitcoinAddress!,
    amountSats: "100000",
    operatorXonly: OPERATOR,
    guardianXonly: GUARDIAN,
    propertyId: 1,
    dlcTemplateId: "starter-utxoref-v1",
    dlcContractId: "starter-utxoref-contract-001",
    settlementState: "FUNDED",
    dlcHash: "ab".repeat(32)
  };
  const first = buildReserveIntakePlan({ ...base, walletSessionId: "wallet-session-funding-test" });
  const second = buildReserveIntakePlan({ ...base, walletSessionId: "wallet-session-funding-other" });
  assert.notEqual(first.bindingHash, second.bindingHash);
  assert.notEqual(first.reserve.scriptPubKeyHex, second.reserve.scriptPubKeyHex);
  assert.equal(verifyReserveIntakePlan({
    ...first,
    amountSats: "100001"
  }), false);
});

test("reserve intake derives a unique bounded contract id when the caller does not provide one", () => {
  const base = {
    walletSessionId: "wallet-session-derived-contract",
    walletAddress: state().wallet.bitcoinAddress!,
    amountSats: "100000",
    operatorXonly: OPERATOR,
    guardianXonly: GUARDIAN,
    propertyId: 1,
    dlcTemplateId: "starter-utxoref-v1",
    settlementState: "FUNDED",
    dlcHash: "ab".repeat(32)
  };
  const first = buildReserveIntakePlan({ ...base, workflowId: "derived-contract-first" });
  const second = buildReserveIntakePlan({ ...base, workflowId: "derived-contract-second" });

  assert.match(first.tradeLayer.dlcContractId, /^utxoref-[a-f0-9]{40}$/);
  assert.notEqual(first.tradeLayer.dlcContractId, second.tradeLayer.dlcContractId);
  assert.equal(verifyReserveIntakePlan(first), true);
});

test("strategy funding evidence keeps wallet, reserve, and tlBTC amounts separate", async () => {
  const workflow = state();
  const source = new ScriptedStrategyFundingSource();
  const evidence = await source.observe({
    state: workflow,
    requestedAmountSats: "100000",
    now: new Date("2026-08-06T09:01:00.000Z")
  });
  assert.equal(verifyStrategyFundingEvidence(evidence, workflow, "100000"), true);
  assert.equal(evidence.bitcoinSpendableSats, "150000");
  assert.equal(evidence.reserveLockedSats, "100000");
  assert.equal(evidence.tlBtcAvailableSats, "100000");
  assert.equal(verifyStrategyFundingEvidence({
    ...evidence,
    tlBtcAvailableSats: "99999"
  }, workflow, "100000"), false);
});

test("tx5 simulation charges wallet only the carrier fee and marks proceeds conditional", async () => {
  const now = new Date("2026-08-06T09:02:00.000Z");
  const quote = await new ScriptedQuoteProvider().getStarterStrategyQuote({ amountSats: "100000", now });
  const simulation = simulateStarterStrategy({
    amountSats: "100000",
    balanceSats: "150000",
    tlBtcAvailableSats: "100000",
    networkFeeSats: "900",
    quote,
    now
  });
  assert.equal(simulation.balanceAfterSats, "149100");
  assert.equal(simulation.strategy?.expectedTlUsdAtoms, "6500000000");
  assert.equal(simulation.effects.find((effect) => effect.asset === "tlUSD")?.condition, "on_fill");
  assert.equal(simulation.effects.some((effect) =>
    effect.asset === "BTC" && effect.amount === "100000"
  ), false);
});
