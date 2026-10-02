export type ActionClass =
  | "swap" | "bridge" | "deposit" | "place_limit" | "cancel"
  | "reduce_position" | "withdraw";

export type ReapprovalTrigger =
  | "scope_change" | "limit_change" | "budget_exhausted"
  | "strategy_drift" | "unresolved_price_conflict"
  | "reconciliation_mismatch" | "consecutive_rejections";

export type AssetRole = "spend" | "receive" | "both";

export type RunContract = {
  schema: "bitagent.run_contract.v1";
  contractId: string;
  version: number;
  parentContractHash?: string;
  source?: { schema: string; hash: string };
  principal: {
    walletAccount: string;
    walletProvider: "bitcoin_wallet" | "metamask" | "phantom";
    walletSessionId: string;
  };
  objective: {
    intent: string;
    summary: string;
    sourceUtteranceIds: string[];
  };
  scope: {
    chains: string[];
    assets: { asset: string; decimals: number; registryHash: string; role: AssetRole }[];
    venues: { id: string; kind: "router" | "dex" | "tradelayer" | "bridge"; codeHash?: string }[];
    destinations: { chain: string; address: string; label: "self" | "venue" }[];
    actions: ActionClass[];
  };
  limits: {
    perActionMaxAtoms: Record<string, string>;
    cumulativeMaxAtoms: Record<string, string>;
    maxTotalFeeAtoms: Record<string, string>;
    maxActions: number;
    maxSlippageBps: number;
    maxQuoteAgeMs: number;
    minPriceSources: number;
    maxPriceDeviationBps: number;
    maxLossBps?: number;
  };
  strategy?: {
    strategyId: string;
    strategyVersion: string;
    paramsHash: string;
    driftBoundsBps: number;
  };
  autonomy: {
    mode: "per_action_approval" | "delegated_within_contract";
    reapprovalTriggers: ReapprovalTrigger[];
  };
  stop: {
    expiresAt: string;
    maxModelTurns: number;
    maxWallMs: number;
    haltOnIncident: boolean;
  };
  runtime: {
    modelHash: string;
    adapterHash: string;
    harnessHash: string;
    toolRegistryHash: string;
  };
  effectiveAt: string;
  contractHash: string;
};

export type RunContractApproval = {
  schema: "bitagent.run_contract_approval.v1";
  contractHash: string;
  walletSessionId: string;
  status: "approved" | "revoked";
  approvedAt: string;
  walletApprovalRef: string;
};

export type InFlightAction = {
  idempotencyKey: string;
  envelopeId: string;
  submittedAt: string;
  spend: { asset: string; atoms: string };
  fees: { asset: string; atoms: string }[];
};

export type RunBudgetState = {
  schema: "bitagent.run_budget_state.v1";
  contractHash: string;
  spentAtoms: Record<string, string>;
  feeAtoms: Record<string, string>;
  actionsUsed: number;
  modelTurnsUsed: number;
  idempotencyKeys: string[];
  inFlight: InFlightAction[];
};

export type EvidenceFlag =
  | "stale" | "price_conflict" | "below_quorum" | "unregistered_asset"
  | "decimals_mismatch" | "chain_mismatch" | "contains_untrusted_text"
  | "unverified_claim" | "outcome_unknown";

export type EvidenceKind =
  | "user_utterance" | "quote" | "price" | "balance" | "token_metadata"
  | "tx_status" | "tool_error" | "simulation" | "model_note";

export type EvidenceTrust = "host_verified" | "provider_reported" | "untrusted_text";

export type EvidenceTyped = Record<string, string | number | boolean>;

export type EvidenceReceipt = {
  schema: "bitagent.evidence_receipt.v1";
  id: string;
  kind: EvidenceKind;
  source: { id: string; trust: EvidenceTrust };
  chain?: string;
  observedAt: string;
  expiresAt?: string;
  sequence?: string;
  typed: EvidenceTyped;
  taintedText?: { fieldPaths: string[]; sha256: string };
  flags: EvidenceFlag[];
  payloadSha256: string;
  registryRoot: string;
};

export type GateId =
  | "G01_contract_active" | "G02_chain_allowed" | "G03_asset_allowed"
  | "G04_venue_allowed" | "G05_destination_allowed" | "G06_action_allowed"
  | "G07_per_action_cap" | "G08_cumulative_cap" | "G09_quote_fresh"
  | "G10_price_quorum" | "G11_slippage_bound" | "G12_fee_cap"
  | "G13_units_consistent" | "G14_idempotent" | "G15_evidence_attested"
  | "G16_strategy_bound" | "G17_simulation_bound" | "G18_run_limits";

export type GateVerdict = {
  schema: "bitagent.gate_verdict.v1";
  admitted: boolean;
  checks: Record<GateId, boolean>;
  reasonCodes: string[];
  nextAuthority: "none" | "wallet_user" | "lease";
  policyHash: string;
};

export type EnvelopeFee = {
  asset: string;
  atoms: string;
  kind: "network" | "protocol" | "affiliate" | "outbound";
};

export type ActionEnvelopeDraft = {
  schema: "bitagent.action_envelope.v1";
  envelopeId: string;
  runId: string;
  contractHash: string;
  stepIndex: number;
  actionClass: ActionClass;
  chain: string;
  venueId: string;
  spend: { asset: string; atoms: string };
  receiveMin: { asset: string; atoms: string };
  destination: { chain: string; address: string };
  fees: EnvelopeFee[];
  intentRef: string;
  quoteRef: string;
  priceRefs: string[];
  limitPriceCents?: string;
  strategyParamsHash?: string;
  effectiveSlippageBps: number;
  payloadHash: string;
  idempotencyKey: string;
  simulationHash: string;
  expiresAt: string;
  authority: "deterministic_host";
  effect: "none";
  signingPerformed: false;
  broadcastPerformed: false;
};

export type ActionEnvelope = ActionEnvelopeDraft & { gate: GateVerdict };

export type ReconciliationRecord = {
  schema: "bitagent.reconciliation_record.v1";
  envelopeId: string;
  contractHash: string;
  simulated: Record<string, string>;
  observed: Record<string, string>;
  feeObserved: Record<string, string>;
  deviationBps: number;
  status: "matched" | "within_tolerance" | "mismatch" | "pending";
  discrepancyClass?:
    | "undisclosed_fee" | "transfer_tax" | "partial_fill" | "reorg"
    | "wrong_destination" | "duplicate_effect" | "unknown";
  budgetAfter: RunBudgetState;
  evidenceIds: string[];
  recordHash: string;
};
