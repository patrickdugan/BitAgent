import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ScriptedSignalExecutionBroker, withPortfolioHash } from "../src/signals/broker.js";
import { computeSourceTreeCommitment } from "../src/signals/codebaseVerifier.js";
import { SignalKernelError } from "../src/signals/errors.js";
import { buildSignalRiskPolicy, createTestCommittedSignalKernel } from "../src/signals/factory.js";
import { createAlgorithmicTradeSignal } from "../src/signals/signalValidator.js";
import { FileSignalWorkflowStore, InMemorySignalWorkflowStore } from "../src/signals/store.js";
import type {
  AlgorithmicTradeSignal,
  SignalPortfolioSnapshot,
  SignalRiskPolicy
} from "../src/signals/types.js";

const fixedNow = new Date("2026-07-26T12:00:00.000Z");
const producerKeys = crypto.generateKeyPairSync("ed25519");
const producerPublicKeyPem = producerKeys.publicKey.export({ type: "spki", format: "pem" }).toString();

function signPayloadHash(payloadHash: string) {
  return crypto.sign(null, Buffer.from(payloadHash, "hex"), producerKeys.privateKey).toString("base64");
}

function portfolio(overrides: Partial<Omit<SignalPortfolioSnapshot, "snapshotHash">> = {}) {
  return {
    source: "test-wallet-observer",
    observedAt: fixedNow.toISOString(),
    network: "testnet4" as const,
    senderAddress: "tb1qcommittedsignaltestsender000000000000000000",
    confirmedUtxos: [{
      txid: "aa".repeat(32),
      vout: 1,
      amountSats: "250000",
      scriptPubKeyHex: `0014${"22".repeat(20)}`,
      confirmations: 3
    }],
    tlbtcAvailableSats: "250000",
    tlusdAvailableAtoms: "20000000000",
    openExposureSats: "0",
    dailyDrawdownSats: "0",
    ...overrides
  };
}

async function fixture(input: {
  broker?: ScriptedSignalExecutionBroker;
  policyOverrides?: Partial<Omit<SignalRiskPolicy, "approvedCodebases">>;
  store?: InMemorySignalWorkflowStore | FileSignalWorkflowStore;
} = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-signal-code-"));
  await fs.writeFile(path.join(directory, "strategy.js"), "export const strategy = 'committed-limit-signal-v1';\n");
  const commitment = await computeSourceTreeCommitment(directory);
  const approved = {
    codebaseId: "fixture-algorithms",
    kind: "sha256_source_tree" as const,
    digest: commitment.digest,
    rootPath: directory
  };
  const policy = buildSignalRiskPolicy([approved], {
    approvedProducers: [{
      producerKeyId: "fixture-producer",
      codebaseId: approved.codebaseId,
      publicKeyPem: producerPublicKeyPem
    }],
    ...input.policyOverrides
  });
  const broker = input.broker || new ScriptedSignalExecutionBroker({ portfolio: portfolio() });
  const store = input.store || new InMemorySignalWorkflowStore();
  const kernel = createTestCommittedSignalKernel({ policy, broker, store, now: () => new Date(fixedNow) });
  return { directory, commitment, approved, policy, broker, store, kernel };
}

function signal(
  digest: string,
  overrides: Partial<Omit<AlgorithmicTradeSignal, "payloadHash">> = {}
) {
  return createAlgorithmicTradeSignal({
    schema: "bitagent_tradelayer_signal_v1",
    signalId: "signal-001",
    codebase: { codebaseId: "fixture-algorithms", kind: "sha256_source_tree", digest },
    producerKeyId: "fixture-producer",
    strategyId: "committed-limit-signal-v1",
    strategyVersion: "1",
    market: "TLBTC/TLUSD",
    side: "sell_tlbtc",
    amountSats: "50000",
    limitPriceUsd: "65000.00",
    postOnly: true,
    generatedAt: fixedNow.toISOString(),
    expiresAt: new Date(fixedNow.getTime() + 120_000).toISOString(),
    inputSnapshotHash: "33".repeat(32),
    ...overrides
  }, signPayloadHash);
}

async function ingestAndSimulate(
  setup: Awaited<ReturnType<typeof fixture>>,
  workflowId = "workflow-1",
  selectedSignal = signal(setup.commitment.digest)
) {
  await setup.kernel.start({ workflowId });
  await setup.kernel.ingest(workflowId, selectedSignal);
  const simulation = await setup.kernel.simulate(workflowId);
  return { simulation, workflowId };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) =>
    error instanceof SignalKernelError && error.code === code
  );
}

