import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";
import type {
  MarketAgentDecision,
  MarketRiskState,
  MarketStrategyConfig,
  ProposedMarketOrder,
  ShadowOutcome,
  TradeLayerOrderBookSnapshot
} from "./types.js";

function sats(value: string, field: string): bigint {
  if (!/^-?(0|[1-9][0-9]*)$/.test(value)) throw new IntegrationBoundaryError("market_risk_error", `${field} must be an integer string`);
  return BigInt(value);
}

function order(input: Omit<ProposedMarketOrder, "proposalHash">): ProposedMarketOrder {
  return { ...input, proposalHash: canonicalHash(input) };
}

export function proposeShadowMarketOrders(input: {
  book: TradeLayerOrderBookSnapshot;
  risk: MarketRiskState;
  config: MarketStrategyConfig;
  existingOrders?: ProposedMarketOrder[];
  now?: Date;
}): MarketAgentDecision {
  const bestBid = input.book.bids[0]?.price;
  const bestAsk = input.book.asks[0]?.price;
  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk) || bestBid! <= 0 || bestAsk! <= bestBid!) {
    throw new IntegrationBoundaryError("market_risk_error", "Order book is crossed, empty, or invalid");
  }
  const inventory = sats(input.risk.inventorySats, "inventorySats");
  const exposure = sats(input.risk.openExposureSats, "openExposureSats");
  const drawdown = sats(input.risk.dailyDrawdownSats, "dailyDrawdownSats");
  const maxInventory = sats(input.config.maxInventorySats, "maxInventorySats");
  const maxExposure = sats(input.config.maxExposureSats, "maxExposureSats");
  const maxDrawdown = sats(input.config.maxDailyDrawdownSats, "maxDailyDrawdownSats");
  const referenceMid = (bestBid! + bestAsk!) / 2;
  const riskFingerprint = canonicalHash({ risk: input.risk, config: input.config, bookHash: input.book.sourceHash });

  if (drawdown >= maxDrawdown || exposure >= maxExposure || (inventory < 0n ? -inventory : inventory) >= maxInventory) {
    return {
      mode: "shadow",
      decision: "cancel_all",
      reasonCodes: [drawdown >= maxDrawdown ? "daily_drawdown_limit" : exposure >= maxExposure ? "exposure_limit" : "inventory_limit"],
      referenceMid,
      proposedOrders: [],
      cancelOrderIds: (input.existingOrders || []).map((existing) => existing.orderId),
      riskFingerprint
    };
  }

  const inventoryRatio = maxInventory === 0n ? 0 : Number(inventory * 10_000n / maxInventory) / 10_000;
  const skewBps = inventoryRatio * input.config.spreadBps;
  const halfSpread = input.config.spreadBps / 2;
  const bidPrice = Math.floor(referenceMid * (1 - (halfSpread + skewBps) / 10_000));
  const askPrice = Math.ceil(referenceMid * (1 + (halfSpread - skewBps) / 10_000));
  const expiresAt = new Date((input.now || new Date()).getTime() + 60_000).toISOString();
  const proposedOrders = [
    order({ orderId: `shadow-buy-${input.book.sequence}`, side: "buy", price: bidPrice, sizeSats: input.config.quoteSizeSats, expiresAt }),
    order({ orderId: `shadow-sell-${input.book.sequence}`, side: "sell", price: askPrice, sizeSats: input.config.quoteSizeSats, expiresAt })
  ];
  const existing = input.existingOrders || [];
  const cancelOrderIds = existing.filter((current) => {
    const replacement = proposedOrders.find((candidate) => candidate.side === current.side);
    return !replacement || Math.abs(replacement.price - current.price) * 10_000 / referenceMid >= input.config.repriceThresholdBps;
  }).map((current) => current.orderId);
  return {
    mode: "shadow",
    decision: "quote",
    reasonCodes: ["risk_limits_passed", "shadow_mode_only"],
    referenceMid,
    proposedOrders,
    cancelOrderIds,
    riskFingerprint
  };
}

export function evaluateShadowOutcome(input: {
  order: ProposedMarketOrder;
  nextBook: TradeLayerOrderBookSnapshot;
}): ShadowOutcome {
  const observedPrice = input.order.side === "buy" ? input.nextBook.asks[0]?.price : input.nextBook.bids[0]?.price;
  if (!Number.isFinite(observedPrice)) throw new IntegrationBoundaryError("market_risk_error", "Follow-up book is missing executable prices");
  const wouldFill = input.order.side === "buy" ? observedPrice! <= input.order.price : observedPrice! >= input.order.price;
  const priceErrorBps = Math.round(Math.abs(observedPrice! - input.order.price) * 10_000 / input.order.price);
  const signedEdge = input.order.side === "buy" ? observedPrice! - input.order.price : input.order.price - observedPrice!;
  const hypotheticalPnl = wouldFill
    ? (BigInt(input.order.sizeSats) * BigInt(Math.trunc(signedEdge))) / BigInt(Math.trunc(input.order.price))
    : 0n;
  const material = { proposalHash: input.order.proposalHash, nextBookHash: input.nextBook.sourceHash, wouldFill, observedPrice };
  return {
    proposalHash: input.order.proposalHash,
    wouldFill,
    observedPrice: observedPrice!,
    priceErrorBps,
    hypotheticalPnlSats: hypotheticalPnl.toString(),
    evidenceHash: canonicalHash(material)
  };
}
