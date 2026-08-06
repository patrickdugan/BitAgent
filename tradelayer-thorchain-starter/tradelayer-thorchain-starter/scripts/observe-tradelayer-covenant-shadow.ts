import fs from "node:fs/promises";
import path from "node:path";
import { materializeTradeLayerShadowFeed } from "../src/mandates/shadowFeeder.js";
import { FileTradeLayerShadowCaptureStore } from "../src/mandates/shadowStore.js";
import type { TradeLayerRiskCheckpoint, TradeLayerShadowConfig } from "../src/mandates/shadowTypes.js";
import { TradeLayerWalletListenerShadowSource } from "../src/mandates/tradelayerShadowSource.js";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(name: string, fallback?: number) {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${name} must be a non-negative integer`);
  return Number(value);
}

const riskPath = path.resolve(required("TL_SHADOW_RISK_CHECKPOINT"));
const config: TradeLayerShadowConfig = {
  endpoint: required("TL_SHADOW_ENDPOINT"),
  providerNodeId: required("TL_SHADOW_PROVIDER_NODE_ID"),
  network: "testnet4",
  walletAddress: required("TL_SHADOW_WALLET_ADDRESS"),
  channelId: required("TL_SHADOW_CHANNEL_ID"),
  tlbtcPropertyId: integer("TL_SHADOW_TLBTC_PROPERTY_ID"),
  tlusdPropertyId: integer("TL_SHADOW_TLUSD_PROPERTY_ID"),
  oracleId: integer("TL_SHADOW_ORACLE_ID"),
  oraclePolicy: required("TL_SHADOW_ORACLE_POLICY"),
  maxSourceAgeMs: integer("TL_SHADOW_MAX_SOURCE_AGE_MS", 2_000),
  maxSyncLagBlocks: integer("TL_SHADOW_MAX_SYNC_LAG_BLOCKS", 1),
  maxOracleLagBlocks: integer("TL_SHADOW_MAX_ORACLE_LAG_BLOCKS", 1),
  maxRiskLagBlocks: integer("TL_SHADOW_MAX_RISK_LAG_BLOCKS", 1),
  timeoutMs: integer("TL_SHADOW_TIMEOUT_MS", 5_000),
  maxResponseBytes: integer("TL_SHADOW_MAX_RESPONSE_BYTES", 1_000_000)
};
const riskCheckpoint = JSON.parse(await fs.readFile(riskPath, "utf8")) as TradeLayerRiskCheckpoint;
const source = new TradeLayerWalletListenerShadowSource();
const capture = await source.capture(config);
const store = new FileTradeLayerShadowCaptureStore(path.resolve(".runtime", "strategy-covenant", "shadow-captures"));
await store.save(capture);
const feed = materializeTradeLayerShadowFeed({ capture, riskCheckpoint, config, now: new Date() });

console.log(JSON.stringify({
  mode: "live_read_only_shadow",
  feed,
  persistedCaptureHash: capture.captureHash,
  rawResponsesDisplayed: false,
  signingPerformed: false,
  broadcastPerformed: false
}, null, 2));
