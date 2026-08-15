import assert from "node:assert/strict";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { before } from "node:test";
import { buildBitcoinCliBrokerArgs } from "../src/broker/bitcoinCliBrokerRpc.js";
import { createTestnetBrokerRequest, TestnetSignerBroker } from "../src/broker/testnetSignerBroker.js";
import type { BitcoinCoreBrokerRpc, TestnetBrokerRequest } from "../src/broker/types.js";
import type { TradeLayerTestnetArtifact } from "../src/economy/types.js";
import { runTradeLayerTestnetMock } from "../src/adapters/tradelayerTestnetAdapter.js";
import { scoreAkashBids } from "../src/adapters/akashLifecycleAdapter.js";
import { prepareBacalhauJob, prepareGolemTask } from "../src/adapters/distributedComputeAdapters.js";
import { InfrastructureLifecycle, verifyDeterministicOutput } from "../src/infrastructure/lifecycle.js";
import { TreasuryLedger, verifyLedger } from "../src/ledger/treasuryLedger.js";
import {
  applyBroadcastReceipt,
  ReceiptBackedChainSource,
  runLiveTestnetAgent,
  simulatedBroadcastReceipt
} from "../src/live/harness.js";
import { proposeShadowMarketOrders } from "../src/market/agent.js";
import { createRecoveryManifest, verifyRecoveryChain } from "../src/persistence/recoveryManifest.js";
import { observeTradeLayerSettlement } from "../src/settlement/tradelayerSettlementObserver.js";
import {
  createTradeLayerBalanceSnapshot,
  createTradeLayerPnlEvidence,
  normalizeTradeLayerBalanceRows,
  verifyTradeLayerBalanceSnapshot,
  verifyTradeLayerPnlEvidence
} from "../src/settlement/tradelayerPnlObserver.js";
import { canonicalHash } from "../src/survival/policy.js";

let artifact: TradeLayerTestnetArtifact;
let request: TestnetBrokerRequest;
const now = new Date("2026-07-12T12:00:00.000Z");
const policyFingerprint = canonicalHash({ policy: "testnet-broker-fixture" });

test("Bitcoin CLI broker binds an explicitly configured local RPC endpoint", () => {
  const args = buildBitcoinCliBrokerArgs({
    bitcoinBin: "D:\\Bitcoin",
    datadir: "D:\\BitcoinTestnet",
    wallet: "utxoref-testnet",
    rpcConnect: "127.0.0.1",
    rpcPort: "48332"
  }, "getblockchaininfo", []);
  assert.deepEqual(args, [
    "-datadir=D:\\BitcoinTestnet",
    "-rpcconnect=127.0.0.1",
    "-rpcport=48332",
    "-rpcwallet=utxoref-testnet",
    "getblockchaininfo"
  ]);
  assert.equal(buildBitcoinCliBrokerArgs({ wallet: "wallet" }, "getblockchaininfo", [])[0], "-chain=testnet4");
  assert.throws(
    () => buildBitcoinCliBrokerArgs({ wallet: "wallet", rpcPort: "not-a-port" }, "getblockchaininfo", []),
    /decimal TCP port/
  );
});

before(async () => {
  const runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-live-fixture-"));
  artifact = (await runTradeLayerTestnetMock({ runtimeDirectory })).artifact;
  request = createTestnetBrokerRequest({
    artifact,
    requestId: "broker-fixture",
    wallet: "fixture-wallet",
    policyFingerprint,
    maxTotalFeeSats: "1000",
    expiresAt: "2026-07-12T12:15:00.000Z"
  });
});

class FakeBitcoinCoreRpc implements BitcoinCoreBrokerRpc {
  private sequence = 0;
  private readonly payloadByPsbt = new Map<string, string>();
  private readonly lockedOutpoints = new Map<string, { txid: string; vout: number }>();
  signingCallCount = 0;

  get lockedCount(): number {
    return this.lockedOutpoints.size;
  }

