import {
  AuthorizationError,
  HEX32,
  IDENTIFIER,
  canonicalHash,
  constantTimeEqual,
  hmacBase64url,
  readAtoms,
  readEnum,
  readObject,
  readString,
  sha256Hex
} from "./canonical.js";
import { normalizeNodeId, normalizeOnchainAddress } from "./rails.js";
import { parseReceipt, verifyReceiptSignature, type PrincipalKeyStore, type RevocationRegistry } from "./receipt.js";
import { parseMeterChargeEvent, parsePaymentAction, parseSettlementEvidence } from "./requests.js";
import type {
  AttemptStatus,
  AuthorizationDecision,
  AuthorizationEvent,
  AuthorizationEventType,
  AuthorizationReason,
  AuthorizationReceipt,
  BreachReason,
  CardCaptureEvidence,
  CardCaptureVerifier,
  ClaimResult,
  DecodedLightningInvoice,
  ExecutionOrder,
  LightningInvoiceDecoder,
  MeterChargeEvent,
  MeterChargeResult,
  MeterEventVerifier,
  OnchainInstrument,
  OnchainPaymentObserver,
  OnchainSettlementEvidence,
  PaymentAction,
  ReceiptStatus,
  RevocationState,
  SettlementEvidence,
  SettlementResult
} from "./types.js";

const TICKET_DOMAIN = "bitagent/authorization-ticket/v1\n";
const GENESIS_HASH = "0".repeat(64);
const DAY_MS = 86_400_000;
const MAX_BROADCASTS = 16;

export type AuthorizationGateOptions = {
  /** The agent this gate serves; receipts granted to any other agent are refused. */
  agentId: string;
  keys: PrincipalKeyStore;
  revocations: RevocationRegistry;
  /** Secret for executor tickets (32+ bytes). Never exposed to agent tools. */
  ticketKey: Buffer;
  lightningDecoder?: LightningInvoiceDecoder;
  onchainObserverFor?: (instrument: OnchainInstrument) => OnchainPaymentObserver | undefined;
  cardVerifier?: CardCaptureVerifier;
  meterVerifier?: MeterEventVerifier;
  now?: () => Date;
  minConfirmations?: number;
  maxReceiptLifetimeMs?: number;
  clockSkewMs?: number;
};

type Attempt = {
  attemptId: string;
  receiptId: string;
  idempotencyKey: string;
  actionHash: string;
  order: ExecutionOrder;
  amount: bigint;
  maxFee: bigint;
  /** The hold authorized and bound into the ticket. */
  hold: bigint;
  /** The part of the hold still counted in the ledger. */
  outstanding: bigint;
  status: AttemptStatus;
  reservedRef?: string;
  settledAmount?: bigint;
  /** On-chain: txids the executor reported broadcasting for this attempt. */
  broadcastTxids: string[];
  /** Card: the host reported that the processor released the uncaptured remainder. */
  captureClosed: boolean;
  evidenceHashes: string[];
  breaches: BreachReason[];
};

type Ledger = { receipt: AuthorizationReceipt; spent: bigint; held: bigint; frozen: boolean; attempts: Map<string, Attempt> };
type MeterRecord = { receiptId: string; eventHash: string; windowStart: number; windowEnd: number; amount: bigint };
type MeterState = { events: Map<string, MeterRecord>; sequences: Set<number> };

type Verdict =
  | { status: "settled"; amount: bigint; ref: string; breaches: BreachReason[] }
  | { status: "pending"; reasons: AuthorizationReason[] }
  | { status: "rejected"; reasons: AuthorizationReason[] };

const PARSE_CODES = new Set<string>(["receipt_malformed", "action_malformed", "evidence_malformed", "meter_event_malformed"]);

function reasonOf(error: unknown, fallback: AuthorizationReason): AuthorizationReason {
  return error instanceof AuthorizationError && PARSE_CODES.has(error.code) ? (error.code as AuthorizationReason) : fallback;
}

function unique(reasons: AuthorizationReason[]): AuthorizationReason[] {
  return [...new Set(reasons)];
}

/**
 * Deterministic authorization gate shared by card, Lightning and on-chain rails.
 * Agent tools call authorize / settle / chargeMeter / inspect. Only the host calls
 * claim / fail / cancel (executor side). Nothing here signs or broadcasts.
 */
export class AuthorizationGate {
  private readonly ledgers = new Map<string, Ledger>();
  private readonly attempts = new Map<string, Attempt>();
  private readonly settlementRefs = new Map<string, string>();
  private readonly reservedRefs = new Map<string, string>();
  private readonly broadcastOwners = new Map<string, string>();
  private readonly meters = new Map<string, MeterState>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly log: AuthorizationEvent[] = [];
  private readonly skewMs: number;
  private readonly maxLifetimeMs: number;
  private readonly minConfirmations: number;

