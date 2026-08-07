import assert from "node:assert/strict";
import test from "node:test";
import type { BitcoinCoreBrokerRpc } from "../src/broker/types.js";
import {
  buildTradeLayerTx11ActivationPayload,
  createTradeLayerActivationBrokerRequest,
  TradeLayerActivationCandidateBroker
} from "../src/broker/tradelayerActivationCandidateBroker.js";
import { encodeSegwitAddress } from "../src/launch/bitcoin.js";
import { canonicalHash } from "../src/survival/policy.js";

const NOW = new Date("2026-08-07T12:00:00.000Z");
const SENDER = encodeSegwitAddress(Buffer.alloc(20, 17), "bitcoin-testnet4");
const INPUT_TXID = "31".repeat(32);
const UNSIGNED_TXID = "42".repeat(32);
const CODE_HASH = "c72b3ce9101743c59c05ee3b115100ec229055e21f9e17851ff694002b2d9e29";
const POLICY = canonicalHash({ policy: "tx11-activation-candidate-fixture" });
const PAYLOAD = buildTradeLayerTx11ActivationPayload(CODE_HASH);

const request = createTradeLayerActivationBrokerRequest({
  requestId: "candidate10-activation-fixture",
  wallet: "fixture-wallet",
  senderAddress: SENDER,
  releaseId: "tx11-utxoref-dynamic-contract-candidate-10",
  deploymentCommit: "fad7f4bb3955559a05ea9b0c82eb7ea34e46aafd",
  codeHash: CODE_HASH,
  sourceVerificationHash: "90".repeat(32),
  policyFingerprint: POLICY,
  maxFeeSats: "2000",
  expiresAt: "2026-08-07T12:15:00.000Z"
});

type Mutation = "valid" | "wrong_payload" | "swap_outputs" | "foreign_change" | "high_fee";

class FakeActivationRpc implements BitcoinCoreBrokerRpc {
  private readonly locked = new Map<string, { txid: string; vout: number }>();
  readonly methods: string[] = [];

  constructor(private readonly mutation: Mutation = "valid") {}

  get lockedCount(): number {
    return this.locked.size;
  }

  async call<T = unknown>(method: string, ...params: unknown[]): Promise<T> {
    this.methods.push(method);
    let result: unknown;
    if (method === "getblockchaininfo") {
      result = { chain: "testnet4", blocks: 147354, headers: 147354, initialblockdownload: false };
    } else if (method === "getaddressinfo") {
      const address = String(params[0]);
      result = { ismine: this.mutation !== "foreign_change" || address === SENDER, iswatchonly: false };
    } else if (method === "listunspent") {
      result = [{ txid: INPUT_TXID, vout: 0, amount: 0.0001, spendable: true, solvable: true, safe: true }];
    } else if (method === "walletcreatefundedpsbt") {
      const inputs = params[0] as Array<{ txid: string; vout: number }>;
      for (const input of inputs) this.locked.set(`${input.txid}:${input.vout}`, input);
      result = { psbt: "private-activation-psbt" };
    } else if (method === "decodepsbt") {
      const data = {
        value: 0,
        n: 0,
        scriptPubKey: {
          type: "nulldata",
          asm: `OP_RETURN ${this.mutation === "wrong_payload" ? "00" : PAYLOAD.payloadHex}`
        }
      };
      const change = {
        value: 0.00009,
        n: 1,
        scriptPubKey: {
          type: "witness_v0_keyhash",
          address: this.mutation === "foreign_change" ? "tb1qforeign" : SENDER
        }
      };
      result = {
        fee: this.mutation === "high_fee" ? 0.00003 : 0.00001,
        tx: {
          txid: UNSIGNED_TXID,
          vin: [{ txid: INPUT_TXID, vout: 0 }],
          vout: this.mutation === "swap_outputs" ? [change, data] : [data, change]
        },
        inputs: [{ witness_utxo: { amount: 0.0001, scriptPubKey: { address: SENDER } } }]
      };
    } else if (method === "lockunspent") {
      const inputs = params[1] as Array<{ txid: string; vout: number }>;
      for (const input of inputs) this.locked.delete(`${input.txid}:${input.vout}`);
      result = true;
    } else if (method === "listlockunspent") {
      result = [...this.locked.values()];
    } else {
      throw new Error(`Candidate-only activation broker called forbidden or unexpected RPC ${method}`);
    }
    return result as T;
  }
}

