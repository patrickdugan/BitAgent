import type {
  ActionEnvelope,
  EvidenceFlag,
  EvidenceKind,
  EvidenceTrust,
  EvidenceTyped,
  GateId,
  ReconciliationRecord,
  RunBudgetState,
  RunContract
} from "../runcontract/types.js";

export const DAG_CANDIDATE_V3_SCHEMA = "bitagent.dag_candidate.v3" as const;
export const DAG_TASK_V3_SCHEMA = "bitagent.dag_task_packet.v3" as const;

export type DagNodeV3 =
  | "observe" | "inspect" | "validate" | "simulate" | "display" | "approval"
  | "execute" | "verify" | "reconcile" | "complete"
  | "hold" | "recovery" | "incident";

export type DagDecisionV3 = "advance" | "hold" | "recover" | "abort" | "escalate" | "clarify";

export type ModelCandidateV3 = {
  schema: typeof DAG_CANDIDATE_V3_SCHEMA;
  task_id: string;
  decision: DagDecisionV3;
  next_node: DagNodeV3;
  tool: string;
  arg_refs: Record<string, string>;
  evidence_ids: string[];
  reason_code: string;
  risk_flags: string[];
  authority: "model_candidate";
  effect: "none";
};

export type AdmissibilityChecks = {
  schema_valid: boolean;
  task_bound: boolean;
  legal_transition: boolean;
  tool_allowed: boolean;
  refs_resolve: boolean;
  refs_untainted: boolean;
  authority_boundary: boolean;
};

export type AdmissibilityReceipt = {
  schema: "bitagent.dag_admissibility_receipt.v3";
  ok: boolean;
  checks: AdmissibilityChecks;
  arbiter: "accepted" | "deferred" | "rejected" | "fallback";
  margin?: number;
  hostAction: string;
  authorization: false;
  signing: false;
  execution: false;
  broadcast: false;
  secret_access: false;
};

export type HarnessLevel = "H1" | "H2" | "H3";

export type RunStatus =
  | "ACTIVE" | "CLOSED" | "HELD" | "CLARIFY" | "INCIDENT" | "EXPIRED" | "EXHAUSTED";

export type PacketReceipt = {
  id: string;
  kind: EvidenceKind;
  trust: EvidenceTrust;
  observedAt: string;
  flags: EvidenceFlag[];
  typed: EvidenceTyped;
  // Present only at H1. From H2 the host withholds untrusted text and shows its hash.
  untrusted_text?: Record<string, string>;
  untrusted_text_sha256?: string;
};

export type TaskPacketV3 = {
  schema: typeof DAG_TASK_V3_SCHEMA;
  task_id: string;
  run: { status: RunStatus; step: number; turns_remaining: number; intent_index: number; intent_count: number };
  current_node: DagNodeV3;
  // Null while the current turn's reading is unresolved; `intent_candidates` then lists every reading.
  intent_id: string | null;
  intent_candidates: string[];
  cycle: {
    quote_id: string | null;
    // One quote per candidate reading, by intent receipt ID.
    quotes: Record<string, string>;
    refresh_count: number;
    preflight: { gate_failed: GateId[]; error: string | null } | null;
    draft: { intent_ref: string; quote_ref: string } | null;
    simulation: {
      hash: string;
      expires_at: string;
      expired: boolean;
      admitted: boolean;
      gate_failed: GateId[];
    } | null;
    simulation_error: string | null;
    approval: { simulation_hash: string } | null;
    submission: { outcome: "submitted" | "unknown" } | null;
    verification: { status: "confirmed" | "pending" | "not_found" } | null;
    reconciliation: { status: ReconciliationRecord["status"] } | null;
  };
  contract_projection: {
    contract_hash: string;
    expires_at: string;
    actions: string[];
    spend_assets: string[];
    remaining_actions: number;
    in_flight: number;
  };
  receipts: PacketReceipt[];
  admissible: string[];
  allowed_candidate_tools: string[];
  required_response: { schema: typeof DAG_CANDIDATE_V3_SCHEMA; fixed: { authority: "model_candidate"; effect: "none" } };
  safety_boundary: {
    authority: "candidate_only";
    authorization: false;
    signing: false;
    execution: false;
    broadcast: false;
    secret_access: false;
  };
};

export type PolicyContext = { attempt: number; violations: string[] };

export type Policy = {
  id: string;
  // `unknown` on purpose: a policy may emit a malformed object and the host must reject it.
  propose(packet: TaskPacketV3, context: PolicyContext): unknown;
  // Top-two log-probability margin of the last proposal, when the policy is a scored model.
  margin?(): number | undefined;
};

export type AsyncPolicy = {
  id: string;
  propose(packet: TaskPacketV3, context: PolicyContext): Promise<unknown> | unknown;
  margin?(): number | undefined;
};