  constructor(private readonly options: AuthorizationGateOptions) {
    if (!IDENTIFIER.test(options.agentId)) throw new AuthorizationError("invalid_configuration", "invalid agent id");
    if (!Buffer.isBuffer(options.ticketKey) || options.ticketKey.length < 32) {
      throw new AuthorizationError("invalid_configuration", "ticketKey must be at least 32 bytes");
    }
    this.skewMs = options.clockSkewMs ?? 30_000;
    this.maxLifetimeMs = options.maxReceiptLifetimeMs ?? 30 * DAY_MS;
    this.minConfirmations = options.minConfirmations ?? 1;
    if (!Number.isSafeInteger(this.minConfirmations) || this.minConfirmations < 1) {
      throw new AuthorizationError("invalid_configuration", "minConfirmations must be a positive integer");
    }
  }

  // ---- agent-facing ------------------------------------------------------------------------

  async authorize(input: { receipt: unknown; action: unknown }): Promise<AuthorizationDecision> {
    const parsed = this.parse(input.receipt);
    if (!parsed.receipt) return this.denied(parsed.reasons);
    const receipt = parsed.receipt;
    return this.withLock(receipt.receiptId, () => this.authorizeLocked(receipt, input.action));
  }

  async settle(input: { attemptId: unknown; evidence: unknown }): Promise<SettlementResult> {
    const attemptId = typeof input.attemptId === "string" ? input.attemptId : "";
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return this.settlementResult("rejected", ["unknown_attempt"], attemptId.slice(0, 64));
    return this.withLock(attempt.receiptId, () => this.settleLocked(attempt, input.evidence));
  }

  async chargeMeter(input: { receipt: unknown; event: unknown }): Promise<MeterChargeResult> {
    const parsed = this.parse(input.receipt);
    if (!parsed.receipt) return this.meterResult("rejected", parsed.reasons);
    const receipt = parsed.receipt;
    return this.withLock(receipt.receiptId, () => this.chargeLocked(receipt, input.event));
  }

  async inspect(receiptInput: unknown): Promise<ReceiptStatus> {
    const parsed = this.parse(receiptInput);
    const empty = { schema: "bitagent_authorization_receipt_status_v1" as const, spent: "0", held: "0", frozen: false, attempts: [] };
    if (!parsed.receipt) return { ...empty, valid: false, reasons: parsed.reasons, remaining: "0" };
    const receipt = parsed.receipt;
    const { reasons, revocation } = this.validate(receipt, this.now());
    const ledger = this.ledgers.get(receipt.receiptId);
    return {
      ...empty,
      receiptId: receipt.receiptId,
      valid: reasons.length === 0,
      reasons: reasons.length ? reasons : ["authorized"],
      revocation,
      maxAmount: { ...receipt.grant.maxAmount },
      spent: (ledger?.spent ?? 0n).toString(),
      held: (ledger?.held ?? 0n).toString(),
      remaining: (ledger ? this.remaining(ledger) : BigInt(receipt.grant.maxAmount.value)).toString(),
      frozen: ledger?.frozen ?? false,
      attempts: [...(ledger?.attempts.values() ?? [])].map((attempt) => ({
        attemptId: attempt.attemptId,
        status: attempt.status,
        hold: attempt.hold.toString(),
        ...(attempt.settledAmount !== undefined ? { settledAmount: attempt.settledAmount.toString() } : {})
      }))
    };
  }

  // ---- executor-facing (host only) -----------------------------------------------------------

  /** Single-use: the executor exchanges the ticket for the gate's own copy of the order. */
  async claim(ticket: unknown): Promise<ClaimResult> {
    const attempt = this.attemptForTicket(ticket);
    if (!attempt) return { claimed: false, reasons: ["ticket_invalid"] };
    return this.withLock(attempt.receiptId, () => {
      if (attempt.status === "claimed" || attempt.status === "settled") return { claimed: false, reasons: ["ticket_already_claimed"] };
      if (attempt.status !== "authorized") return { claimed: false, reasons: ["attempt_closed"] };
      const ledger = this.ledgers.get(attempt.receiptId)!;
      const { reasons } = this.validate(ledger.receipt, this.now());
      if (reasons.length) {
        this.close(attempt, ledger, "cancelled");
        this.record("claim_refused", { reasons }, attempt);
        return { claimed: false, reasons };
      }
      attempt.status = "claimed";
      this.record("attempt_claimed", { attemptId: attempt.attemptId }, attempt);
      return { claimed: true, order: structuredClone(attempt.order) };
    });
  }

  /** The executor reports that the rail refused or failed the payment; the hold is released. */
  async fail(ticket: unknown): Promise<{ released: boolean; reasons: AuthorizationReason[] }> {
    const attempt = this.attemptForTicket(ticket);
    if (!attempt) return { released: false, reasons: ["ticket_invalid"] };
    return this.withLock(attempt.receiptId, () => {
      if (attempt.status !== "claimed") return { released: false, reasons: ["attempt_closed"] };
      this.close(attempt, this.ledgers.get(attempt.receiptId)!, "failed");
      this.record("attempt_failed", { attemptId: attempt.attemptId }, attempt);
      return { released: true, reasons: [] };
    });
  }