test("committed sell signal completes explain/simulate/approve/execute/verify", async () => {
  const setup = await fixture();
  const { workflowId, simulation } = await ingestAndSimulate(setup);
  assert.match(simulation.payload, /^tl5/);
  assert.match(simulation.funding.fundingRoot, /^[0-9a-f]{64}$/);
  await setup.kernel.requestApproval(workflowId);
  await setup.kernel.resolveApproval(workflowId, "approve");
  const execution = await setup.kernel.execute(workflowId);
  const verification = await setup.kernel.verify(workflowId);
  assert.equal(verification.status, "verified");
  assert.equal(verification.txid, execution.txid);
  assert.equal((await setup.kernel.getPublic(workflowId)).approval?.walletApprovalToken, "[wallet-held]");
});

test("committed buy signal reverses the TradeLayer offered asset", async () => {
  const setup = await fixture();
  const buy = signal(setup.commitment.digest, { side: "buy_tlbtc", amountSats: "25000" });
  const { simulation } = await ingestAndSimulate(setup, "buy-flow", buy);
  assert.equal(simulation.effects[0]?.asset, "tlUSD");
  assert.equal(simulation.effects[1]?.asset, "tlBTC");
  assert.match(simulation.payload, /^tl52,1,/);
});

test("unapproved codebase digest is rejected", async () => {
  const setup = await fixture();
  await setup.kernel.start({ workflowId: "wrong-code" });
  await expectCode(setup.kernel.ingest("wrong-code", signal("55".repeat(32))), "codebase_unapproved");
});

test("source mutation after approval invalidates execution", async () => {
  const setup = await fixture();
  const { workflowId } = await ingestAndSimulate(setup, "mutated-code");
  await setup.kernel.requestApproval(workflowId);
  await setup.kernel.resolveApproval(workflowId, "approve");
  await fs.writeFile(path.join(setup.directory, "strategy.js"), "export const strategy = 'tampered';\n");
  await expectCode(setup.kernel.execute(workflowId), "codebase_mismatch");
});

test("tampered signal payload hash is rejected", async () => {
  const setup = await fixture();
  await setup.kernel.start({ workflowId: "bad-hash" });
  const bad = { ...signal(setup.commitment.digest), amountSats: "50001" };
  await expectCode(setup.kernel.ingest("bad-hash", bad), "signal_schema_error");
});

test("forged producer signature is rejected", async () => {
  const setup = await fixture();
  await setup.kernel.start({ workflowId: "forged-signature" });
  const forgedKeys = crypto.generateKeyPairSync("ed25519");
  const valid = signal(setup.commitment.digest);
  const forged = {
    ...valid,
    signature: crypto.sign(null, Buffer.from(valid.payloadHash, "hex"), forgedKeys.privateKey).toString("base64")
  };
  await expectCode(setup.kernel.ingest("forged-signature", forged), "signal_signature_invalid");
});

test("unapproved producer key cannot claim an approved codebase", async () => {
  const setup = await fixture();
  await setup.kernel.start({ workflowId: "unknown-producer" });
  const unknownKeys = crypto.generateKeyPairSync("ed25519");
  const unsigned = {
    schema: "bitagent_tradelayer_signal_v1" as const,
    signalId: "unknown-producer-signal",
    codebase: {
      codebaseId: "fixture-algorithms",
      kind: "sha256_source_tree" as const,
      digest: setup.commitment.digest
    },
    producerKeyId: "unknown-producer",
    strategyId: "committed-limit-signal-v1",
    strategyVersion: "1",
    market: "TLBTC/TLUSD" as const,
    side: "sell_tlbtc" as const,
    amountSats: "50000",
    limitPriceUsd: "65000.00",
    postOnly: true as const,
    generatedAt: fixedNow.toISOString(),
    expiresAt: new Date(fixedNow.getTime() + 120_000).toISOString(),
    inputSnapshotHash: "33".repeat(32)
  };
  const unapproved = createAlgorithmicTradeSignal(unsigned, (payloadHash) =>
    crypto.sign(null, Buffer.from(payloadHash, "hex"), unknownKeys.privateKey).toString("base64")
  );
  await expectCode(setup.kernel.ingest("unknown-producer", unapproved), "signal_signature_invalid");
});

test("expired signal is rejected", async () => {
  const setup = await fixture();
  await setup.kernel.start({ workflowId: "expired" });
  const expired = signal(setup.commitment.digest, {
    generatedAt: new Date(fixedNow.getTime() - 300_000).toISOString(),
    expiresAt: new Date(fixedNow.getTime() - 1_000).toISOString()
  });
  await expectCode(setup.kernel.ingest("expired", expired), "signal_expired");
});

