import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BitcoinCoreBrokerRpc } from "../src/broker/types.js";
import {
  createTradeLayerActivationBrokerRequest,
  TradeLayerActivationCandidateBroker
} from "../src/broker/tradelayerActivationCandidateBroker.js";
import { FileTradeLayerActivationCandidateStore } from "../src/broker/tradelayerActivationCandidateStore.js";
import { TradeLayerActivationExecutionBroker } from "../src/broker/tradelayerActivationExecutionBroker.js";
import { TradeLayerActivationOperator } from "../src/broker/tradelayerActivationOperator.js";
import { encodeSegwitAddress } from "../src/launch/bitcoin.js";
import { canonicalHash } from "../src/survival/policy.js";

const NOW = new Date("2026-08-07T13:00:00.000Z");
const SENDER = encodeSegwitAddress(Buffer.alloc(20, 29), "bitcoin-testnet4");
const INPUT_TXID = "31".repeat(32);
const UNSIGNED_TXID = "42".repeat(32);
const POLICY = canonicalHash({ policy: "tx11-activation-operator-fixture" });
const request = createTradeLayerActivationBrokerRequest({
  requestId: "candidate11-activation-operator-fixture",
  wallet: "fixture-wallet",
  senderAddress: SENDER,
  releaseId: "tx11-utxoref-dynamic-contract-candidate-11",
  deploymentCommit: "b3423bf7f72a4e8bfad3fbc61f757505553b9d4c",
  codeHash: "8f8e83ae0bac5b578087af7c2dd00c63d3ca87952be72e6e70c4a6acdfffd623",
  sourceVerificationHash: "90".repeat(32),
  policyFingerprint: POLICY,
  maxFeeSats: "2000",
  expiresAt: "2026-08-07T13:15:00.000Z"
});

type Scenario = "success" | "signature_rejected" | "submission_unknown";

class FakeOperatorRpc implements BitcoinCoreBrokerRpc {
  private readonly locked = new Map<string, { txid: string; vout: number }>();
  readonly methods: string[] = [];
  observed = false;

  constructor(readonly scenario: Scenario = "success") {}

  get lockedCount(): number {
    return this.locked.size;
  }

  private decoded() {
    return {
      fee: 0.00001,
      tx: {
        txid: UNSIGNED_TXID,
        vin: [{ txid: INPUT_TXID, vout: 0 }],
        vout: [
          { value: 0, n: 0, scriptPubKey: { type: "nulldata", asm: `OP_RETURN ${request.activation.payloadHex}` } },
          { value: 0.00009, n: 1, scriptPubKey: { type: "witness_v0_keyhash", address: SENDER } }
        ]
      },
      inputs: [{ witness_utxo: { amount: 0.0001, scriptPubKey: { address: SENDER } } }]
    };
  }

  async call<T = unknown>(method: string, ...params: unknown[]): Promise<T> {
    this.methods.push(method);
    let result: unknown;
    if (method === "getblockchaininfo") {
      result = { chain: "testnet4", blocks: 147363, headers: 147363, initialblockdownload: false };
    } else if (method === "getaddressinfo") {
      result = { ismine: true, iswatchonly: false };
    } else if (method === "listunspent") {
      result = [{ txid: INPUT_TXID, vout: 0, amount: 0.0001, spendable: true, solvable: true, safe: true }];
    } else if (method === "walletcreatefundedpsbt") {
      this.locked.set(`${INPUT_TXID}:0`, { txid: INPUT_TXID, vout: 0 });
      result = { psbt: "private-activation-psbt" };
    } else if (method === "decodepsbt") {
      result = this.decoded();
    } else if (method === "walletprocesspsbt") {
      result = this.scenario === "signature_rejected"
        ? { psbt: "rejected", complete: false }
        : { psbt: "signed-activation-psbt", complete: true };
    } else if (method === "finalizepsbt") {
      result = { hex: "02000000activation", complete: true };
    } else if (method === "decoderawtransaction") {
      result = this.decoded().tx;
    } else if (method === "testmempoolaccept") {
      result = [{ allowed: true, txid: UNSIGNED_TXID, fees: { base: 0.00001 } }];
    } else if (method === "sendrawtransaction") {
      if (this.scenario === "submission_unknown") throw new Error("connection dropped");
      this.locked.delete(`${INPUT_TXID}:0`);
      this.observed = true;
      result = UNSIGNED_TXID;
    } else if (method === "lockunspent") {
      for (const input of params[1] as Array<{ txid: string; vout: number }>) {
        this.locked.delete(`${input.txid}:${input.vout}`);
      }
      result = true;
    } else if (method === "listlockunspent") {
      result = [...this.locked.values()];
    } else if (method === "getrawtransaction") {
      if (!this.observed) throw new Error("not found");
      result = { txid: UNSIGNED_TXID, confirmations: 0 };
    } else {
      throw new Error(`Unexpected activation operator RPC ${method}`);
    }
    return result as T;
  }
}