  /**
   * On-chain executor reports a txid it broadcast for this attempt (a fee bump is another call).
   * Only recorded txids can settle the attempt, so an unrelated wallet payment cannot.
   */
  async recordBroadcast(ticket: unknown, txid: unknown): Promise<{ recorded: boolean; reasons: AuthorizationReason[] }> {
    const attempt = this.attemptForTicket(ticket);
    if (!attempt) return { recorded: false, reasons: ["ticket_invalid"] };
    if (typeof txid !== "string" || !HEX32.test(txid)) return { recorded: false, reasons: ["evidence_malformed"] };
    return this.withLock(attempt.receiptId, () => {
      if (attempt.order.rail !== "onchain") return { recorded: false, reasons: ["evidence_rail_mismatch"] };
      if (attempt.status === "authorized") return { recorded: false, reasons: ["attempt_not_executed"] };
      if (attempt.status === "cancelled") return { recorded: false, reasons: ["attempt_closed"] };
      const owner = this.broadcastOwners.get(txid);
      if (owner === attempt.attemptId) return { recorded: true, reasons: [] };
      if (owner) return { recorded: false, reasons: ["txid_recorded_elsewhere"] };
      if (attempt.broadcastTxids.length >= MAX_BROADCASTS) return { recorded: false, reasons: ["broadcast_limit_reached"] };
      this.broadcastOwners.set(txid, attempt.attemptId);
      attempt.broadcastTxids.push(txid);
      this.record("attempt_broadcast", { txid }, attempt);
      return { recorded: true, reasons: [] };
    });
  }

  /**
   * Card executor reports that the processor released the uncaptured remainder of a partially
   * captured authorization (final capture, void or expiry). Its hold is released.
   */
  async closeCapture(ticket: unknown): Promise<{ released: boolean; reasons: AuthorizationReason[] }> {
    const attempt = this.attemptForTicket(ticket);
    if (!attempt) return { released: false, reasons: ["ticket_invalid"] };
    return this.withLock(attempt.receiptId, () => {
      if (attempt.order.rail !== "card") return { released: false, reasons: ["evidence_rail_mismatch"] };
      if (attempt.status === "authorized" || attempt.status === "claimed") return { released: false, reasons: ["attempt_not_executed"] };
      if (attempt.status !== "settled" || attempt.captureClosed) return { released: false, reasons: ["attempt_closed"] };
      const released = attempt.outstanding;
      this.release(attempt, this.ledgers.get(attempt.receiptId)!);
      attempt.captureClosed = true;
      this.record("capture_closed", { released: released.toString() }, attempt);
      return { released: true, reasons: [] };
    });
  }

