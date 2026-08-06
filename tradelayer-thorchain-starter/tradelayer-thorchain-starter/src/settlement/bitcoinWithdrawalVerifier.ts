import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";
import type { BitcoinWithdrawalReadSource } from "./types.js";

const TXID_PATTERN = /^[a-f0-9]{64}$/;
const SCRIPT_PATTERN = /^(?:[a-f0-9]{2})+$/;

export type BitcoinWithdrawalExpectation = {
  txid: string;
  network: "bitcoin" | "bitcoin-testnet4";
  destinationScriptPubKeyHex: string;
  amountSats: string;
  feeSats: string;
  walletNetDebitSats: string;
};

export type BitcoinWithdrawalVerification = {
  schema: "bitcoin_withdrawal_verification_v1";
  txid: string;
  network: "bitcoin" | "bitcoin-testnet4";
  status: "pending" | "verified" | "failed";
  checkedAt: string;
  source: string;
  reason: string;
  chainState: "missing" | "mempool" | "confirmed" | "reorged";
  confirmations: number;
  destinationVout?: number;
  exactTransactionMatched: boolean;
  exactDestinationMatched: boolean;
  exactFeeMatched: boolean;
  exactWalletDebitMatched: boolean;
  evidenceDigest: string;
  evidenceHash: string;
};

function fail(message: string, cause?: unknown): never {
  throw new IntegrationBoundaryError("settlement_error", message, cause);
}

function sats(value: unknown, field: string): bigint {
  const text = String(value ?? "").trim();
  if (!/^(0|[1-9][0-9]*)$/.test(text)) fail(`${field} must be a canonical non-negative satoshi amount`, value);
  return BigInt(text);
}

function result(
  input: Omit<BitcoinWithdrawalVerification, "schema" | "evidenceDigest" | "evidenceHash">,
  evidence: unknown
): BitcoinWithdrawalVerification {
  const material = {
    schema: "bitcoin_withdrawal_verification_v1" as const,
    ...input,
    evidenceDigest: canonicalHash(evidence)
  };
  return { ...material, evidenceHash: canonicalHash(material) };
}

export function verifyBitcoinWithdrawalVerification(value: BitcoinWithdrawalVerification): boolean {
  try {
    if (value.schema !== "bitcoin_withdrawal_verification_v1") return false;
    const { evidenceHash, ...material } = value;
    return canonicalHash(material) === evidenceHash;
  } catch {
    return false;
  }
}

export async function observeBitcoinWithdrawal(input: {
  source: BitcoinWithdrawalReadSource;
  expected: BitcoinWithdrawalExpectation;
  now?: Date;
  minimumConfirmations?: number;
}): Promise<BitcoinWithdrawalVerification> {
  const expected = {
    ...input.expected,
    txid: String(input.expected.txid).trim().toLowerCase(),
    destinationScriptPubKeyHex: String(input.expected.destinationScriptPubKeyHex).trim().toLowerCase()
  };
  if (!TXID_PATTERN.test(expected.txid)) fail("Withdrawal observation requires a canonical txid");
  if (!SCRIPT_PATTERN.test(expected.destinationScriptPubKeyHex)) fail("Withdrawal destination scriptPubKey is invalid");
  const expectedAmount = sats(expected.amountSats, "amountSats");
  const expectedFee = sats(expected.feeSats, "feeSats");
  const expectedDebit = sats(expected.walletNetDebitSats, "walletNetDebitSats");
  if (expectedAmount <= 0n || expectedDebit !== expectedAmount + expectedFee) {
    fail("Withdrawal expectation must bind amount plus fee to walletNetDebitSats");
  }
  const minimumConfirmations = input.minimumConfirmations ?? 1;
  if (!Number.isSafeInteger(minimumConfirmations) || minimumConfirmations < 1) {
    fail("minimumConfirmations must be a positive safe integer");
  }

  const observed = await input.source.observeWithdrawal(expected.txid);
  const checkedAt = (input.now || new Date()).toISOString();
  const evidence = { expected, minimumConfirmations, observed };
  const base = {
    txid: expected.txid,
    network: expected.network,
    checkedAt,
    source: input.source.source,
    chainState: observed.state,
    confirmations: observed.confirmations
  };
  const unmatched = {
    exactTransactionMatched: false,
    exactDestinationMatched: false,
    exactFeeMatched: false,
    exactWalletDebitMatched: false
  };

  if (observed.state === "missing") {
    return result({
      ...base,
      status: "pending",
      reason: "Bitcoin transaction is not observable yet",
      ...unmatched
    }, evidence);
  }
  if (observed.state === "reorged") {
    return result({
      ...base,
      status: "failed",
      reason: "Bitcoin transaction was removed by a chain reorganization",
      ...unmatched
    }, evidence);
  }

  const confirmationsValid = Number.isSafeInteger(observed.confirmations) && observed.confirmations >= 0;
  const seenVouts = new Set<number>();
  const outputsWellFormed = Array.isArray(observed.outputs) && observed.outputs.every((output) => {
    if (!Number.isSafeInteger(output.vout) || output.vout < 0 || seenVouts.has(output.vout)) return false;
    seenVouts.add(output.vout);
    try {
      return SCRIPT_PATTERN.test(String(output.scriptPubKeyHex).toLowerCase())
        && sats(output.valueSats, `output ${output.vout}`) >= 0n;
    } catch {
      return false;
    }
  });
  const exactTransactionMatched = String(observed.txid).toLowerCase() === expected.txid
    && observed.network === expected.network
    && input.source.network === expected.network
    && observed.source === input.source.source
    && confirmationsValid
    && outputsWellFormed;
  const matchingOutputs = outputsWellFormed ? observed.outputs.filter((output) => {
    try {
      return output.scriptPubKeyHex.toLowerCase() === expected.destinationScriptPubKeyHex
        && sats(output.valueSats, `output ${output.vout}`) === expectedAmount;
    } catch {
      return false;
    }
  }) : [];
  const exactDestinationMatched = matchingOutputs.length === 1;
  let exactFeeMatched = false;
  let exactWalletDebitMatched = false;
  try {
    exactFeeMatched = sats(observed.feeSats, "observed feeSats") === expectedFee;
    exactWalletDebitMatched = sats(observed.walletNetDebitSats, "observed walletNetDebitSats") === expectedDebit;
  } catch {
    // Invalid or absent public evidence remains an exact-match failure.
  }
  const destinationVout = exactDestinationMatched ? matchingOutputs[0]!.vout : undefined;

  if (!exactTransactionMatched || !exactDestinationMatched || !exactFeeMatched || !exactWalletDebitMatched) {
    return result({
      ...base,
      status: "failed",
      reason: "Observed Bitcoin transaction does not match the exact approved withdrawal effects and fee",
      destinationVout,
      exactTransactionMatched,
      exactDestinationMatched,
      exactFeeMatched,
      exactWalletDebitMatched
    }, evidence);
  }
  if (observed.state !== "confirmed" || observed.confirmations < minimumConfirmations) {
    return result({
      ...base,
      status: "pending",
      reason: `Exact withdrawal is observable but requires ${minimumConfirmations} confirmation(s)`,
      destinationVout,
      exactTransactionMatched,
      exactDestinationMatched,
      exactFeeMatched,
      exactWalletDebitMatched
    }, evidence);
  }
  return result({
    ...base,
    status: "verified",
    reason: "Bitcoin Core confirms the exact approved destination, amount, fee, and wallet debit",
    destinationVout,
    exactTransactionMatched,
    exactDestinationMatched,
    exactFeeMatched,
    exactWalletDebitMatched
  }, evidence);
}
