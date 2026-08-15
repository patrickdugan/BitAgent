import { hashObject } from "../launch/canonical.js";
import { StrategyMandateError } from "./errors.js";
import type { TradeLayerShadowCapture, TradeLayerShadowConfig, TradeLayerShadowSource } from "./shadowTypes.js";

const SECRET_FIELD = /(private.?key|seed.?phrase|mnemonic|\bwif\b|api.?secret|secret.?key|password|authorization)/i;

function rejectSecrets(value: unknown, path = "response") {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectSecrets(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELD.test(key)) {
      throw new StrategyMandateError("shadow_source_error", `Secret-bearing source field is prohibited: ${path}.${key}`);
    }
    rejectSecrets(item, `${path}.${key}`);
  }
}

function sourceId(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch (error) {
    throw new StrategyMandateError("shadow_source_error", "TradeLayer endpoint must be an absolute HTTP(S) URL", error);
  }
  if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new StrategyMandateError("shadow_source_error", "TradeLayer endpoint URL contains unsupported components");
  }
  return url.toString().replace(/\/$/, "");
}

export function validateTradeLayerShadowConfig(config: TradeLayerShadowConfig) {
  const ids = [config.tlbtcPropertyId, config.tlusdPropertyId, config.oracleId];
  const policies = [config.maxSourceAgeMs, config.maxSyncLagBlocks, config.maxOracleLagBlocks, config.maxRiskLagBlocks];
  if (config.network !== "testnet4" || !config.providerNodeId || !config.walletAddress || !config.channelId
    || !config.oraclePolicy || ids.some((id) => !Number.isSafeInteger(id) || id < 1)
    || config.tlbtcPropertyId === config.tlusdPropertyId
    || policies.some((value) => !Number.isSafeInteger(value) || value < 0)
    || config.maxSourceAgeMs < 100 || config.maxSourceAgeMs > 60_000
    || config.maxSyncLagBlocks > 1_000 || config.maxOracleLagBlocks > 1_000 || config.maxRiskLagBlocks > 1_000
    || (config.timeoutMs !== undefined && (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 30_000))
    || (config.maxResponseBytes !== undefined
      && (!Number.isSafeInteger(config.maxResponseBytes) || config.maxResponseBytes < 1_024 || config.maxResponseBytes > 5_000_000))) {
    throw new StrategyMandateError("shadow_source_error", "TradeLayer shadow source configuration is invalid");
  }
  return sourceId(config.endpoint);
}

export function shadowCaptureCore(capture: TradeLayerShadowCapture) {
  const { captureHash: _hash, ...core } = capture;
  return core;
}

export function validateTradeLayerShadowCapture(capture: TradeLayerShadowCapture) {
  rejectSecrets(capture);
  if (capture.schema !== "bitagent_tradelayer_shadow_capture_v1"
    || capture.authority !== "read_only_observer" || capture.effect !== "none"
    || hashObject(shadowCaptureCore(capture)) !== capture.captureHash) {
    throw new StrategyMandateError("shadow_state_invalid", "TradeLayer shadow capture fingerprint is invalid");
  }
  for (const key of Object.keys(capture.responses) as Array<keyof TradeLayerShadowCapture["responses"]>) {
    if (hashObject(capture.responses[key]) !== capture.responseHashes[key]) {
      throw new StrategyMandateError("shadow_state_invalid", `TradeLayer ${key} response hash is invalid`);
    }
  }
  return structuredClone(capture);
}

export class TradeLayerWalletListenerShadowSource implements TradeLayerShadowSource {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async capture(config: TradeLayerShadowConfig, now = new Date()): Promise<TradeLayerShadowCapture> {
    const endpoint = validateTradeLayerShadowConfig(config);
    const post = (path: string, body: Record<string, unknown>) => this.postJson(
      `${endpoint}${path}`,
      body,
      config.timeoutMs ?? 5_000,
      config.maxResponseBytes ?? 1_000_000
    );
    const syncBefore = await post("/tl_getSyncStatus", {});
    const [network, orderbook, balances, oracles] = await Promise.all([
      post("/tl_allocatedRpc", {
        method: "getblockchaininfo",
        params: [],
        providerNodeId: config.providerNodeId,
        network: config.network,
        service: "bitcoin",
        timeoutMs: config.timeoutMs ?? 5_000
      }),
      post("/tl_getOrderbook", { propertyId1: config.tlbtcPropertyId, propertyId2: config.tlusdPropertyId }),
      post("/tl_getAllBalancesForAddress", { params: config.walletAddress }),
      post("/tl_listOracles", {})
    ]);
    const syncAfter = await post("/tl_getSyncStatus", {});
    const responses = { syncBefore, network, orderbook, balances, oracles, syncAfter };
    rejectSecrets(responses);
    const core = {
      schema: "bitagent_tradelayer_shadow_capture_v1" as const,
      sourceId: endpoint,
      capturedAt: now.toISOString(),
      query: {
        network: config.network,
        providerNodeId: config.providerNodeId,
        walletAddress: config.walletAddress,
        channelId: config.channelId,
        tlbtcPropertyId: config.tlbtcPropertyId,
        tlusdPropertyId: config.tlusdPropertyId,
        oracleId: config.oracleId
      },
      responses,
      responseHashes: {
        syncBefore: hashObject(syncBefore),
        network: hashObject(network),
        orderbook: hashObject(orderbook),
        balances: hashObject(balances),
        oracles: hashObject(oracles),
        syncAfter: hashObject(syncAfter)
      },
      authority: "read_only_observer" as const,
      effect: "none" as const
    };
    return { ...core, captureHash: hashObject(core) };
  }

  private async postJson(url: string, body: Record<string, unknown>, timeoutMs: number, maxResponseBytes: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > maxResponseBytes) throw new Error("response exceeds configured byte limit");
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new StrategyMandateError("shadow_source_error", `Read-only TradeLayer request failed: ${new URL(url).pathname}`, error);
    } finally {
      clearTimeout(timer);
    }
  }
}
