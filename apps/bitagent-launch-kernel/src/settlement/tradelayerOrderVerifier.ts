import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";

const TXID_PATTERN = /^[a-f0-9]{64}$/;
const DECIMAL_SCALE = 8;

export type StarterOrderExpectation = {
  txid: string;
  address: string;
  offeredPropertyId: number;
  desiredPropertyId: number;
  amountOffered: string;
  amountExpected: string;
  postOnly: true;
};

export type TradeLayerOrderObservation = {
  schema: "tradelayer_order_observation_v1";
  txid: string;
  status: "pending" | "verified" | "failed";
  positionOrOrderState?: "open" | "filled";
  checkedAt: string;
  source: string;
  reason: string;
  sync: {
    initialized: boolean;
    phase: string;
    currentHeight: number | null;
    targetHeight: number | null;
    processedHeight: number | null;
    lag: number | null;
  };
  transactionProcessed: boolean;
  transactionValid?: boolean;
  exactTransactionMatched: boolean;
  openOrderMatched: boolean;
  fillMatched: boolean;
  evidenceDigest: string;
  evidenceHash: string;
};

export interface TradeLayerOrderReadSource {
  readonly source: string;
  getSyncStatus(): Promise<unknown>;
  getTransaction(txid: string): Promise<unknown>;
  getOrderbook(offeredPropertyId: number, desiredPropertyId: number): Promise<unknown>;
  getTokenTradeHistory(offeredPropertyId: number, desiredPropertyId: number, address: string): Promise<unknown>;
}

