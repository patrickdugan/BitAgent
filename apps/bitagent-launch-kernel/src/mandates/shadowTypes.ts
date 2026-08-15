import type { StrategyMarketSnapshot, StrategyPortfolioState } from "./types.js";

export type TradeLayerShadowConfig = {
  endpoint: string;
  providerNodeId: string;
  network: "testnet4";
  walletAddress: string;
  channelId: string;
  tlbtcPropertyId: number;
  tlusdPropertyId: number;
  oracleId: number;
  oraclePolicy: string;
  maxSourceAgeMs: number;
  maxSyncLagBlocks: number;
  maxOracleLagBlocks: number;
  maxRiskLagBlocks: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export type TradeLayerRiskCheckpoint = {
  schema: "bitagent_tradelayer_risk_checkpoint_v1";
  network: "testnet4";
  walletAddress: string;
  channelId: string;
  balanceSnapshotHash: string;
  currentNetDeltaBps: number;
  grossLeverageBps: number;
  dailyLossBps: number;
  drawdownBps: number;
  nonce: number;
  sourceHeight: number;
  observedAt: string;
  sourceId: string;
  checkpointHash: string;
};

export type TradeLayerShadowCapture = {
  schema: "bitagent_tradelayer_shadow_capture_v1";
  sourceId: string;
  capturedAt: string;
  query: {
    network: "testnet4";
    providerNodeId: string;
    walletAddress: string;
    channelId: string;
    tlbtcPropertyId: number;
    tlusdPropertyId: number;
    oracleId: number;
  };
  responses: {
    syncBefore: unknown;
    network: unknown;
    orderbook: unknown;
    balances: unknown;
    oracles: unknown;
    syncAfter: unknown;
  };
  responseHashes: {
    syncBefore: string;
    network: string;
    orderbook: string;
    balances: string;
    oracles: string;
    syncAfter: string;
  };
  authority: "read_only_observer";
  effect: "none";
  captureHash: string;
};

export type TradeLayerShadowFeed = {
  schema: "bitagent_tradelayer_shadow_feed_v1";
  captureHash: string;
  riskCheckpointHash: string;
  observedHeight: number;
  observedAt: string;
  evidence: {
    networkHash: string;
    syncBeforeHash: string;
    syncAfterHash: string;
    orderbookHash: string;
    balancesHash: string;
    oraclesHash: string;
    balanceSnapshotHash: string;
  };
  market: StrategyMarketSnapshot;
  portfolio: StrategyPortfolioState;
  authority: "read_only_observer";
  effect: "none";
  nextAuthority: "deterministic_host";
  signingPerformed: false;
  broadcastPerformed: false;
  feedRoot: string;
};

export interface TradeLayerShadowSource {
  capture(config: TradeLayerShadowConfig, now?: Date): Promise<TradeLayerShadowCapture>;
}
