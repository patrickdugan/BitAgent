import { hashObject } from "../launch/canonical.js";
import { StrategyMandateError } from "./errors.js";
import type {
  TradeLayerRiskCheckpoint,
  TradeLayerShadowCapture,
  TradeLayerShadowConfig,
  TradeLayerShadowFeed
} from "./shadowTypes.js";
import { validateTradeLayerShadowCapture, validateTradeLayerShadowConfig } from "./tradelayerShadowSource.js";
import { createMarketSnapshot, createPortfolioState } from "./validator.js";

const HASH = /^[0-9a-f]{64}$/;
const SECRET_FIELD = /(private.?key|seed.?phrase|mnemonic|\bwif\b|api.?secret|secret.?key|password|authorization)/i;

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StrategyMandateError("shadow_state_invalid", `${label} must be an object`);
  }
  return value as JsonRecord;
}

function rejectSecrets(value: unknown, path = "input") {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectSecrets(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as JsonRecord)) {
    if (SECRET_FIELD.test(key)) {
      throw new StrategyMandateError("secret_material_prohibited", `Secret-bearing field is prohibited: ${path}.${key}`);
    }
    rejectSecrets(item, `${path}.${key}`);
  }
}

function safeInteger(value: unknown, label: string, minimum = 0) {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < minimum) {
    throw new StrategyMandateError("shadow_state_invalid", `${label} must be a safe integer`);
  }
  return Number(parsed);
}

function timestamp(value: unknown, label: string) {
  const parsed = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new StrategyMandateError("shadow_state_invalid", `${label} timestamp is invalid`);
  return Number(parsed);
}

function assertFresh(value: unknown, label: string, now: Date, maxAgeMs: number) {
  const observed = timestamp(value, label);
  const age = now.getTime() - observed;
  if (age < 0 || age > maxAgeMs) {
    throw new StrategyMandateError("shadow_state_stale", `${label} is stale or future-dated`);
  }
}

function tokenAtoms(value: unknown, label: string) {
  let text: string;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) text = value.toFixed(8);
  else text = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,8})?$/.test(text)) {
    throw new StrategyMandateError("shadow_state_invalid", `${label} must be a non-negative decimal with at most 8 places`);
  }
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 100_000_000n + BigInt((fraction + "00000000").slice(0, 8));
}

function priceCents(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new StrategyMandateError("shadow_state_invalid", `${label} must be a positive price`);
  }
  return BigInt(Math.round(parsed * 100));
}

function formatCents(value: bigint) {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

function responseArray(value: unknown, label: string): unknown[] {
  if (Array.isArray(value)) return value;
  const outer = record(value, label);
  if (Array.isArray(outer.data)) return outer.data;
  if (Array.isArray(outer.result)) return outer.result;
  throw new StrategyMandateError("shadow_state_invalid", `${label} must contain an array`);
}

function networkChain(value: unknown): string {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    const row = record(current, "network response");
    if (typeof row.chain === "string") return row.chain;
    if (row.data !== undefined) current = row.data;
    else if (row.result !== undefined) current = row.result;
    else break;
  }
  throw new StrategyMandateError("shadow_state_invalid", "Network response is missing chain identity");
}

type SyncState = { chainTip: number; indexedHeight: number; processedHeight: number; updatedAt: number };

function syncState(value: unknown, label: string, config: TradeLayerShadowConfig, now: Date): SyncState {
  const row = record(value, label);
  const chainTip = safeInteger(row.chainTip, `${label}.chainTip`);
  const indexedHeight = safeInteger(row.indexedHeight, `${label}.indexedHeight`);
  const processedHeight = safeInteger(row.processedHeight, `${label}.processedHeight`);
  if (row.initialized !== true || row.phase !== "realtime" || (row.error !== null && row.error !== undefined && row.error !== "")) {
    throw new StrategyMandateError("shadow_state_stale", `${label} is not a healthy realtime listener`);
  }
  assertFresh(row.updatedAt, `${label}.updatedAt`, now, config.maxSourceAgeMs);
  if (chainTip - Math.min(indexedHeight, processedHeight) > config.maxSyncLagBlocks) {
    throw new StrategyMandateError("shadow_state_stale", `${label} exceeds the configured listener lag`);
  }
  if (indexedHeight > chainTip || processedHeight > chainTip) {
    throw new StrategyMandateError("shadow_state_conflict", `${label} reports a listener height ahead of the chain tip`);
  }
  return { chainTip, indexedHeight, processedHeight, updatedAt: timestamp(row.updatedAt, `${label}.updatedAt`) };
}

