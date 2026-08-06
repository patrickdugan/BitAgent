import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { hashObject } from "../src/launch/canonical.js";
import { buildStrategyCandidate } from "../src/mandates/allocator.js";
import { createStrategyBenchmarkScenario } from "../src/mandates/benchmark.js";
import { StrategyMandateError } from "../src/mandates/errors.js";
import {
  createBalanceSnapshotHash,
  createTradeLayerRiskCheckpoint,
  materializeTradeLayerShadowFeed
} from "../src/mandates/shadowFeeder.js";
import { FileTradeLayerShadowCaptureStore } from "../src/mandates/shadowStore.js";
import type { TradeLayerShadowCapture, TradeLayerShadowConfig } from "../src/mandates/shadowTypes.js";
import {
  shadowCaptureCore,
  TradeLayerWalletListenerShadowSource
} from "../src/mandates/tradelayerShadowSource.js";
import { createStrategyProposal, proposalCore } from "../src/mandates/validator.js";

const now = new Date("2026-08-05T12:00:00.000Z");
const config: TradeLayerShadowConfig = {
  endpoint: "http://127.0.0.1:3000",
  providerNodeId: "testnet4-observer-1",
  network: "testnet4",
  walletAddress: "tb1qshadowwallet00000000000000000000000000",
  channelId: "tl-channel-42",
  tlbtcPropertyId: 1,
  tlusdPropertyId: 2,
  oracleId: 7,
  oraclePolicy: "tl-oracle-set-v2",
  maxSourceAgeMs: 2_000,
  maxSyncLagBlocks: 1,
  maxOracleLagBlocks: 1,
  maxRiskLagBlocks: 1,
  timeoutMs: 1_000,
  maxResponseBytes: 100_000
};

function fixtures() {
  const sync = {
    initialized: true,
    phase: "realtime",
    chainTip: 420,
    indexedHeight: 420,
    processedHeight: 420,
    updatedAt: now.getTime(),
    error: null
  };
  return {
    syncBefore: structuredClone(sync),
    syncAfter: structuredClone(sync),
    network: { ok: true, data: { chain: "testnet4", blocks: 420 } },
    orderbook: {
      buy: [{ offeredPropertyId: 2, desiredPropertyId: 1, amountOffered: 64.99, amountExpected: 0.001 }],
      sell: [{ offeredPropertyId: 1, desiredPropertyId: 2, amountOffered: 0.001, amountExpected: 65.01 }]
    },
    balances: [
      { propertyId: "1", ticker: "TLBTC", amount: 0.1, available: 0.08, reserved: 0.01, margin: 0, channel: 0.01 },
      { propertyId: "2", ticker: "TLUSD", amount: 1000, available: 900, reserved: 50, margin: 0, channel: 50 }
    ],
    oracles: [{ id: 7, ticker: "TLBTC/USD", lastPublishedBlock: 420, data: { price: 65000 } }]
  };
}

type FixtureSet = ReturnType<typeof fixtures>;

function mockFetch(values: FixtureSet, calls: Array<{ path: string; body: Record<string, unknown> }> = []) {
  let syncCalls = 0;
  return async (url: string | URL | Request, init?: RequestInit) => {
    const parsed = new URL(String(url));
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    calls.push({ path: parsed.pathname, body });
    let value: unknown;
    if (parsed.pathname === "/tl_getSyncStatus") value = syncCalls++ === 0 ? values.syncBefore : values.syncAfter;
    else if (parsed.pathname === "/tl_allocatedRpc") value = values.network;
    else if (parsed.pathname === "/tl_getOrderbook") value = values.orderbook;
    else if (parsed.pathname === "/tl_getAllBalancesForAddress") value = values.balances;
    else if (parsed.pathname === "/tl_listOracles") value = values.oracles;
    else return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  };
}

async function capture(values = fixtures(), calls?: Array<{ path: string; body: Record<string, unknown> }>) {
  const source = new TradeLayerWalletListenerShadowSource(mockFetch(values, calls) as typeof fetch);
  return source.capture(config, now);
}

