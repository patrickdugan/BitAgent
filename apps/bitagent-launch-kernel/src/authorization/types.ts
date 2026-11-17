export type Rail = "card" | "lightning" | "onchain";
export type CardNetwork = "visa" | "mastercard" | "amex" | "discover";
export type LightningNetwork = "mainnet" | "testnet" | "testnet4" | "signet" | "regtest";
export type OnchainChain = "bitcoin" | "litecoin";
export type OnchainNetwork = "mainnet" | "testnet" | "testnet4" | "signet" | "regtest";

// ---- the six fields every authorization receipt carries -----------------------------------

/** Who grants the authority. keyId must belong to this principal in the host's key store. */
export type PrincipalRef = { id: string; keyId: string };

/** Card instruments are processor tokens; a raw card number (PAN) is rejected at issuance. */
export type CardInstrument = { rail: "card"; instrumentId: string; network: CardNetwork; currency: string };
export type LightningInstrument = { rail: "lightning"; nodeId: string; network: LightningNetwork };
export type OnchainInstrument = { rail: "onchain"; chain: OnchainChain; network: OnchainNetwork; walletId: string };
export type AuthorizationInstrument = CardInstrument | LightningInstrument | OnchainInstrument;

export type CardDestination = { rail: "card"; merchantId: string; mccs?: string[] };
/** paymentHash pins the receipt to one invoice; without it any invoice from the payee qualifies. */
export type LightningDestination = { rail: "lightning"; payeeNodeId: string; paymentHash?: string };
export type OnchainDestination = { rail: "onchain"; address: string };
export type AuthorizationDestination = CardDestination | LightningDestination | OnchainDestination;

/** Cumulative cap over the receipt's life, in the rail's smallest unit (card minor units, msat, sat). */
export type AmountUnit = "minor" | "msat" | "sat";
export type MaxAmount = { asset: string; unit: AmountUnit; value: string };

export type RevocationHandle = { registryId: string; serial: string };

export type UsageMode = { kind: "one_shot" } | { kind: "multi_use" } | { kind: "metered"; meterId: string };

/** The principal-signed part of the receipt. receiptId is the domain-separated hash of this object. */
export type AuthorizationGrant = {
  schema: "bitagent_authorization_grant_v1";
  principal: PrincipalRef;
  agentId: string;
  instrument: AuthorizationInstrument;
  destination: AuthorizationDestination;
  maxAmount: MaxAmount;
  usage: UsageMode;
  notBefore: string;
  expiresAt: string;
  revocationHandle: RevocationHandle;
  nonce: string;
};

/**
 * Revocation state as last observed. It travels with the receipt for display but is not
 * signed by the principal and is never trusted: the gate re-reads the registry on every use.
 */
export type RevocationState = {
  status: "active" | "revoked";
  registryId: string;
  serial: string;
  checkedAt: string;
  revokedAt?: string;
  reason?: string;
};

export type AuthorizationReceipt = {
  schema: "bitagent_authorization_receipt_v1";
  receiptId: string;
  grant: AuthorizationGrant;
  signature: { algorithm: "Ed25519"; value: string };
  revocation: RevocationState;
};

export type SignedRevocation = {
  schema: "bitagent_authorization_revocation_v1";
  registryId: string;
  principalId: string;
  keyId: string;
  serial: string;
  signedAt: string;
  reason: string;
  signature: string;
};

// ---- agent-requested actions ----------------------------------------------------------------

export type CardChargeAction = {
  rail: "card";
  idempotencyKey: string;
  merchantId: string;
  mcc: string;
  amountMinor: string;
  currency: string;
};
/** The invoice is decoded by the host's own Lightning node, never by the requesting tool. */
export type LightningPaymentAction = { rail: "lightning"; idempotencyKey: string; invoice: string; maxFeeMsat: string };
export type OnchainSendAction = {
  rail: "onchain";
  idempotencyKey: string;
  address: string;
  amountSats: string;
  maxFeeSats: string;
};
export type PaymentAction = CardChargeAction | LightningPaymentAction | OnchainSendAction;