function selectedBalance(input: {
  rows: unknown[];
  propertyId: number;
  asset: string;
}) {
  const candidates = input.rows.filter((item) => Number(record(item, "balance row").propertyId) === input.propertyId);
  if (candidates.length !== 1) {
    throw new StrategyMandateError("shadow_state_invalid", `Expected exactly one ${input.asset} balance row`);
  }
  const row = record(candidates[0], `${input.asset} balance`);
  const amount = tokenAtoms(row.amount, `${input.asset}.amount`);
  const components = ["available", "reserved", "margin", "channel"].map((key) => tokenAtoms(row[key] ?? 0, `${input.asset}.${key}`));
  if (components.reduce((sum, item) => sum + item, 0n) !== amount) {
    throw new StrategyMandateError("shadow_state_conflict", `${input.asset} balance components do not equal total amount`);
  }
  return amount.toString();
}

export function createBalanceSnapshotHash(input: {
  network: "testnet4";
  walletAddress: string;
  tlbtcPropertyId: number;
  tlusdPropertyId: number;
  tlbtcSats: string;
  tlusdAtoms: string;
  sourceHeight: number;
}) {
  return hashObject(input);
}

export function riskCheckpointCore(checkpoint: TradeLayerRiskCheckpoint) {
  const { checkpointHash: _hash, ...core } = checkpoint;
  return core;
}

export function createTradeLayerRiskCheckpoint(input: Omit<TradeLayerRiskCheckpoint, "checkpointHash">) {
  return validateTradeLayerRiskCheckpoint({ ...structuredClone(input), checkpointHash: hashObject(input) });
}

export function validateTradeLayerRiskCheckpoint(raw: TradeLayerRiskCheckpoint) {
  rejectSecrets(raw);
  if (raw.schema !== "bitagent_tradelayer_risk_checkpoint_v1" || raw.network !== "testnet4"
    || !raw.walletAddress || !raw.channelId || !raw.sourceId || !HASH.test(raw.balanceSnapshotHash)
    || !HASH.test(raw.checkpointHash) || hashObject(riskCheckpointCore(raw)) !== raw.checkpointHash) {
    throw new StrategyMandateError("shadow_state_invalid", "Risk checkpoint fingerprint is invalid");
  }
  for (const [key, value] of Object.entries({
    currentNetDeltaBps: raw.currentNetDeltaBps,
    grossLeverageBps: raw.grossLeverageBps,
    dailyLossBps: raw.dailyLossBps,
    drawdownBps: raw.drawdownBps,
    nonce: raw.nonce,
    sourceHeight: raw.sourceHeight
  })) {
    if (!Number.isSafeInteger(value) || (key !== "currentNetDeltaBps" && value < 0)) {
      throw new StrategyMandateError("shadow_state_invalid", `Risk checkpoint ${key} is invalid`);
    }
  }
  if (Math.abs(raw.currentNetDeltaBps) > 10_000 || !Number.isFinite(Date.parse(raw.observedAt))) {
    throw new StrategyMandateError("shadow_state_invalid", "Risk checkpoint values are invalid");
  }
  return structuredClone(raw);
}

