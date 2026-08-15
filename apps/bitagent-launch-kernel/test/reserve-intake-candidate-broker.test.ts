import assert from "node:assert/strict";
import test from "node:test";
import type { BitcoinCoreBrokerRpc } from "../src/broker/types.js";
import {
  createReserveIntakeBrokerRequest,
  ReserveIntakeCandidateBroker
} from "../src/broker/reserveIntakeCandidateBroker.js";
import { encodeSegwitAddress } from "../src/launch/bitcoin.js";
import { buildReserveIntakePlan } from "../src/launch/reserveIntake.js";
import { canonicalHash } from "../src/survival/policy.js";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const SENDER = encodeSegwitAddress(Buffer.alloc(20, 21), "bitcoin-testnet4");
const INPUT_TXID = "31".repeat(32);
const OPERATOR = "04d7f4188a5cbc5335aee6600ad8e327730d73de961534e23b4b91b7d64b6ae4";
const GUARDIAN = "d1517d4cbf81891b1c360554cb5352f1d9e307cfb08d493125450147ad01260c";
const POLICY = canonicalHash({ policy: "reserve-intake-candidate-fixture" });

const plan = buildReserveIntakePlan({
  workflowId: "reserve-intake-fixture",
  walletSessionId: "wallet-session-reserve-fixture",
  walletAddress: SENDER,
  amountSats: "100000",
  operatorXonly: OPERATOR,
  guardianXonly: GUARDIAN,
  propertyId: 1,
  dlcTemplateId: "starter-utxoref-v1",
  dlcContractId: "starter-utxoref-contract-001",
  settlementState: "FUNDED",
  dlcHash: "ab".repeat(32)
});

const request = createReserveIntakeBrokerRequest({
  requestId: "reserve-intake-fixture",
  wallet: "fixture-wallet",
  senderAddress: SENDER,
  policyFingerprint: POLICY,
  maxFeeSats: "2000",
  expiresAt: "2026-08-06T12:15:00.000Z",
  plan
});

type Mutation = "valid" | "swap_outputs" | "wrong_reserve" | "high_fee";

class FakeReserveRpc implements BitcoinCoreBrokerRpc {
  private readonly locked = new Map<string, { txid: string; vout: number }>();
  readonly methods: string[] = [];

  constructor(private readonly mutation: Mutation = "valid") {}

  get lockedCount(): number {
    return this.locked.size;
  }

  async call<T = unknown>(method: string, ...params: unknown[]): Promise<T> {
    this.methods.push(method);
    let result: unknown;
    if (method === "getblockchaininfo") result = { chain: "testnet4" };
    else if (method === "getaddressinfo") result = { ismine: true, iswatchonly: false };
    else if (method === "listunspent") {
      result = [{
        txid: INPUT_TXID,
        vout: 0,
        amount: 0.00302443,
        spendable: true,
        solvable: true,
        safe: true
      }];
    } else if (method === "walletcreatefundedpsbt") {
      const inputs = params[0] as Array<{ txid: string; vout: number }>;
      for (const input of inputs) this.locked.set(`${input.txid}:${input.vout}`, input);
      result = { psbt: "unsigned-reserve-psbt" };
    } else if (method === "decodepsbt") {
      const reserve = {
        value: this.mutation === "wrong_reserve" ? 0.00099999 : 0.001,
        n: 0,
        scriptPubKey: {
          type: "witness_v1_taproot",
          hex: plan.reserve.scriptPubKeyHex,
          address: plan.reserve.address
        }
      };
      const data = {
        value: 0,
        n: 1,
        scriptPubKey: {
          type: "nulldata",
          asm: `OP_RETURN ${plan.tradeLayer.payloadHex}`
        }
      };
      const change = {
        value: 0.00201443,
        n: 2,
        scriptPubKey: {
          type: "witness_v0_keyhash",
          hex: `0014${Buffer.alloc(20, 21).toString("hex")}`,
          address: SENDER
        }
      };
      result = {
        fee: this.mutation === "high_fee" ? 0.00003 : 0.00001,
        tx: {
          txid: canonicalHash("reserve-unsigned-tx"),
          vin: [{ txid: INPUT_TXID, vout: 0 }],
          vout: this.mutation === "swap_outputs" ? [data, reserve, change] : [reserve, data, change]
        },
        inputs: [{
          witness_utxo: {
            amount: 0.00302443,
            scriptPubKey: { address: SENDER }
          }
        }]
      };
    } else if (method === "lockunspent") {
      const unlock = params[0] as boolean;
      const inputs = params[1] as Array<{ txid: string; vout: number }>;
      if (!unlock) throw new Error("Fixture only supports releasing locks");
      for (const input of inputs) this.locked.delete(`${input.txid}:${input.vout}`);
      result = true;
    } else if (method === "listlockunspent") result = [...this.locked.values()];
    else throw new Error(`Candidate-only broker called forbidden or unexpected RPC ${method}`);
    return result as T;
  }
}

test("prepares exact reserve-vout0, tx11-vout1, change-vout2 candidate without exposing the PSBT", async () => {
  const rpc = new FakeReserveRpc();
  const broker = new ReserveIntakeCandidateBroker(rpc, POLICY);
  const candidate = await broker.prepare(request, NOW);

  assert.equal(candidate.reserveOutput.vout, 0);
  assert.equal(candidate.reserveOutput.valueSats, "100000");
  assert.equal(candidate.dataOutput.vout, 1);
  assert.equal(candidate.dataOutput.payloadBytes, plan.tradeLayer.payloadBytes);
  assert.equal(candidate.changeOutput.vout, 2);
  assert.equal(candidate.feeSats, "1000");
  assert.equal("psbt" in candidate, false);
  assert.equal(rpc.methods.includes("walletprocesspsbt"), false);
  assert.equal(rpc.methods.includes("sendrawtransaction"), false);
  assert.equal(rpc.lockedCount, 1);

  const cancellation = await broker.cancelPrepared(candidate, new Date("2026-08-06T12:20:00.000Z"));
  assert.equal(cancellation.inputLockReleased, true);
  assert.equal(cancellation.signingPerformed, false);
  assert.equal(cancellation.broadcastPerformed, false);
  assert.equal(rpc.lockedCount, 0);
});

for (const fixture of [
  ["swapped output order", "swap_outputs", /vout 0/] as const,
  ["wrong reserve amount", "wrong_reserve", /vout 0/] as const,
  ["fee above cap", "high_fee", /fee cap/] as const
]) {
  test(`rejects ${fixture[0]} and releases the selected input`, async () => {
    const rpc = new FakeReserveRpc(fixture[1]);
    await assert.rejects(
      () => new ReserveIntakeCandidateBroker(rpc, POLICY).prepare(request, NOW),
      fixture[2]
    );
    assert.equal(rpc.lockedCount, 0);
    assert.equal(rpc.methods.includes("walletprocesspsbt"), false);
    assert.equal(rpc.methods.includes("sendrawtransaction"), false);
  });
}

test("tampered cancellation is refused until the intact candidate releases the lock", async () => {
  const rpc = new FakeReserveRpc();
  const broker = new ReserveIntakeCandidateBroker(rpc, POLICY);
  const candidate = await broker.prepare(request, NOW);
  const tampered = structuredClone(candidate);
  tampered.reserveOutput.valueSats = "100001";

  await assert.rejects(() => broker.cancelPrepared(tampered, NOW), /approval fingerprint mismatch/);
  assert.equal(rpc.lockedCount, 1);
  await broker.cancelPrepared(candidate, NOW);
  assert.equal(rpc.lockedCount, 0);
});
