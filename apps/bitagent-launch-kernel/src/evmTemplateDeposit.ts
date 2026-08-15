import { ethers } from "ethers";
import { buildProceduralTemplateContext } from "./adapters/proceduralAdapter.js";
import { buildEvmTemplateCommitment } from "./adapters/evmTemplateAdapter.js";
import { demoDefaults } from "./config.js";
import type { InboundUtxoReceipt } from "./types.js";
import { IntegrationBoundaryError } from "./types.js";
import { fromTokenUnits, getInboundAddress, getSwapQuote, toThorchain1e8 } from "../scripts/thorchain.js";

const TEMPLATE_ADAPTER_ABI = [
  "function depositNativeWithTemplate(address vault,uint256 amount,string memo,uint256 expiry,bytes32 templateHash,bytes32 destinationScriptCommitment,uint32 destinationChain,uint32 receiptPropertyId,uint32 collateralPropertyId,uint32 settlementState) external payable returns (bytes32)",
  "function depositErc20WithTemplate(address vault,address asset,uint256 amount,string memo,uint256 expiry,bytes32 templateHash,bytes32 destinationScriptCommitment,uint32 destinationChain,uint32 receiptPropertyId,uint32 collateralPropertyId,uint32 settlementState) external returns (bytes32)"
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() external view returns (uint8)"
];

function settlementStateCode(state: string) {
  return {
    TEMPLATE: 0,
    FUNDED: 1,
    OPEN: 2,
    SETTLED: 3,
    CLOSED: 4,
    DISPUTED: 5
  }[state] ?? 0;
}

function destinationChainCode(chain: "bitcoin" | "litecoin") {
  return chain === "litecoin" ? 1 : 0;
}

export async function submitTemplateBoundDeposit() {
  const adapterAddress = process.env.TEMPLATE_BOUND_ADAPTER_ADDRESS;
  const rpcUrl = process.env.ETH_RPC_URL || process.env.BASE_RPC_URL;
  const privateKey = process.env.PRIVATE_KEY;
  const destination = process.env.DEST_BTC_ADDRESS || process.env.DEST_LTC_ADDRESS;
  const sourceAsset = process.env.SOURCE_ASSET || (demoDefaults.sourceAsset === "USDC" ? "ETH.USDC" : "ETH.ETH");
  const amountHuman = process.env.AMOUNT_IN_TOKEN_UNITS || (demoDefaults.sourceAsset === "USDC" ? "10.0" : "0.01");
  const chain = process.env.SOURCE_CHAIN || "ETH";
  const tokenAddress = process.env.SOURCE_TOKEN_ADDRESS;

  if (!adapterAddress || !rpcUrl || !privateKey || !destination) {
    throw new IntegrationBoundaryError("router_submit_error", "Missing TEMPLATE_BOUND_ADAPTER_ADDRESS, RPC URL, private key, or destination");
  }

  const procedural = buildProceduralTemplateContext();
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const adapter = new ethers.Contract(adapterAddress, TEMPLATE_ADAPTER_ABI, wallet);

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

  if (!quote.memo) {
    throw new IntegrationBoundaryError("quote_error", "THORChain quote did not return a memo");
  }

  const receipt: InboundUtxoReceipt = {
    sourceChain: demoDefaults.sourceChain,
    sourceAsset: demoDefaults.sourceAsset,
    destinationChain: demoDefaults.destinationChain,
    destinationAddress: destination,
    thorchainMemo: quote.memo,
    status: "quote_obtained",
    raw: { inbound, quote }
  };

  const commitment = buildEvmTemplateCommitment({
    receipt,
    procedural,
    depositor: wallet.address
  });

  const expiry = BigInt(quote.expiry || Math.floor(Date.now() / 1000) + 3600);
  const destinationChain = destinationChainCode(receipt.destinationChain);
  const settlementState = settlementStateCode(procedural.settlementState);

  if (sourceAsset.endsWith(".ETH")) {
    const amountNative = fromTokenUnits(amountHuman, 18);
    const tx = await adapter.depositNativeWithTemplate(
      inbound.address,
      amountNative,
      quote.memo,
      expiry,
      commitment.templateHash,
      commitment.destinationScriptCommitment,
      destinationChain,
      procedural.receiptPropertyId || 0,
      procedural.collateralPropertyId || 0,
      settlementState,
      { value: amountNative }
    );
    await tx.wait();
    return { txHash: tx.hash, receipt, commitment, procedural };
  }

  if (!tokenAddress) {
    throw new IntegrationBoundaryError("router_submit_error", "SOURCE_TOKEN_ADDRESS is required for template-bound ERC-20 deposit");
  }

  const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const tokenDecimals = Number(await erc20.decimals());
  const amountNative = fromTokenUnits(amountHuman, tokenDecimals);
  const allowance = await erc20.allowance(wallet.address, adapterAddress);
  if (allowance < amountNative) {
    const approveTx = await erc20.approve(adapterAddress, amountNative);
    await approveTx.wait();
  }

  const tx = await adapter.depositErc20WithTemplate(
    inbound.address,
    tokenAddress,
    amountNative,
    quote.memo,
    expiry,
    commitment.templateHash,
    commitment.destinationScriptCommitment,
    destinationChain,
    procedural.receiptPropertyId || 0,
    procedural.collateralPropertyId || 0,
    settlementState
  );
  await tx.wait();
  return { txHash: tx.hash, receipt, commitment, procedural };
}
