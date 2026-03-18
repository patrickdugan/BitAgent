import { ethers } from "ethers";
import { buildOrSubmitAbsorb } from "./adapters/tradelayerAdapter.js";
import { ArkDlcPreparationAdapter } from "./adapters/dlcAdapter.js";
import { buildEvmTemplateCommitment } from "./adapters/evmTemplateAdapter.js";
import { maybeSeedProceduralRegistry, buildProceduralTemplateContext } from "./adapters/proceduralAdapter.js";
import { buildTlWebPhantomIntent } from "./adapters/tlwebAdapter.js";
import { mapReceiptToCanonicalUtxo } from "./adapters/utxoRefAdapter.js";
import { publishActivity } from "./adapters/walletAdapter.js";
import { demoDefaults } from "./config.js";
import { buildObservedReceipt, normalizeReceipt } from "./receipt.js";
import type { AbsorbInboundUtxoResult, InboundUtxoReceipt, OnboardingActivity } from "./types.js";
import { IntegrationBoundaryError } from "./types.js";
import { fromTokenUnits, getInboundAddress, getSwapQuote, toThorchain1e8 } from "../scripts/thorchain.js";

const ROUTER_ABI = [
  "function depositWithExpiry(address payable vault, address asset, uint256 amount, string memo, uint256 expiry) external payable"
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() external view returns (uint8)"
];

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

async function maybeSubmitEvmSwap(quote: { memo: string; expiry?: number }, inbound: { address: string; router?: string }) {
  const submitLive = String(process.env.DEMO_SUBMIT || "false").toLowerCase() === "true";
  if (!submitLive) {
    return { txid: process.env.SIMULATED_THORCHAIN_SWAP_TXID || "simulated-router-submit", submitted: false };
  }

  const rpcUrl = process.env.ETH_RPC_URL || process.env.BASE_RPC_URL;
  const privateKey = process.env.PRIVATE_KEY;
  const amountHuman = process.env.AMOUNT_IN_TOKEN_UNITS || "0.01";
  const sourceAsset = process.env.SOURCE_ASSET || "ETH.ETH";
  const tokenAddress = process.env.SOURCE_TOKEN_ADDRESS;

  if (!rpcUrl || !privateKey || !inbound.router) {
    throw new IntegrationBoundaryError("router_submit_error", "Missing EVM RPC, private key, or THORChain router address for live submit");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const expiry = BigInt(quote.expiry || Math.floor(Date.now() / 1000) + 3600);
  const router = new ethers.Contract(inbound.router, ROUTER_ABI, wallet);

  if (sourceAsset.endsWith(".ETH")) {
    const amountNative = fromTokenUnits(amountHuman, 18);
    const tx = await router.depositWithExpiry(inbound.address, ethers.ZeroAddress, amountNative, quote.memo, expiry, {
      value: amountNative
    });
    await tx.wait();
    return { txid: tx.hash, submitted: true };
  }

  if (!tokenAddress) {
    throw new IntegrationBoundaryError("router_submit_error", "SOURCE_TOKEN_ADDRESS is required for live ERC-20 submit");
  }

  const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const decimals = Number(await erc20.decimals());
  const amountNative = fromTokenUnits(amountHuman, decimals);
  const allowance = await erc20.allowance(wallet.address, inbound.router);
  if (allowance < amountNative) {
    const approveTx = await erc20.approve(inbound.router, amountNative);
    await approveTx.wait();
  }
  const tx = await router.depositWithExpiry(inbound.address, tokenAddress, amountNative, quote.memo, expiry);
  await tx.wait();
  return { txid: tx.hash, submitted: true };
}

export async function obtainQuoteAndBaseReceipt(): Promise<InboundUtxoReceipt> {
  const destination = process.env.DEST_BTC_ADDRESS || process.env.DEST_LTC_ADDRESS;
  const sourceAsset = process.env.SOURCE_ASSET || (demoDefaults.sourceAsset === "USDC" ? "ETH.USDC" : "ETH.ETH");
  const chain = process.env.SOURCE_CHAIN || "ETH";
  const amountHuman = process.env.AMOUNT_IN_TOKEN_UNITS || (demoDefaults.sourceAsset === "USDC" ? "10.0" : "0.01");
  if (!destination) {
    throw new IntegrationBoundaryError("quote_error", "DEST_BTC_ADDRESS or DEST_LTC_ADDRESS is required");
  }

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

  const swap = await maybeSubmitEvmSwap(quote, inbound);

  return normalizeReceipt({
    sourceChain: demoDefaults.sourceChain,
    sourceAsset: demoDefaults.sourceAsset,
    thorchainSwapTx: swap.txid,
    thorchainMemo: quote.memo,
    destinationChain: demoDefaults.destinationChain,
    destinationAddress: destination,
    status: swap.submitted ? "submitted" : "quote_obtained",
    raw: { inbound, quote }
  });
}

export async function absorbInboundUtxo(receipt: InboundUtxoReceipt): Promise<AbsorbInboundUtxoResult> {
  const normalized = normalizeReceipt(receipt);
  const mapped = mapReceiptToCanonicalUtxo(normalized);
  const result = await buildOrSubmitAbsorb({
    utxo: mapped,
    sourceTxid: normalized.thorchainSwapTx
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
    activity("deposit", "deposit", "success", "Quote obtained and EVM deposit path prepared", {
      memo: baseReceipt.thorchainMemo,
      thorchainSwapTx: baseReceipt.thorchainSwapTx
    }, baseReceipt.thorchainSwapTx)
  );

  const observedReceipt = buildObservedReceipt(baseReceipt);
  await publishActivity(
    activity("utxo_detection", "utxo_detection", "success", "Observed destination UTXO mapped into onboarding receipt", {
      destinationTxid: observedReceipt.destinationTxid,
      destinationVout: observedReceipt.destinationVout,
      valueSats: observedReceipt.valueSats
    }, observedReceipt.destinationTxid)
  );

  const absorbResult = await absorbInboundUtxo(observedReceipt);
  const canonical = mapReceiptToCanonicalUtxo(observedReceipt);
  const evmCommitment = buildEvmTemplateCommitment({
    receipt: observedReceipt,
    procedural,
    depositor: process.env.EVM_DEPOSITOR_ADDRESS
  });
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
