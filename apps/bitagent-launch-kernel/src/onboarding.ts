import { verifyReceiptAgainstCommitment } from "./adapters/commitmentVerifier.js";
import { buildOrSubmitAbsorb } from "./adapters/tradelayerAdapter.js";
import { ArkDlcPreparationAdapter } from "./adapters/dlcAdapter.js";
import { buildEvmTemplateCommitment } from "./adapters/evmTemplateAdapter.js";
import { OneClickNearIntentsProvider, type NearIntentsProvider } from "./adapters/nearIntentsAdapter.js";
import { maybeSeedProceduralRegistry, buildProceduralTemplateContext } from "./adapters/proceduralAdapter.js";
import { ScriptedNearIntentsProvider } from "./adapters/scriptedNearIntentsProvider.js";
import { buildTlWebPhantomIntent } from "./adapters/tlwebAdapter.js";
import { mapReceiptToCanonicalUtxo } from "./adapters/utxoRefAdapter.js";
import { publishActivity } from "./adapters/walletAdapter.js";
import { demoDefaults, infrastructureConfig } from "./config.js";
import { buildObservedReceipt, normalizeReceipt } from "./receipt.js";
import { canonicalHash } from "./survival/policy.js";
import type { AbsorbInboundUtxoResult, InboundUtxoReceipt, OnboardingActivity } from "./types.js";
import { IntegrationBoundaryError } from "./types.js";
import { getInboundAddress, getSwapQuote, toThorchain1e8 } from "../scripts/thorchain.js";

function activity(
  id: string,
  phase: OnboardingActivity["phase"],
  status: OnboardingActivity["status"],
  label: string,
  meta?: Record<string, unknown>,
  txid?: string
): OnboardingActivity {
  return { id, phase, status, label, meta, txid };
}

async function obtainThorchainQuoteReceipt(destination: string): Promise<InboundUtxoReceipt> {
  const sourceAsset = process.env.SOURCE_ASSET || (demoDefaults.sourceAsset === "USDC" ? "ETH.USDC" : "ETH.ETH");
  const chain = process.env.SOURCE_CHAIN || "ETH";
  const amountHuman = process.env.AMOUNT_IN_TOKEN_UNITS || (demoDefaults.sourceAsset === "USDC" ? "10.0" : "0.01");
  const decimals = sourceAsset.includes("USDC") ? 6 : 18;
  const amount1e8 = toThorchain1e8(amountHuman, decimals).toString();
  const inbound = await getInboundAddress(chain);
  const quote = await getSwapQuote({
    fromAsset: sourceAsset,
    toAsset: process.env.DEST_ASSET || demoDefaults.destinationAsset,
    amount1e8,
    destination,
    affiliate: process.env.AFFILIATE,
    affiliateBps: process.env.AFFILIATE_BPS,
    streamingInterval: process.env.STREAMING_INTERVAL,
    streamingQuantity: process.env.STREAMING_QUANTITY
  });
  return normalizeReceipt({
    sourceChain: demoDefaults.sourceChain,
    sourceAsset: demoDefaults.sourceAsset,
    swapRail: "thorchain",
    swapQuoteId: canonicalHash({ inbound, quote }),
    swapDepositAddress: inbound.address,
    swapStatus: "quote_obtained",
    swapRouteCommitment: quote.memo,
    thorchainMemo: quote.memo,
    destinationChain: demoDefaults.destinationChain,
    destinationAddress: destination,
    status: "quote_obtained",
    raw: { inbound, quote, legacyRail: true }
  });
}

export async function obtainQuoteAndBaseReceipt(input: {
  nearIntentsProvider?: NearIntentsProvider;
  now?: Date;
} = {}): Promise<InboundUtxoReceipt> {
  const destination = process.env.DEST_BTC_ADDRESS || process.env.DEST_LTC_ADDRESS;
  if (!destination) {
    throw new IntegrationBoundaryError("quote_error", "DEST_BTC_ADDRESS or DEST_LTC_ADDRESS is required");
  }
  if (demoDefaults.crossChainRail === "thorchain") return obtainThorchainQuoteReceipt(destination);

  const refundTo = process.env.NEAR_INTENTS_REFUND_ADDRESS || process.env.EVM_DEPOSITOR_ADDRESS;
  if (!refundTo) {
    throw new IntegrationBoundaryError(
      "near_intents_quote_error",
      "NEAR_INTENTS_REFUND_ADDRESS is required and must be controlled by the connected origin-chain wallet"
    );
  }
  const provider =
    input.nearIntentsProvider ||
    (infrastructureConfig.nearIntentsMode === "live"
      ? new OneClickNearIntentsProvider({
          jwt: infrastructureConfig.nearIntentsJwt,
          baseUrl: infrastructureConfig.nearIntentsBaseUrl
        })
      : new ScriptedNearIntentsProvider());
  const now = input.now || new Date();
  const plan = await provider.quote({
    sourceChain: demoDefaults.sourceChain,
    sourceAsset: demoDefaults.sourceAsset,
    destinationChain: demoDefaults.destinationChain,
    amount: process.env.AMOUNT_IN_TOKEN_UNITS || (demoDefaults.sourceAsset === "USDC" ? "10.0" : "0.01"),
    recipient: destination,
    refundTo,
    slippageBps: Number(process.env.NEAR_INTENTS_SLIPPAGE_BPS || 100),
    deadline: process.env.NEAR_INTENTS_DEADLINE || new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    dry: infrastructureConfig.nearIntentsMode !== "live" || process.env.NEAR_INTENTS_DRY_RUN === "true",
    originAssetId: process.env.NEAR_INTENTS_ORIGIN_ASSET,
    destinationAssetId: process.env.NEAR_INTENTS_DESTINATION_ASSET,
    referral: process.env.NEAR_INTENTS_REFERRAL
  });
  return normalizeReceipt({
    sourceChain: demoDefaults.sourceChain,
    sourceAsset: demoDefaults.sourceAsset,
    swapRail: "near_intents",
    swapQuoteId: plan.quoteId,
    swapDepositAddress: plan.depositAddress,
    swapDepositMemo: plan.depositMemo,
    swapStatus: plan.mode === "executable" ? "awaiting_approval" : "simulation_only",
    swapRouteCommitment: canonicalHash(plan),
    destinationChain: demoDefaults.destinationChain,
    destinationAddress: destination,
    status: "quote_obtained",
    raw: { nearIntentsQuote: plan, mode: infrastructureConfig.nearIntentsMode }
  });
}

