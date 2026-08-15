import { canonicalHash } from "../survival/policy.js";
import type {
  NearIntentsExecutionState,
  NearIntentsProvider,
  NearIntentsQuoteInput,
  NearIntentsQuotePlan,
  NearIntentsToken
} from "./nearIntentsAdapter.js";
import { resolveNearIntentsAsset, toAssetUnits } from "./nearIntentsAdapter.js";

const scriptedTokens: NearIntentsToken[] = [
  { assetId: "scripted:eth:eth", blockchain: "eth" as NearIntentsToken["blockchain"], symbol: "ETH", decimals: 18 },
  { assetId: "scripted:eth:usdc", blockchain: "eth" as NearIntentsToken["blockchain"], symbol: "USDC", decimals: 6 },
  { assetId: "scripted:base:eth", blockchain: "base" as NearIntentsToken["blockchain"], symbol: "ETH", decimals: 18 },
  { assetId: "scripted:base:usdc", blockchain: "base" as NearIntentsToken["blockchain"], symbol: "USDC", decimals: 6 },
  { assetId: "scripted:arb:eth", blockchain: "arb" as NearIntentsToken["blockchain"], symbol: "ETH", decimals: 18 },
  { assetId: "scripted:arb:usdc", blockchain: "arb" as NearIntentsToken["blockchain"], symbol: "USDC", decimals: 6 },
  { assetId: "scripted:op:eth", blockchain: "op" as NearIntentsToken["blockchain"], symbol: "ETH", decimals: 18 },
  { assetId: "scripted:op:usdc", blockchain: "op" as NearIntentsToken["blockchain"], symbol: "USDC", decimals: 6 },
  { assetId: "scripted:btc:btc", blockchain: "btc" as NearIntentsToken["blockchain"], symbol: "BTC", decimals: 8 },
  { assetId: "scripted:ltc:ltc", blockchain: "ltc" as NearIntentsToken["blockchain"], symbol: "LTC", decimals: 8 }
];

export class ScriptedNearIntentsProvider implements NearIntentsProvider {
  constructor(
    private readonly executionState: NearIntentsExecutionState["status"] = "awaiting_deposit",
    private readonly executable = false
  ) {}

  async listTokens() {
    return scriptedTokens;
  }

  async quote(input: NearIntentsQuoteInput): Promise<NearIntentsQuotePlan> {
    const origin = resolveNearIntentsAsset(scriptedTokens, {
      chain: input.sourceChain,
      symbol: input.sourceAsset,
      assetId: input.originAssetId
    });
    const destination = resolveNearIntentsAsset(scriptedTokens, {
      chain: input.destinationChain,
      symbol: input.destinationChain === "bitcoin" ? "BTC" : "LTC",
      assetId: input.destinationAssetId
    });
    const amountIn = toAssetUnits(input.amount, origin.decimals);
    const amountOut = destination.decimals === 8 ? "100000" : "1000000";
    const quoteId = `scripted-${canonicalHash({ ...input, amountIn }).slice(0, 20)}`;
    return {
      rail: "near_intents" as const,
      mode: this.executable ? "executable" : "preview",
      quoteId,
      signature: `simulation-only:${quoteId}`,
      quotedAt: new Date(0).toISOString(),
      originAssetId: origin.assetId,
      destinationAssetId: destination.assetId,
      amountIn,
      amountInFormatted: input.amount,
      amountOut,
      amountOutFormatted: "0.001",
      minAmountOut: "99000",
      recipient: input.recipient,
      refundTo: input.refundTo,
      depositAddress: this.executable ? `scripted://${quoteId}` : undefined,
      deadline: this.executable ? input.deadline : undefined,
      timeEstimateSeconds: 120,
      withdrawFee: "1000",
      refundFee: "0"
    };
  }

  async getStatus(depositAddress: string): Promise<NearIntentsExecutionState> {
    return {
      quoteId: depositAddress,
      status: this.executionState,
      providerStatus: this.executionState.toUpperCase(),
      updatedAt: new Date(0).toISOString(),
      originTxids: [],
      destinationTxids:
        this.executionState === "success" ? [canonicalHash({ depositAddress, chain: "destination" })] : [],
      refundedAmount: this.executionState === "refunded" ? "10000000" : undefined,
      refundReason: this.executionState === "refunded" ? "scripted_refund" : undefined
    };
  }

  async submitDepositTx(input: { txHash: string; depositAddress: string }) {
    const state = await this.getStatus(input.depositAddress);
    return { ...state, originTxids: [input.txHash] };
  }
}