function fail(message: string, cause?: unknown): never {
  throw new IntegrationBoundaryError("settlement_error", message, cause);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function integer(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function decimalAtoms(value: unknown, label: string): bigint {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(String(value).trim());
  if (!match || (match[2]?.length || 0) > DECIMAL_SCALE) {
    fail(`${label} must be a non-negative decimal with at most eight places`, value);
  }
  return BigInt(match[1]!) * 100_000_000n + BigInt((match[2] || "").padEnd(DECIMAL_SCALE, "0") || "0");
}

function boolean(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

function normalizedTxid(value: unknown): string | null {
  const txid = String(value || "").trim().toLowerCase();
  return TXID_PATTERN.test(txid) ? txid : null;
}

function transactionIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    const item = record(candidate);
    if (!item) return;
    for (const [key, child] of Object.entries(item)) {
      if (["txid", "txId", "fullTxid", "takerTxId", "makerTxId", "buyerTxId", "sellerTxId"].includes(key)) {
        const txid = normalizedTxid(child);
        if (txid) ids.add(txid);
      } else if (child && typeof child === "object") {
        visit(child);
      }
    }
  };
  visit(value);
  return ids;
}

function participantMatches(value: unknown, address: string): boolean {
  const target = address.toLowerCase();
  const item = record(value);
  if (!item) return false;
  return ["sender", "senderAddress", "address", "buyer", "seller", "buyerAddress", "sellerAddress"]
    .some((key) => String(item[key] || "").trim().toLowerCase() === target);
}

function exactOrderFields(value: unknown, expected: StarterOrderExpectation): boolean {
  const item = record(value);
  if (!item || !participantMatches(item, expected.address)) return false;
  try {
    return integer(item.offeredPropertyId ?? item.propertyIdOffered) === expected.offeredPropertyId
      && integer(item.desiredPropertyId ?? item.propertyIdDesired) === expected.desiredPropertyId
      && decimalAtoms(item.amountOffered, "observed amountOffered") === decimalAtoms(expected.amountOffered, "expected amountOffered")
      && decimalAtoms(item.amountExpected, "observed amountExpected") === decimalAtoms(expected.amountExpected, "expected amountExpected");
  } catch {
    return false;
  }
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function syncSummary(value: unknown) {
  const item = record(value) || {};
  const initialized = item.initialized === true;
  const phase = String(item.phase || "unknown");
  const currentHeight = integer(item.currentHeight);
  const targetHeight = integer(item.targetHeight);
  const processedHeight = integer(item.processedHeight);
  const lag = currentHeight == null || targetHeight == null ? null : Math.max(0, targetHeight - currentHeight);
  return { initialized, phase, currentHeight, targetHeight, processedHeight, lag };
}

function observation(input: Omit<TradeLayerOrderObservation, "schema" | "evidenceDigest" | "evidenceHash">, evidence: unknown): TradeLayerOrderObservation {
  const material = {
    schema: "tradelayer_order_observation_v1" as const,
    ...input,
    evidenceDigest: canonicalHash(evidence)
  };
  const evidenceHash = canonicalHash(material);
  return { ...material, evidenceHash };
}

export function verifyTradeLayerOrderObservation(value: TradeLayerOrderObservation): boolean {
  try {
    if (value.schema !== "tradelayer_order_observation_v1") return false;
    const { evidenceHash, ...material } = value;
    return canonicalHash(material) === evidenceHash;
  } catch {
    return false;
  }
}

export async function observeStarterTradeLayerOrder(input: {
  source: TradeLayerOrderReadSource;
  expected: StarterOrderExpectation;
  now?: Date;
  maximumSyncLag?: number;
}): Promise<TradeLayerOrderObservation> {
  const expected = {
    ...input.expected,
    txid: String(input.expected.txid).trim().toLowerCase(),
    address: String(input.expected.address).trim()
  };
  if (!TXID_PATTERN.test(expected.txid) || !expected.address) fail("Order observation requires a canonical txid and address");
  decimalAtoms(expected.amountOffered, "amountOffered");
  decimalAtoms(expected.amountExpected, "amountExpected");
  const checkedAt = (input.now || new Date()).toISOString();

  const [rawSync, rawTransaction, rawOrderbook, rawHistory] = await Promise.all([
    input.source.getSyncStatus(),
    input.source.getTransaction(expected.txid),
    input.source.getOrderbook(expected.offeredPropertyId, expected.desiredPropertyId),
    input.source.getTokenTradeHistory(expected.offeredPropertyId, expected.desiredPropertyId, expected.address)
  ]);
  const sync = syncSummary(rawSync);
  const evidence = { expected, rawSync, rawTransaction, rawOrderbook, rawHistory };
  const maximumSyncLag = input.maximumSyncLag ?? 1;
  if (!sync.initialized || sync.lag == null || sync.lag > maximumSyncLag || ["error", "paused"].includes(sync.phase)) {
    return observation({
      txid: expected.txid,
      status: "pending",
      checkedAt,
      source: input.source.source,
      reason: "TradeLayer listener is not synchronized closely enough to verify the order",
      sync,
      transactionProcessed: false,
      exactTransactionMatched: false,
      openOrderMatched: false,
      fillMatched: false
    }, evidence);
  }

  const transaction = record(rawTransaction);
  if (!transaction) {
    return observation({
      txid: expected.txid,
      status: "pending",
      checkedAt,
      source: input.source.source,
      reason: "TradeLayer has not processed the transaction",
      sync,
      transactionProcessed: false,
      exactTransactionMatched: false,
      openOrderMatched: false,
      fillMatched: false
    }, evidence);
  }
  const transactionValid = boolean(transaction.valid);
  const transactionTxid = normalizedTxid(transaction.txid ?? transaction.txId);
  const exactTransactionMatched = transactionTxid === expected.txid
    && transactionValid === true
    && exactOrderFields(transaction, expected)
    && boolean(transaction.post) === expected.postOnly;
  if (!exactTransactionMatched) {
    return observation({
      txid: expected.txid,
      status: "failed",
      checkedAt,
      source: input.source.source,
      reason: "Processed TradeLayer transaction does not match the exact approved tx5 order",
      sync,
      transactionProcessed: true,
      transactionValid: transactionValid === true,
      exactTransactionMatched: false,
      openOrderMatched: false,
      fillMatched: false
    }, evidence);
  }

  const book = record(rawOrderbook) || {};
  const orders = [...array(book.buy), ...array(book.sell)];
  const openOrderMatched = orders.some((order) =>
    normalizedTxid(record(order)?.fullTxid) === expected.txid && exactOrderFields(order, expected)
  );
  const history = array(rawHistory);
  const fillMatched = history.some((trade) =>
    transactionIds(trade).has(expected.txid) && participantMatches(trade, expected.address)
  );
  if (openOrderMatched || fillMatched) {
    return observation({
      txid: expected.txid,
      status: "verified",
      positionOrOrderState: fillMatched ? "filled" : "open",
      checkedAt,
      source: input.source.source,
      reason: fillMatched ? "Exact tx5 identity appears in address trade history" : "Exact tx5 identity appears in the open orderbook",
      sync,
      transactionProcessed: true,
      transactionValid: true,
      exactTransactionMatched: true,
      openOrderMatched,
      fillMatched
    }, evidence);
  }
  return observation({
    txid: expected.txid,
    status: "pending",
    checkedAt,
    source: input.source.source,
    reason: "Transaction is valid, but no exact full-txid open-order or fill record is observable yet",
    sync,
    transactionProcessed: true,
    transactionValid: true,
    exactTransactionMatched: true,
    openOrderMatched: false,
    fillMatched: false
  }, evidence);
}

function unwrap(payload: unknown): unknown {
  const item = record(payload);
  if (!item) return payload;
  if (item.error) fail("TradeLayer relayer returned an error", item.error);
  if (Object.prototype.hasOwnProperty.call(item, "data")) return item.data;
  if (Object.prototype.hasOwnProperty.call(item, "result")) return item.result;
  return payload;
}

export class RelayerTradeLayerOrderReadSource implements TradeLayerOrderReadSource {
  readonly source: string;

  constructor(private readonly endpoint: string, private readonly timeoutMs = 5_000) {
    this.source = endpoint.replace(/\/$/, "");
    if (!/^https?:\/\//.test(this.source)) fail("TradeLayer relayer endpoint must be HTTP(S)");
  }

  private async call(method: string, params: unknown[]): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.source}/rpc/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ params }),
        signal: controller.signal
      });
      if (!response.ok) fail(`TradeLayer relayer ${method} returned HTTP ${response.status}`);
      return unwrap(await response.json());
    } catch (error) {
      if (error instanceof IntegrationBoundaryError) throw error;
      fail(`Could not read TradeLayer ${method}`, error);
    } finally {
      clearTimeout(timer);
    }
  }

  getSyncStatus() {
    return this.call("tl_getsyncstatus", []);
  }

  getTransaction(txid: string) {
    return this.call("tl_gettransaction", [txid]);
  }

  getOrderbook(offeredPropertyId: number, desiredPropertyId: number) {
    return this.call("tl_getorderbook", [offeredPropertyId, desiredPropertyId]);
  }

  getTokenTradeHistory(offeredPropertyId: number, desiredPropertyId: number, address: string) {
    return this.call("tl_tokentradehistoryforaddress", [offeredPropertyId, desiredPropertyId, address]);
  }
}