export type FaultKind =
  | "clock_advance" | "inject_receipt"
  | "tool_timeout" | "tool_malformed"
  | "quote_stale" | "quote_replay" | "quote_wrong_chain" | "quote_unlisted_venue"
  | "quote_fee_spike" | "quote_bad_limit" | "quote_impostor_asset" | "quote_low_receive"
  | "price_conflict" | "price_source_down"
  | "timeout_after_effect" | "timeout_no_effect" | "undisclosed_fee"
  | "provider_status_lie";

export type FaultSpec = {
  id: string;
  kind: FaultKind;
  // `step` fires when that decision step begins. `onTool` + `nth` fires on the nth call of a tool;
  // `params.persist` keeps it firing on every later call.
  at: { step?: number; onTool?: string; nth?: number };
  params: Record<string, unknown>;
};

export type WorldSpec = {
  clockStart: string;
  stepMs: number;
  chain: string;
  tip: number;
  balances: Record<string, string>;
  venueId: string;
  feeAsset: string;
  networkFeeAtoms: string;
  quoteTtlMs: number;
  priceSources: { id: string; markPriceCents: string }[];
  // Assets paired by action class: what a deposit or limit order returns for what it spends.
  receiveAsset: Record<string, string>;
};

export type ParsedIntent = {
  actionClass: string;
  asset: string;
  amountAtoms: string;
  amountText: string;
  amountUnit: string;
  destinationAddress?: string;
  strategyParamsHash?: string;
};

export type Scenario = {
  schema: "bitagent.bench_scenario.v1";
  id: string;
  templateId: string;
  tier: "T0" | "T1" | "T2" | "T3" | "T4";
  family: string;
  variant: "gate_visible" | "gate_invisible" | "benign_twin";
  twinOf?: string;
  // The gate this scenario is designed to exercise in isolation, for mutation coverage.
  isolates?: GateId;
  seed: number;
  world: WorldSpec;
  contract: { mode: "given"; contract: RunContract };
  // `parsed` is the deterministic parse of the turn. A turn with `alternatives` is ambiguous: the
  // host registers every reading and the model must pick the one the user's words support, or
  // ask. An alternative marked `critical` would move more value than the user asked for.
  user: {
    turns: {
      atStep: number;
      text: string;
      parsed: ParsedIntent;
      alternatives?: { parsed: ParsedIntent; critical?: boolean }[];
      oracle?: "parsed" | "clarify";
    }[];
  };
  faults: FaultSpec[];
  // Steps the adversarial reference policy walks, as "next_node" or "next_node:selector".
  adversary?: { plan: string[] };
  oracle: {
    // Overrides the rule planner where only scenario knowledge decides, keyed "intentIndex@node".
    decisionPoints: { trigger: string; preferred: string }[];
    terminal: { status: RunStatus; executions: number; ledgerDeltas?: Record<string, string> };
  };
  horizon: { expectedDecisions: number; maxDecisions: number };
};

export type WorldEffect = {
  effectId: string;
  txid: string;
  at: string;
  tip: number;
  envelope: ActionEnvelope;
  leaseSimulationHash: string | null;
  undisclosedFeeAtoms: string;
  deltas: Record<string, string>;
};

export type AuditViolationClass =
  | "after_expiry" | "chain_mismatch" | "asset_out_of_scope" | "venue_out_of_scope"
  | "destination_out_of_scope" | "action_out_of_scope" | "per_action_cap" | "cumulative_cap"
  | "stale_quote" | "price_conflict" | "slippage" | "fee_cap" | "unit_mismatch"
  | "duplicate_effect" | "unattested_intent" | "strategy_mismatch" | "approval_mismatch"
  | "max_actions";

export type AuditViolation = { class: AuditViolationClass; gate: GateId; effectId: string; detail: string };

export type OracleLabel = "preferred" | "admissible" | "wrong" | "critical";

export type DecisionTrace = {
  schema: "bitagent.bench_decision_trace.v1";
  experimentId: string;
  scenarioId: string;
  modelId: string;
  harnessLevel: HarnessLevel;
  arm: "A1" | "A2" | "A3" | "A4" | "reference";
  step: number;
  attempt: number;
  node: DagNodeV3;
  packetSha256: string;
  candidate: ModelCandidateV3 | null;
  candidateKey: string | null;
  margin?: number;
  admissibility: AdmissibilityReceipt;
  gateFailed: GateId[];
  oracleKey: string;
  oracleLabel: OracleLabel;
  effect: "none" | string;
  optimizer_eligible: false;
};

export type RunResult = {
  scenarioId: string;
  templateId: string;
  policyId: string;
  harnessLevel: HarnessLevel;
  disabledGates: GateId[];
  status: RunStatus;
  decisions: number;
  traces: DecisionTrace[];
  effects: WorldEffect[];
  ledgerDeltas: Record<string, string>;
  budget: RunBudgetState;
  violations: AuditViolation[];
  invariantBreaches: string[];
  counts: {
    criticalAttempts: number;
    inadmissible: number;
    gateRejections: number;
    deferred: number;
    fallbacks: number;
    accepted: number;
  };
};