test("unapproved strategy version is rejected", async () => {
  const setup = await fixture();
  await setup.kernel.start({ workflowId: "strategy-version" });
  await expectCode(
    setup.kernel.ingest("strategy-version", signal(setup.commitment.digest, { strategyVersion: "2" })),
    "strategy_unapproved"
  );
});

test("secret-bearing fields are rejected before schema processing", async () => {
  const setup = await fixture();
  await setup.kernel.start({ workflowId: "secret" });
  const unsafe = { ...signal(setup.commitment.digest), privateKey: "do-not-read" };
  await expectCode(setup.kernel.ingest("secret", unsafe), "secret_material_prohibited");
  assert.equal(JSON.stringify(await setup.kernel.get("secret")).includes("do-not-read"), false);
});

test("insufficient tlBTC fails risk policy before approval", async () => {
  const broker = new ScriptedSignalExecutionBroker({ portfolio: portfolio({ tlbtcAvailableSats: "1000" }) });
  const setup = await fixture({ broker });
  await setup.kernel.start({ workflowId: "no-tlbtc" });
  await setup.kernel.ingest("no-tlbtc", signal(setup.commitment.digest));
  await expectCode(setup.kernel.simulate("no-tlbtc"), "risk_rejected");
});

test("insufficient tlUSD blocks a buy signal", async () => {
  const broker = new ScriptedSignalExecutionBroker({ portfolio: portfolio({ tlusdAvailableAtoms: "1" }) });
  const setup = await fixture({ broker });
  await setup.kernel.start({ workflowId: "no-tlusd" });
  await setup.kernel.ingest("no-tlusd", signal(setup.commitment.digest, { side: "buy_tlbtc" }));
  await expectCode(setup.kernel.simulate("no-tlusd"), "risk_rejected");
});

test("order size cap is enforced", async () => {
  const setup = await fixture();
  await setup.kernel.start({ workflowId: "size-cap" });
  await setup.kernel.ingest("size-cap", signal(setup.commitment.digest, { amountSats: "100001" }));
  await expectCode(setup.kernel.simulate("size-cap"), "risk_rejected");
});

test("unconfirmed UTXO cannot fund the TradeLayer transaction", async () => {
  const unconfirmed = portfolio({
    confirmedUtxos: [{
      txid: "aa".repeat(32),
      vout: 1,
      amountSats: "250000",
      scriptPubKeyHex: `0014${"22".repeat(20)}`,
      confirmations: 1
    }]
  });
  const setup = await fixture({ broker: new ScriptedSignalExecutionBroker({ portfolio: unconfirmed }) });
  await setup.kernel.start({ workflowId: "unconfirmed" });
  await setup.kernel.ingest("unconfirmed", signal(setup.commitment.digest));
  await expectCode(setup.kernel.simulate("unconfirmed"), "utxo_unconfirmed");
});

test("execution without wallet approval is prohibited", async () => {
  const setup = await fixture();
  const { workflowId } = await ingestAndSimulate(setup, "no-approval");
  await expectCode(setup.kernel.execute(workflowId), "approval_required");
});

test("user cancellation is persisted and does not execute", async () => {
  const setup = await fixture();
  const { workflowId } = await ingestAndSimulate(setup, "cancel");
  await setup.kernel.requestApproval(workflowId);
  await setup.kernel.resolveApproval(workflowId, "cancel");
  assert.equal((await setup.kernel.get(workflowId)).status, "cancelled");
  await expectCode(setup.kernel.execute(workflowId), "approval_required");
});

test("rejected wallet approval is recoverable", async () => {
  const setup = await fixture({
    broker: new ScriptedSignalExecutionBroker({ portfolio: portfolio(), rejectAuthorization: true })
  });
  const { workflowId } = await ingestAndSimulate(setup, "rejected");
  await setup.kernel.requestApproval(workflowId);
  await expectCode(setup.kernel.resolveApproval(workflowId, "approve"), "approval_rejected");
  const state = await setup.kernel.get(workflowId);
  assert.equal(state.status, "simulation_ready");
  assert.equal(state.approval?.status, "rejected");
});

test("wallet state change after approval makes simulation stale", async () => {
  const broker = new ScriptedSignalExecutionBroker({ portfolio: portfolio() });
  const setup = await fixture({ broker });
  const { workflowId } = await ingestAndSimulate(setup, "portfolio-change");
  await setup.kernel.requestApproval(workflowId);
  await setup.kernel.resolveApproval(workflowId, "approve");
  broker.setPortfolio(portfolio({ openExposureSats: "1" }));
  await expectCode(setup.kernel.execute(workflowId), "simulation_stale");
});

