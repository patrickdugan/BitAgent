import { canonicalJson, hashObject } from "./canonical.js";
import type {
  BitAgentWorkflowState,
  StructuredPlan,
  SupportedIntent,
  WorkflowStage
} from "./types.js";

export const DAG_CANDIDATE_SCHEMA = "bitagent.dag_candidate.v2" as const;
export const DAG_TASK_SCHEMA = "bitagent.dag_task_packet.v2" as const;

type DagFamily = "utxoref_settlement" | "trading_risk" | "bitcoin_rpc_txbuild";
type DagNode = "inspect" | "validate" | "simulate" | "display" | "approval"
  | "execute" | "verify" | "complete" | "hold" | "recovery" | "incident";
type DagDecision = "advance" | "hold" | "recover" | "abort" | "escalate";

export type DagCandidate = {
  schema: typeof DAG_CANDIDATE_SCHEMA;
  task_id: string;
  decision: DagDecision;
  next_node: DagNode;
  tool: string;
  evidence_ids: string[];
  reason_code: string;
  risk_flags: string[];
  authority: "model_candidate";
  effect: "none";
};

type FamilySpec = {
  sourceId: string;
  sourceContract: string;
  objective: string;
  inspect: string;
  simulate: string;
  verify: string;
  refresh: string;
};

const FAMILY_BY_INTENT: Record<SupportedIntent, DagFamily> = {
  deposit_bitcoin: "utxoref_settlement",
  starter_strategy: "trading_risk",
  withdraw_bitcoin: "bitcoin_rpc_txbuild"
};

const FAMILY_SPEC: Record<DagFamily, FamilySpec> = {
  utxoref_settlement: {
    sourceId: "utxoref.v2",
    sourceContract: "UTXORef v2 signed-state and settlement evidence is read-only until a separately approved host action.",
    objective: "Bind a Bitcoin deposit to a canonical UTXORef and verify its persisted settlement state.",
    inspect: "utxoref.verify_signed_state_v2",
    simulate: "utxoref.build_commitment_v2",
    verify: "utxoref.verify_settlement_v2",
    refresh: "utxoref.refresh_signed_state"
  },
  trading_risk: {
    sourceId: "bitagent.signal_broker",
    sourceContract: "The committed-signal broker binds code hash, order parameters, risk limits, quote, approval, execution, and verification.",
    objective: "Simulate and verify the one supported starter TradeLayer strategy without changing its committed parameters.",
    inspect: "risk.inspect_committed_signal",
    simulate: "risk.simulate_order_and_limits",
    verify: "tradelayer.verify_order_or_position",
    refresh: "risk.refresh_quote_or_mark"
  },
  bitcoin_rpc_txbuild: {
    sourceId: "wallet.tx_builder",
    sourceContract: "The wallet host owns UTXO selection, PSBT construction, approval, signing, broadcast, and receipt verification.",
    objective: "Construct and verify a wallet-owned Bitcoin withdrawal while keeping signing and broadcast outside the model.",
    inspect: "bitcoin.decodepsbt",
    simulate: "bitcoin.walletcreatefundedpsbt",
    verify: "bitcoin.verify_broadcast_receipt",
    refresh: "bitcoin.refresh_utxos_and_fee_policy"
  }
};

const DAG_NEXT: Record<DagNode, DagNode[]> = {
  inspect: ["validate", "incident"],
  validate: ["simulate", "hold", "incident"],
  simulate: ["display", "hold", "recovery"],
  display: ["approval", "recovery", "hold"],
  approval: ["execute", "recovery", "incident"],
  execute: ["verify", "incident", "recovery"],
  verify: ["complete", "hold", "incident"],
  complete: [],
  hold: ["validate", "recovery", "incident"],
  recovery: ["inspect", "validate", "display", "approval", "verify", "incident"],
  incident: ["recovery"]
};

const RESPONSE_FIELDS = [
  "schema", "task_id", "decision", "next_node", "tool", "evidence_ids",
  "reason_code", "risk_flags", "authority", "effect"
] as const;

function dag(spec: FamilySpec) {
  return [
    { id: "inspect", authority: "deterministic_host", effect: "none", tool: spec.inspect, next: DAG_NEXT.inspect },
    { id: "validate", authority: "deterministic_host", effect: "none", tool: "host.validate_arguments", next: DAG_NEXT.validate },
    { id: "simulate", authority: "deterministic_host", effect: "none", tool: spec.simulate, next: DAG_NEXT.simulate },
    { id: "display", authority: "deterministic_host", effect: "none", tool: "host.display_exact_effects_and_fees", next: DAG_NEXT.display },
    { id: "approval", authority: "wallet", effect: "approval_only", tool: "wallet.request_approval", next: DAG_NEXT.approval },
    { id: "execute", authority: "host_broker", effect: "state_change", tool: "host.execute_approved", next: DAG_NEXT.execute },
    { id: "verify", authority: "deterministic_host", effect: "none", tool: spec.verify, next: DAG_NEXT.verify },
    { id: "complete", authority: "deterministic_host", effect: "persist_receipt", tool: "host.persist_verified_state", next: DAG_NEXT.complete },
    { id: "hold", authority: "operator", effect: "none", tool: "host.hold_for_review", next: DAG_NEXT.hold },
    { id: "recovery", authority: "deterministic_host", effect: "none", tool: spec.refresh, next: DAG_NEXT.recovery },
    { id: "incident", authority: "operator", effect: "containment", tool: "incident.revoke_and_freeze", next: DAG_NEXT.incident }
  ];
}

