import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { buildObservedReceipt, normalizeReceipt } from "../src/receipt.js";
import { verifyReceiptAgainstCommitment } from "../src/adapters/commitmentVerifier.js";
import { buildEvmTemplateCommitment } from "../src/adapters/evmTemplateAdapter.js";
import { mapReceiptToCanonicalUtxo } from "../src/adapters/utxoRefAdapter.js";
import { buildOrSubmitAbsorb } from "../src/adapters/tradelayerAdapter.js";
import { buildProceduralTemplateContext } from "../src/adapters/proceduralAdapter.js";
import { buildTlWebPhantomIntent } from "../src/adapters/tlwebAdapter.js";
import { getWalletActivityFeedPath, publishActivity } from "../src/adapters/walletAdapter.js";
import { resetActivities } from "../src/activityStore.js";
import type { InboundUtxoReceipt } from "../src/types.js";

const baseReceipt: InboundUtxoReceipt = {
  sourceChain: "ethereum",
  sourceAsset: "ETH",
  thorchainSwapTx: "0xswap",
  thorchainMemo: "=:btc-destination",
  destinationChain: "bitcoin",
  status: "submitted"
};

test("receipt normalization accepts canonical inbound receipt", () => {
  const normalized = normalizeReceipt({
    ...baseReceipt,
    destinationTxid: "abcd",
    destinationVout: 1,
    valueSats: "250000",
    confirmations: 2,
    status: "utxo_confirmed"
  });

  assert.equal(normalized.destinationVout, 1);
  assert.equal(normalized.valueSats, "250000");
});

test("observed receipt env mapping produces a confirmed UTXO receipt", () => {
  process.env.OBSERVED_DEST_TXID = "feedbeef";
  process.env.OBSERVED_DEST_VOUT = "0";
  process.env.OBSERVED_VALUE_SATS = "100000";
  process.env.OBSERVED_CONFIRMATIONS = "3";

  const observed = buildObservedReceipt(baseReceipt);
  assert.equal(observed.status, "utxo_confirmed");
  assert.equal(observed.destinationTxid, "feedbeef");
});

test("UTXO mapping produces deterministic ref and bigint value", () => {
  const mapped = mapReceiptToCanonicalUtxo({
    ...baseReceipt,
    destinationTxid: "ca".repeat(32),
    destinationVout: 2,
    valueSats: "400000",
    destinationScriptPubKey: "0014" + "11".repeat(20),
    status: "utxo_confirmed"
  });

  assert.equal(mapped.txid, "ca".repeat(32));
  assert.equal(mapped.valueSats, 400000n);
  assert.equal(mapped.utxoRef.length, 64);
  assert.equal(mapped.utxoRef, mapped.fundingRoot);
});

test("TradeLayer build path is callable in build-only mode", async () => {
  process.env.TL_RECEIPT_PROPERTY_ID = "214";
  process.env.TL_SUBMIT_ABSORB = "false";
  process.env.TL_DLC_TEMPLATE_ID = "tpl-integration";
  const result = await buildOrSubmitAbsorb({
    utxo: {
      txid: "deadbeef",
      vout: 0,
      valueSats: 150000n,
      address: "tb1qexample",
      utxoRef: "f".repeat(64)
    },
    sourceTxid: "0xrouter"
  });

  assert.equal(result.status, "built");
  assert.ok(result.tlTxHex);
});

test("procedural template context computes template hash and issue payload", () => {
  process.env.TL_DLC_TEMPLATE_ID = "tpl-integration";
  process.env.TL_RECEIPT_PROPERTY_ID = "214";
  const procedural = buildProceduralTemplateContext();
  assert.equal(procedural.templateId, "tpl-integration");
  assert.ok(procedural.templateHash.length > 10);
  assert.ok(procedural.issuePayload?.startsWith("tl1"));
});

test("tlweb phantom intent carries token issue and grant-managed actions", () => {
  const receipt = {
    ...baseReceipt,
    destinationTxid: "abc123",
    destinationVout: 0,
    valueSats: "100000",
    status: "utxo_confirmed" as const
  };
  const procedural = buildProceduralTemplateContext();
  const intent = buildTlWebPhantomIntent({
    receipt,
    procedural,
    absorbPayload: "tlb123"
  });

  assert.equal(intent.provider, "phantom");
  assert.equal(intent.target, "tlweb");
  assert.equal(intent.actions.length, 2);
  assert.equal(intent.actions[0]?.kind, "token_issue");
  assert.equal(intent.actions[1]?.kind, "grant_managed");
});

test("evm template commitment derives deterministic deposit binding hashes", () => {
  const receipt = {
    ...baseReceipt,
    destinationAddress: "bc1qexample",
    thorchainMemo: "=:b:bc1qexample:0/1/0",
    status: "quote_obtained" as const
  };
  const procedural = buildProceduralTemplateContext();
  const commitment = buildEvmTemplateCommitment({
    receipt,
    procedural,
    depositor: "0x0000000000000000000000000000000000000001",
    nonce: 7n
  });

  assert.ok(commitment.depositId.startsWith("0x"));
  assert.ok(commitment.templateHash.startsWith("0x"));
  assert.ok(commitment.destinationScriptCommitment.startsWith("0x"));
  assert.ok(commitment.thorMemoHash.startsWith("0x"));
});

test("commitment verifier accepts matching receipt and template", () => {
  const receipt = {
    ...baseReceipt,
    destinationAddress: "bc1qexample",
    thorchainMemo: "=:b:bc1qexample:0/1/0",
    status: "quote_obtained" as const
  };
  const procedural = buildProceduralTemplateContext();
  const commitment = buildEvmTemplateCommitment({
    receipt,
    procedural,
    depositor: "0x0000000000000000000000000000000000000001",
    nonce: 7n
  });

  const verified = verifyReceiptAgainstCommitment({
    receipt,
    procedural,
    commitment,
    depositor: "0x0000000000000000000000000000000000000001",
    nonce: 7n
  });

  assert.equal(verified.depositId, commitment.depositId);
});

test("wallet activity serialization persists JSON feed", async () => {
  await resetActivities();
  await publishActivity({
    id: "demo",
    phase: "deposit",
    status: "success",
    label: "Demo saved"
  });

  const raw = await fs.readFile(getWalletActivityFeedPath(), "utf8");
  const parsed = JSON.parse(raw) as Array<{ id: string }>;
  assert.equal(parsed[0]?.id, "demo");
});
