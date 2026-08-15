import { createRequire } from "node:module";
import path from "node:path";
import { externalRepos } from "../config.js";
import type { CanonicalUtxoReference, InboundUtxoReceipt } from "../types.js";
import { IntegrationBoundaryError } from "../types.js";

const require = createRequire(import.meta.url);
const utxoRefModule = require(path.join(externalRepos.utxoRef, "bitvm3", "utxo_referee", "index.js"));

export function getUtxoRefExports() {
  return utxoRefModule;
}

export function mapReceiptToCanonicalUtxo(receipt: InboundUtxoReceipt): CanonicalUtxoReference {
  if (
    !receipt.destinationTxid ||
    receipt.destinationVout === undefined ||
    !receipt.valueSats ||
    !receipt.destinationScriptPubKey
  ) {
    throw new IntegrationBoundaryError(
      "utxo_ref_map_error",
      "Receipt is missing destination txid, vout, valueSats, or scriptPubKey required by UTXO-Ref V2",
      receipt
    );
  }

  try {
    const fundingSet = utxoRefModule.v2.settlement.buildFundingSetV2([
      {
        txid: receipt.destinationTxid,
        vout: receipt.destinationVout,
        amountSats: receipt.valueSats,
        scriptPubKeyHex: receipt.destinationScriptPubKey
      }
    ]);
    const funding = fundingSet.funding[0];
    return {
      txid: funding.txid,
      vout: funding.vout,
      valueSats: BigInt(funding.amountSats),
      address: receipt.destinationAddress,
      scriptPubKey: funding.scriptPubKeyHex,
      utxoRef: fundingSet.fundingRoot,
      fundingRoot: fundingSet.fundingRoot,
      fundingIndex: funding.index
    };
  } catch (error) {
    throw new IntegrationBoundaryError("utxo_parse_error", "UTXO-Ref V2 rejected the inbound funding outpoint", error);
  }
}
