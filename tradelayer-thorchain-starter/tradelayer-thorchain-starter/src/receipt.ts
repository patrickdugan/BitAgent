import type { InboundUtxoReceipt } from "./types.js";
import { IntegrationBoundaryError } from "./types.js";

export function normalizeReceipt(receipt: InboundUtxoReceipt): InboundUtxoReceipt {
  if (!receipt.sourceChain || !receipt.sourceAsset || !receipt.destinationChain || !receipt.status) {
    throw new IntegrationBoundaryError("utxo_parse_error", "Receipt is missing required top-level fields", receipt);
  }

  if (receipt.destinationVout !== undefined && receipt.destinationVout < 0) {
    throw new IntegrationBoundaryError("utxo_parse_error", "destinationVout must be non-negative", receipt);
  }

  if (receipt.confirmations !== undefined && receipt.confirmations < 0) {
    throw new IntegrationBoundaryError("utxo_parse_error", "confirmations must be non-negative", receipt);
  }

  if (receipt.valueSats !== undefined) {
    BigInt(receipt.valueSats);
  }

  return receipt;
}

export function buildObservedReceipt(base: InboundUtxoReceipt): InboundUtxoReceipt {
  const txid = process.env.OBSERVED_DEST_TXID;
  const vout = process.env.OBSERVED_DEST_VOUT;
  const address = process.env.OBSERVED_DEST_ADDRESS || process.env.DEST_BTC_ADDRESS;
  const valueSats = process.env.OBSERVED_VALUE_SATS;
  const confirmations = process.env.OBSERVED_CONFIRMATIONS;
  const scriptPubKey = process.env.OBSERVED_DEST_SPK;

  if (!txid || vout === undefined || !valueSats) {
    throw new IntegrationBoundaryError(
      "egress_not_found",
      "Observed destination UTXO env vars are missing. Set OBSERVED_DEST_TXID, OBSERVED_DEST_VOUT, and OBSERVED_VALUE_SATS."
    );
  }

  return normalizeReceipt({
    ...base,
    destinationTxid: txid,
    destinationVout: Number(vout),
    destinationAddress: address,
    destinationScriptPubKey: scriptPubKey,
    valueSats,
    confirmations: confirmations ? Number(confirmations) : 0,
    status: Number(confirmations || 0) > 0 ? "utxo_confirmed" : "egress_detected"
  });
}