async function fixture(scenario: Scenario = "success") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-activation-operator-"));
  const storePath = path.join(directory, "private-candidates.json");
  const rpc = new FakeOperatorRpc(scenario);
  const store = new FileTradeLayerActivationCandidateStore(storePath, POLICY);
  const operator = new TradeLayerActivationOperator(
    new TradeLayerActivationCandidateBroker(rpc, POLICY),
    new TradeLayerActivationExecutionBroker(rpc, POLICY),
    store
  );
  return { directory, storePath, rpc, store, operator };
}

test("durably resumes a host-private candidate through a PSBT-free approval view", async () => {
  const setup = await fixture();
  try {
    const prepared = await setup.operator.prepare(request, NOW);
    assert.equal(prepared.status, "pending_approval");
    assert.equal(prepared.approval.expiresAt, request.expiresAt);
    assert.equal(prepared.approval.expired, false);
    assert.equal(prepared.approval.decisionStatus, "pending");
    assert.equal(prepared.exactEffects.dataOutput.payloadUtf8, request.activation.payloadUtf8);
    assert.equal(prepared.exactEffects.feeSats, "1000");
    assert.equal(JSON.stringify(prepared).includes("rawPsbt"), false);
    assert.equal((await fs.readFile(setup.storePath, "utf8")).includes("rawPsbt"), true);

    const resumed = await new FileTradeLayerActivationCandidateStore(setup.storePath, POLICY)
      .getPublic(prepared.exactEffects.approvalHash, NOW);
    assert.deepEqual(resumed, prepared);
    assert.equal(JSON.stringify(resumed).includes("private-activation-psbt"), false);
    await setup.operator.cancel(prepared.exactEffects.approvalHash, NOW);
  } finally {
    await fs.rm(setup.directory, { recursive: true, force: true });
  }
});

test("exact approval executes once and persists a PSBT-free submission receipt", async () => {
  const setup = await fixture();
  try {
    const prepared = await setup.operator.prepare(request, NOW);
    const approvalHash = prepared.exactEffects.approvalHash;
    const submitted = await setup.operator.approveAndExecute(approvalHash, NOW);
    assert.equal(submitted.status, "submitted");
    assert.equal(submitted.result?.schema, "bitagent_tradelayer_activation_submission_v1");
    assert.equal(submitted.approval.decisionStatus, "approved");
    assert.equal(submitted.walletActions.signingPerformed, true);
    assert.equal(submitted.walletActions.broadcastStatus, "submitted");
    assert.equal(JSON.stringify(submitted).includes("rawPsbt"), false);
    await assert.rejects(() => setup.operator.approveAndExecute(approvalHash, NOW), /Only a pending/);
    await assert.rejects(() => setup.operator.cancel(approvalHash, NOW), /Only a pending/);
  } finally {
    await fs.rm(setup.directory, { recursive: true, force: true });
  }
});

test("expired approval is public, cannot sign, and remains explicitly cancellable", async () => {
  const setup = await fixture();
  try {
    const prepared = await setup.operator.prepare(request, NOW);
    const approvalHash = prepared.exactEffects.approvalHash;
    const expiredAt = new Date("2026-08-07T13:15:01.000Z");
    const expired = await setup.operator.status(approvalHash, expiredAt);
    assert.equal(expired.status, "pending_approval");
    assert.equal(expired.approval.expired, true);
    assert.equal(expired.approval.decisionStatus, "expired");
    assert.match(expired.recoveryInstructions.join(" "), /do not approve/i);
    assert.match(expired.recoveryInstructions.join(" "), /fresh simulation/i);
    await assert.rejects(
      () => setup.operator.approveAndExecute(approvalHash, expiredAt),
      /approval expired/i
    );
    assert.equal(setup.rpc.methods.includes("walletprocesspsbt"), false);
    assert.equal(setup.rpc.lockedCount, 1);
    const cancelled = await setup.operator.cancel(approvalHash, expiredAt);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.approval.decisionStatus, "cancelled");
    assert.equal(setup.rpc.lockedCount, 0);
  } finally {
    await fs.rm(setup.directory, { recursive: true, force: true });
  }
});

