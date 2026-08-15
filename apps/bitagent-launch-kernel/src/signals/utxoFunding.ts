import { getUtxoRefExports } from "../adapters/utxoRefAdapter.js";
import { SignalKernelError } from "./errors.js";
import type { CanonicalSignalFunding, ConfirmedWalletUtxo } from "./types.js";

function normalizeUtxo(utxo: ConfirmedWalletUtxo, requiredConfirmations: number) {
  if (!/^[0-9a-f]{64}$/i.test(utxo.txid)
    || !Number.isSafeInteger(utxo.vout)
    || utxo.vout < 0
    || !/^[1-9][0-9]*$/.test(utxo.amountSats)
    || !/^[0-9a-f]+$/i.test(utxo.scriptPubKeyHex)
    || utxo.scriptPubKeyHex.length % 2 !== 0) {
    throw new SignalKernelError("utxo_ref_error", "Wallet returned a malformed UTXO");
  }
  if (!Number.isSafeInteger(utxo.confirmations) || utxo.confirmations < requiredConfirmations) {
    throw new SignalKernelError(
      "utxo_unconfirmed",
      `Funding UTXO ${utxo.txid}:${utxo.vout} has ${utxo.confirmations}/${requiredConfirmations} confirmations`
    );
  }
  return {
    txid: utxo.txid.toLowerCase(),
    vout: utxo.vout,
    amountSats: utxo.amountSats,
    scriptPubKeyHex: utxo.scriptPubKeyHex.toLowerCase()
  };
}

export function selectCanonicalSignalFunding(input: {
  utxos: ConfirmedWalletUtxo[];
  requiredSats: string;
  requiredConfirmations: number;
}): CanonicalSignalFunding {
  const required = BigInt(input.requiredSats);
  if (required <= 0n) throw new SignalKernelError("utxo_ref_error", "Required funding amount must be positive");
  const candidates = input.utxos
    .map((utxo) => normalizeUtxo(utxo, input.requiredConfirmations))
    .sort((left, right) => `${left.txid}:${left.vout}`.localeCompare(`${right.txid}:${right.vout}`));
  const selected: typeof candidates = [];
  let total = 0n;
  for (const candidate of candidates) {
    selected.push(candidate);
    total += BigInt(candidate.amountSats);
    if (total >= required) break;
  }
  if (total < required) {
    throw new SignalKernelError("wallet_state_unavailable", "Confirmed Bitcoin UTXOs cannot cover the network fee");
  }

  try {
    const fundingSet = getUtxoRefExports().v2.settlement.buildFundingSetV2(selected);
    return {
      fundingRoot: String(fundingSet.fundingRoot),
      totalSats: total.toString(),
      outpoints: fundingSet.funding.map((row: {
        txid: string;
        vout: number;
        amountSats: string;
        scriptPubKeyHex: string;
      }) => ({
        txid: row.txid,
        vout: row.vout,
        amountSats: String(row.amountSats),
        scriptPubKeyHex: row.scriptPubKeyHex
      }))
    };
  } catch (error) {
    throw new SignalKernelError("utxo_ref_error", "UTXO-Ref V2 rejected the signal funding set", error);
  }
}
