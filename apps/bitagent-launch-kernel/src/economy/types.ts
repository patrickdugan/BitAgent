import type { NearChainSignaturePreparation } from "../adapters/nearChainSignatureAdapter.js";
import type { PolicyDecision, SpendIntent } from "../survival/types.js";

export type TradeLayerTestnetTradePrint = {
  id: string;
  price: string;
  baseAmountSats: string;
  quoteAmountMicrousd: string;
  makerTxid: string | null;
  takerTxid: string | null;
};

export type TradeLayerTestnetArtifact = {
  kind: "tradelayer_btctest_vwap_trade_history";
  network: "BTCTEST";
  bitcoinNetwork: "testnet4";
  adminAddress: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  steps: Array<{ label: string; phase: string; txid: string | null; [key: string]: unknown }>;
  tradePrints: TradeLayerTestnetTradePrint[];
  vwap: Record<string, unknown>;
};

export type TradeLayerTestnetRun = {
  mode: "testnet_dry_run";
  artifactPath: string;
  artifact: TradeLayerTestnetArtifact;
  transactionIds: string[];
  settlementStatus: "unsettled" | "settled";
};

export type InfrastructureProvider = "filecoin" | "akash" | "bacalhau" | "golem" | "generic";

export type InfrastructureQuote = {
  quoteId: string;
  provider: InfrastructureProvider;
  service: "storage" | "compute";
  mode: "mock" | "calibration" | "prepared";
  policyCostSats: string;
  providerPrice: { amount: string; denomination: string };
  expiresAt: string;
  quoteHash: string;
};

export type InfrastructurePlan = {
  provider: InfrastructureProvider;
  status: "mock" | "prepared";
  quote: InfrastructureQuote;
  payload: Record<string, unknown>;
  payloadHash: string;
  submitAuthority: "external_capability_broker";
};

export type ChainAbstractionEnvelope = {
  envelopeId: string;
  targetChain: "bitcoin" | "litecoin" | "ethereum" | "solana" | "filecoin" | "akash";
  actionType: string;
  payloadHash: string;
  relayable: false;
  signaturePreparation?: NearChainSignaturePreparation;
  status: "unsigned" | "signature_prepared";
};

export type EconomicProjection = {
  scenario: "mock_spread_capture";
  positionSats: string;
  entryPrice: number;
  exitPrice: number;
  projectedGrossRevenueSats: string;
  projectedTradingFeesSats: string;
  projectedInfrastructureCostSats: string;
  projectedOperatingMarginSats: string;
  projectedCoverageBps: number;
  projectedSelfSustaining: boolean;
  settledRevenueSats: string;
  spendableProfitSats: string;
  note: string;
};

export type InfrastructureAuthorization = {
  intent: SpendIntent;
  decision: PolicyDecision;
};