  async call<T = unknown>(method: string, ...params: unknown[]): Promise<T> {
    let result: unknown;
    if (method === "getblockchaininfo") result = { chain: "testnet4" };
    else if (method === "listunspent") {
      result = [{
        txid: canonicalHash(`fixture-utxo-${this.sequence}`),
        vout: 0,
        amount: 0.0011,
        spendable: true,
        solvable: true,
        safe: true
      }];
    }
    else if (method === "walletcreatefundedpsbt") {
      const inputs = params[0] as Array<{ txid: string; vout: number }>;
      const outputs = params[1] as Array<{ data: string }>;
      const psbt = `psbt-${++this.sequence}`;
      this.payloadByPsbt.set(psbt, outputs[0]!.data);
      for (const input of inputs) this.lockedOutpoints.set(`${input.txid}:${input.vout}`, input);
      result = { psbt };
    } else if (method === "decodepsbt") {
      const psbt = String(params[0]).replace(/^signed-/, "");
      const payload = this.payloadByPsbt.get(psbt);
      result = {
        fee: 0.000001,
        tx: {
          vin: [{ txid: canonicalHash(`fixture-utxo-${Number(psbt.split("-").at(-1)) - 1}`), vout: 0 }],
          vout: [
            { value: 0, scriptPubKey: { type: "nulldata", asm: `OP_RETURN ${payload}` } },
            { value: 0.001099, scriptPubKey: { type: "witness_v0_keyhash", address: artifact.adminAddress } }
          ]
        },
        inputs: [{ witness_utxo: { amount: 0.0011, scriptPubKey: { address: artifact.adminAddress } } }]
      };
    } else if (method === "getaddressinfo") result = { ismine: true, iswatchonly: false };
    else if (method === "lockunspent") {
      const unlock = params[0] as boolean;
      const inputs = params[1] as Array<{ txid: string; vout: number }>;
      if (!unlock) throw new Error("Fixture only supports releasing locks");
      for (const input of inputs) this.lockedOutpoints.delete(`${input.txid}:${input.vout}`);
      result = true;
    }
    else if (method === "listlockunspent") result = [...this.lockedOutpoints.values()];
    else if (method === "walletprocesspsbt") {
      this.signingCallCount += 1;
      result = { psbt: `signed-${params[0]}`, complete: true };
    }
    else if (method === "finalizepsbt") result = { hex: `hex-${String(params[0]).replace(/^signed-/, "")}`, complete: true };
    else if (method === "testmempoolaccept") result = [{ allowed: true }];
    else if (method === "sendrawtransaction") result = canonicalHash(params[0]);
    else throw new Error(`Unexpected fake RPC method ${method}`);
    return result as T;
  }
}

test("settlement observer requires both reciprocal tx5 legs and confirmations", async () => {
  const receipt = simulatedBroadcastReceipt(artifact, request.requestHash, now);
  const observedArtifact = applyBroadcastReceipt(artifact, receipt, request);
  const report = await observeTradeLayerSettlement({
    artifact: observedArtifact,
    chainSource: new ReceiptBackedChainSource(observedArtifact, "confirmed", 2),
    minimumConfirmations: 2,
    now
  });

  assert.equal(report.allSettled, true);
  assert.equal(report.settledPairCount, 3);
  assert.ok(report.pairs.every((pair) => pair.reciprocalMatch && pair.transitions.at(-1) === "settled"));
  assert.ok(report.pairs.every((pair) => pair.settlementEvidenceHash));
});

test("settlement observer revokes settlement on reorg evidence", async () => {
  const receipt = simulatedBroadcastReceipt(artifact, request.requestHash, now);
  const observedArtifact = applyBroadcastReceipt(artifact, receipt, request);
  const report = await observeTradeLayerSettlement({
    artifact: observedArtifact,
    chainSource: new ReceiptBackedChainSource(observedArtifact, "reorged", -1),
    minimumConfirmations: 2,
    now
  });

  assert.equal(report.allSettled, false);
  assert.ok(report.pairs.every((pair) => pair.state === "reorged"));
});

test("TradeLayer PnL evidence binds exact-decimal snapshots, valuation source, and txids", () => {
  const before = createTradeLayerBalanceSnapshot({
    address: "tb1q-pnl-fixture",
    observedAt: "2026-07-12T11:59:59.000Z",
    source: "http://127.0.0.1:3000",
    rows: [{ propertyId: 2, available: "0.00000000" }, { propertyId: 1, available: "1.00000000" }]
  });
  const after = createTradeLayerBalanceSnapshot({
    address: "tb1q-pnl-fixture",
    observedAt: now.toISOString(),
    source: "http://127.0.0.1:3000",
    rows: [{ propertyId: 1, available: "1.00000227" }, { propertyId: 2, available: "0" }]
  });
  const txids = [canonicalHash("pnl-tx-b"), canonicalHash("pnl-tx-a")];
  const evidence = createTradeLayerPnlEvidence({
    beforeSnapshot: before,
    afterSnapshot: after,
    valuationPriceUsd: "65000.00000000",
    valuationSource: "independent-oracle-fixture",
    feesSats: "0",
    transactionIds: txids
  });

  assert.equal(before.rows[0]?.propertyId, 1);
  assert.equal(before.rows[0]?.available, "1");
  assert.equal(evidence.valuationPriceUsd, "65000");
  assert.equal(evidence.settledPnlSats, "227");
  assert.deepEqual(evidence.transactionIds, [...txids].sort());
  assert.equal(verifyTradeLayerBalanceSnapshot(before), true);
  assert.equal(verifyTradeLayerPnlEvidence(evidence, txids), true);
});