function normalizeBook(input: {
  value: unknown;
  tlbtcPropertyId: number;
  tlusdPropertyId: number;
}) {
  const book = record(input.value, "orderbook");
  if (!Array.isArray(book.buy) || !Array.isArray(book.sell) || book.buy.length === 0 || book.sell.length === 0) {
    throw new StrategyMandateError("shadow_state_invalid", "Orderbook must contain both buy and sell liquidity");
  }
  const normalize = (item: unknown, side: "buy" | "sell") => {
    const row = record(item, `${side} order`);
    const offeredId = safeInteger(row.offeredPropertyId, `${side}.offeredPropertyId`, 1);
    const desiredId = safeInteger(row.desiredPropertyId, `${side}.desiredPropertyId`, 1);
    const expectedOffered = side === "buy" ? input.tlusdPropertyId : input.tlbtcPropertyId;
    const expectedDesired = side === "buy" ? input.tlbtcPropertyId : input.tlusdPropertyId;
    if (offeredId !== expectedOffered || desiredId !== expectedDesired) {
      throw new StrategyMandateError("shadow_state_conflict", `${side} order property orientation is inconsistent`);
    }
    const offeredAtoms = tokenAtoms(row.amountOffered, `${side}.amountOffered`);
    const expectedAtoms = tokenAtoms(row.amountExpected, `${side}.amountExpected`);
    const btcSats = side === "buy" ? expectedAtoms : offeredAtoms;
    const usdAtoms = side === "buy" ? offeredAtoms : expectedAtoms;
    if (btcSats <= 0n || usdAtoms <= 0n) throw new StrategyMandateError("shadow_state_invalid", `${side} order amount is zero`);
    const cents = (usdAtoms * 100n + btcSats / 2n) / btcSats;
    return { cents, sizeSats: btcSats.toString() };
  };
  const bids = book.buy.map((item) => normalize(item, "buy")).sort((left, right) => left.cents > right.cents ? -1 : 1);
  const asks = book.sell.map((item) => normalize(item, "sell")).sort((left, right) => left.cents < right.cents ? -1 : 1);
  if (bids[0]!.cents >= asks[0]!.cents) throw new StrategyMandateError("shadow_state_conflict", "Orderbook is locked or crossed");
  return { bid: bids[0]!.cents, ask: asks[0]!.cents };
}

function oracleMark(value: unknown, oracleId: number, observedHeight: number, maxLag: number) {
  const oracles = responseArray(value, "oracles");
  const matches = oracles.filter((item) => {
    const row = record(item, "oracle");
    return Number(row.id ?? String(row._id || "").replace(/^oracle-/, "")) === oracleId;
  });
  if (matches.length !== 1) throw new StrategyMandateError("shadow_state_invalid", "Configured oracle is missing or ambiguous");
  const oracle = record(matches[0], "oracle");
  const publishedHeight = safeInteger(oracle.lastPublishedBlock, "oracle.lastPublishedBlock");
  if (publishedHeight > observedHeight || observedHeight - publishedHeight > maxLag) {
    throw new StrategyMandateError("shadow_state_stale", "Oracle observation is stale or ahead of listener state");
  }
  return priceCents(record(oracle.data, "oracle.data").price, "oracle.data.price");
}

