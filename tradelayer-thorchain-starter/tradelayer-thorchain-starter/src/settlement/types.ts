export type SettlementLifecycleState =
  | "planned"
  | "broadcast"
  | "mempool"
  | "confirmed"
  | "matched"
  | "settled"
  | "reorged";

export type BitcoinTransactionEvidence = {
  txid: string;
  state: "missing" | "mempool" | "confirmed" | "reorged";
  confirmations: number;
  blockHash?: string;
  payloadHex?: string;
  observedAt: string;
  source: string;
};

export interface BitcoinChainSource {
  observeTransaction(txid: string): Promise<BitcoinTransactionEvidence>;
}

export type DecodedTokenTrade = {
  propertyIdOffered: number;
  propertyIdDesired: number;
  amountOffered: number;
  amountExpected: number;
  stop: boolean;
  post: boolean;
};

export type TradeLegSettlement = {
  side: "maker" | "taker";
  txid?: string;
  transitions: SettlementLifecycleState[];
  state: SettlementLifecycleState;
  expectedPayloadHex: string;
  observedPayloadHex?: string;
  payloadMatches: boolean;
  confirmations: number;
  decoded?: DecodedTokenTrade;
  evidence?: BitcoinTransactionEvidence;
};

export type TradePairSettlement = {
  tradePrintId: string;
  price: string;
  transitions: SettlementLifecycleState[];
  state: SettlementLifecycleState;
  maker: TradeLegSettlement;
  taker: TradeLegSettlement;
  reciprocalMatch: boolean;
  settlementEvidenceHash?: string;
};

export type TradeLayerSettlementReport = {
  observedAt: string;
  minimumConfirmations: number;
  pairs: TradePairSettlement[];
  allSettled: boolean;
  settledPairCount: number;
  reportHash: string;
};

export type TradeLayerBalanceRow = {
  propertyId: string | number;
  ticker?: string;
  available: string | number;
  reserved?: string | number;
  margin?: string | number;
};

export type TradeLayerPnlEvidence = {
  schema: "tradelayer_balance_delta_pnl_v1";
  agentAddress: string;
  before: TradeLayerBalanceRow[];
  after: TradeLayerBalanceRow[];
  valuationPriceUsd: number;
  feesSats: string;
  settledPnlSats: string;
  transactionIds: string[];
  observedAt: string;
  source: string;
  evidenceHash: string;
};
