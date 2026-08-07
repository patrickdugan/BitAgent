import assert from "node:assert/strict";
import test from "node:test";
import type { BitcoinCoreBrokerRpc } from "../src/broker/types.js";
import {
  createTradeLayerActivationBrokerRequest,
  TradeLayerActivationCandidateBroker
} from "../src/broker/tradelayerActivationCandidateBroker.js";
import {
  isTradeLayerActivationExecutionError,
  TradeLayerActivationExecutionBroker
} from "../src/broker/tradelayerActivationExecutionBroker.js";
import { encodeSegwitAddress } from "../src/launch/bitcoin.js";
import { canonicalHash } from "../src/survival/policy.js";

const NOW = new Date("2026-08-07T13:00:00.000Z");
const SENDER = encodeSegwitAddress(Buffer.alloc(20, 23), "bitcoin-testnet4");
const INPUT_TXID = "31".repeat(32);
const UNSIGNED_TXID = "42".repeat(32);
const POLICY = canonicalHash({ policy: "tx11-activation-execution-fixture" });
const request = createTradeLayerActivationBrokerRequest({
  requestId: "candidate11-activation-execution-fixture",
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

type Scenario = "success" | "signature_rejected" | "final_tamper" | "mempool_rejected" | "submission_unknown";

class FakeExecutionRpc implements BitcoinCoreBrokerRpc {
  private readonly locked = new Map<string, { txid: string; vout: number }>();
  readonly methods: string[] = [];
  observed = false;

  constructor(readonly scenario: Scenario = "success") {}

  get lockedCount(): number {
    return this.locked.size;
  }

  private decoded(payloadHex: string) {
    return {
      fee: 0.00001,
      tx: {
        txid: UNSIGNED_TXID,
        vin: [{ txid: INPUT_TXID, vout: 0 }],
        vout: [
          { value: 0, n: 0, scriptPubKey: { type: "nulldata", asm: `OP_RETURN ${payloadHex}` } },
          { value: 0.00009, n: 1, scriptPubKey: { type: "witness_v0_keyhash", address: SENDER } }
        ]
      },
      inputs: [{ witness_utxo: { amount: 0.0001, scriptPubKey: { address: SENDER } } }]
    };
  }

  async call<T = unknown>(method: string, ...params: unknown[]): Promise<T> {
    this.methods.push(method);
    const payloadHex = request.activation.payloadHex;
    let result: unknown;
    if (method === "getblockchaininfo") {
      result = { chain: "testnet4", blocks: 147355, headers: 147355, initialblockdownload: false };
    } else if (method === "getaddressinfo") {
      result = { ismine: true, iswatchonly: false };
    } else if (method === "listunspent") {
      result = [{ txid: INPUT_TXID, vout: 0, amount: 0.0001, spendable: true, solvable: true, safe: true }];
    } else if (method === "walletcreatefundedpsbt") {
      this.locked.set(`${INPUT_TXID}:0`, { txid: INPUT_TXID, vout: 0 });
      result = { psbt: "private-activation-psbt" };
    } else if (method === "decodepsbt") {
      result = this.decoded(payloadHex);
    } else if (method === "walletprocesspsbt") {
      result = this.scenario === "signature_rejected"
        ? { psbt: "rejected", complete: false }
        : { psbt: "signed-activation-psbt", complete: true };
    } else if (method === "finalizepsbt") {
      result = { hex: "02000000activation", complete: true };
    } else if (method === "decoderawtransaction") {
      result = this.scenario === "final_tamper"
        ? { ...this.decoded("00").tx }
        : this.decoded(payloadHex).tx;
    } else if (method === "testmempoolaccept") {
      result = this.scenario === "mempool_rejected"
        ? [{ allowed: false, reject_reason: "fixture" }]
        : [{ allowed: true, txid: UNSIGNED_TXID, fees: { base: 0.00001 } }];
    } else if (method === "sendrawtransaction") {
      if (this.scenario === "submission_unknown") throw new Error("connection dropped");
      this.locked.delete(`${INPUT_TXID}:0`);
      this.observed = true;
      result = UNSIGNED_TXID;
    } else if (method === "lockunspent") {
      const inputs = params[1] as Array<{ txid: string; vout: number }>;
      for (const input of inputs) this.locked.delete(`${input.txid}:${input.vout}`);
      result = true;
    } else if (method === "listlockunspent") {
      result = [...this.locked.values()];
    } else if (method === "getrawtransaction") {
      if (!this.observed) throw new Error("not found");
      result = { txid: UNSIGNED_TXID, confirmations: 0 };
    } else {
      throw new Error(`Unexpected activation execution RPC ${method}`);
    }
    return result as T;
  }
}

async function prepared(rpc: FakeExecutionRpc) {
  return new TradeLayerActivationCandidateBroker(rpc, POLICY).prepareForWalletExecution(request, NOW);
}

test("executes only the exact approved private candidate through mempool admission", async () => {
  const rpc = new FakeExecutionRpc();
  const candidate = await prepared(rpc);
  assert.equal("rawPsbt" in candidate.publicCandidate, false);
  const receipt = await new TradeLayerActivationExecutionBroker(rpc, POLICY).execute({
    candidate,
    approvalHash: candidate.publicCandidate.approvalHash,
    now: NOW
  });
  assert.equal(receipt.txid, UNSIGNED_TXID);
  assert.equal(receipt.mempoolAccepted, true);
  assert.equal(receipt.signingPerformed, true);
  assert.equal(receipt.broadcastPerformed, true);
  assert.equal("rawPsbt" in receipt, false);
  assert.ok(rpc.methods.indexOf("testmempoolaccept") < rpc.methods.indexOf("sendrawtransaction"));
  assert.equal(rpc.lockedCount, 0);
});

test("wrong approval hash cannot reach signing and preserves the candidate for a valid decision", async () => {
  const rpc = new FakeExecutionRpc();
  const candidate = await prepared(rpc);
  await assert.rejects(
    () => new TradeLayerActivationExecutionBroker(rpc, POLICY).execute({ candidate, approvalHash: "00".repeat(32), now: NOW }),
    /approval hash/
  );
  assert.equal(rpc.methods.includes("walletprocesspsbt"), false);
  assert.equal(rpc.lockedCount, 1);
  await new TradeLayerActivationCandidateBroker(rpc, POLICY).cancelPrepared(candidate.publicCandidate, NOW);
});

for (const fixture of [
  ["rejected signature", "signature_rejected", "signature_rejected"] as const,
  ["signed transaction mutation", "final_tamper", "execution_validation_failed"] as const,
  ["mempool rejection", "mempool_rejected", "mempool_rejected"] as const
]) {
  test(`${fixture[0]} releases the exact input before any broadcast`, async () => {
    const rpc = new FakeExecutionRpc(fixture[1]);
    const candidate = await prepared(rpc);
    await assert.rejects(
      () => new TradeLayerActivationExecutionBroker(rpc, POLICY).execute({
        candidate,
        approvalHash: candidate.publicCandidate.approvalHash,
        now: NOW
      }),
        (error: unknown) => isTradeLayerActivationExecutionError(error)
          && error.code === fixture[2]
          && error.broadcastMayHaveOccurred === false
          && error.inputLockDisposition === "released"
    );
    assert.equal(rpc.methods.includes("sendrawtransaction"), false);
    assert.equal(rpc.lockedCount, 0);
  });
}

test("ambiguous submission retains the input and requires positive reconciliation", async () => {
  const rpc = new FakeExecutionRpc("submission_unknown");
  const candidate = await prepared(rpc);
  const broker = new TradeLayerActivationExecutionBroker(rpc, POLICY);
  await assert.rejects(
    () => broker.execute({
      candidate,
      approvalHash: candidate.publicCandidate.approvalHash,
      now: NOW
    }),
      (error: unknown) => isTradeLayerActivationExecutionError(error)
        && error.code === "submission_unknown"
        && error.broadcastMayHaveOccurred === true
        && error.inputLockDisposition === "retained"
  );
  assert.equal(rpc.lockedCount, 1);
  await assert.rejects(
    () => broker.reconcile(candidate.publicCandidate, NOW),
    (error: unknown) => isTradeLayerActivationExecutionError(error)
      && error.code === "submission_unknown"
  );
  assert.equal(rpc.lockedCount, 1);

  rpc.observed = true;
  const receipt = await broker.reconcile(candidate.publicCandidate, NOW);
  assert.equal(receipt.positiveObservation, true);
  assert.equal(receipt.status, "mempool");
  assert.equal(receipt.retryAuthorized, false);
});

test("a tampered private PSBT envelope fails before signing", async () => {
  const rpc = new FakeExecutionRpc();
  const candidate = await prepared(rpc);
  candidate.rawPsbt = "substituted-psbt";
  await assert.rejects(
    () => new TradeLayerActivationExecutionBroker(rpc, POLICY).execute({
      candidate,
      approvalHash: candidate.publicCandidate.approvalHash,
      now: NOW
    }),
    /envelope fingerprint mismatch/
  );
  assert.equal(rpc.methods.includes("walletprocesspsbt"), false);
  assert.equal(rpc.lockedCount, 1);
});