export function materializeTradeLayerShadowFeed(input: {
  capture: TradeLayerShadowCapture;
  riskCheckpoint: TradeLayerRiskCheckpoint;
  config: TradeLayerShadowConfig;
  now?: Date;
}): TradeLayerShadowFeed {
  const now = input.now || new Date();
  const configuredEndpoint = validateTradeLayerShadowConfig(input.config);
  const capture = validateTradeLayerShadowCapture(input.capture);
  const risk = validateTradeLayerRiskCheckpoint(input.riskCheckpoint);
  rejectSecrets(input.config);
  if (capture.sourceId !== configuredEndpoint || capture.query.network !== input.config.network
    || capture.query.providerNodeId !== input.config.providerNodeId
    || capture.query.walletAddress !== input.config.walletAddress || capture.query.channelId !== input.config.channelId
    || capture.query.tlbtcPropertyId !== input.config.tlbtcPropertyId
    || capture.query.tlusdPropertyId !== input.config.tlusdPropertyId || capture.query.oracleId !== input.config.oracleId) {
    throw new StrategyMandateError("shadow_state_conflict", "Capture query does not match the approved shadow configuration");
  }
  assertFresh(capture.capturedAt, "capture.capturedAt", now, input.config.maxSourceAgeMs);
  if (networkChain(capture.responses.network) !== input.config.network) {
    throw new StrategyMandateError("shadow_state_conflict", "Bitcoin RPC network does not match testnet4");
  }
  const before = syncState(capture.responses.syncBefore, "syncBefore", input.config, now);
  const after = syncState(capture.responses.syncAfter, "syncAfter", input.config, now);
  if (before.chainTip !== after.chainTip || before.indexedHeight !== after.indexedHeight
    || before.processedHeight !== after.processedHeight) {
    throw new StrategyMandateError("shadow_state_conflict", "TradeLayer listener advanced during the multi-source capture");
  }
  const rows = responseArray(capture.responses.balances, "balances");
  const tlbtcSats = selectedBalance({ rows, propertyId: input.config.tlbtcPropertyId, asset: "tlBTC" });
  const tlusdAtoms = selectedBalance({ rows, propertyId: input.config.tlusdPropertyId, asset: "tlUSD" });
  const balanceSnapshotHash = createBalanceSnapshotHash({
    network: input.config.network,
    walletAddress: input.config.walletAddress,
    tlbtcPropertyId: input.config.tlbtcPropertyId,
    tlusdPropertyId: input.config.tlusdPropertyId,
    tlbtcSats,
    tlusdAtoms,
    sourceHeight: after.processedHeight
  });
  assertFresh(risk.observedAt, "riskCheckpoint.observedAt", now, input.config.maxSourceAgeMs);
  if (risk.network !== input.config.network || risk.walletAddress !== input.config.walletAddress
    || risk.channelId !== input.config.channelId || risk.balanceSnapshotHash !== balanceSnapshotHash) {
    throw new StrategyMandateError("shadow_state_conflict", "Risk checkpoint is not bound to the observed wallet balance state");
  }
  if (risk.sourceHeight > after.processedHeight || after.processedHeight - risk.sourceHeight > input.config.maxRiskLagBlocks) {
    throw new StrategyMandateError("shadow_state_stale", "Risk checkpoint height is stale or ahead of listener state");
  }
  const book = normalizeBook({
    value: capture.responses.orderbook,
    tlbtcPropertyId: input.config.tlbtcPropertyId,
    tlusdPropertyId: input.config.tlusdPropertyId
  });
  const mark = oracleMark(capture.responses.oracles, input.config.oracleId, after.processedHeight, input.config.maxOracleLagBlocks);
  if (mark < book.bid || mark > book.ask) {
    throw new StrategyMandateError("shadow_state_conflict", "Oracle mark is outside the executable spread");
  }
  const marketObservedAt = capture.capturedAt;
  const portfolioObservedAt = risk.observedAt;
  const observedAt = new Date(Math.min(Date.parse(marketObservedAt), Date.parse(portfolioObservedAt))).toISOString();
  const market = createMarketSnapshot({
    schema: "bitagent_strategy_market_snapshot_v1",
    pair: "TLBTC/TLUSD",
    bidPriceUsd: formatCents(book.bid),
    askPriceUsd: formatCents(book.ask),
    markPriceUsd: formatCents(mark),
    oraclePolicy: input.config.oraclePolicy,
    observedAt: marketObservedAt,
    source: `tradelayer-wallet-listener:${capture.captureHash}`
  });
  const portfolio = createPortfolioState({
    schema: "bitagent_strategy_portfolio_v1",
    channelId: input.config.channelId,
    capitalAtoms: tlusdAtoms,
    currentNetDeltaBps: risk.currentNetDeltaBps,
    grossLeverageBps: risk.grossLeverageBps,
    dailyLossBps: risk.dailyLossBps,
    drawdownBps: risk.drawdownBps,
    nonce: risk.nonce,
    observedAt: portfolioObservedAt,
  });
  const evidence = {
    networkHash: capture.responseHashes.network,
    syncBeforeHash: capture.responseHashes.syncBefore,
    syncAfterHash: capture.responseHashes.syncAfter,
    orderbookHash: capture.responseHashes.orderbook,
    balancesHash: capture.responseHashes.balances,
    oraclesHash: capture.responseHashes.oracles,
    balanceSnapshotHash
  };
  const core = {
    schema: "bitagent_tradelayer_shadow_feed_v1" as const,
    captureHash: capture.captureHash,
    riskCheckpointHash: risk.checkpointHash,
    observedHeight: after.processedHeight,
    observedAt,
    evidence,
    market,
    portfolio,
    authority: "read_only_observer" as const,
    effect: "none" as const,
    nextAuthority: "deterministic_host" as const,
    signingPerformed: false as const,
    broadcastPerformed: false as const
  };
  return { ...core, feedRoot: hashObject(core) };
}

export async function readTradeLayerShadowFeed(input: {
  source: { capture(config: TradeLayerShadowConfig, now?: Date): Promise<TradeLayerShadowCapture> };
  riskCheckpoint: TradeLayerRiskCheckpoint;
  config: TradeLayerShadowConfig;
  now?: Date;
}) {
  const capture = await input.source.capture(input.config, input.now);
  return { capture, feed: materializeTradeLayerShadowFeed({ ...input, capture }) };
}
