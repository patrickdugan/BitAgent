import assert from "node:assert/strict";
import test from "node:test";
import { inspectTestnet4Wallet } from "../src/broker/testnet4WalletSnapshot.js";
import type { BitcoinCoreBrokerRpc } from "../src/broker/types.js";

const admin = "tb1qpg5jvhd32vut07pvxg92dka7pttudjy570auuu";

test("testnet4 wallet snapshot uses only read-only RPC and exposes aggregates", async () => {
  const calls: string[] = [];
  const rpc: BitcoinCoreBrokerRpc = {
    async call<T>(method: string): Promise<T> {
      calls.push(method);
      const values: Record<string, unknown> = {
        getblockchaininfo: {
          chain: "testnet4",
          blocks: 148000,
          headers: 148000,
          initialblockdownload: false,
          verificationprogress: 1,
        },
        getwalletinfo: {
          private_keys_enabled: true,
          descriptors: true,
          txcount: 4,
        },
        getbalances: {
          mine: { trusted: 0.003, untrusted_pending: 0.00002085 },
        },
        getaddressinfo: { ismine: true, iswatchonly: false, solvable: true },
        listlockunspent: [{ txid: "a".repeat(64), vout: 1 }],
        listunspent: [
          { address: admin, amount: 0.001, spendable: true, safe: true },
          { address: "non-admin", amount: 0.002, spendable: true, safe: true },
          { address: "unsafe", amount: 1, spendable: true, safe: false },
        ],
      };
      return values[method] as T;
    },
  };

  const snapshot = await inspectTestnet4Wallet({
    rpc,
    wallet: "utxoref-testnet",
    protocolAdminAddress: admin,
    trackedOutpoint: { txid: "a".repeat(64), vout: 1 },
  });

  assert.deepEqual(calls.sort(), [
    "getaddressinfo",
    "getbalances",
    "getblockchaininfo",
    "getwalletinfo",
    "listlockunspent",
    "listunspent",
  ]);
  assert.equal(snapshot.authority, "read_only_observer");
  assert.match(snapshot.observedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(snapshot.effect, "none");
  assert.equal(snapshot.locks.trackedOutpointLocked, true);
  assert.equal(snapshot.wallet.confirmedBalanceSats, "300000");
  assert.equal(snapshot.wallet.unconfirmedBalanceSats, "2085");
  assert.equal(snapshot.available.adminSats, "100000");
  assert.equal(snapshot.available.nonAdminSats, "200000");
  assert.equal(snapshot.signingPerformed, false);
  assert.equal(snapshot.broadcastPerformed, false);
  const encoded = JSON.stringify(snapshot);
  assert.ok(!encoded.includes("non-admin"));
  assert.ok(!encoded.includes("rawPsbt"));
});