/** What the executor is told to do. Built from the gate's stored copy, never from the tool's request. */
export type ExecutionOrder =
  | { rail: "card"; attemptId: string; receiptId: string; instrument: CardInstrument; merchantId: string; mcc: string; amountMinor: string; currency: string }
  | { rail: "lightning"; attemptId: string; receiptId: string; instrument: LightningInstrument; invoice: string; paymentHash: string; amountMsat: string; maxFeeMsat: string }
  | { rail: "onchain"; attemptId: string; receiptId: string; instrument: OnchainInstrument; address: string; amountSats: string; maxFeeSats: string };

// ---- rail payment receipts (settlement evidence) --------------------------------------------

/** Processor capture webhook; authenticated by the processor's HMAC, bound to the attempt by reference. */
export type CardCaptureEvidence = {
  rail: "card";
  processorEventId: string;
  reference: string;
  instrumentId: string;
  merchantId: string;
  amountMinor: string;
  currency: string;
  authorizationCode: string;
  signature: string;
};
/** The preimage proves the invoice was paid; amounts come from the decoded invoice, not the tool. */
export type LightningSettlementEvidence = { rail: "lightning"; paymentHash: string; preimage: string };
/** Only a txid: outputs, fee and wallet debit are read from the host's chain observer. */
export type OnchainSettlementEvidence = { rail: "onchain"; txid: string };
export type SettlementEvidence = CardCaptureEvidence | LightningSettlementEvidence | OnchainSettlementEvidence;

/** A metering provider's signed usage charge, bound to one metered receipt by receiptId. */
export type MeterChargeEvent = {
  receiptId: string;
  meterId: string;
  eventId: string;
  sequence: number;
  windowStart: string;
  windowEnd: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  signature: string;
};

// ---- trusted host seams ---------------------------------------------------------------------

export type DecodedLightningInvoice = {
  network: LightningNetwork;
  payeeNodeId: string;
  paymentHash: string;
  amountMsat?: string;
  expiresAt: string;
};

/** Backed by the host's Lightning node (decodepay / DecodePayReq), which checks the invoice signature. */
export interface LightningInvoiceDecoder {
  decode(invoice: string): Promise<DecodedLightningInvoice> | DecodedLightningInvoice;
}

export type OnchainObservation = {
  txid: string;
  state: "missing" | "mempool" | "confirmed" | "reorged";
  confirmations: number;
  outputs: Array<{ vout: number; valueSats: string; address?: string }>;
  feeSats?: string;
  /** Net amount the host wallet lost in this tx; proves the tx was ours, not a stranger's. */
  walletNetDebitSats?: string;
};

/** Structurally compatible with settlement/types.ts BitcoinWithdrawalReadSource. */
export interface OnchainPaymentObserver {
  observeWithdrawal(txid: string): Promise<OnchainObservation>;
}

export interface CardCaptureVerifier {
  verify(evidence: CardCaptureEvidence): boolean;
}

export interface MeterEventVerifier {
  verify(event: MeterChargeEvent): boolean;
}

// ---- outcomes -------------------------------------------------------------------------------

export type ReceiptReason =
  | "receipt_malformed"
  | "receipt_id_mismatch"
  | "unknown_signing_key"
  | "signing_key_revoked"
  | "signing_key_not_valid_at_time"
  | "principal_key_mismatch"
  | "signature_invalid"
  | "agent_mismatch"
  | "receipt_not_yet_valid"
  | "receipt_expired"
  | "receipt_lifetime_exceeded"
  | "revocation_registry_mismatch"
  | "receipt_revoked"
  | "receipt_frozen";

export type ActionReason =
  | "action_malformed"
  | "rail_mismatch"
  | "rail_unavailable"
  | "usage_mode_mismatch"
  | "destination_mismatch"
  | "mcc_not_allowed"
  | "currency_mismatch"
  | "invoice_undecodable"
  | "invoice_network_mismatch"
  | "invoice_amount_missing"
  | "invoice_expired"
  | "invoice_already_used"
  | "payment_hash_mismatch"
  | "amount_exceeds_remaining"
  | "receipt_consumed"
  | "idempotency_conflict";

