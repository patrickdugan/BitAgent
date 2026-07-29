import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChainsigBitcoinAdapter } from "../src/adapters/nearChainSignatureAdapter.js";
import {
  assertExecutableNearIntentsQuote,
  resolveNearIntentsAsset,
  toAssetUnits
} from "../src/adapters/nearIntentsAdapter.js";
import { ScriptedNearIntentsProvider } from "../src/adapters/scriptedNearIntentsProvider.js";
import { ScriptedOriginWalletBroker } from "../src/crosschain/broker.js";
import { NearDepositKernel } from "../src/crosschain/kernel.js";
import { FileNearDepositStore, InMemoryNearDepositStore } from "../src/crosschain/store.js";
import type { NearIntentsQuoteInput, NearIntentsQuotePlan } from "../src/adapters/nearIntentsAdapter.js";

const now = new Date("2026-07-23T12:00:00.000Z");
const input: NearIntentsQuoteInput = {
  sourceChain: "base",
  sourceAsset: "USDC",
  destinationChain: "bitcoin",
  amount: "10.5",
  recipient: "bc1qnearintentsrecipient",
  refundTo: "0x0000000000000000000000000000000000000001",
  slippageBps: 100,
  deadline: new Date(now.getTime() + 60_000).toISOString(),
  dry: false
};

function kernel(status: "awaiting_deposit" | "success" | "refunded" | "failed" = "success") {
  return new NearDepositKernel({
    provider: new ScriptedNearIntentsProvider(status, true),
    walletBroker: new ScriptedOriginWalletBroker(),
    store: new InMemoryNearDepositStore(),
    now: () => now
  });
}

test("NEAR Intents decimal conversion is exact and rejects excessive precision", () => {
  assert.equal(toAssetUnits("10.5", 6), "10500000");
  assert.throws(() => toAssetUnits("0.0000001", 6), /exceeds 6 decimal places/);
});

test("NEAR Intents token resolution fails closed on ambiguous symbols", () => {
  const tokens = [
    { assetId: "a", blockchain: "base" as const, symbol: "USDC", decimals: 6 },
    { assetId: "b", blockchain: "base" as const, symbol: "USDC", decimals: 6 }
  ];
  assert.throws(() => resolveNearIntentsAsset(tokens, { chain: "base", symbol: "USDC" }), /ambiguous/);
  assert.equal(resolveNearIntentsAsset(tokens, { chain: "base", symbol: "USDC", assetId: "b" }).assetId, "b");
});

test("preview and stale quotes cannot cross the approval boundary", () => {
  const base: NearIntentsQuotePlan = {
    rail: "near_intents",
    mode: "preview",
    quoteId: "q",
    signature: "s",
    quotedAt: now.toISOString(),
    originAssetId: "origin",
    destinationAssetId: "destination",
    amountIn: "1",
    amountInFormatted: "1",
    amountOut: "1",
    amountOutFormatted: "1",
    minAmountOut: "1",
    recipient: input.recipient,
    refundTo: input.refundTo,
    timeEstimateSeconds: 1
  };
  assert.throws(() => assertExecutableNearIntentsQuote(base, now), /preview-only/);
  assert.throws(
    () =>
      assertExecutableNearIntentsQuote(
        { ...base, mode: "executable", depositAddress: "address", deadline: now.toISOString() },
        now
      ),
    /stale/
  );
});

test("NEAR deposit follows simulate, approve, execute, and verify", async () => {
  const flow = kernel("success");
  await flow.start("success", input);
  const simulated = await flow.simulate("success");
  assert.equal(simulated.stage, "quote_ready");
  assert.ok(simulated.quote?.depositAddress?.startsWith("scripted://"));
  await flow.requestApproval("success");
  await flow.resolveApproval("success", "approve");
  const submitted = await flow.execute("success");
  assert.equal(submitted.stage, "deposit_submitted");
  const verified = await flow.verify("success");
  assert.equal(verified.stage, "completed");
  assert.equal((await flow.getPublic("success")).approval?.walletApprovalToken, "[wallet-held]");
});

test("rejected NEAR wallet approval preserves the quote for recovery", async () => {
  const flow = kernel();
  await flow.start("reject", input);
  const quoted = await flow.simulate("reject");
  await flow.requestApproval("reject");
  const rejected = await flow.resolveApproval("reject", "reject");
  assert.equal(rejected.stage, "quote_ready");
  assert.equal(rejected.approval?.status, "rejected");
  assert.equal(rejected.quoteHash, quoted.quoteHash);
  await assert.rejects(() => flow.execute("reject"), /approved wallet action is required/);
});

test("refunded NEAR execution is truthful and not marked completed", async () => {
  const flow = kernel("refunded");
  await flow.start("refund", input);
  await flow.simulate("refund");
  await flow.requestApproval("refund");
  await flow.resolveApproval("refund", "approve");
  await flow.execute("refund");
  const verified = await flow.verify("refund");
  assert.equal(verified.stage, "refunded");
  assert.equal(verified.execution?.status, "refunded");
});

test("interrupted NEAR deposit resumes from the atomic file store", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-near-"));
  try {
    const file = path.join(directory, "workflows.json");
    const store = new FileNearDepositStore(file);
    const first = new NearDepositKernel({
      provider: new ScriptedNearIntentsProvider("success", true),
      walletBroker: new ScriptedOriginWalletBroker(),
      store,
      now: () => now
    });
    await first.start("resume", input);
    await first.simulate("resume");
    await first.requestApproval("resume");
    const resumed = new NearDepositKernel({
      provider: new ScriptedNearIntentsProvider("success", true),
      walletBroker: new ScriptedOriginWalletBroker(),
      store: new FileNearDepositStore(file),
      now: () => now
    });
    assert.equal((await resumed.get("resume")).stage, "approval_pending");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("chain-signature adapter rejects secret-bearing inputs before SDK access", async () => {
  const adapter = new ChainsigBitcoinAdapter({ network: "testnet", nearNetwork: "testnet" });
  await assert.rejects(
    () =>
      adapter.deriveAccount({
        nearAccount: "user.testnet",
        derivationPath: "bitcoin-0",
        privateKey: "prohibited"
      } as { nearAccount: string; derivationPath: string }),
    /Secret-bearing field/
  );
});