test("network fee change after approval makes simulation stale", async () => {
  class MutableFeeBroker extends ScriptedSignalExecutionBroker {
    fee = "900";
    override async estimateNetworkFee() {
      return { networkFeeSats: this.fee, source: "mutable-test-fee" };
    }
  }
  const broker = new MutableFeeBroker({ portfolio: portfolio() });
  const setup = await fixture({ broker });
  const { workflowId } = await ingestAndSimulate(setup, "fee-change");
  await setup.kernel.requestApproval(workflowId);
  await setup.kernel.resolveApproval(workflowId, "approve");
  broker.fee = "901";
  await expectCode(setup.kernel.execute(workflowId), "simulation_stale");
});

test("duplicate execute is idempotent", async () => {
  const setup = await fixture();
  const { workflowId } = await ingestAndSimulate(setup, "duplicate");
  await setup.kernel.requestApproval(workflowId);
  await setup.kernel.resolveApproval(workflowId, "approve");
  const first = await setup.kernel.execute(workflowId);
  const second = await setup.kernel.execute(workflowId);
  assert.deepEqual(second, first);
});

test("pending verification can be resumed", async () => {
  const broker = new ScriptedSignalExecutionBroker({ portfolio: portfolio(), pendingVerification: true });
  const setup = await fixture({ broker });
  const { workflowId } = await ingestAndSimulate(setup, "pending");
  await setup.kernel.requestApproval(workflowId);
  await setup.kernel.resolveApproval(workflowId, "approve");
  await setup.kernel.execute(workflowId);
  const result = await setup.kernel.verify(workflowId);
  assert.equal(result.status, "pending");
  assert.equal((await setup.kernel.get(workflowId)).status, "submitted");
});

test("approved workflow resumes from an atomic file store", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-signal-state-"));
  const statePath = path.join(directory, "signals.json");
  const store = new FileSignalWorkflowStore(statePath);
  const setup = await fixture({ store });
  const { workflowId } = await ingestAndSimulate(setup, "resume-file");
  await setup.kernel.requestApproval(workflowId);
  await setup.kernel.resolveApproval(workflowId, "approve");
  const resumed = createTestCommittedSignalKernel({
    policy: setup.policy,
    broker: setup.broker,
    store: new FileSignalWorkflowStore(statePath),
    now: () => new Date(fixedNow)
  });
  const execution = await resumed.execute(workflowId);
  assert.match(execution.txid, /^[0-9a-f]{64}$/);
});

test("a UTXO cannot be reserved by two active signal workflows", async () => {
  const setup = await fixture();
  await ingestAndSimulate(setup, "funding-a", signal(setup.commitment.digest, { signalId: "signal-a" }));
  await setup.kernel.start({ workflowId: "funding-b" });
  await setup.kernel.ingest("funding-b", signal(setup.commitment.digest, { signalId: "signal-b" }));
  await expectCode(setup.kernel.simulate("funding-b"), "risk_rejected");
});

test("persisted simulation tampering is detected before approval", async () => {
  const store = new InMemorySignalWorkflowStore();
  const setup = await fixture({ store });
  const { workflowId } = await ingestAndSimulate(setup, "tamper-state");
  const state = await store.get(workflowId);
  assert.ok(state?.simulation);
  state.simulation.effects[0]!.amount = "999999";
  await store.save(state);
  await expectCode(setup.kernel.requestApproval(workflowId), "state_conflict");
});

test("verification failure remains visible and blocks success", async () => {
  const setup = await fixture({
    broker: new ScriptedSignalExecutionBroker({ portfolio: portfolio(), failVerification: true })
  });
  const { workflowId } = await ingestAndSimulate(setup, "verify-fail");
  await setup.kernel.requestApproval(workflowId);
  await setup.kernel.resolveApproval(workflowId, "approve");
  await setup.kernel.execute(workflowId);
  const verification = await setup.kernel.verify(workflowId);
  assert.equal(verification.status, "failed");
  assert.equal((await setup.kernel.get(workflowId)).status, "failed");
});

test("portfolio hashes ignore observation timestamp but bind balances and UTXOs", () => {
  const first = withPortfolioHash(portfolio());
  const second = withPortfolioHash(portfolio({ observedAt: "2026-07-26T12:00:01.000Z" }));
  const changed = withPortfolioHash(portfolio({ tlbtcAvailableSats: "249999" }));
  assert.equal(first.snapshotHash, second.snapshotHash);
  assert.notEqual(first.snapshotHash, changed.snapshotHash);
});