function checkpoint(changes: Record<string, unknown> = {}) {
  return createTradeLayerRiskCheckpoint({
    schema: "bitagent_tradelayer_risk_checkpoint_v1",
    network: "testnet4",
    walletAddress: config.walletAddress,
    channelId: config.channelId,
    balanceSnapshotHash: createBalanceSnapshotHash({
      network: "testnet4",
      walletAddress: config.walletAddress,
      tlbtcPropertyId: 1,
      tlusdPropertyId: 2,
      tlbtcSats: "10000000",
      tlusdAtoms: "100000000000",
      sourceHeight: 420
    }),
    currentNetDeltaBps: -200,
    grossLeverageBps: 8_000,
    dailyLossBps: 20,
    drawdownBps: 40,
    nonce: 2841,
    sourceHeight: 420,
    observedAt: now.toISOString(),
    sourceId: "operator-risk-ledger:testnet4",
    ...changes
  });
}

function rehash(raw: TradeLayerShadowCapture) {
  const capture = structuredClone(raw);
  for (const key of Object.keys(capture.responses) as Array<keyof TradeLayerShadowCapture["responses"]>) {
    capture.responseHashes[key] = hashObject(capture.responses[key]);
  }
  capture.captureHash = hashObject(shadowCaptureCore(capture));
  return capture;
}

function expectCode(fn: () => unknown, code: string) {
  assert.throws(fn, (error: unknown) => error instanceof StrategyMandateError && error.code === code);
}

test("wallet-listener source calls only the six fixed read-only observations", async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  await capture(fixtures(), calls);
  assert.deepEqual(calls.map((item) => item.path), [
    "/tl_getSyncStatus",
    "/tl_allocatedRpc",
    "/tl_getOrderbook",
    "/tl_getAllBalancesForAddress",
    "/tl_listOracles",
    "/tl_getSyncStatus"
  ]);
  assert.equal(calls[1]!.body.method, "getblockchaininfo");
  assert.equal(calls.some((item) => /create|send|sign|broadcast|submit/i.test(item.path)), false);
});

test("fresh TradeLayer evidence materializes an effect-free covenant feed", async () => {
  const feed = materializeTradeLayerShadowFeed({ capture: await capture(), riskCheckpoint: checkpoint(), config, now });
  assert.equal(feed.market.bidPriceUsd, "64990.00");
  assert.equal(feed.market.askPriceUsd, "65010.00");
  assert.equal(feed.market.markPriceUsd, "65000.00");
  assert.equal(feed.portfolio.capitalAtoms, "100000000000");
  assert.equal(feed.portfolio.nonce, 2841);
  assert.equal(feed.effect, "none");
  assert.equal(feed.nextAuthority, "deterministic_host");
  assert.equal(feed.signingPerformed, false);
  assert.equal(feed.broadcastPerformed, false);
  assert.match(feed.feedRoot, /^[0-9a-f]{64}$/);
});

test("shadow feed reaches the existing allocator without transaction authority", async () => {
  const setup = createStrategyBenchmarkScenario(now);
  const feed = materializeTradeLayerShadowFeed({ capture: await capture(), riskCheckpoint: checkpoint(), config, now });
  const proposals = setup.proposals.map((proposal) => createStrategyProposal({
    ...proposalCore(proposal),
    marketSnapshotHash: feed.market.snapshotHash
  }));
  const candidate = buildStrategyCandidate({ ...setup, proposals, market: feed.market, portfolio: feed.portfolio });
  assert.equal(candidate.action, "place_limit");
  assert.equal(candidate.effect, "none");
  assert.equal(candidate.nextAuthority, "wallet_user");
  assert.equal(candidate.signingPerformed, false);
  assert.equal(candidate.broadcastPerformed, false);
});

test("network mismatch fails closed", async () => {
  const raw = await capture();
  (raw.responses.network as { data: { chain: string } }).data.chain = "main";
  expectCode(() => materializeTradeLayerShadowFeed({ capture: rehash(raw), riskCheckpoint: checkpoint(), config, now }), "shadow_state_conflict");
});

test("capture endpoint must match the approved source endpoint", async () => {
  const raw = await capture();
  expectCode(() => materializeTradeLayerShadowFeed({
    capture: raw,
    riskCheckpoint: checkpoint(),
    config: { ...config, endpoint: "http://127.0.0.1:4000" },
    now
  }), "shadow_state_conflict");
});