test("TradeLayer PnL evidence rejects tampered, ambiguous, and non-monotonic observations", () => {
  const before = createTradeLayerBalanceSnapshot({
    address: "tb1q-pnl-fixture",
    observedAt: "2026-07-12T11:59:59.000Z",
    source: "direct-tradelayer-rpc",
    rows: [{ propertyId: 1, available: "1" }]
  });
  const after = createTradeLayerBalanceSnapshot({
    address: before.address,
    observedAt: now.toISOString(),
    source: before.source,
    rows: [{ propertyId: 1, available: "1.000001" }]
  });
  const txid = canonicalHash("pnl-tx");
  const evidence = createTradeLayerPnlEvidence({
    beforeSnapshot: before,
    afterSnapshot: after,
    valuationPriceUsd: "65000",
    valuationSource: "oracle-fixture",
    feesSats: "1",
    transactionIds: [txid]
  });
  const tampered = structuredClone(evidence);
  tampered.afterSnapshot.rows[0]!.available = "2";
  assert.equal(verifyTradeLayerPnlEvidence(tampered, [txid]), false);
  assert.throws(
    () => normalizeTradeLayerBalanceRows([
      { propertyId: 1, available: "1" },
      { propertyId: "1", available: "2" }
    ]),
    /duplicate property/
  );
  assert.throws(
    () => normalizeTradeLayerBalanceRows([{ propertyId: 1, available: "0.000000001" }]),
    /at most 8 places/
  );
  assert.throws(
    () => createTradeLayerPnlEvidence({
      beforeSnapshot: after,
      afterSnapshot: before,
      valuationPriceUsd: "65000",
      valuationSource: "oracle-fixture",
      feesSats: "0",
      transactionIds: [txid]
    }),
    /newer than/
  );
});

test("double-entry ledger prohibits spending unrealized revenue", async () => {
  const ledger = new TreasuryLedger();
  await ledger.recognizeUnrealized("227", "projection-evidence", now.toISOString());
  await assert.rejects(() => ledger.spendInfrastructure("1", "provider-invoice", now.toISOString()), /available treasury/);
  await ledger.settleRevenue("227", ["maker-proof", "taker-proof", "pnl-proof"], now.toISOString());
  await ledger.releaseSettled("227", "reconciliation-proof", now.toISOString());
  await ledger.spendInfrastructure("100", "provider-invoice", now.toISOString());

  assert.equal(ledger.balance("unrealized"), 0n);
  assert.equal(ledger.balance("available"), 127n);
  assert.equal(ledger.balance("infrastructure"), 100n);
  assert.equal(verifyLedger(ledger.list()), true);
});

test("PSBT broker enforces exact approval and returns txids without keys", async () => {
  const broker = new TestnetSignerBroker(new FakeBitcoinCoreRpc(), policyFingerprint);
  const prepared = await broker.prepare(request, now);
  assert.equal(prepared.preparedSteps.length, 6);
  assert.equal(prepared.totalFeeSats, "600");
  assert.ok(prepared.preparedSteps.every((step) => step.inputUtxos.length === 1));
  assert.ok(prepared.preparedSteps.every((step) => step.walletChangeOutputs[0]?.valueSats === "109900"));
  assert.ok(prepared.preparedSteps.every((step) => step.walletChangeAddresses.length === 1));
  await assert.rejects(
    () => broker.signAndBroadcast({ prepared, approvalHash: "wrong", now }),
    /approval hash mismatch/
  );
  const receipt = await broker.signAndBroadcast({ prepared, approvalHash: prepared.approvalHash, now });
  assert.equal(receipt.transactions.length, 6);
  assert.ok(receipt.transactions.every((transaction) => /^[a-f0-9]{64}$/.test(transaction.txid)));
  assert.equal(JSON.stringify(receipt).includes("private"), false);
});

