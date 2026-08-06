import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";
import type {
  TradeLayerBalanceRow,
  TradeLayerBalanceSnapshot,
  TradeLayerPnlEvidence
} from "./types.js";

const TOKEN_SCALE = 8;
const SATS_PER_BTC = 100_000_000n;
const TXID_PATTERN = /^[a-f0-9]{64}$/;

function settlementError(message: string, cause?: unknown): never {
  throw new IntegrationBoundaryError("settlement_error", message, cause);
}

function propertyId(value: string | number): number {
  const text = String(value).trim();
  if (!/^(0|[1-9][0-9]*)$/.test(text)) settlementError("TradeLayer balance row contains an invalid property ID", value);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) settlementError("TradeLayer property ID exceeds the safe integer range", value);
  return parsed;
}

function decimalAtoms(value: string | number, scale: number, label: string): bigint {
  const text = String(value).trim();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(text);
  if (!match || (match[2]?.length || 0) > scale) {
    settlementError(`${label} must be a non-negative decimal with at most ${scale} places`, value);
  }
  const fraction = (match[2] || "").padEnd(scale, "0");
  return BigInt(match[1]!) * (10n ** BigInt(scale)) + BigInt(fraction || "0");
}

function canonicalDecimal(value: string | number, label: string): string {
  const atoms = decimalAtoms(value, TOKEN_SCALE, label);
  const whole = atoms / SATS_PER_BTC;
  const fraction = (atoms % SATS_PER_BTC).toString().padStart(TOKEN_SCALE, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function timestamp(value: string, label: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) settlementError(`${label} is not a valid timestamp`, value);
  return new Date(time).toISOString();
}

export function normalizeTradeLayerBalanceRows(rows: TradeLayerBalanceRow[]): TradeLayerBalanceRow[] {
  if (!Array.isArray(rows)) settlementError("TradeLayer balances must be an array");
  const observed = new Set<number>();
  const normalized = rows.map((row, index) => {
    if (!row || typeof row !== "object") settlementError("TradeLayer balance row is not an object", row);
    const id = propertyId(row.propertyId);
    if (observed.has(id)) settlementError(`TradeLayer balance snapshot contains duplicate property ${id}`);
    observed.add(id);
    const result: TradeLayerBalanceRow = {
      propertyId: id,
      available: canonicalDecimal(row.available, `rows[${index}].available`)
    };
    if (row.ticker != null) result.ticker = String(row.ticker).trim();
    if (row.reserved != null) result.reserved = canonicalDecimal(row.reserved, `rows[${index}].reserved`);
    if (row.margin != null) result.margin = canonicalDecimal(row.margin, `rows[${index}].margin`);
    return result;
  });
  return normalized.sort((left, right) => Number(left.propertyId) - Number(right.propertyId));
}

export function createTradeLayerBalanceSnapshot(input: {
  address: string;
  observedAt: string;
  source: string;
  rows: TradeLayerBalanceRow[];
}): TradeLayerBalanceSnapshot {
  const address = input.address.trim();
  const source = input.source.trim();
  if (!address || !source) settlementError("TradeLayer balance snapshot requires an address and source");
  const material = {
    schema: "tradelayer_balance_snapshot_v1" as const,
    address,
    observedAt: timestamp(input.observedAt, "observedAt"),
    source,
    rows: normalizeTradeLayerBalanceRows(input.rows)
  };
  return { ...material, snapshotHash: canonicalHash(material) };
}

export function verifyTradeLayerBalanceSnapshot(snapshot: TradeLayerBalanceSnapshot): boolean {
  try {
    if (snapshot.schema !== "tradelayer_balance_snapshot_v1") return false;
    const rebuilt = createTradeLayerBalanceSnapshot(snapshot);
    const { snapshotHash, ...material } = snapshot;
    return canonicalHash(material) === snapshotHash && rebuilt.snapshotHash === snapshotHash;
  } catch {
    return false;
  }
}

function availableAtoms(rows: TradeLayerBalanceRow[], id: number): bigint {
  const row = rows.find((candidate) => Number(candidate.propertyId) === id);
  return row ? decimalAtoms(row.available, TOKEN_SCALE, `property ${id} available`) : 0n;
}

function portfolioSats(snapshot: TradeLayerBalanceSnapshot, priceAtoms: bigint): bigint {
  const tlbtcSats = availableAtoms(snapshot.rows, 1);
  const tlusdAtoms = availableAtoms(snapshot.rows, 2);
  return tlbtcSats + (tlusdAtoms * SATS_PER_BTC) / priceAtoms;
}

export function createTradeLayerPnlEvidence(input: {
  beforeSnapshot: TradeLayerBalanceSnapshot;
  afterSnapshot: TradeLayerBalanceSnapshot;
  valuationPriceUsd: string;
  valuationSource: string;
  feesSats: string;
  transactionIds: string[];
}): TradeLayerPnlEvidence {
  if (!verifyTradeLayerBalanceSnapshot(input.beforeSnapshot) || !verifyTradeLayerBalanceSnapshot(input.afterSnapshot)) {
    settlementError("PnL evidence requires valid hash-bound balance snapshots");
  }
  if (
    input.beforeSnapshot.address !== input.afterSnapshot.address ||
    input.beforeSnapshot.source !== input.afterSnapshot.source
  ) {
    settlementError("PnL balance snapshots must use the same address and source");
  }
  if (Date.parse(input.afterSnapshot.observedAt) <= Date.parse(input.beforeSnapshot.observedAt)) {
    settlementError("PnL after-snapshot must be newer than the before-snapshot");
  }
  const valuationSource = input.valuationSource.trim();
  const valuationPriceUsd = canonicalDecimal(input.valuationPriceUsd, "valuationPriceUsd");
  const priceAtoms = decimalAtoms(valuationPriceUsd, TOKEN_SCALE, "valuationPriceUsd");
  if (!valuationSource || priceAtoms <= 0n) settlementError("PnL evidence requires a positive price and valuation source");
  if (!/^(0|[1-9][0-9]*)$/.test(input.feesSats)) settlementError("PnL evidence requires non-negative integer fees");

  const transactionIds = input.transactionIds.map((txid) => txid.trim().toLowerCase());
  if (
    transactionIds.length === 0 ||
    transactionIds.some((txid) => !TXID_PATTERN.test(txid)) ||
    new Set(transactionIds).size !== transactionIds.length
  ) {
    settlementError("PnL evidence requires unique canonical transaction IDs");
  }
  transactionIds.sort();
  const delta = portfolioSats(input.afterSnapshot, priceAtoms)
    - portfolioSats(input.beforeSnapshot, priceAtoms)
    - BigInt(input.feesSats);
  const material = {
    schema: "tradelayer_balance_delta_pnl_v2" as const,
    agentAddress: input.beforeSnapshot.address,
    beforeSnapshot: input.beforeSnapshot,
    afterSnapshot: input.afterSnapshot,
    valuationPriceUsd,
    valuationSource,
    feesSats: input.feesSats,
    settledPnlSats: delta.toString(),
    transactionIds,
    observedAt: input.afterSnapshot.observedAt,
    source: input.afterSnapshot.source
  };
  return { ...material, evidenceHash: canonicalHash(material) };
}

export function verifyTradeLayerPnlEvidence(evidence: TradeLayerPnlEvidence, requiredTxids: string[]): boolean {
  try {
    if (evidence.schema !== "tradelayer_balance_delta_pnl_v2") return false;
    const { evidenceHash, ...material } = evidence;
    if (canonicalHash(material) !== evidenceHash || BigInt(evidence.settledPnlSats) <= 0n) return false;
    const rebuilt = createTradeLayerPnlEvidence({
      beforeSnapshot: evidence.beforeSnapshot,
      afterSnapshot: evidence.afterSnapshot,
      valuationPriceUsd: evidence.valuationPriceUsd,
      valuationSource: evidence.valuationSource,
      feesSats: evidence.feesSats,
      transactionIds: evidence.transactionIds
    });
    if (rebuilt.evidenceHash !== evidenceHash || rebuilt.settledPnlSats !== evidence.settledPnlSats) return false;
    const observed = new Set(evidence.transactionIds);
    return requiredTxids.length > 0 && requiredTxids.every((txid) => observed.has(txid.toLowerCase()));
  } catch {
    return false;
  }
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
    const payload = await response.json() as unknown;
    const rows = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : payload && typeof payload === "object" && Array.isArray((payload as { result?: unknown }).result)
          ? (payload as { result: unknown[] }).result
          : null;
    if (!rows) throw new Error("TradeLayer balance endpoint returned a non-array response");
    return normalizeTradeLayerBalanceRows(rows as TradeLayerBalanceRow[]);
  } catch (error) {
    throw new IntegrationBoundaryError("settlement_error", "Could not observe TradeLayer address balances", error);
  } finally {
    clearTimeout(timer);
  }
}