test("idle listener fails closed", async () => {
  const raw = await capture();
  (raw.responses.syncAfter as { phase: string }).phase = "idle";
  expectCode(() => materializeTradeLayerShadowFeed({ capture: rehash(raw), riskCheckpoint: checkpoint(), config, now }), "shadow_state_stale");
});

test("unsynchronized listener fails closed", async () => {
  const raw = await capture();
  (raw.responses.syncBefore as { processedHeight: number }).processedHeight = 417;
  (raw.responses.syncAfter as { processedHeight: number }).processedHeight = 417;
  expectCode(() => materializeTradeLayerShadowFeed({ capture: rehash(raw), riskCheckpoint: checkpoint(), config, now }), "shadow_state_stale");
});

test("listener height ahead of chain tip is rejected", async () => {
  const raw = await capture();
  (raw.responses.syncBefore as { processedHeight: number }).processedHeight = 421;
  (raw.responses.syncAfter as { processedHeight: number }).processedHeight = 421;
  expectCode(() => materializeTradeLayerShadowFeed({ capture: rehash(raw), riskCheckpoint: checkpoint(), config, now }), "shadow_state_conflict");
});

test("listener advancing inside a capture is a state conflict", async () => {
  const raw = await capture();
  (raw.responses.syncAfter as { processedHeight: number }).processedHeight = 421;
  expectCode(() => materializeTradeLayerShadowFeed({ capture: rehash(raw), riskCheckpoint: checkpoint(), config, now }), "shadow_state_conflict");
});

test("stale capture is rejected", async () => {
  const raw = await capture();
  raw.capturedAt = new Date(now.getTime() - 2_001).toISOString();
  expectCode(() => materializeTradeLayerShadowFeed({ capture: rehash(raw), riskCheckpoint: checkpoint(), config, now }), "shadow_state_stale");
});

test("future listener timestamp is rejected", async () => {
  const raw = await capture();
  (raw.responses.syncBefore as { updatedAt: number }).updatedAt = now.getTime() + 1;
  expectCode(() => materializeTradeLayerShadowFeed({ capture: rehash(raw), riskCheckpoint: checkpoint(), config, now }), "shadow_state_stale");
});

test("stale risk checkpoint is rejected", async () => {
  const stale = checkpoint({ observedAt: new Date(now.getTime() - 2_001).toISOString() });
  const raw = await capture();
  expectCode(() => materializeTradeLayerShadowFeed({ capture: raw, riskCheckpoint: stale, config, now }), "shadow_state_stale");
});

test("portfolio freshness preserves the older risk observation time", async () => {
  const observedAt = new Date(now.getTime() - 1_500).toISOString();
  const feed = materializeTradeLayerShadowFeed({
    capture: await capture(),
    riskCheckpoint: checkpoint({ observedAt }),
    config,
    now
  });
  assert.equal(feed.portfolio.observedAt, observedAt);
  assert.equal(feed.observedAt, observedAt);
  assert.equal(feed.market.observedAt, now.toISOString());
});

test("risk checkpoint ahead of listener state is rejected", async () => {
  const ahead = checkpoint({ sourceHeight: 421 });
  const raw = await capture();
  expectCode(() => materializeTradeLayerShadowFeed({ capture: raw, riskCheckpoint: ahead, config, now }), "shadow_state_stale");
});

test("risk checkpoint must bind the live balance snapshot", async () => {
  const wrong = checkpoint({ balanceSnapshotHash: "aa".repeat(32) });
  const raw = await capture();
  expectCode(() => materializeTradeLayerShadowFeed({ capture: raw, riskCheckpoint: wrong, config, now }), "shadow_state_conflict");
});

test("inconsistent balance components are rejected", async () => {
  const raw = await capture();
  (raw.responses.balances as Array<{ propertyId: string; available: number }>)[1]!.available = 899;
  expectCode(() => materializeTradeLayerShadowFeed({ capture: rehash(raw), riskCheckpoint: checkpoint(), config, now }), "shadow_state_conflict");
});

test("duplicate property balance rows are rejected", async () => {
  const raw = await capture();
  (raw.responses.balances as unknown[]).push(structuredClone((raw.responses.balances as unknown[])[0]));
  expectCode(() => materializeTradeLayerShadowFeed({ capture: rehash(raw), riskCheckpoint: checkpoint(), config, now }), "shadow_state_invalid");
});

