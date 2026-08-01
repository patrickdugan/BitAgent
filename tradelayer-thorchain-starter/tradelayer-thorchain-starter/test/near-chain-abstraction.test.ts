import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChainsigBitcoinAdapter } from "../src/adapters/nearChainSignatureAdapter.js";
import { ChainsigEvmAdapter } from "../src/adapters/nearChainSignatureEvmAdapter.js";
import { ChainsigSolanaAdapter } from "../src/adapters/nearChainSignatureSolanaAdapter.js";
import {
  assertExecutableWalletPlan,
  buildEvmWalletPlan,
  buildSolanaWalletPlan,
  createPublicWalletSession
} from "../src/multichain/planner.js";
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

test("Phantom and MetaMask sessions are public, typed, and network-bound", () => {
  const connectedAt = "2026-07-23T12:00:00.000Z";
  const phantom = createPublicWalletSession({
    provider: "phantom",
    connectedAt,
    accounts: [{
      environment: "ethereum",
      network: "sepolia",
      address: "0x1111111111111111111111111111111111111111",
      caip2: "eip155:11155111"
    }]
  });
  const metamask = createPublicWalletSession({
    provider: "metamask",
    connectedAt,
    accounts: [{
      environment: "solana",
      network: "devnet",
      address: "11111111111111111111111111111111",
      caip2: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
    }]
  });
  assert.equal(phantom.accounts[0]?.caip10, "eip155:11155111:0x1111111111111111111111111111111111111111");
  assert.equal(metamask.accounts[0]?.environment, "solana");
  assert.throws(
    () => createPublicWalletSession({ ...phantom, accounts: phantom.accounts, seedPhrase: "prohibited" } as never),
    /Secret-bearing field/
  );
});

test("EVM plans bind exact upper-bound fees, provider, account, and simulation hash", () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const session = createPublicWalletSession({
    provider: "phantom",
    connectedAt: now.toISOString(),
    accounts: [{
      environment: "ethereum",
      network: "sepolia",
      address: "0x1111111111111111111111111111111111111111",
      caip2: "eip155:11155111"
    }]
  });
  const plan = buildEvmWalletPlan({
    provider: "phantom",
    network: "sepolia",
    action: "native_transfer",
    from: session.accounts[0]!.address,
    to: "0x2222222222222222222222222222222222222222",
    valueWei: "1000000000000000",
    gasLimit: "21000",
    maxFeePerGasWei: "2000000000",
    maxPriorityFeePerGasWei: "1000000000",
    effects: [{ label: "Send ETH", amount: "0.001 ETH" }],
    expiresAt
  });
  assert.equal(plan.maximumNetworkFeeWei, "42000000000000");
  assert.doesNotThrow(() => assertExecutableWalletPlan(plan, session, now));
  assert.throws(() => assertExecutableWalletPlan({ ...plan, valueWei: "2" }, session, now), /changed after simulation/);
  assert.throws(
    () => assertExecutableWalletPlan(plan, { ...session, provider: "metamask" }, now),
    /provider does not match/
  );
});

test("Solana plans reject stale approvals and malformed serialized transactions", () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const session = createPublicWalletSession({
    provider: "metamask",
    connectedAt: now.toISOString(),
    accounts: [{
      environment: "solana",
      network: "devnet",
      address: "11111111111111111111111111111111",
      caip2: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
    }]
  });
  const plan = buildSolanaWalletPlan({
    provider: "metamask",
    network: "devnet",
    from: session.accounts[0]!.address,
    to: "SysvarRent111111111111111111111111111111111",
    valueLamports: "1000000",
    networkFeeLamports: "5000",
    recentBlockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 123,
    serializedTransactionBase64: Buffer.from([1, 2, 3]).toString("base64"),
    effects: [{ label: "Send SOL", amount: "0.001 SOL" }],
    expiresAt
  });
  assert.doesNotThrow(() => assertExecutableWalletPlan(plan, session, now));
  assert.throws(() => assertExecutableWalletPlan(plan, session, new Date(Date.parse(expiresAt) + 1)), /stale/);
  assert.throws(
    () => buildSolanaWalletPlan({ ...plan, serializedTransactionBase64: "not base64***" }),
    /canonical base64/
  );
});

test("chainsig.js prepares concrete offline Sepolia and Solana devnet transactions", async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const evm = await new ChainsigEvmAdapter({
    network: "sepolia",
    nearNetwork: "testnet",
    publicClient: {
      estimateGas: async () => 21_000n,
      estimateFeesPerGas: async () => ({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }),
      getTransactionCount: async () => 1,
      getChainId: async () => 11_155_111
    }
  }).prepareTransfer({
    nearAccount: "bitagent.testnet",
    derivationPath: "bitagent/ethereum/0",
    to: "0x1111111111111111111111111111111111111111",
    valueWei: "1000000000000000",
    expiresAt
  });
  assert.equal(evm.chainId, 11_155_111);
  assert.equal(evm.maximumNetworkFeeWei, "42000000000000");
  assert.match(evm.serializedTransaction, /^0x/);

  const solana = await new ChainsigSolanaAdapter({
    network: "devnet",
    nearNetwork: "testnet",
    solanaConnection: {
      getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
      getFeeForMessage: async () => ({ value: 5000 })
    } as never
  }).prepareTransfer({
    nearAccount: "bitagent.testnet",
    derivationPath: "bitagent/solana/0",
    to: "11111111111111111111111111111111",
    valueLamports: "1000000",
    expiresAt
  });
  assert.equal(solana.networkFeeLamports, "5000");
  assert.ok(Buffer.from(solana.serializedTransaction, "base64").length > 0);
  await assert.rejects(
    () => new ChainsigSolanaAdapter({
      network: "devnet",
      nearNetwork: "testnet",
      solanaConnection: { getFeeForMessage: async () => ({ value: 5000 }) }
    }).prepareTransfer({
      nearAccount: "bitagent.testnet",
      derivationPath: "bitagent/solana/0",
      to: "11111111111111111111111111111111",
      valueLamports: (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString(),
      expiresAt
    }),
    /safe integer limit/
  );
});