test("rejected signature records released-input recovery without retrying", async () => {
  const setup = await fixture("signature_rejected");
  try {
    const prepared = await setup.operator.prepare(request, NOW);
    const approvalHash = prepared.exactEffects.approvalHash;
    await assert.rejects(() => setup.operator.approveAndExecute(approvalHash, NOW), /did not sign/);
    const status = await setup.operator.status(approvalHash, NOW);
    assert.equal(status.status, "failed_released");
    assert.equal(status.failure?.inputLockDisposition, "released");
    assert.equal(status.failure?.broadcastMayHaveOccurred, false);
    assert.equal(status.walletActions.signingPerformed, false);
    assert.equal(status.walletActions.broadcastStatus, "not_performed");
    assert.equal(setup.rpc.lockedCount, 0);
  } finally {
    await fs.rm(setup.directory, { recursive: true, force: true });
  }
});

test("ambiguous submission persists no-retry state until positive reconciliation", async () => {
  const setup = await fixture("submission_unknown");
  try {
    const prepared = await setup.operator.prepare(request, NOW);
    const approvalHash = prepared.exactEffects.approvalHash;
    await assert.rejects(() => setup.operator.approveAndExecute(approvalHash, NOW), /outcome is unknown/);
    const ambiguous = await setup.operator.status(approvalHash, NOW);
    assert.equal(ambiguous.status, "submission_unknown");
    assert.equal(ambiguous.recoveryInstructions[0], "Do not retry.");
    assert.equal(ambiguous.walletActions.signingPerformed, true);
    assert.equal(ambiguous.walletActions.broadcastStatus, "unknown");
    assert.equal(setup.rpc.lockedCount, 1);
    await assert.rejects(() => setup.operator.reconcile(approvalHash, NOW), /not positively observed/);
    assert.equal((await setup.operator.status(approvalHash, NOW)).status, "submission_unknown");

    setup.rpc.observed = true;
    const reconciled = await setup.operator.reconcile(approvalHash, NOW);
    assert.equal(reconciled.status, "mempool");
    assert.equal(reconciled.result?.schema, "bitagent_tradelayer_activation_reconciliation_v1");
  } finally {
    await fs.rm(setup.directory, { recursive: true, force: true });
  }
});

test("write-ahead execution state survives interruption and permits only positive reconciliation", async () => {
  const setup = await fixture();
  try {
    const prepared = await setup.operator.prepare(request, NOW);
    const approvalHash = prepared.exactEffects.approvalHash;
    await setup.store.markExecutionRequested(approvalHash, NOW);
    const resumed = await new FileTradeLayerActivationCandidateStore(setup.storePath, POLICY).getPublic(approvalHash, NOW);
    assert.equal(resumed.status, "execution_requested");
    assert.equal(resumed.walletActions.signingPerformed, null);
    assert.equal(resumed.walletActions.broadcastStatus, "unknown");
    assert.equal(resumed.recoveryInstructions[0], "Do not retry.");
    await assert.rejects(() => setup.operator.approveAndExecute(approvalHash, NOW), /Only a pending/);
    await assert.rejects(() => setup.operator.cancel(approvalHash, NOW), /Only a pending/);
    await assert.rejects(() => setup.operator.reconcile(approvalHash, NOW), /not positively observed/);
    assert.equal((await setup.operator.status(approvalHash, NOW)).status, "execution_requested");
  } finally {
    await fs.rm(setup.directory, { recursive: true, force: true });
  }
});

test("corrupt durable state fails closed and is not returned publicly", async () => {
  const setup = await fixture();
  try {
    const prepared = await setup.operator.prepare(request, NOW);
    const document = JSON.parse(await fs.readFile(setup.storePath, "utf8"));
    document.records[prepared.exactEffects.approvalHash].candidate.rawPsbt = "tampered";
    await fs.writeFile(setup.storePath, JSON.stringify(document), "utf8");
    await assert.rejects(
      () => setup.operator.status(prepared.exactEffects.approvalHash),
      /store integrity check failed/
    );
  } finally {
    await fs.rm(setup.directory, { recursive: true, force: true });
  }
});

test("candidate persistence failure releases the newly reserved input", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-activation-store-failure-"));
  const blocker = path.join(directory, "not-a-directory");
  await fs.writeFile(blocker, "block", "utf8");
  const rpc = new FakeOperatorRpc();
  const operator = new TradeLayerActivationOperator(
    new TradeLayerActivationCandidateBroker(rpc, POLICY),
    new TradeLayerActivationExecutionBroker(rpc, POLICY),
    new FileTradeLayerActivationCandidateStore(path.join(blocker, "store.json"), POLICY)
  );
  try {
    await assert.rejects(() => operator.prepare(request, NOW));
    assert.equal(rpc.lockedCount, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