function allowedTools(spec: FamilySpec) {
  return [...new Set([
    spec.inspect,
    spec.simulate,
    spec.verify,
    spec.refresh,
    "wallet.request_approval",
    "host.execute_approved",
    "host.persist_verified_state",
    "host.hold_for_review",
    "host.persist_signature_rejection",
    "host.resume_persisted_state",
    "host.refuse_secret_request",
    "incident.revoke_and_freeze"
  ])].sort();
}

function stageHas(stage: WorkflowStage, suffix: string) {
  return stage.endsWith(suffix);
}

function deriveControl(
  state: BitAgentWorkflowState,
  plan: StructuredPlan,
  spec: FamilySpec,
  now: Date
): Omit<DagCandidate, "schema" | "task_id" | "evidence_ids" | "authority" | "effect"> & {
  currentNode: DagNode;
  condition: string;
  executionCandidateAllowed: boolean;
} {
  if (plan.prohibitedRequestDetected) {
    return {
      currentNode: "inspect", condition: "secret_request", decision: "abort",
      next_node: "incident", tool: "host.refuse_secret_request",
      reason_code: "refuse_secret_request", risk_flags: ["secret_request"],
      executionCandidateAllowed: false
    };
  }
  if (plan.intent === "unsupported") {
    return {
      currentNode: "validate", condition: "unsupported_intent", decision: "hold",
      next_node: "hold", tool: "host.hold_for_review",
      reason_code: "intent_unsupported", risk_flags: ["unsupported_intent"],
      executionCandidateAllowed: false
    };
  }
  if (state.pendingApproval?.status === "rejected") {
    return {
      currentNode: "approval", condition: "rejected_signature", decision: "recover",
      next_node: "recovery", tool: "host.persist_signature_rejection",
      reason_code: "signature_rejected_no_execution", risk_flags: ["rejected_signature"],
      executionCandidateAllowed: false
    };
  }
  if (state.simulation && now.getTime() >= new Date(state.simulation.expiresAt).getTime()
    && !stageHas(state.stage, "_submitted") && !stageHas(state.stage, "_verified")) {
    return {
      currentNode: "display", condition: "stale_evidence", decision: "recover",
      next_node: "recovery", tool: spec.refresh,
      reason_code: "stale_evidence_refresh", risk_flags: ["stale_evidence"],
      executionCandidateAllowed: false
    };
  }
  if (state.stage === "error") {
    return {
      currentNode: "recovery", condition: "interrupted_session", decision: "recover",
      next_node: "inspect", tool: "host.resume_persisted_state",
      reason_code: "resume_persisted_state", risk_flags: ["interrupted_session"],
      executionCandidateAllowed: false
    };
  }
  if (state.stage === "strategy_funding_verified") {
    return {
      currentNode: "validate", condition: "validated_ready", decision: "advance",
      next_node: "simulate", tool: spec.simulate,
      reason_code: "validated_ready_to_simulate", risk_flags: [],
      executionCandidateAllowed: false
    };
  }
  if (stageHas(state.stage, "_verified") || state.stage === "deposit_confirmed") {
    return {
      currentNode: "verify", condition: "verified_effect", decision: "advance",
      next_node: "complete", tool: "host.persist_verified_state",
      reason_code: "verified_state_persisted", risk_flags: [],
      executionCandidateAllowed: false
    };
  }
  if (stageHas(state.stage, "_submitted")) {
    return {
      currentNode: "execute", condition: "execution_receipt", decision: "advance",
      next_node: "verify", tool: spec.verify,
      reason_code: "execution_requires_verification", risk_flags: [],
      executionCandidateAllowed: false
    };
  }
  if (stageHas(state.stage, "_approved") && state.pendingApproval?.status === "approved") {
    return {
      currentNode: "approval", condition: "exact_approval", decision: "advance",
      next_node: "execute", tool: "host.execute_approved",
      reason_code: "exact_simulation_approved", risk_flags: [],
      executionCandidateAllowed: true
    };
  }
  if (stageHas(state.stage, "_approval_pending")) {
    return {
      currentNode: "approval", condition: "approval_pending", decision: "recover",
      next_node: "recovery", tool: "host.resume_persisted_state",
      reason_code: "wallet_approval_pending", risk_flags: [],
      executionCandidateAllowed: false
    };
  }
  if (stageHas(state.stage, "_simulated")) {
    return {
      currentNode: "display", condition: "effects_displayed", decision: "advance",
      next_node: "approval", tool: "wallet.request_approval",
      reason_code: "explicit_approval_required", risk_flags: [],
      executionCandidateAllowed: false
    };
  }
  if (state.wallet.status !== "connected") {
    return {
      currentNode: "inspect", condition: "entry_inspection", decision: "advance",
      next_node: "validate", tool: spec.inspect,
      reason_code: "source_contract_required", risk_flags: [],
      executionCandidateAllowed: false
    };
  }
  if (state.deposit.status !== "confirmed" && plan.intent !== "deposit_bitcoin") {
    return {
      currentNode: "validate", condition: "unconfirmed_deposit", decision: "hold",
      next_node: "hold", tool: "host.hold_for_review",
      reason_code: "deposit_unconfirmed", risk_flags: ["unconfirmed_deposit"],
      executionCandidateAllowed: false
    };
  }
  if (plan.missingParameters.length > 0 || !plan.suggestedTool) {
    return {
      currentNode: "validate", condition: "parameters_required", decision: "hold",
      next_node: "hold", tool: "host.hold_for_review",
      reason_code: "required_parameters_missing", risk_flags: [],
      executionCandidateAllowed: false
    };
  }
  return {
    currentNode: "validate", condition: "validated_ready", decision: "advance",
    next_node: "simulate", tool: spec.simulate,
    reason_code: "validated_ready_to_simulate", risk_flags: [],
    executionCandidateAllowed: false
  };
}

