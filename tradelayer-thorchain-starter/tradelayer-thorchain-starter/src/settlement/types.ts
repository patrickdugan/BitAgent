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

export type BitcoinWithdrawalOutput = {
  vout: number;
  valueSats: string;
  scriptPubKeyHex: string;
  address?: string;
};

export type BitcoinWithdrawalObservation = {
  txid: string;
  network: "bitcoin" | "bitcoin-testnet4";
  state: "missing" | "mempool" | "confirmed" | "reorged";
  confirmations: number;
  blockHash?: string;
  outputs: BitcoinWithdrawalOutput[];
  feeSats?: string;
  walletNetDebitSats?: string;
  observedAt: string;
  source: string;
};

export interface BitcoinWithdrawalReadSource {
  readonly source: string;
  readonly network: "bitcoin" | "bitcoin-testnet4";
  observeWithdrawal(txid: string): Promise<BitcoinWithdrawalObservation>;
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

export type TradeLayerBalanceSnapshot = {
  schema: "tradelayer_balance_snapshot_v1";
  address: string;
  observedAt: string;
  source: string;
  rows: TradeLayerBalanceRow[];
  snapshotHash: string;
};

export type TradeLayerPnlEvidence = {
  schema: "tradelayer_balance_delta_pnl_v2";
  agentAddress: string;
  beforeSnapshot: TradeLayerBalanceSnapshot;
  afterSnapshot: TradeLayerBalanceSnapshot;
  valuationPriceUsd: string;
  valuationSource: string;
  feesSats: string;
  settledPnlSats: string;
  transactionIds: string[];
  observedAt: string;
  source: string;
  evidenceHash: string;
};
