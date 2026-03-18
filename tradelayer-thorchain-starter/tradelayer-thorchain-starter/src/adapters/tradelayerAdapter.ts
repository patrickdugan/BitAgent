import { createRequire } from "node:module";
import path from "node:path";
import { externalRepos } from "../config.js";
import type { AbsorbInboundUtxoResult, CanonicalUtxoReference } from "../types.js";
import { IntegrationBoundaryError } from "../types.js";
import { buildProceduralTemplateContext } from "./proceduralAdapter.js";

const require = createRequire(import.meta.url);
const encode = require(path.join(externalRepos.tradelayer, "src", "txEncoder.js"));

type AbsorbBuildInput = {
  utxo: CanonicalUtxoReference;
  sourceTxid?: string;
};

export function buildGrantParams(input: AbsorbBuildInput) {
  const procedural = buildProceduralTemplateContext();
  const propertyId = Number(procedural.receiptPropertyId || 0);
  if (!propertyId) {
    throw new IntegrationBoundaryError(
      "tradelayer_build_error",
      "TL_RECEIPT_PROPERTY_ID is required to build the provisional TradeLayer intake transaction"
    );
  }

  return {
    propertyId,
    amountGranted: Number(input.utxo.valueSats) / 1e8,
    addressToGrantTo: process.env.TL_DESTINATION_ADDRESS || input.utxo.address || process.env.DEST_BTC_ADDRESS || "",
    dlcTemplateId: procedural.templateId,
    dlcContractId: procedural.contractId || input.sourceTxid || input.utxo.txid,
    settlementState: procedural.settlementState,
    dlcHash: procedural.templateHash
  };
}

export async function buildOrSubmitAbsorb(input: AbsorbBuildInput): Promise<AbsorbInboundUtxoResult> {
  const params = buildGrantParams(input);

  try {
    const payload = encode.encodeGrantManagedToken(params);
    const payloadHex = Buffer.from(payload, "utf8").toString("hex");
    const senderAddress = process.env.TL_ADMIN_ADDRESS;

    if (!senderAddress || String(process.env.TL_SUBMIT_ABSORB || "false").toLowerCase() !== "true") {
      return {
        tlTxHex: payloadHex,
        status: "built"
      };
    }

    const txUtils = require(path.join(externalRepos.tradelayer, "src", "txUtils.js"));
    const tlTxid = await txUtils.createGrantManagedTokenTransaction(senderAddress, params);
    return {
      tlTxHex: payloadHex,
      tlTxid,
      status: "submitted"
    };
  } catch (error) {
    throw new IntegrationBoundaryError("tradelayer_build_error", "Failed to build or submit TradeLayer intake transaction", error);
  }
}