test("PSBT broker rejects stale requests before touching signing", async () => {
  const broker = new TestnetSignerBroker(new FakeBitcoinCoreRpc(), policyFingerprint);
  await assert.rejects(() => broker.prepare(request, new Date("2026-07-12T12:20:00.000Z")), /expired/);
});

test("PSBT broker cancellation releases only prepared inputs without signing or broadcasting", async () => {
  const rpc = new FakeBitcoinCoreRpc();
  const broker = new TestnetSignerBroker(rpc, policyFingerprint);
  const prepared = await broker.prepare(request, now);
  assert.equal(rpc.lockedCount, 6);
  const afterExpiry = new Date("2026-07-12T12:20:00.000Z");
  const receipt = await broker.cancelPrepared(prepared, afterExpiry);
  assert.equal(receipt.status, "cancelled_after_local_test");
  assert.equal(receipt.inputOutpoints.length, 6);
  assert.equal(receipt.inputLockReleased, true);
  assert.equal(receipt.signingPerformed, false);
  assert.equal(receipt.broadcastPerformed, false);
  assert.equal(rpc.lockedCount, 0);
  assert.equal(rpc.signingCallCount, 0);

  const resumedReceipt = await broker.cancelPrepared(prepared, afterExpiry);
  assert.equal(resumedReceipt.receiptHash, receipt.receiptHash);
  assert.equal(rpc.lockedCount, 0);
});

test("PSBT broker refuses a tampered cancellation receipt before releasing inputs", async () => {
  const rpc = new FakeBitcoinCoreRpc();
  const broker = new TestnetSignerBroker(rpc, policyFingerprint);
  const prepared = await broker.prepare(request, now);
  const tampered = structuredClone(prepared);
  tampered.preparedSteps[0]!.inputUtxos[0]!.vout += 1;
  await assert.rejects(() => broker.cancelPrepared(tampered, now), /approval fingerprint mismatch/);
  assert.equal(rpc.lockedCount, 6);
  assert.equal(rpc.signingCallCount, 0);
  await broker.cancelPrepared(prepared, now);
});

test("PSBT broker releases reserved inputs when preparation exceeds its fee cap", async () => {
  const rpc = new FakeBitcoinCoreRpc();
  const broker = new TestnetSignerBroker(rpc, policyFingerprint);
  const lowCap = createTestnetBrokerRequest({
    artifact,
    requestId: "broker-low-fee-cap",
    wallet: "fixture-wallet",
    policyFingerprint,
    maxTotalFeeSats: "1",
    expiresAt: "2026-07-12T12:15:00.000Z"
  });
  await assert.rejects(() => broker.prepare(lowCap, now), /aggregate fee cap/);
  assert.equal(rpc.lockedCount, 0);
  assert.equal(rpc.signingCallCount, 0);
});

test("market loop cancels all orders at its drawdown breaker", () => {
  const bookCore = {
    pair: "BTCUSD" as const,
    sequence: 1,
    observedAt: now.toISOString(),
    bids: [{ price: 64_900, sizeSats: "100000" }],
    asks: [{ price: 65_100, sizeSats: "100000" }]
  };
  const decision = proposeShadowMarketOrders({
    book: { ...bookCore, sourceHash: canonicalHash(bookCore) },
    risk: { inventorySats: "0", realizedPnlSats: "-50000", dailyDrawdownSats: "50000", openExposureSats: "0" },
    config: {
      strategy: "bounded_market_making",
      quoteSizeSats: "100000",
      spreadBps: 20,
      maxInventorySats: "500000",
      maxExposureSats: "1000000",
      maxDailyDrawdownSats: "50000",
      maxSlippageBps: 50,
      repriceThresholdBps: 5
    },
    existingOrders: [{
      orderId: "existing",
      side: "buy",
      price: 64_900,
      sizeSats: "100000",
      expiresAt: "2026-07-12T12:01:00.000Z",
      proposalHash: "existing-hash"
    }],
    now
  });
  assert.equal(decision.decision, "cancel_all");
  assert.deepEqual(decision.cancelOrderIds, ["existing"]);
});