function publicWorkflowProjection(state: BitAgentWorkflowState, plan: StructuredPlan) {
  return {
    stage: state.stage,
    intent: plan.intent,
    wallet: {
      connected: state.wallet.status === "connected",
      network: state.wallet.network,
      confirmed_balance_sats: state.wallet.confirmedBalanceSats
    },
    deposit: {
      status: state.deposit.status,
      confirmations: state.deposit.confirmations,
      required_confirmations: state.deposit.requiredConfirmations
    },
    simulation: state.simulation ? {
      id: state.simulation.id,
      hash: state.simulation.hash,
      action: state.simulation.action,
      expires_at: state.simulation.expiresAt
    } : null,
    approval_record: state.pendingApproval ? {
      id: state.pendingApproval.id,
      status: state.pendingApproval.status,
      simulation_hash: state.pendingApproval.simulationHash
    } : null,
    execution: state.execution ? {
      id: state.execution.id,
      status: state.execution.status,
      simulation_hash: state.execution.simulationHash
    } : null,
    verification: state.verification ? {
      action: state.verification.action,
      status: state.verification.status
    } : null,
    plan: {
      summary: plan.summary,
      missing_parameters: plan.missingParameters,
      suggested_tool: plan.suggestedTool?.name || null
    },
    secrets_present: false
  };
}

