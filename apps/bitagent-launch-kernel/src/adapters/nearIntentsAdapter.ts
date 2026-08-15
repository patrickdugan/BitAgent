import { OneClickService, OpenAPI, QuoteRequest, type QuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import type { DestinationChain, SourceAsset, SourceChain } from "../types.js";
import { IntegrationBoundaryError } from "../types.js";

export type NearIntentsToken = {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
};

export type NearIntentsQuoteInput = {
  sourceChain: SourceChain;
  sourceAsset: SourceAsset;
  destinationChain: DestinationChain;
  amount: string;
  recipient: string;
  refundTo: string;
  deadline: string;
  dry?: boolean;
  slippageBps?: number;
  originAssetId?: string;
  destinationAssetId?: string;
  referral?: string;
};

export type NearIntentsQuotePlan = {
  rail: "near_intents";
  mode: "preview" | "executable";
  quoteId: string;
  signature: string;
  quotedAt: string;
  originAssetId: string;
  destinationAssetId: string;
  amountIn: string;
  amountInFormatted: string;
  amountOut: string;
  amountOutFormatted: string;
  minAmountOut: string;
  recipient: string;
  refundTo: string;
  depositAddress?: string;
  depositMemo?: string;
  deadline?: string;
  timeEstimateSeconds: number;
  withdrawFee?: string;
  refundFee?: string;
};

export type NearIntentsExecutionState = {
  quoteId: string;
  status: "awaiting_deposit" | "processing" | "success" | "refunded" | "failed";
  providerStatus: string;
  updatedAt: string;
  originTxids: string[];
  destinationTxids: string[];
  amountIn?: string;
  amountOut?: string;
  refundedAmount?: string;
  refundReason?: string;
};

export interface NearIntentsProvider {
  listTokens(): Promise<NearIntentsToken[]>;
  quote(input: NearIntentsQuoteInput): Promise<NearIntentsQuotePlan>;
  getStatus(depositAddress: string, depositMemo?: string): Promise<NearIntentsExecutionState>;
  submitDepositTx(input: {
    txHash: string;
    depositAddress: string;
    depositMemo?: string;
    nearSenderAccount?: string;
  }): Promise<NearIntentsExecutionState>;
}

const chainNames: Record<SourceChain | DestinationChain, string> = {
  ethereum: "eth",
  base: "base",
  arbitrum: "arb",
  optimism: "op",
  solana: "sol",
  bitcoin: "btc",
  litecoin: "ltc"
};

function safeCause(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
}

function mapStatus(response: {
  quoteResponse: { correlationId: string };
  status: string;
  updatedAt: string;
  swapDetails: {
    originChainTxHashes: Array<{ hash: string }>;
    destinationChainTxHashes: Array<{ hash: string }>;
    amountIn?: string;
    amountOut?: string;
    refundedAmount?: string;
    refundReason?: string;
  };
}): NearIntentsExecutionState {
  const providerStatus = String(response.status);
  const status =
    providerStatus === "SUCCESS"
      ? "success"
      : providerStatus === "REFUNDED"
        ? "refunded"
        : providerStatus === "FAILED"
          ? "failed"
          : providerStatus === "PROCESSING"
            ? "processing"
            : "awaiting_deposit";
  return {
    quoteId: response.quoteResponse.correlationId,
    status,
    providerStatus,
    updatedAt: response.updatedAt,
    originTxids: response.swapDetails.originChainTxHashes.map((item) => item.hash),
    destinationTxids: response.swapDetails.destinationChainTxHashes.map((item) => item.hash),
    amountIn: response.swapDetails.amountIn,
    amountOut: response.swapDetails.amountOut,
    refundedAmount: response.swapDetails.refundedAmount,
    refundReason: response.swapDetails.refundReason
  };
}

export function toAssetUnits(value: string, decimals: number): string {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new IntegrationBoundaryError("near_intents_quote_error", "Amount must be a positive decimal string");
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) {
    throw new IntegrationBoundaryError("near_intents_quote_error", `Amount exceeds ${decimals} decimal places`);
  }
  const units = BigInt(`${whole}${fraction.padEnd(decimals, "0")}`);
  if (units <= 0n) throw new IntegrationBoundaryError("near_intents_quote_error", "Amount must be greater than zero");
  return units.toString();
}

export function resolveNearIntentsAsset(
  tokens: NearIntentsToken[],
  input: { chain: SourceChain | DestinationChain; symbol: string; assetId?: string }
): NearIntentsToken {
  if (input.assetId) {
    const exact = tokens.find((token) => token.assetId === input.assetId);
    if (!exact) throw new IntegrationBoundaryError("near_intents_quote_error", `Unsupported asset id: ${input.assetId}`);
    return exact;
  }
  const matches = tokens.filter(
    (token) =>
      String(token.blockchain) === chainNames[input.chain] &&
      token.symbol.toUpperCase() === input.symbol.toUpperCase()
  );
  if (matches.length !== 1) {
    throw new IntegrationBoundaryError(
      "near_intents_quote_error",
      matches.length === 0
        ? `${input.symbol} on ${input.chain} is not supported by the current 1Click token list`
        : `${input.symbol} on ${input.chain} is ambiguous; configure an exact NEAR Intents asset id`,
      { candidateAssetIds: matches.map((token) => token.assetId) }
    );
  }
  return matches[0]!;
}