test("infrastructure and recovery state reject unverifiable transitions", () => {
  const lifecycle = new InfrastructureLifecycle("akash", "lease-1");
  lifecycle.transition("quoted", { price: "100uact" }, now.toISOString());
  assert.throws(() => lifecycle.transition("verified", { status: "running" }, now.toISOString()), /Invalid infrastructure/);
  const output = "deterministic-result";
  const expectedSha256 = crypto.createHash("sha256").update(output).digest("hex");
  assert.equal(verifyDeterministicOutput({ output, expectedSha256 }).valid, true);
  assert.equal(verifyDeterministicOutput({ output: "tampered", expectedSha256 }).valid, false);

  const first = createRecoveryManifest({
    agentId: "agent",
    version: 1,
    previousManifestHash: "0".repeat(64),
    createdAt: now.toISOString(),
    artifacts: [{ role: "ledger", cid: "bafy-ledger-1", sha256: "a".repeat(64), sizeBytes: "10" }],
    storage: { network: "filecoin-calibration", mode: "filecoin_pin_alpha", proofStatus: "pending" }
  });
  const second = createRecoveryManifest({
    agentId: "agent",
    version: 2,
    previousManifestHash: first.manifestHash,
    createdAt: now.toISOString(),
    artifacts: [{ role: "ledger", cid: "bafy-ledger-2", sha256: "b".repeat(64), sizeBytes: "11" }],
    storage: { network: "filecoin-calibration", mode: "filecoin_pin_alpha", proofStatus: "confirmed", proofEvidenceHash: "proof" }
  });
  assert.equal(verifyRecoveryChain([first, second]), true);
  assert.equal(verifyRecoveryChain([second, first]), false);
});

test("distributed compute plans remain unsigned and deterministically verifiable", () => {
  const expiresAt = "2026-07-12T12:05:00.000Z";
  const quote = (provider: "bacalhau" | "golem") => ({
    quoteId: `${provider}-quote`,
    provider,
    service: "compute" as const,
    mode: "mock" as const,
    policyCostSats: "100",
    providerPrice: { amount: "100", denomination: provider === "golem" ? "GLM" : "policy-sats" },
    expiresAt,
    quoteHash: canonicalHash({ provider, expiresAt })
  });
  const expectedOutputSha256 = crypto.createHash("sha256").update("result").digest("hex");
  const bacalhau = prepareBacalhauJob({
    quote: quote("bacalhau"),
    jobId: "filecoin-batch",
    image: "example/worker:1.0.0",
    command: ["run", "/inputs"],
    inputCid: "bafy-input",
    expectedOutputSha256,
    resources: { cpuMillicores: 500, memoryMiB: 512, storageMiB: 1024, replicas: 1 }
  });
  const golem = prepareGolemTask({
    quote: quote("golem"),
    taskId: "divisible-task",
    imageHash: "sha3:fixture",
    command: ["run-task"],
    expectedOutputSha256,
    timeoutSeconds: 300
  });
  assert.equal(bacalhau.provider, "bacalhau");
  assert.equal(golem.provider, "golem");
  assert.equal(bacalhau.submitAuthority, "external_capability_broker");
  assert.equal(golem.submitAuthority, "external_capability_broker");

  const ranked = scoreAkashBids([
    { provider: "cheap-unreliable", priceUact: "50", uptimeBps: 8000, completedLeaseCount: 2, signedByTrustedAuditor: false },
    { provider: "reliable", priceUact: "100", uptimeBps: 9990, completedLeaseCount: 1000, signedByTrustedAuditor: true }
  ]);
  assert.equal(ranked[0]?.provider, "reliable");
});

test("full deterministic loop reaches settlement but labels signing as simulated", async () => {
  const runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-live-loop-"));
  const result = await runLiveTestnetAgent({ runtimeDirectory, now, simulatedSettlement: true });

  assert.equal(result.settlement.allSettled, true);
  assert.equal(result.pnlVerified, true);
  assert.equal(result.ledger.valid, true);
  assert.equal(result.ledger.balances.available, "227");
  assert.equal(result.acceptance.observedConfirmationAndMatch, true);
  assert.equal(result.acceptance.settledPnlLedgerEntry, true);
  assert.equal(result.acceptance.cappedInfrastructureIntent, true);
  assert.equal(result.acceptance.walletVisibleEvidenceTrace, true);
  assert.equal(result.acceptance.fundedTestnetWallet, false);
  assert.equal(result.acceptance.signedTradeLayerTransactions, false);
  assert.equal(result.market.decision.mode, "shadow");
});