test("builds the exact candidate10 tx0 wire payload for activating tx11", () => {
  assert.equal(PAYLOAD.payloadUtf8, "tl011,4ypfnlsyfm5zcuiw52ts92ccg3p388tdfwjya7w5d0frwpb6eh");
  assert.equal(PAYLOAD.payloadHex, "746c3031312c347970666e6c7379666d357a637569773532747339326363673370333838746466776a796137773564306672777062366568");
  assert.equal(PAYLOAD.payloadBytes, 56);
  assert.deepEqual(PAYLOAD.activatedTxTypes, [11]);
});

test("prepares an exact candidate-only activation and cancels without signing", async () => {
  const rpc = new FakeActivationRpc();
  const broker = new TradeLayerActivationCandidateBroker(rpc, POLICY);
  const candidate = await broker.prepare(request, NOW);

  assert.equal(candidate.authority, "wallet_user");
  assert.equal(candidate.effect, "none_candidate_only");
  assert.equal(candidate.dataOutput.vout, 0);
  assert.equal(candidate.dataOutput.payloadHex, PAYLOAD.payloadHex);
  assert.equal(candidate.changeOutput.vout, 1);
  assert.equal(candidate.changeOutput.address, SENDER);
  assert.equal(candidate.feeSats, "1000");
  assert.equal("psbt" in candidate, false);
  assert.equal(candidate.signingPerformed, false);
  assert.equal(candidate.broadcastPerformed, false);
  assert.equal(rpc.methods.includes("walletprocesspsbt"), false);
  assert.equal(rpc.methods.includes("sendrawtransaction"), false);
  assert.equal(rpc.lockedCount, 1);

  const receipt = await broker.cancelPrepared(candidate, new Date("2026-08-07T12:20:00.000Z"));
  assert.equal(receipt.inputLockReleased, true);
  assert.equal(receipt.signingPerformed, false);
  assert.equal(receipt.broadcastPerformed, false);
  assert.equal(rpc.lockedCount, 0);
});

for (const fixture of [
  ["wrong activation payload", "wrong_payload", /vout 0/] as const,
  ["swapped output order", "swap_outputs", /vout 0/] as const,
  ["foreign change", "foreign_change", /vout 1/] as const,
  ["fee above cap", "high_fee", /fee cap/] as const
]) {
  test(`rejects ${fixture[0]} and releases the selected input`, async () => {
    const rpc = new FakeActivationRpc(fixture[1]);
    await assert.rejects(
      () => new TradeLayerActivationCandidateBroker(rpc, POLICY).prepare(request, NOW),
      fixture[2]
    );
    assert.equal(rpc.lockedCount, 0);
    assert.equal(rpc.methods.includes("walletprocesspsbt"), false);
    assert.equal(rpc.methods.includes("sendrawtransaction"), false);
  });
}

test("fails before wallet calls on stale requests, payload tampering, or unsynchronized nodes", async () => {
  const stale = structuredClone(request);
  await assert.rejects(
    () => new TradeLayerActivationCandidateBroker(new FakeActivationRpc(), POLICY).prepare(stale, new Date("2026-08-07T12:16:00.000Z")),
    /expired/
  );

  const tampered = structuredClone(request);
  tampered.activation.payloadHex = "00";
  await assert.rejects(
    () => new TradeLayerActivationCandidateBroker(new FakeActivationRpc(), POLICY).prepare(tampered, NOW),
    /fingerprint mismatch/
  );

  class SyncingRpc extends FakeActivationRpc {
    override async call<T = unknown>(method: string, ...params: unknown[]): Promise<T> {
      if (method === "getblockchaininfo") {
        this.methods.push(method);
        return { chain: "testnet4", blocks: 108000, headers: 147354, initialblockdownload: true } as T;
      }
      return super.call<T>(method, ...params);
    }
  }
  const syncing = new SyncingRpc();
  await assert.rejects(
    () => new TradeLayerActivationCandidateBroker(syncing, POLICY).prepare(request, NOW),
    /fully synchronized/
  );
  assert.deepEqual(syncing.methods, ["getblockchaininfo"]);
});

test("tampered cancellation cannot release an input under a different approval hash", async () => {
  const rpc = new FakeActivationRpc();
  const broker = new TradeLayerActivationCandidateBroker(rpc, POLICY);
  const candidate = await broker.prepare(request, NOW);
  const tampered = structuredClone(candidate);
  tampered.feeSats = "1001";

  await assert.rejects(() => broker.cancelPrepared(tampered, NOW), /approval fingerprint mismatch/);
  assert.equal(rpc.lockedCount, 1);
  await broker.cancelPrepared(candidate, NOW);
  assert.equal(rpc.lockedCount, 0);
});