export type ExecutionReason =
  | "ticket_invalid"
  | "ticket_already_claimed"
  | "attempt_closed"
  | "unknown_attempt"
  | "txid_recorded_elsewhere"
  | "broadcast_limit_reached";

export type SettlementReason =
  | "attempt_not_executed"
  | "evidence_malformed"
  | "evidence_rail_mismatch"
  | "card_signature_invalid"
  | "card_reference_mismatch"
  | "preimage_mismatch"
  | "settlement_reference_reused"
  | "observer_error"
  | "txid_not_recorded"
  | "tx_not_found"
  | "tx_not_confirmed"
  | "tx_output_missing"
  | "tx_not_from_wallet"
  | "fee_unobservable";

export type BreachReason =
  | "card_overcapture"
  | "card_capture_mismatch"
  | "duplicate_capture"
  | "capture_after_close"
  | "onchain_overpayment"
  | "duplicate_payment"
  | "fee_exceeds_max"
  | "settled_after_failure";

export type MeterReason =
  | "meter_event_malformed"
  | "meter_signature_invalid"
  | "meter_mismatch"
  | "meter_amount_mismatch"
  | "meter_window_invalid"
  | "meter_event_conflict"
  | "duplicate_meter_sequence"
  | "overlapping_usage_window";

export type AuthorizationReason =
  | "authorized"
  | ReceiptReason
  | ActionReason
  | ExecutionReason
  | SettlementReason
  | BreachReason
  | MeterReason
  | "revocation_malformed";

export type AttemptStatus = "authorized" | "claimed" | "settled" | "failed" | "cancelled";

export type AuthorizationDecision = {
  schema: "bitagent_authorization_decision_v1";
  decision: "authorized" | "denied";
  reasons: AuthorizationReason[];
  receiptId?: string;
  attemptId?: string;
  attemptStatus?: AttemptStatus;
  holdAmount?: string;
  remaining?: string;
  replayed: boolean;
  revocation?: RevocationState;
  /** Single-use executor ticket. Hosts route it to the executor; agent tools never see it. */
  ticket?: string;
};

export type ClaimResult =
  | { claimed: true; order: ExecutionOrder }
  | { claimed: false; reasons: AuthorizationReason[] };

export type SettlementResult = {
  schema: "bitagent_authorization_settlement_v1";
  status: "settled" | "pending" | "rejected";
  reasons: AuthorizationReason[];
  attemptId: string;
  receiptId?: string;
  settledAmount?: string;
  breaches: BreachReason[];
  spent?: string;
  remaining?: string;
  replayed: boolean;
};

export type MeterChargeResult = {
  schema: "bitagent_authorization_meter_charge_v1";
  status: "charged" | "duplicate" | "rejected";
  reasons: AuthorizationReason[];
  receiptId?: string;
  eventId?: string;
  amount?: string;
  spent?: string;
  remaining?: string;
};

export type ReceiptStatus = {
  schema: "bitagent_authorization_receipt_status_v1";
  receiptId?: string;
  valid: boolean;
  reasons: AuthorizationReason[];
  revocation?: RevocationState;
  maxAmount?: MaxAmount;
  spent: string;
  held: string;
  remaining: string;
  frozen: boolean;
  attempts: Array<{ attemptId: string; status: AttemptStatus; hold: string; settledAmount?: string }>;
};

export type AuthorizationEventType =
  | "attempt_authorized"
  | "attempt_denied"
  | "attempt_claimed"
  | "claim_refused"
  | "attempt_failed"
  | "attempt_cancelled"
  | "attempt_broadcast"
  | "capture_closed"
  | "settlement_recorded"
  | "settlement_pending"
  | "settlement_rejected"
  | "receipt_frozen"
  | "meter_charged"
  | "meter_duplicate"
  | "meter_rejected";

export type AuthorizationEvent = {
  sequence: number;
  type: AuthorizationEventType;
  at: string;
  receiptId?: string;
  attemptId?: string;
  payloadHash: string;
  previousHash: string;
  hash: string;
};
