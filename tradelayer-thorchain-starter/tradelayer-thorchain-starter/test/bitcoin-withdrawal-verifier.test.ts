import test from "node:test";
import assert from "node:assert/strict";
import { validateBitcoinAddress, encodeSegwitAddress } from "../src/launch/bitcoin.js";
import {
  observeBitcoinWithdrawal,
  verifyBitcoinWithdrawalVerification,
  type BitcoinWithdrawalExpectation
} from "../src/settlement/bitcoinWithdrawalVerifier.js";
import type {
  BitcoinWithdrawalObservation,
  BitcoinWithdrawalReadSource
} from "../src/settlement/types.js";

const TXID = "ab".repeat(32);
const destination = encodeSegwitAddress(Buffer.alloc(20, 17), "bitcoin-testnet4");
const destinationScript = validateBitcoinAddress(destination, "bitcoin-testnet4").scriptPubKeyHex;

const expected: BitcoinWithdrawalExpectation = {
  txid: TXID,
  network: "bitcoin-testnet4",
  destinationScriptPubKeyHex: destinationScript,
  amountSats: "50000",
  feeSats: "600",
  walletNetDebitSats: "50600"
};

class WithdrawalSource implements BitcoinWithdrawalReadSource {
  readonly source = "bitcoin-withdrawal-fixture";
  readonly network = "bitcoin-testnet4" as const;
  observation: BitcoinWithdrawalObservation = {
    txid: TXID,
    network: "bitcoin-testnet4",
    state: "confirmed",
    confirmations: 2,
    blockHash: "cd".repeat(32),
    outputs: [
      { vout: 0, valueSats: "50000", scriptPubKeyHex: destinationScript, address: destination },
      { vout: 1, valueSats: "100000", scriptPubKeyHex: "0014" + "22".repeat(20) }
    ],
    feeSats: "600",
    walletNetDebitSats: "50600",
    observedAt: "2026-08-06T08:00:00.000Z",
    source: "bitcoin-withdrawal-fixture"
  };

  async observeWithdrawal(_txid: string) {
    return structuredClone(this.observation);
  }
}

test("exact confirmed withdrawal is independently verified", async () => {
  const result = await observeBitcoinWithdrawal({
    source: new WithdrawalSource(),
    expected,
    now: new Date("2026-08-06T08:01:00.000Z")
  });
  assert.equal(result.status, "verified");
  assert.equal(result.destinationVout, 0);
  assert.equal(result.exactDestinationMatched, true);
  assert.equal(result.exactFeeMatched, true);
  assert.equal(result.exactWalletDebitMatched, true);
  assert.equal(verifyBitcoinWithdrawalVerification(result), true);
});

test("exact mempool withdrawal remains pending until confirmation", async () => {
  const source = new WithdrawalSource();
  source.observation.state = "mempool";
  source.observation.confirmations = 0;
  const result = await observeBitcoinWithdrawal({ source, expected, minimumConfirmations: 1 });
  assert.equal(result.status, "pending");
  assert.equal(result.exactTransactionMatched, true);
});

test("confirmed withdrawal remains pending below the configured depth", async () => {
  const source = new WithdrawalSource();
  source.observation.confirmations = 1;
  const result = await observeBitcoinWithdrawal({ source, expected, minimumConfirmations: 2 });
  assert.equal(result.status, "pending");
  assert.equal(result.confirmations, 1);
});

test("missing withdrawal remains retryable", async () => {
  const source = new WithdrawalSource();
  source.observation.state = "missing";
  source.observation.confirmations = 0;
  source.observation.outputs = [];
  const result = await observeBitcoinWithdrawal({ source, expected });
  assert.equal(result.status, "pending");
  assert.match(result.reason, /not observable/i);
});

for (const [label, mutate, field] of [
  ["destination", (value: BitcoinWithdrawalObservation) => { value.outputs[0]!.valueSats = "49999"; }, "exactDestinationMatched"],
  ["fee", (value: BitcoinWithdrawalObservation) => { value.feeSats = "601"; }, "exactFeeMatched"],
  ["wallet debit", (value: BitcoinWithdrawalObservation) => { value.walletNetDebitSats = "50601"; }, "exactWalletDebitMatched"]
] as const) {
  test(`mismatched ${label} fails closed`, async () => {
    const source = new WithdrawalSource();
    mutate(source.observation);
    const result = await observeBitcoinWithdrawal({ source, expected });
    assert.equal(result.status, "failed");
    assert.equal(result[field], false);
  });
}

test("reorganized withdrawal fails closed", async () => {
  const source = new WithdrawalSource();
  source.observation.state = "reorged";
  source.observation.confirmations = -1;
  const result = await observeBitcoinWithdrawal({ source, expected });
  assert.equal(result.status, "failed");
  assert.match(result.reason, /reorganization/i);
});

test("duplicate output indexes invalidate transaction evidence", async () => {
  const source = new WithdrawalSource();
  source.observation.outputs[1]!.vout = 0;
  const result = await observeBitcoinWithdrawal({ source, expected });
  assert.equal(result.status, "failed");
  assert.equal(result.exactTransactionMatched, false);
});

test("withdrawal evidence hash detects tampering", async () => {
  const result = await observeBitcoinWithdrawal({ source: new WithdrawalSource(), expected });
  result.confirmations = 99;
  assert.equal(verifyBitcoinWithdrawalVerification(result), false);
});

test("expectation cannot hide an extra wallet debit", async () => {
  await assert.rejects(
    observeBitcoinWithdrawal({
      source: new WithdrawalSource(),
      expected: { ...expected, walletNetDebitSats: "50700" }
    }),
    /bind amount plus fee/i
  );
});