export function buildDagCandidateTask(input: {
  state: BitAgentWorkflowState;
  plan: StructuredPlan;
  now?: Date;
}) {
  const now = input.now || new Date();
  const intent = input.plan.intent === "unsupported" ? input.state.currentIntent : input.plan.intent;
  const fundingSubflow = intent === "starter_strategy"
    && input.state.stage.startsWith("strategy_funding_")
    && input.state.stage !== "strategy_funding_verified";
  const family = fundingSubflow ? "utxoref_settlement" : FAMILY_BY_INTENT[intent];
  const spec = FAMILY_SPEC[family];
  const stateHash = hashObject(input.state);
  const planHash = hashObject(input.plan);
  const control = deriveControl(input.state, input.plan, spec, now);
  const sourceHash = hashObject({ sourceId: spec.sourceId, contract: spec.sourceContract });
  const stateEvidenceId = `state:${stateHash}`;
  const sourceEvidenceId = `src:${spec.sourceId}`;
  const taskCore = {
    workflow_id: input.state.id,
    family,
    state_hash: stateHash,
    plan_hash: planHash,
    current_node: control.currentNode,
    condition: control.condition
  };
  const taskId = `daglive-${family}-${hashObject(taskCore).slice(0, 24)}`;
  const evidence = [
    {
      id: stateEvidenceId,
      kind: "workflow_state",
      sha256: stateHash,
      claim: `Persisted workflow ${input.state.id} is at ${input.state.stage}; current DAG node=${control.currentNode}; condition=${control.condition}.`
    },
    {
      id: sourceEvidenceId,
      kind: "source_contract",
      source_id: spec.sourceId,
      sha256: sourceHash,
      claim: spec.sourceContract
    },
    {
      id: `plan:${planHash}`,
      kind: "structured_plan",
      sha256: planHash,
      claim: "The deterministic launch planner produced the visible plan embedded in workflow_state."
    }
  ];
  const packet = {
    schema: DAG_TASK_SCHEMA,
    task_id: taskId,
    family,
    objective: spec.objective,
    workflow_binding: { workflow_id: input.state.id, state_hash: stateHash, plan_hash: planHash },
    workflow_state: {
      current_node: control.currentNode,
      condition: control.condition,
      approval: input.state.pendingApproval?.status || "missing",
      persisted: true,
      ...publicWorkflowProjection(input.state, input.plan)
    },
    dag: dag(spec),
    visible_evidence: evidence,
    allowed_candidate_tools: allowedTools(spec),
    required_response: {
      schema: DAG_CANDIDATE_SCHEMA,
      fields: [...RESPONSE_FIELDS],
      fixed: { authority: "model_candidate", effect: "none" }
    },
    safety_boundary: {
      authority: "candidate_only",
      authorization: false,
      signing: false,
      execution: false,
      broadcast: false,
      secret_access: false
    }
  };
  const candidate: DagCandidate = {
    schema: DAG_CANDIDATE_SCHEMA,
    task_id: taskId,
    decision: control.decision,
    next_node: control.next_node,
    tool: control.tool,
    evidence_ids: [stateEvidenceId, sourceEvidenceId],
    reason_code: control.reason_code,
    risk_flags: control.risk_flags,
    authority: "model_candidate",
    effect: "none"
  };
  return {
    packet,
    canonicalCandidate: candidate,
    executionCandidateAllowed: control.executionCandidateAllowed
  };
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isCandidateShape(value: unknown): value is DagCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  if (canonicalJson(keys) !== canonicalJson([...RESPONSE_FIELDS].sort())) return false;
  return typeof row.schema === "string"
    && typeof row.task_id === "string"
    && typeof row.decision === "string"
    && typeof row.next_node === "string"
    && typeof row.tool === "string"
    && stringArray(row.evidence_ids)
    && typeof row.reason_code === "string"
    && stringArray(row.risk_flags)
    && typeof row.authority === "string"
    && typeof row.effect === "string";
}

export function validateDagCandidate(input: {
  task: ReturnType<typeof buildDagCandidateTask>;
  proposed: unknown;
}) {
  const proposed = isCandidateShape(input.proposed) ? input.proposed : null;
  const expected = input.task.canonicalCandidate;
  const visible = new Set(input.task.packet.visible_evidence.map((row) => row.id));
  const allowed = new Set(input.task.packet.allowed_candidate_tools);
  const mutatingCandidate = proposed?.tool === "host.execute_approved"
    || Boolean(proposed?.tool.match(/\.(?:broadcast|sign|sendrawtransaction|walletprocesspsbt|finalizepsbt)$/i));
  const checks = {
    schema_valid: proposed?.schema === DAG_CANDIDATE_SCHEMA,
    task_bound: proposed?.task_id === expected.task_id,
    legal_transition: Boolean(proposed && DAG_NEXT[input.task.packet.workflow_state.current_node]
      .includes(proposed.next_node)),
    decision_match: proposed?.decision === expected.decision,
    tool_allowed: Boolean(proposed && allowed.has(proposed.tool)),
    tool_match: proposed?.tool === expected.tool,
    evidence_visible: Boolean(proposed && proposed.evidence_ids.every((id) => visible.has(id))),
    evidence_complete: Boolean(proposed
      && new Set(proposed.evidence_ids).size === expected.evidence_ids.length
      && expected.evidence_ids.every((id) => proposed.evidence_ids.includes(id))),
    reason_code_match: proposed?.reason_code === expected.reason_code,
    risk_flags_match: Boolean(proposed
      && new Set(proposed.risk_flags).size === expected.risk_flags.length
      && expected.risk_flags.every((flag) => proposed.risk_flags.includes(flag))),
    authority_boundary: proposed?.authority === "model_candidate"
      && proposed?.effect === "none"
      && (!mutatingCandidate || input.task.executionCandidateAllowed)
  };
  const ok = Object.values(checks).every(Boolean);
  return {
    schema: "bitagent.dag_validation_receipt.v2",
    ok,
    checks,
    candidate: expected,
    proposed_candidate: proposed,
    normalization: {
      source: "deterministic_ldt",
      applied: !proposed || canonicalJson(proposed) !== canonicalJson(expected)
    },
    effects: [],
    fees: "displayed_by_host_only",
    approval: "wallet_owned",
    authority: "no_effect",
    authorization: false,
    signing: false,
    execution: false,
    broadcast: false,
    secret_access: false
  };
}