function normalizeQuote(response: QuoteResponse): NearIntentsQuotePlan {
  const { quote, quoteRequest } = response;
  return {
    rail: "near_intents",
    mode: quoteRequest.dry ? "preview" : "executable",
    quoteId: response.correlationId,
    signature: response.signature,
    quotedAt: response.timestamp,
    originAssetId: quoteRequest.originAsset,
    destinationAssetId: quoteRequest.destinationAsset,
    amountIn: quote.amountIn,
    amountInFormatted: quote.amountInFormatted,
    amountOut: quote.amountOut,
    amountOutFormatted: quote.amountOutFormatted,
    minAmountOut: quote.minAmountOut,
    recipient: quoteRequest.recipient,
    refundTo: quoteRequest.refundTo,
    depositAddress: quote.depositAddress,
    depositMemo: quote.depositMemo,
    deadline: quote.deadline,
    timeEstimateSeconds: quote.timeEstimate,
    withdrawFee: quote.withdrawFee,
    refundFee: quote.refundFee
  };
}

export class OneClickNearIntentsProvider implements NearIntentsProvider {
  constructor(private readonly options: { jwt?: string; baseUrl?: string } = {}) {}

  private configure() {
    OpenAPI.BASE = this.options.baseUrl || "https://1click.chaindefuser.com";
    OpenAPI.TOKEN = this.options.jwt;
  }

  async listTokens() {
    this.configure();
    try {
      return await OneClickService.getTokens();
    } catch (error) {
      throw new IntegrationBoundaryError("near_intents_quote_error", "Unable to load the live NEAR Intents token list", safeCause(error));
    }
  }

  async quote(input: NearIntentsQuoteInput) {
    this.configure();
    if (!input.dry && !this.options.jwt) {
      throw new IntegrationBoundaryError("near_intents_quote_error", "NEAR_INTENTS_JWT is required for an executable quote");
    }
    try {
      const tokens = await this.listTokens();
      const origin = resolveNearIntentsAsset(tokens, {
        chain: input.sourceChain,
        symbol: input.sourceAsset,
        assetId: input.originAssetId
      });
      const destination = resolveNearIntentsAsset(tokens, {
        chain: input.destinationChain,
        symbol: input.destinationChain === "bitcoin" ? "BTC" : "LTC",
        assetId: input.destinationAssetId
      });
      const response = await OneClickService.getQuote({
        dry: input.dry ?? false,
        swapType: QuoteRequest.swapType.EXACT_INPUT,
        slippageTolerance: input.slippageBps ?? 100,
        originAsset: origin.assetId,
        depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
        destinationAsset: destination.assetId,
        amount: toAssetUnits(input.amount, origin.decimals),
        refundTo: input.refundTo,
        refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
        recipient: input.recipient,
        recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
        deadline: input.deadline,
        referral: input.referral
      });
      return normalizeQuote(response);
    } catch (error) {
      if (error instanceof IntegrationBoundaryError) throw error;
      throw new IntegrationBoundaryError("near_intents_quote_error", "NEAR Intents quote failed", safeCause(error));
    }
  }

  async getStatus(depositAddress: string, depositMemo?: string) {
    this.configure();
    try {
      return mapStatus(await OneClickService.getExecutionStatus(depositAddress, depositMemo));
    } catch (error) {
      throw new IntegrationBoundaryError("near_intents_status_error", "Unable to read NEAR Intents execution status", safeCause(error));
    }
  }

  async submitDepositTx(input: {
    txHash: string;
    depositAddress: string;
    depositMemo?: string;
    nearSenderAccount?: string;
  }) {
    this.configure();
    try {
      return mapStatus(
        await OneClickService.submitDepositTx({
          txHash: input.txHash,
          depositAddress: input.depositAddress,
          memo: input.depositMemo,
          nearSenderAccount: input.nearSenderAccount
        })
      );
    } catch (error) {
      throw new IntegrationBoundaryError("near_intents_status_error", "Unable to register the deposit transaction", safeCause(error));
    }
  }
}

export function assertExecutableNearIntentsQuote(plan: NearIntentsQuotePlan, now = new Date()) {
  if (plan.mode !== "executable" || !plan.depositAddress || !plan.deadline) {
    throw new IntegrationBoundaryError("near_intents_quote_error", "Quote is preview-only and cannot receive funds");
  }
  if (Date.parse(plan.deadline) <= now.getTime()) {
    throw new IntegrationBoundaryError("near_intents_quote_error", "Quote is stale; request a fresh quote before wallet approval");
  }
}