test("orderbook property orientation is enforced", async () => {
  const raw = await capture();
  (raw.responses.orderbook as { buy: Array<{ offeredPropertyId: number }> }).buy[0]!.offeredPropertyId = 1;
  expectCode(() => materializeTradeLayerShadowFeed({ capture: rehash(raw), riskCheckpoint: checkpoint(), config, now }), "shadow_state_conflict");
});

test("crossed orderbook is rejected", async () => {
  const raw = await capture();
  (raw.responses.orderbook as { buy: Array<{ amountOffered: number }> }).buy[0]!.amountOffered = 65.02;
  expectCode(() => materializeTradeLayerShadowFeed({ capture: rehash(raw), riskCheckpoint: checkpoint(), config, now }), "shadow_state_conflict");
});

test("stale oracle block is rejected", async () => {
  const raw = await capture();
  (raw.responses.oracles as Array<{ lastPublishedBlock: number }>)[0]!.lastPublishedBlock = 418;
  expectCode(() => materializeTradeLayerShadowFeed({ capture: rehash(raw), riskCheckpoint: checkpoint(), config, now }), "shadow_state_stale");
});

test("oracle mark outside the executable spread is rejected", async () => {
  const raw = await capture();
  (raw.responses.oracles as Array<{ data: { price: number } }>)[0]!.data.price = 66000;
  expectCode(() => materializeTradeLayerShadowFeed({ capture: rehash(raw), riskCheckpoint: checkpoint(), config, now }), "shadow_state_conflict");
});

test("secret-bearing listener response is rejected before capture persistence", async () => {
  const values = fixtures() as FixtureSet & { network: { ok: boolean; data: { chain: string; privateKey?: string } } };
  values.network.data.privateKey = "prohibited";
  await assert.rejects(capture(values), (error: unknown) => error instanceof StrategyMandateError && error.code === "shadow_source_error");
});

test("tampered raw response is detected by its individual evidence hash", async () => {
  const raw = await capture();
  (raw.responses.oracles as Array<{ data: { price: number } }>)[0]!.data.price = 1;
  expectCode(() => materializeTradeLayerShadowFeed({ capture: raw, riskCheckpoint: checkpoint(), config, now }), "shadow_state_invalid");
});

test("content-addressed captures resume after an interrupted session", async () => {
  const raw = await capture();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-shadow-captures-"));
  const store = new FileTradeLayerShadowCaptureStore(directory);
  await store.save(raw);
  const resumed = await new FileTradeLayerShadowCaptureStore(directory).load(raw.captureHash);
  const feed = materializeTradeLayerShadowFeed({ capture: resumed, riskCheckpoint: checkpoint(), config, now });
  assert.equal(feed.captureHash, raw.captureHash);
});

test("capture store never overwrites corrupt evidence", async () => {
  const raw = await capture();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-shadow-corrupt-"));
  const store = new FileTradeLayerShadowCaptureStore(directory);
  await store.save(raw);
  const target = path.join(directory, `${raw.captureHash}.json`);
  await fs.writeFile(target, "{}\n", "utf8");
  await assert.rejects(store.save(raw), (error: unknown) => error instanceof StrategyMandateError && error.code === "shadow_state_invalid");
  assert.equal(await fs.readFile(target, "utf8"), "{}\n");
});

test("source endpoint cannot embed credentials", async () => {
  const source = new TradeLayerWalletListenerShadowSource(mockFetch(fixtures()) as typeof fetch);
  await assert.rejects(source.capture({ ...config, endpoint: "http://user:pass@127.0.0.1:3000" }, now),
    (error: unknown) => error instanceof StrategyMandateError && error.code === "shadow_source_error");
});

test("risk checkpoint tampering is detected", async () => {
  const risk = checkpoint();
  risk.dailyLossBps += 1;
  const raw = await capture();
  expectCode(() => materializeTradeLayerShadowFeed({ capture: raw, riskCheckpoint: risk, config, now }), "shadow_state_invalid");
});

test("shadow source failures remain classified and non-executing", async () => {
  const failing = new TradeLayerWalletListenerShadowSource(async () => new Response("down", { status: 503 }) as never);
  await assert.rejects(failing.capture(config, now), (error: unknown) => error instanceof StrategyMandateError
    && error.code === "shadow_source_error" && /read-only/i.test(error.message));
});
