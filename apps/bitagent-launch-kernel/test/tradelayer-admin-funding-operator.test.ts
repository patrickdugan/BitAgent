import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createTradeLayerAdminFundingRequest,
  FileTradeLayerAdminFundingStore,
  TradeLayerAdminFundingCandidateBroker,
  TradeLayerAdminFundingExecutionBroker,
  TradeLayerAdminFundingOperator
} from "../src/broker/tradelayerAdminFundingOperator.js";
import { TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS } from "../src/broker/tradelayerActivationCandidateBroker.js";
import type { BitcoinCoreBrokerRpc } from "../src/broker/types.js";
import { canonicalHash } from "../src/survival/policy.js";

const NOW = new Date("2026-08-08T18:00:00.000Z");
const SOURCE_TXID = "31".repeat(32);
const UNSIGNED_TXID = "42".repeat(32);
const SOURCE_ADDRESS = "tb1pma0a7clpqfdwpy4aq80ejrxk3dtumgzqkrm5hatpmgl0qn9aqh5ss2puu0";
const POLICY = canonicalHash({ policy: "admin-funding-fixture" });
const request = createTradeLayerAdminFundingRequest({
  requestId: "admin-funding-fixture",
  wallet: "fixture-wallet",
  source: { txid: SOURCE_TXID, vout: 1, address: SOURCE_ADDRESS, valueSats: "302085" },
  feeRateSatVb: 2,
  maxFeeSats: "1000",
  expiresAt: "2026-08-08T18:15:00.000Z",
  policyFingerprint: POLICY
});

type Scenario = "success" | "signature_rejected";

class FakeFundingRpc implements BitcoinCoreBrokerRpc {
  readonly methods: string[] = [];
  locked = false;
  observed = false;

  constructor(private readonly scenario: Scenario = "success") {}

  private psbt() {
    return {
      fee: 0.000003,
      tx: {
        txid: UNSIGNED_TXID,
        vin: [{ txid: SOURCE_TXID, vout: 1 }],
        vout: [{
          n: 0,
          value: 0.00301785,
          scriptPubKey: { address: TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS }
        }]
      },
      inputs: [{
        witness_utxo: { amount: 0.00302085, scriptPubKey: { address: SOURCE_ADDRESS } }
      }]
    };
  }

  async call<T = unknown>(method: string, ...params: unknown[]): Promise<T> {
    this.methods.push(method);
    let result: unknown;
    if (method === "getblockchaininfo") {
      result = { chain: "testnet4", blocks: 147561, headers: 147561, initialblockdownload: false };
    } else if (method === "getaddressinfo") {
      result = { ismine: true, iswatchonly: false };
    } else if (method === "listunspent") {
      result = [{
        txid: SOURCE_TXID,
        vout: 1,
        address: SOURCE_ADDRESS,
        amount: 0.00302085,
        confirmations: 25,
        spendable: true,
        solvable: true,
        safe: true
      }];
    } else if (method === "walletcreatefundedpsbt") {
      this.locked = true;
      result = { psbt: "private-admin-funding-psbt" };
    } else if (method === "decodepsbt") {
      result = this.psbt();
    } else if (method === "walletprocesspsbt") {
      result = this.scenario === "signature_rejected"
        ? { psbt: "rejected", complete: false }
        : { psbt: "signed-admin-funding-psbt", complete: true };
    } else if (method === "finalizepsbt") {
      result = { hex: "02000000adminfunding", complete: true };
    } else if (method === "decoderawtransaction") {
      result = this.psbt().tx;
    } else if (method === "testmempoolaccept") {
      result = [{ allowed: true, txid: UNSIGNED_TXID, fees: { base: 0.000003 } }];
    } else if (method === "sendrawtransaction") {
      this.locked = false;
      this.observed = true;
      result = UNSIGNED_TXID;
    } else if (method === "lockunspent") {
      this.locked = false;
      result = true;
    } else if (method === "listlockunspent") {
      result = this.locked ? [{ txid: SOURCE_TXID, vout: 1 }] : [];
    } else if (method === "getrawtransaction") {
      if (!this.observed) throw new Error("not found");
      result = { txid: UNSIGNED_TXID, confirmations: 0 };
    } else {
      throw new Error(`Unexpected admin funding RPC ${method} ${JSON.stringify(params)}`);
    }
    return result as T;
  }
}

