export type SurvivalRail =
  | "bitcoin_onchain"
  | "lightning"
  | "thorchain"
  | "tradelayer"
  | "fedimint"
  | "ark"
  | "dlc"
  | "filecoin"
  | "akash"
  | "compute_market";

export type SurvivalPurpose = "compute" | "network" | "storage" | "security" | "recovery" | "strategy";
export type SurvivalBudget = "operations" | "strategy" | "reserve";

export type FinancialCapability =
  | "propose_psbt"
  | "pay_invoice_capped"
  | "propose_swap"
  | "propose_tradelayer_intake"
  | "propose_fedimint_payment"
  | "propose_vtxo_action"
  | "propose_dlc"
  | "propose_filecoin_storage"
  | "propose_compute_lease";

export type SpendIntent = {
  id: string;
  idempotencyKey: string;
  purpose: SurvivalPurpose;
  budget: SurvivalBudget;
  rail: SurvivalRail;
  asset: "BTC" | "LTC" | "ETH" | "USDC" | "FIL" | "AKT" | "ACT";
  amountAtoms: string;
  policyValueSats: string;
  destination: string;
  maxFeeSats: string;
  maxSlippageBps?: number;
  expiresAt: string;
  policyId: string;
  quoteHash?: string;
  sourceReceipts?: string[];
};

export type SurvivalObserver = {
  sourceId: string;
  subject: "treasury_balance" | "chain_tip" | "quote" | "channel_monitor" | "vtxo_expiry" | "oracle_set";
  observedAt: string;
  valueHash: string;
  healthy: boolean;
};

export type TreasurySnapshot = {
  capturedAt: string;
  balancesSats: Partial<Record<SurvivalRail, string>>;
  protectedReserveSats: string;
  encumberedSats: string;
  spentTodaySats: string;
  essentialDailyBurnSats: string;
  pendingFlightSats: string;
  observers: SurvivalObserver[];
  breakerAlerts?: string[];
};

export type SurvivalPolicy = {
  id: string;
  version: number;
  allowedPurposes: SurvivalPurpose[];
  allowedRails: SurvivalRail[];
  experimentalRails: SurvivalRail[];
  minimumRunwayDays: number;
  protectedReserveSats: string;
  maxSingleSpendSats: string;
  maxAutonomousSpendSats: string;
  maxDailySpendSats: string;
  maxFeePerActionSats: string;
  maxSlippageBps: number;
  maxIntentLifetimeSeconds: number;
  maxObservationAgeSeconds: number;
  minimumObserverQuorum: number;
  railCapsSats: Partial<Record<SurvivalRail, string>>;
};

export type SurvivalReasonCode =
  | "authorized"
  | "policy_mismatch"
  | "invalid_intent"
  | "intent_expired"
  | "intent_lifetime_exceeded"
  | "unsupported_purpose"
  | "unsupported_rail"
  | "quote_required"
  | "slippage_exceeded"
  | "fee_cap_exceeded"
  | "single_spend_cap_exceeded"
  | "daily_spend_cap_exceeded"
  | "rail_cap_exceeded"
  | "protected_reserve_breach"
  | "observer_quorum_missing"
  | "stale_observation"
  | "breaker_active"
  | "reserve_budget_forbidden"
  | "strategy_requires_manual_approval"
  | "autonomous_cap_exceeded"
  | "experimental_rail_requires_manual_approval";

export type PolicyDecision = {
  intentId: string;
  intentHash: string;
  constraintsHash: string;
  decision: "denied" | "manual_required" | "authorized";
  reasonCodes: SurvivalReasonCode[];
  nextCapability?: FinancialCapability;
  expiresAt: string;
};

export type SurvivalAssessment = {
  mode: "healthy" | "conserve" | "emergency" | "frozen";
  totalTreasurySats: string;
  availableOperatingSats: string;
  runwayDays: number | null;
  reasonCodes: SurvivalReasonCode[];
};

export type SurvivalJournalRecord = {
  sequence: number;
  eventId: string;
  type: "snapshot_assessed" | "intent_proposed" | "policy_decided" | "settlement_observed" | "reconciled";
  occurredAt: string;
  intentId?: string;
  payloadHash: string;
  previousHash: string;
  hash: string;
};
