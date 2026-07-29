import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";
import type { TradeLayerBalanceRow, TradeLayerPnlEvidence } from "./types.js";

function available(rows: TradeLayerBalanceRow[], propertyId: number): number {
  const row = rows.find((candidate) => Number(candidate.propertyId) === propertyId);
  const value = Number(row?.available || 0);
  if (!Number.isFinite(value)) throw new IntegrationBoundaryError("settlement_error", "TradeLayer balance row contains an invalid amount", row);
  return value;
}

function portfolioSats(rows: TradeLayerBalanceRow[], btcUsd: number): bigint {
  const tlbtcSats = Math.round(available(rows, 1) * 100_000_000);
  const tlusdSats = Math.round((available(rows, 2) / btcUsd) * 100_000_000);
  return BigInt(tlbtcSats + tlusdSats);
}

export function createTradeLayerPnlEvidence(input: {
  agentAddress: string;
  before: TradeLayerBalanceRow[];
  after: TradeLayerBalanceRow[];
  valuationPriceUsd: number;
  feesSats: string;
  transactionIds: string[];
  observedAt: string;
  source: string;
}): TradeLayerPnlEvidence {
  if (!input.agentAddress || !Number.isFinite(input.valuationPriceUsd) || input.valuationPriceUsd <= 0) {
    throw new IntegrationBoundaryError("settlement_error", "PnL evidence requires an address and positive valuation price");
  }
  if (!/^(0|[1-9][0-9]*)$/.test(input.feesSats) || input.transactionIds.length === 0) {
    throw new IntegrationBoundaryError("settlement_error", "PnL evidence requires non-negative fees and transaction IDs");
  }
  const delta = portfolioSats(input.after, input.valuationPriceUsd) - portfolioSats(input.before, input.valuationPriceUsd) - BigInt(input.feesSats);
  const material = {
    schema: "tradelayer_balance_delta_pnl_v1" as const,
    ...input,
    transactionIds: [...new Set(input.transactionIds)].sort(),
    settledPnlSats: delta.toString()
  };
  return { ...material, evidenceHash: canonicalHash(material) };
}

export function verifyTradeLayerPnlEvidence(evidence: TradeLayerPnlEvidence, requiredTxids: string[]): boolean {
  const { evidenceHash, ...material } = evidence;
  try {
    if (canonicalHash(material) !== evidenceHash || BigInt(evidence.settledPnlSats) <= 0n) return false;
  } catch {
    return false;
  }
  const observed = new Set(evidence.transactionIds);
  return requiredTxids.length > 0 && requiredTxids.every((txid) => observed.has(txid));
}

export async function fetchTradeLayerBalances(input: {
  endpoint: string;
  address: string;
  timeoutMs?: number;
}): Promise<TradeLayerBalanceRow[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs || 5_000);
  try {
    const response = await fetch(`${input.endpoint.replace(/\/$/, "")}/tl_getAllBalancesForAddress`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ params: input.address }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("TradeLayer balance endpoint returned a non-array response");
    return rows as TradeLayerBalanceRow[];
  } catch (error) {
    throw new IntegrationBoundaryError("settlement_error", "Could not observe TradeLayer address balances", error);
  } finally {
    clearTimeout(timer);
  }
}