async function fixture(scenario: Scenario = "success") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-admin-funding-"));
  const storePath = path.join(directory, "private-candidates.json");
  const rpc = new FakeFundingRpc(scenario);
  const store = new FileTradeLayerAdminFundingStore(storePath, POLICY);
  const operator = new TradeLayerAdminFundingOperator(
    new TradeLayerAdminFundingCandidateBroker(rpc, POLICY),
    new TradeLayerAdminFundingExecutionBroker(rpc, POLICY),
    store
  );
  return { directory, storePath, rpc, store, operator };
}

test("admin funding prepare exposes exact effects but keeps the PSBT private", async () => {
  const setup = await fixture();
  try {
    const prepared = await setup.operator.prepare(request, NOW);
    assert.equal(prepared.status, "pending_approval");
    assert.equal(prepared.exactEffects.input.valueSats, "302085");
    assert.equal(prepared.exactEffects.destinationOutput.valueSats, "301785");
    assert.equal(prepared.exactEffects.destinationOutput.address, TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS);
    assert.equal(prepared.exactEffects.feeSats, "300");
    assert.equal(JSON.stringify(prepared).includes("private-admin-funding-psbt"), false);
    assert.equal((await fs.readFile(setup.storePath, "utf8")).includes("private-admin-funding-psbt"), true);
    const cancelled = await setup.operator.cancel(prepared.exactEffects.approvalHash, NOW);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(setup.rpc.locked, false);
  } finally {
    await fs.rm(setup.directory, { recursive: true, force: true });
  }
});

test("exact admin funding approval signs and broadcasts only the reviewed transaction", async () => {
  const setup = await fixture();
  try {
    const prepared = await setup.operator.prepare(request, NOW);
    const submitted = await setup.operator.approveAndExecute(prepared.exactEffects.approvalHash, NOW);
    assert.equal(submitted.status, "submitted");
    assert.equal(submitted.result?.txid, UNSIGNED_TXID);
    assert.equal(submitted.walletActions.signingPerformed, true);
    assert.equal(submitted.walletActions.broadcastStatus, "submitted");
    assert.equal(setup.rpc.methods.includes("testmempoolaccept"), true);
    assert.equal(JSON.stringify(submitted).includes("signed-admin-funding-psbt"), false);
    await assert.rejects(() => setup.operator.approveAndExecute(prepared.exactEffects.approvalHash, NOW), /Only a current pending/);
  } finally {
    await fs.rm(setup.directory, { recursive: true, force: true });
  }
});

test("rejected admin funding signature releases the input without broadcast", async () => {
  const setup = await fixture("signature_rejected");
  try {
    const prepared = await setup.operator.prepare(request, NOW);
    await assert.rejects(
      () => setup.operator.approveAndExecute(prepared.exactEffects.approvalHash, NOW),
      /did not sign/
    );
    const failed = await setup.operator.status(prepared.exactEffects.approvalHash, NOW);
    assert.equal(failed.status, "failed_released");
    assert.equal(failed.failure?.inputLockDisposition, "released");
    assert.equal(failed.failure?.signingPerformed, false);
    assert.equal(failed.walletActions.signingPerformed, false);
    assert.equal(failed.walletActions.broadcastStatus, "not_performed");
    assert.equal(setup.rpc.methods.includes("sendrawtransaction"), false);
    assert.equal(setup.rpc.locked, false);
  } finally {
    await fs.rm(setup.directory, { recursive: true, force: true });
  }
});

test("admin funding request rejects use of the admin address as its source", () => {
  const invalid = createTradeLayerAdminFundingRequest({
    requestId: "invalid-admin-source",
    wallet: "fixture-wallet",
    source: {
      txid: SOURCE_TXID,
      vout: 1,
      address: TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS,
      valueSats: "302085"
    },
    feeRateSatVb: 2,
    maxFeeSats: "1000",
    expiresAt: "2026-08-08T18:15:00.000Z",
    policyFingerprint: POLICY
  });
  const rpc = new FakeFundingRpc();
  assert.rejects(
    () => new TradeLayerAdminFundingCandidateBroker(rpc, POLICY).preparePrivate(invalid, NOW),
    /invalid or expired/
  );
});