  /** Host cancels an attempt no executor has claimed yet. */
  async cancel(attemptId: string): Promise<{ released: boolean; reasons: AuthorizationReason[] }> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return { released: false, reasons: ["unknown_attempt"] };
    return this.withLock(attempt.receiptId, () => {
      if (attempt.status !== "authorized") return { released: false, reasons: ["attempt_closed"] };
      this.close(attempt, this.ledgers.get(attempt.receiptId)!, "cancelled");
      this.record("attempt_cancelled", { attemptId }, attempt);
      return { released: true, reasons: [] };
    });
  }

  events(): AuthorizationEvent[] {
    return structuredClone(this.log);
  }

  // ---- receipt validation ------------------------------------------------------------------

  private now(): Date {
    const value = this.options.now?.() ?? new Date();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new AuthorizationError("invalid_configuration", "host clock returned an invalid date");
    }
    return value;
  }

  private parse(value: unknown): { receipt?: AuthorizationReceipt; reasons: AuthorizationReason[] } {
    try {
      return { receipt: parseReceipt(value), reasons: [] };
    } catch (error) {
      return { reasons: [reasonOf(error, "receipt_malformed")] };
    }
  }

  private validate(receipt: AuthorizationReceipt, now: Date): { reasons: AuthorizationReason[]; revocation?: RevocationState } {
    const reasons = verifyReceiptSignature(receipt, this.options.keys, now);
    const grant = receipt.grant;
    if (grant.agentId !== this.options.agentId) reasons.push("agent_mismatch");
    const nowMs = now.getTime();
    const notBefore = Date.parse(grant.notBefore);
    const expiresAt = Date.parse(grant.expiresAt);
    if (notBefore - this.skewMs > nowMs) reasons.push("receipt_not_yet_valid");
    if (expiresAt <= nowMs) reasons.push("receipt_expired");
    if (expiresAt - notBefore > this.maxLifetimeMs) reasons.push("receipt_lifetime_exceeded");
    let revocation: RevocationState | undefined;
    if (grant.revocationHandle.registryId !== this.options.revocations.registryId) {
      reasons.push("revocation_registry_mismatch");
    } else {
      // The registry is authoritative. The receipt's own revocation field can only make things stricter.
      revocation = this.options.revocations.status(grant.principal.id, grant.revocationHandle.serial, now);
      if (revocation.status === "revoked" || receipt.revocation.status === "revoked") reasons.push("receipt_revoked");
    }
    if (this.ledgers.get(receipt.receiptId)?.frozen) reasons.push("receipt_frozen");
    return { reasons: unique(reasons), revocation };
  }

  private ledger(receipt: AuthorizationReceipt): Ledger {
    let ledger = this.ledgers.get(receipt.receiptId);
    if (!ledger) {
      ledger = { receipt, spent: 0n, held: 0n, frozen: false, attempts: new Map() };
      this.ledgers.set(receipt.receiptId, ledger);
    }
    return ledger;
  }

  private remaining(ledger: Ledger): bigint {
    const left = BigInt(ledger.receipt.grant.maxAmount.value) - ledger.spent - ledger.held;
    return left > 0n ? left : 0n;
  }

  // ---- authorization -----------------------------------------------------------------------

  private async authorizeLocked(receipt: AuthorizationReceipt, actionInput: unknown): Promise<AuthorizationDecision> {
    const first = this.validate(receipt, this.now());
    const deny = (reasons: AuthorizationReason[], extra: Partial<AuthorizationDecision> = {}) =>
      this.denied(reasons, { receiptId: receipt.receiptId, revocation: first.revocation, ...extra });
    if (first.reasons.length) return deny(first.reasons);
    let action: PaymentAction;
    try {
      action = parsePaymentAction(actionInput);
    } catch (error) {
      return deny([reasonOf(error, "action_malformed")]);
    }
    const grant = receipt.grant;
    if (grant.usage.kind === "metered") return deny(["usage_mode_mismatch"]);
    if (action.rail !== grant.instrument.rail) return deny(["rail_mismatch"]);

    const ledger = this.ledger(receipt);
    const actionHash = canonicalHash(action);
    const prior = ledger.attempts.get(action.idempotencyKey);
    if (prior) {
      if (prior.actionHash !== actionHash) return deny(["idempotency_conflict"], { attemptId: prior.attemptId });
      if (prior.status === "failed" || prior.status === "cancelled") return deny(["attempt_closed"], { attemptId: prior.attemptId, replayed: true });
      return this.authorized(prior, ledger, first.revocation, true);
    }

    const attemptId = `att_${canonicalHash({ receiptId: receipt.receiptId, idempotencyKey: action.idempotencyKey }).slice(0, 40)}`;
    const built = await this.buildOrder(receipt, action, attemptId);
    if ("reasons" in built) return deny(built.reasons);

    // Everything below is synchronous, so the checks and the commit cannot interleave with other calls.
    const second = this.validate(receipt, this.now());
    if (second.reasons.length) return deny(second.reasons);
    const live = [...ledger.attempts.values()].some((item) => ["authorized", "claimed", "settled"].includes(item.status));
    if (grant.usage.kind === "one_shot" && live) return deny(["receipt_consumed"]);
    if (built.reservedRef && this.reservedRefs.has(built.reservedRef)) return deny(["invoice_already_used"]);
    const hold = built.amount + built.maxFee;
    const remaining = this.remaining(ledger);
    if (hold > remaining) return deny(["amount_exceeds_remaining"], { remaining: remaining.toString() });

    const attempt: Attempt = {
      attemptId,
      receiptId: receipt.receiptId,
      idempotencyKey: action.idempotencyKey,
      actionHash,
      order: built.order,
      amount: built.amount,
      maxFee: built.maxFee,
      hold,
      outstanding: hold,
      status: "authorized",
      reservedRef: built.reservedRef,
      broadcastTxids: [],
      captureClosed: false,
      evidenceHashes: [],
      breaches: []
    };
    ledger.attempts.set(action.idempotencyKey, attempt);
    this.attempts.set(attemptId, attempt);
    ledger.held += hold;
    if (built.reservedRef) this.reservedRefs.set(built.reservedRef, attemptId);
    this.record("attempt_authorized", { actionHash, hold: hold.toString() }, attempt);
    return this.authorized(attempt, ledger, second.revocation, false);
  }

  private async buildOrder(
    receipt: AuthorizationReceipt,
    action: PaymentAction,
    attemptId: string
  ): Promise<{ order: ExecutionOrder; amount: bigint; maxFee: bigint; reservedRef?: string } | { reasons: AuthorizationReason[] }> {
    const { instrument, destination } = receipt.grant;
    const base = { attemptId, receiptId: receipt.receiptId };
    const reasons: AuthorizationReason[] = [];

    if (action.rail === "card" && instrument.rail === "card" && destination.rail === "card") {
      if (action.merchantId !== destination.merchantId) reasons.push("destination_mismatch");
      if (destination.mccs && !destination.mccs.includes(action.mcc)) reasons.push("mcc_not_allowed");
      if (action.currency !== instrument.currency) reasons.push("currency_mismatch");
      if (action.amountMinor === "0") reasons.push("action_malformed");
      if (!this.options.cardVerifier) reasons.push("rail_unavailable");
      if (reasons.length) return { reasons };
      const order: ExecutionOrder = {
        rail: "card", ...base, instrument: { ...instrument }, merchantId: action.merchantId, mcc: action.mcc, amountMinor: action.amountMinor, currency: action.currency
      };
      return { order, amount: BigInt(action.amountMinor), maxFee: 0n };
    }

    if (action.rail === "lightning" && instrument.rail === "lightning" && destination.rail === "lightning") {
      if (!this.options.lightningDecoder) return { reasons: ["rail_unavailable"] };
      let invoice: DecodedLightningInvoice;
      try {
        invoice = readDecodedInvoice(await this.options.lightningDecoder.decode(action.invoice));
      } catch {
        return { reasons: ["invoice_undecodable"] };
      }
      if (invoice.network !== instrument.network) reasons.push("invoice_network_mismatch");
      if (invoice.payeeNodeId !== destination.payeeNodeId) reasons.push("destination_mismatch");
      if (destination.paymentHash && invoice.paymentHash !== destination.paymentHash) reasons.push("payment_hash_mismatch");
      if (!invoice.amountMsat || invoice.amountMsat === "0") reasons.push("invoice_amount_missing");
      if (Date.parse(invoice.expiresAt) <= this.now().getTime()) reasons.push("invoice_expired");
      if (reasons.length) return { reasons };
      const order: ExecutionOrder = {
        rail: "lightning", ...base, instrument: { ...instrument }, invoice: action.invoice, paymentHash: invoice.paymentHash,
        amountMsat: invoice.amountMsat!, maxFeeMsat: action.maxFeeMsat
      };
      return { order, amount: BigInt(invoice.amountMsat!), maxFee: BigInt(action.maxFeeMsat), reservedRef: `ln:${invoice.paymentHash}` };
    }

    if (action.rail === "onchain" && instrument.rail === "onchain" && destination.rail === "onchain") {
      let address: string;
      try {
        address = normalizeOnchainAddress(instrument.chain, instrument.network, action.address, "action_malformed");
      } catch {
        return { reasons: ["destination_mismatch"] };
      }
      if (address !== destination.address) reasons.push("destination_mismatch");
      if (action.amountSats === "0") reasons.push("action_malformed");
      if (!this.options.onchainObserverFor?.(instrument)) reasons.push("rail_unavailable");
      if (reasons.length) return { reasons };
      const order: ExecutionOrder = {
        rail: "onchain", ...base, instrument: { ...instrument }, address, amountSats: action.amountSats, maxFeeSats: action.maxFeeSats
      };
      return { order, amount: BigInt(action.amountSats), maxFee: BigInt(action.maxFeeSats) };
    }
    return { reasons: ["rail_mismatch"] };
  }

  // ---- settlement --------------------------------------------------------------------------

  private async settleLocked(attempt: Attempt, evidenceInput: unknown): Promise<SettlementResult> {
    const ledger = this.ledgers.get(attempt.receiptId)!;
    const reject = (reasons: AuthorizationReason[]) => {
      this.record("settlement_rejected", { reasons }, attempt);
      return this.settlementResult("rejected", reasons, attempt.attemptId, attempt.receiptId);
    };
    let evidence: SettlementEvidence;
    try {
      evidence = parseSettlementEvidence(evidenceInput);
    } catch (error) {
      return reject([reasonOf(error, "evidence_malformed")]);
    }
    const evidenceHash = canonicalHash(evidence);
    if (evidence.rail !== attempt.order.rail) return reject(["evidence_rail_mismatch"]);
    if (attempt.status === "settled") {
      if (attempt.evidenceHashes.includes(evidenceHash)) return this.settledResult(attempt, ledger, true);
      // A preimage settles its invoice once; a card or on-chain attempt can move money again.
      if (evidence.rail === "lightning") return reject(["attempt_closed"]);
    } else if (attempt.status === "authorized") {
      return reject(["attempt_not_executed"]);
    } else if (attempt.status === "cancelled") {
      // Never claimed, so no executor ever held this order.
      return reject(["attempt_closed"]);
    }

    const verdict = await this.verifyEvidence(attempt, evidence);
    if (verdict.status === "pending") {
      this.record("settlement_pending", { reasons: verdict.reasons }, attempt);
      return this.settlementResult("pending", verdict.reasons, attempt.attemptId, attempt.receiptId);
    }
    if (verdict.status === "rejected") return reject(verdict.reasons);

    // Synchronous commit: a reference settles at most one attempt across every receipt.
    if (this.settlementRefs.has(verdict.ref)) return reject(["settlement_reference_reused"]);
    this.settlementRefs.set(verdict.ref, attempt.attemptId);
    const breaches = [...verdict.breaches];
    // A failed attempt's hold was already released; proof that it paid anyway is still recorded.
    if (attempt.status === "failed") {
      breaches.push("settled_after_failure");
      attempt.captureClosed = true;
    }
    if (attempt.status === "settled" && attempt.order.rail === "onchain") breaches.push("duplicate_payment");
    attempt.status = "settled";
    attempt.settledAmount = (attempt.settledAmount ?? 0n) + verdict.amount;
    ledger.spent += verdict.amount;
    // The processor may still capture the rest of a card authorization, so that part stays held.
    const residual = attempt.order.rail === "card" && !attempt.captureClosed ? attempt.amount - attempt.settledAmount : 0n;
    this.release(attempt, ledger, residual > 0n ? residual : 0n);
    attempt.evidenceHashes.push(evidenceHash);
    attempt.breaches.push(...breaches);
    this.record("settlement_recorded", { ref: verdict.ref, amount: verdict.amount.toString(), breaches }, attempt);
    if (breaches.length) this.freeze(ledger, attempt, breaches);
    return { ...this.settledResult(attempt, ledger, false), breaches };
  }

  private async verifyEvidence(attempt: Attempt, evidence: SettlementEvidence): Promise<Verdict> {
    const order = attempt.order;
    if (evidence.rail === "card" && order.rail === "card") return this.verifyCard(attempt, order, evidence);
    if (evidence.rail === "lightning" && order.rail === "lightning") {
      if (evidence.paymentHash !== order.paymentHash) return { status: "rejected", reasons: ["payment_hash_mismatch"] };
      if (sha256Hex(Buffer.from(evidence.preimage, "hex")) !== order.paymentHash) return { status: "rejected", reasons: ["preimage_mismatch"] };
      // The preimage proves payment but not the routing fee, so the full fee allowance is charged.
      return { status: "settled", amount: attempt.amount + attempt.maxFee, ref: `ln:${order.paymentHash}`, breaches: [] };
    }
    if (evidence.rail === "onchain" && order.rail === "onchain") return this.verifyOnchain(attempt, order, evidence);
    return { status: "rejected", reasons: ["evidence_rail_mismatch"] };
  }

  private verifyCard(attempt: Attempt, order: Extract<ExecutionOrder, { rail: "card" }>, evidence: CardCaptureEvidence): Verdict {
    let authentic = false;
    try {
      authentic = this.options.cardVerifier?.verify(evidence) === true;
    } catch {
      authentic = false;
    }
    if (!authentic) return { status: "rejected", reasons: ["card_signature_invalid"] };
    if (evidence.reference !== attempt.attemptId) return { status: "rejected", reasons: ["card_reference_mismatch"] };
    const amount = BigInt(evidence.amountMinor);
    const breaches: BreachReason[] = [];
    // Authentic and bound to this attempt, so the money moved even if it disagrees with the grant.
    if (evidence.instrumentId !== order.instrument.instrumentId || evidence.merchantId !== order.merchantId || evidence.currency !== order.currency) {
      breaches.push("card_capture_mismatch");
    }
    const captured = attempt.status === "settled" ? attempt.settledAmount ?? 0n : 0n;
    if (attempt.status === "settled" && attempt.captureClosed) breaches.push("capture_after_close");
    else if (attempt.status === "settled" && captured >= attempt.amount) breaches.push("duplicate_capture");
    else if (captured + amount > attempt.amount) breaches.push("card_overcapture");
    return { status: "settled", amount, ref: `card:${evidence.processorEventId}`, breaches };
  }

  private async verifyOnchain(
    attempt: Attempt,
    order: Extract<ExecutionOrder, { rail: "onchain" }>,
    evidence: OnchainSettlementEvidence
  ): Promise<Verdict> {
    if (!attempt.broadcastTxids.includes(evidence.txid)) return { status: "rejected", reasons: ["txid_not_recorded"] };
    const observer = this.options.onchainObserverFor?.(order.instrument);
    if (!observer) return { status: "rejected", reasons: ["rail_unavailable"] };
    let paid = 0n;
    let fee: bigint | undefined;
    let walletDebit: bigint | undefined;
    let state: string;
    let confirmations: number;
    try {
      const observation = await observer.observeWithdrawal(evidence.txid);
      if (observation.txid !== evidence.txid) return { status: "rejected", reasons: ["observer_error"] };
      state = observation.state;
      confirmations = observation.confirmations;
      for (const output of observation.outputs) {
        if (!output.address) continue;
        let address: string;
        try {
          address = normalizeOnchainAddress(order.instrument.chain, order.instrument.network, output.address, "evidence_malformed");
        } catch {
          continue;
        }
        if (address === order.address) paid += BigInt(readAtoms(output.valueSats, "output.valueSats", "evidence_malformed"));
      }
      if (observation.feeSats !== undefined) fee = BigInt(readAtoms(observation.feeSats, "feeSats", "evidence_malformed"));
      if (observation.walletNetDebitSats !== undefined) {
        walletDebit = BigInt(readAtoms(observation.walletNetDebitSats, "walletNetDebitSats", "evidence_malformed"));
      }
    } catch {
      return { status: "rejected", reasons: ["observer_error"] };
    }
    if (state === "missing" || state === "reorged") return { status: "rejected", reasons: ["tx_not_found"] };
    if (paid < attempt.amount) return { status: "rejected", reasons: ["tx_output_missing"] };
    if (fee === undefined) return { status: "rejected", reasons: ["fee_unobservable"] };
    if (walletDebit === undefined || walletDebit < paid + fee) return { status: "rejected", reasons: ["tx_not_from_wallet"] };
    if (state !== "confirmed" || confirmations < this.minConfirmations) return { status: "pending", reasons: ["tx_not_confirmed"] };
    const breaches: BreachReason[] = [];
    if (paid > attempt.amount || walletDebit > paid + fee) breaches.push("onchain_overpayment");
    if (fee > attempt.maxFee) breaches.push("fee_exceeds_max");
    return { status: "settled", amount: walletDebit, ref: `onchain:${evidence.txid}`, breaches };
  }

  // ---- metering ----------------------------------------------------------------------------

  private chargeLocked(receipt: AuthorizationReceipt, eventInput: unknown): MeterChargeResult {
    const now = this.now();
    const reject = (reasons: AuthorizationReason[], eventId?: string) => {
      this.record("meter_rejected", { reasons, eventId }, { receiptId: receipt.receiptId });
      return this.meterResult("rejected", reasons, receipt.receiptId, eventId);
    };
    let event: MeterChargeEvent;
    try {
      event = parseMeterChargeEvent(eventInput);
    } catch (error) {
      return reject([reasonOf(error, "meter_event_malformed")]);
    }
    let authentic = false;
    try {
      authentic = this.options.meterVerifier?.verify(event) === true;
    } catch {
      authentic = false;
    }
    if (!authentic) return reject(["meter_signature_invalid"], event.eventId);

    // Duplicate detection runs before validity, so a provider's retry is a no-op even after revocation.
    const eventHash = canonicalHash(event);
    const meter = this.meters.get(event.meterId) ?? { events: new Map<string, MeterRecord>(), sequences: new Set<number>() };
    const prior = meter.events.get(event.eventId);
    if (prior) {
      if (prior.receiptId !== receipt.receiptId || prior.eventHash !== eventHash) return reject(["meter_event_conflict"], event.eventId);
      const ledger = this.ledgers.get(receipt.receiptId)!;
      this.record("meter_duplicate", { eventId: event.eventId }, { receiptId: receipt.receiptId });
      return this.meterResult("duplicate", [], receipt.receiptId, event.eventId, prior.amount, ledger);
    }

    const { reasons } = this.validate(receipt, now);
    if (reasons.length) return reject(reasons, event.eventId);
    const grant = receipt.grant;
    if (grant.usage.kind !== "metered") return reject(["usage_mode_mismatch"], event.eventId);
    if (grant.usage.meterId !== event.meterId || event.receiptId !== receipt.receiptId) return reject(["meter_mismatch"], event.eventId);
    const amount = BigInt(event.amount);
    if (amount === 0n || amount !== BigInt(event.quantity) * BigInt(event.unitPrice)) return reject(["meter_amount_mismatch"], event.eventId);
    const windowStart = Date.parse(event.windowStart);
    const windowEnd = Date.parse(event.windowEnd);
    if (windowEnd <= windowStart || windowStart < Date.parse(grant.notBefore) || windowEnd > Date.parse(grant.expiresAt)
      || windowEnd > now.getTime() + this.skewMs) {
      return reject(["meter_window_invalid"], event.eventId);
    }
    if (meter.sequences.has(event.sequence)) return reject(["duplicate_meter_sequence"], event.eventId);
    for (const record of meter.events.values()) {
      if (windowStart < record.windowEnd && record.windowStart < windowEnd) return reject(["overlapping_usage_window"], event.eventId);
    }
    const ledger = this.ledger(receipt);
    if (amount > this.remaining(ledger)) return reject(["amount_exceeds_remaining"], event.eventId);

    meter.events.set(event.eventId, { receiptId: receipt.receiptId, eventHash, windowStart, windowEnd, amount });
    meter.sequences.add(event.sequence);
    this.meters.set(event.meterId, meter);
    ledger.spent += amount;
    this.record("meter_charged", { eventId: event.eventId, amount: amount.toString() }, { receiptId: receipt.receiptId });
    return this.meterResult("charged", [], receipt.receiptId, event.eventId, amount, ledger);
  }

  // ---- helpers -----------------------------------------------------------------------------

  private ticketFor(attempt: Attempt): string {
    const mac = hmacBase64url(this.options.ticketKey, TICKET_DOMAIN, {
      attemptId: attempt.attemptId,
      receiptId: attempt.receiptId,
      actionHash: attempt.actionHash,
      hold: attempt.hold.toString()
    });
    return `${attempt.attemptId}.${mac}`;
  }

  private attemptForTicket(ticket: unknown): Attempt | undefined {
    if (typeof ticket !== "string" || ticket.length > 256) return undefined;
    const separator = ticket.indexOf(".");
    if (separator < 1) return undefined;
    const attempt = this.attempts.get(ticket.slice(0, separator));
    return attempt && constantTimeEqual(ticket, this.ticketFor(attempt)) ? attempt : undefined;
  }

  private close(attempt: Attempt, ledger: Ledger, status: "failed" | "cancelled") {
    this.release(attempt, ledger);
    attempt.status = status;
    if (attempt.reservedRef && this.reservedRefs.get(attempt.reservedRef) === attempt.attemptId) this.reservedRefs.delete(attempt.reservedRef);
  }

  /** Lowers the attempt's outstanding hold to `keep` (never raises it). */
  private release(attempt: Attempt, ledger: Ledger, keep = 0n) {
    if (keep >= attempt.outstanding) return;
    ledger.held -= attempt.outstanding - keep;
    attempt.outstanding = keep;
  }

  private freeze(ledger: Ledger, attempt: Attempt, reasons: AuthorizationReason[]) {
    if (ledger.frozen) return;
    ledger.frozen = true;
    this.record("receipt_frozen", { reasons }, attempt);
  }

  private async withLock<T>(key: string, task: () => Promise<T> | T): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(task);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  private record(type: AuthorizationEventType, payload: unknown, ids: { receiptId?: string; attemptId?: string }) {
    const material = {
      sequence: this.log.length,
      type,
      at: this.now().toISOString(),
      receiptId: ids.receiptId,
      attemptId: ids.attemptId,
      payloadHash: canonicalHash(payload),
      previousHash: this.log.at(-1)?.hash ?? GENESIS_HASH
    };
    this.log.push({ ...material, hash: canonicalHash(material) });
  }

  private denied(reasons: AuthorizationReason[], extra: Partial<AuthorizationDecision> = {}): AuthorizationDecision {
    this.record("attempt_denied", { reasons }, { receiptId: extra.receiptId, attemptId: extra.attemptId });
    return { schema: "bitagent_authorization_decision_v1", decision: "denied", reasons: unique(reasons), replayed: false, ...extra };
  }

  private authorized(attempt: Attempt, ledger: Ledger, revocation: RevocationState | undefined, replayed: boolean): AuthorizationDecision {
    return {
      schema: "bitagent_authorization_decision_v1",
      decision: "authorized",
      reasons: ["authorized"],
      receiptId: attempt.receiptId,
      attemptId: attempt.attemptId,
      attemptStatus: attempt.status,
      holdAmount: attempt.hold.toString(),
      remaining: this.remaining(ledger).toString(),
      replayed,
      revocation,
      ...(attempt.status === "authorized" ? { ticket: this.ticketFor(attempt) } : {})
    };
  }

  private settlementResult(status: SettlementResult["status"], reasons: AuthorizationReason[], attemptId: string, receiptId?: string): SettlementResult {
    return { schema: "bitagent_authorization_settlement_v1", status, reasons: unique(reasons), attemptId, receiptId, breaches: [], replayed: false };
  }

  private settledResult(attempt: Attempt, ledger: Ledger, replayed: boolean): SettlementResult {
    return {
      schema: "bitagent_authorization_settlement_v1",
      status: "settled",
      reasons: [],
      attemptId: attempt.attemptId,
      receiptId: attempt.receiptId,
      settledAmount: (attempt.settledAmount ?? 0n).toString(),
      breaches: [...attempt.breaches],
      spent: ledger.spent.toString(),
      remaining: this.remaining(ledger).toString(),
      replayed
    };
  }

  private meterResult(
    status: MeterChargeResult["status"],
    reasons: AuthorizationReason[],
    receiptId?: string,
    eventId?: string,
    amount?: bigint,
    ledger?: Ledger
  ): MeterChargeResult {
    return {
      schema: "bitagent_authorization_meter_charge_v1",
      status,
      reasons: unique(reasons),
      receiptId,
      eventId,
      ...(amount !== undefined ? { amount: amount.toString() } : {}),
      ...(ledger ? { spent: ledger.spent.toString(), remaining: this.remaining(ledger).toString() } : {})
    };
  }
}

/** The decoder is trusted host code, but its output is still shape-checked before use. */
function readDecodedInvoice(value: unknown): DecodedLightningInvoice {
  const code = "action_malformed" as const;
  const input = readObject(value, "decoded invoice", code);
  const expiresAt = input.expiresAt;
  if (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) throw new AuthorizationError(code, "decoded invoice expiry invalid");
  return {
    network: readEnum(input.network, "decoded.network", code, ["mainnet", "testnet", "testnet4", "signet", "regtest"] as const),
    payeeNodeId: normalizeNodeId(input.payeeNodeId, "decoded.payeeNodeId", code),
    paymentHash: readString(input.paymentHash, "decoded.paymentHash", code, HEX32, 64),
    ...(input.amountMsat !== undefined ? { amountMsat: readAtoms(input.amountMsat, "decoded.amountMsat", code) } : {}),
    expiresAt
  };
}

export function verifyAuthorizationEventLog(events: AuthorizationEvent[]): boolean {
  let previousHash = GENESIS_HASH;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event || event.sequence !== index || event.previousHash !== previousHash) return false;
    const { hash, ...material } = event;
    if (canonicalHash(material) !== hash) return false;
    previousHash = hash;
  }
  return true;
}
