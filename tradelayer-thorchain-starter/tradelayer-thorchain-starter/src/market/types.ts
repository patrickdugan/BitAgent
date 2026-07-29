export type OrderBookLevel = { price: number; sizeSats: string };

export type TradeLayerOrderBookSnapshot = {
  pair: "BTCUSD";
  sequence: number;
  observedAt: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  sourceHash: string;
};

export type MarketRiskState = {
  inventorySats: string;
  realizedPnlSats: string;
  dailyDrawdownSats: string;
  openExposureSats: string;
};

export type MarketStrategyConfig = {
  strategy: "fixed_spread" | "vwap_reversion" | "bounded_market_making";
  quoteSizeSats: string;
  spreadBps: number;
  maxInventorySats: string;
  maxExposureSats: string;
  maxDailyDrawdownSats: string;
  maxSlippageBps: number;
  repriceThresholdBps: number;
};

export type ProposedMarketOrder = {
  orderId: string;
  side: "buy" | "sell";
  price: number;
  sizeSats: string;
  expiresAt: string;
  proposalHash: string;
};

export type MarketAgentDecision = {
  mode: "shadow";
  decision: "quote" | "hold" | "cancel_all";
  reasonCodes: string[];
  referenceMid: number;
  proposedOrders: ProposedMarketOrder[];
  cancelOrderIds: string[];
  riskFingerprint: string;
};

export type ShadowOutcome = {
  proposalHash: string;
  wouldFill: boolean;
  observedPrice: number;
  priceErrorBps: number;
  hypotheticalPnlSats: string;
  evidenceHash: string;
};