export async function absorbInboundUtxo(receipt: InboundUtxoReceipt): Promise<AbsorbInboundUtxoResult> {
  const normalized = normalizeReceipt(receipt);
  const mapped = mapReceiptToCanonicalUtxo(normalized);
  const result = await buildOrSubmitAbsorb({
    utxo: mapped,
    sourceTxid: normalized.swapTxid || normalized.thorchainSwapTx
  });

  await publishActivity(
    activity(`tradelayer_absorb:${mapped.utxoRef}`, "tradelayer_absorb", "success", "TradeLayer intake transaction prepared", {
      utxoRef: mapped.utxoRef,
      tlTxHex: result.tlTxHex
    }, result.tlTxid)
  );

  return result;
}

export async function runOnboardingDemo() {
  const baseReceipt = await obtainQuoteAndBaseReceipt();
  const procedural = buildProceduralTemplateContext();
  await maybeSeedProceduralRegistry(procedural);
  await publishActivity(
    activity("deposit", "deposit", "success", "Cross-chain quote prepared; no funds moved", {
      rail: baseReceipt.swapRail,
      quoteId: baseReceipt.swapQuoteId,
      depositAddress: baseReceipt.swapDepositAddress,
      depositMemo: baseReceipt.swapDepositMemo,
      status: baseReceipt.swapStatus
    }, baseReceipt.swapTxid || baseReceipt.thorchainSwapTx)
  );
  await publishActivity(
    activity(
      `swap:${baseReceipt.swapQuoteId}`,
      baseReceipt.swapRail === "near_intents" ? "near_intents_swap" : "thorchain_swap",
      "pending",
      baseReceipt.swapRail === "near_intents"
        ? "NEAR Intents quote is ready for explicit wallet approval"
        : "Legacy THORChain quote is ready",
      { quoteId: baseReceipt.swapQuoteId, routeCommitment: baseReceipt.swapRouteCommitment }
    )
  );

  const observedReceipt = buildObservedReceipt(baseReceipt);
  await publishActivity(
    activity("utxo_detection", "utxo_detection", "success", "Observed destination UTXO mapped into onboarding receipt", {
      destinationTxid: observedReceipt.destinationTxid,
      destinationVout: observedReceipt.destinationVout,
      valueSats: observedReceipt.valueSats
    }, observedReceipt.destinationTxid)
  );

  const evmCommitment = buildEvmTemplateCommitment({
    receipt: observedReceipt,
    procedural,
    depositor: process.env.EVM_DEPOSITOR_ADDRESS
  });
  verifyReceiptAgainstCommitment({
    receipt: observedReceipt,
    procedural,
    commitment: evmCommitment,
    depositor: process.env.EVM_DEPOSITOR_ADDRESS
  });
  const absorbResult = await absorbInboundUtxo(observedReceipt);
  const canonical = mapReceiptToCanonicalUtxo(observedReceipt);
  const tlwebIntent = buildTlWebPhantomIntent({
    receipt: observedReceipt,
    procedural,
    absorbPayload: Buffer.from(absorbResult.tlTxHex || "", "hex").toString("utf8")
  });
  const dlc = await new ArkDlcPreparationAdapter().prepareFromAbsorbedUtxo({
    tlTxid: absorbResult.tlTxid || "built-only",
    utxoRef: canonical.utxoRef,
    walletAccount: process.env.TL_ADMIN_ADDRESS
  });

  await publishActivity(
    activity("dlc_ready", "dlc_ready", "success", "DLC/VTXO preparation hook executed", {
      dlcCandidateId: dlc.dlcCandidateId,
      relayPayload: dlc.relayPayload
    }, absorbResult.tlTxid)
  );

  return {
    receipt: observedReceipt,
    procedural,
    evmCommitment,
    mappedUtxo: canonical,
    absorbResult,
    tlwebIntent,
    dlc
  };
}
