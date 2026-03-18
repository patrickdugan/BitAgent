import crypto from "node:crypto";
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
  if (!receipt.destinationTxid || receipt.destinationVout === undefined || !receipt.valueSats) {
    throw new IntegrationBoundaryError(
      "utxo_ref_map_error",
      "Receipt is missing destination txid, vout, or valueSats required for UTXO mapping",
      receipt
    );
  }

  const utxoRef = crypto
    .createHash("sha256")
    .update(`${receipt.destinationTxid}:${receipt.destinationVout}`)
    .digest("hex");

  const canonical: CanonicalUtxoReference = {
    txid: receipt.destinationTxid,
    vout: receipt.destinationVout,
    valueSats: BigInt(receipt.valueSats),
    address: receipt.destinationAddress,
    scriptPubKey: receipt.destinationScriptPubKey,
    utxoRef
  };

  if (canonical.scriptPubKey) {
    try {
      new utxoRefModule.PayoutLeaf({
        epochId: 0n,
        recipientScriptPubKey: canonical.scriptPubKey,
        amountSats: canonical.valueSats
      });
    } catch (error) {
      throw new IntegrationBoundaryError(
        "utxo_parse_error",
        "UTXO-Ref rejected the mapped payout leaf representation",
        error
      );
    }
  }

  return canonical;
}
