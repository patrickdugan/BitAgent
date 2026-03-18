import { createRequire } from "node:module";
import path from "node:path";
import { externalRepos } from "../config.js";
import type { ProceduralTemplateContext } from "../types.js";

const require = createRequire(import.meta.url);

const utxoRefIndex = require(path.join(externalRepos.utxoRef, "bitvm3", "utxo_referee", "index.js"));
const txEncoder = require(path.join(externalRepos.tradelayer, "src", "txEncoder.js"));

function getTemplateSource() {
  const customTemplate = process.env.TL_PROCEDURAL_TEMPLATE_JSON;
  if (customTemplate) {
    return JSON.parse(customTemplate);
  }
  return utxoRefIndex.RECEIPT_DLC_TEMPLATE_V1;
}

export function buildProceduralTemplateContext(): ProceduralTemplateContext {
  const template = getTemplateSource();
  const templateId = process.env.TL_DLC_TEMPLATE_ID || template.templateId || "thorchain-inbound";
  const contractId = process.env.TL_DLC_CONTRACT_ID || "thorchain-inbound-contract";
  const settlementState = (process.env.TL_DLC_SETTLEMENT_STATE || "FUNDED").toUpperCase();
  const templateHash =
    process.env.TL_DLC_TEMPLATE_HASH ||
    utxoRefIndex.templateHashHex({
      ...template,
      templateId
    });
  const receiptPropertyId = process.env.TL_RECEIPT_PROPERTY_ID ? Number(process.env.TL_RECEIPT_PROPERTY_ID) : undefined;
  const collateralPropertyId = process.env.TL_COLLATERAL_PROPERTY_ID ? Number(process.env.TL_COLLATERAL_PROPERTY_ID) : undefined;
  const issuePayload = txEncoder.encodeTokenIssue({
    initialAmount: 1,
    ticker: process.env.TL_RECEIPT_TICKER || "THORU",
    whitelists: [],
    managed: true,
    backupAddress: process.env.TL_BACKUP_ADDRESS || "",
    nft: false,
    coloredCoinHybrid: false,
    proceduralType: Number(process.env.TL_PROCEDURAL_TYPE || 1)
  });

  return {
    templateId,
    contractId,
    settlementState,
    templateHash,
    receiptPropertyId,
    collateralPropertyId,
    issuePayload
  };
}

export async function maybeSeedProceduralRegistry(context: ProceduralTemplateContext) {
  if (String(process.env.TL_SEED_PROCEDURAL_REGISTRY || "false").toLowerCase() !== "true") {
    return { seeded: false };
  }

  const { ProceduralRegistry } = require(path.join(externalRepos.tradelayer, "src", "procedural.js"));

  await ProceduralRegistry.upsertTemplate(context.templateId, {
    templateHash: context.templateHash,
    receiptPropertyId: context.receiptPropertyId,
    collateralPropertyId: context.collateralPropertyId
  });

  await ProceduralRegistry.upsertContract(context.contractId, context.templateId, context.settlementState, {
    source: "thorchain-starter"
  });

  return { seeded: true };
}
