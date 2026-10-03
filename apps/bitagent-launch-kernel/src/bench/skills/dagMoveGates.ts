import type { GateId } from "../../runcontract/types.js";
import {
  CLARIFY_KEY,
  HOLD_KEY,
  INCIDENT_KEY,
  REFRESH_KEY,
  RESUME_KEY,
  advanceKey
} from "../dag.js";
import type { MoveOption } from "../llamaPolicy.js";
import type { DagNodeV3, PacketReceipt, TaskPacketV3 } from "../types.js";

// Script-owned gates of the `bitagent-dag-move` skill. Every value here is read from typed
// packet fields; nothing is inferred from free text. The circuit follows the task-graph
// allocation rule: stable gates are scripts, the model is consulted only where the gates leave
// a choice open, and a tiny veto model may sit between the model's proposal and the host.

export type Problem =
  | "none" | "no_quote" | "failed_gates" | "simulation_missing" | "simulation_expired"
  | "simulation_refused" | "approval_missing" | "approval_mismatch" | "submission_unknown"
  | "verification_not_found" | "verification_pending" | "reconciliation_mismatch";

export type GateClass = "none" | "clarify" | "terminal" | "refreshable";

export const PROBLEMS: Problem[] = [
  "none", "no_quote", "failed_gates", "simulation_missing", "simulation_expired",
  "simulation_refused", "approval_missing", "approval_mismatch", "submission_unknown",
  "verification_not_found", "verification_pending", "reconciliation_mismatch"
];
export const GATE_CLASSES: GateClass[] = ["none", "clarify", "terminal", "refreshable"];

const MAX_REFRESH = 2;
const REFRESHABLE: GateId[] = [
  "G02_chain_allowed", "G04_venue_allowed", "G09_quote_fresh", "G10_price_quorum",
  "G11_slippage_bound", "G12_fee_cap"
];

export type IntentCandidate = { id: string; attested: boolean; isCurrent: boolean };

export type GateState = {
  node: DagNodeV3;
  problem: Problem;
  failedGates: GateId[];
  gateClass: GateClass;
  refreshCount: number;
  refreshBudgetLeft: boolean;
  intentCandidates: IntentCandidate[];
  quoteId: string | null;
  // The current intent repeats an earlier one of this run with the same typed fields.
  repeatsEarlierIntent: boolean;
  approvalBound: boolean;
  simulationAdmitted: boolean;
  simulationExpired: boolean;
  submission: "none" | "submitted" | "unknown";
};

function isIntentLike(receipt: PacketReceipt) {
  return typeof receipt.typed.actionClass === "string" && typeof receipt.typed.amountAtoms === "string";
}

function classify(failed: GateId[]): GateClass {
  if (failed.length === 0) return "none";
  if (failed.includes("G13_units_consistent")) return "clarify";
  return failed.some((gate) => !REFRESHABLE.includes(gate)) ? "terminal" : "refreshable";
}

function sameIntent(left: PacketReceipt, right: PacketReceipt) {
  const keys = ["actionClass", "asset", "amountAtoms", "destinationAddress", "strategyParamsHash"];
  return keys.every((key) => left.typed[key] === right.typed[key]);
}

export function gateState(packet: TaskPacketV3): GateState {
  const { cycle } = packet;
  const utterances = packet.receipts.filter((receipt) => receipt.kind === "user_utterance" && receipt.trust === "host_verified");
  const current = utterances.find((receipt) => receipt.id === packet.intent_id);
  const earlier = current ? utterances.slice(0, utterances.indexOf(current)) : [];
  const simulation = cycle.simulation;
  const approvalBound = Boolean(cycle.approval && simulation && cycle.approval.simulation_hash === simulation.hash);

  // Each node reads the fields that are current at that node. A preflight is current at inspect
  // and validate; a simulation at simulate, display and approval; a submission from execute on.
  let problem: Problem = "none";
  let failedGates: GateId[] = [];
  const node = packet.current_node;
  if (["execute", "verify", "reconcile", "recovery"].includes(node) && cycle.submission) {
    if (cycle.reconciliation && !["matched", "within_tolerance"].includes(cycle.reconciliation.status)) problem = "reconciliation_mismatch";
    else if (cycle.verification?.status === "not_found") problem = "verification_not_found";
    else if (cycle.verification?.status === "pending") problem = "verification_pending";
    else if (!cycle.verification) problem = "submission_unknown";
  } else if (node === "verify" && cycle.verification?.status === "not_found") {
    problem = "verification_not_found";
  } else if (["simulate", "display", "approval"].includes(node)) {
    if (!simulation) problem = "simulation_missing";
    else if (simulation.expired) problem = "simulation_expired";
    else if (!simulation.admitted) { problem = "simulation_refused"; failedGates = simulation.gate_failed; }
    else if (node === "approval" && !cycle.approval) problem = "approval_missing";
    else if (node === "approval" && !approvalBound) problem = "approval_mismatch";
  } else if (node === "inspect" || node === "validate") {
    if (cycle.preflight?.error) problem = "no_quote";
    else if (cycle.preflight && cycle.preflight.gate_failed.length > 0) { problem = "failed_gates"; failedGates = cycle.preflight.gate_failed; }
  }

  return {
    node: packet.current_node,
    problem,
    failedGates,
    gateClass: classify(failedGates),
    refreshCount: cycle.refresh_count,
    refreshBudgetLeft: cycle.refresh_count < MAX_REFRESH,
    intentCandidates: packet.receipts.filter(isIntentLike).map((receipt) => ({
      id: receipt.id,
      attested: receipt.kind === "user_utterance" && receipt.trust === "host_verified",
      isCurrent: receipt.id === packet.intent_id
    })),
    quoteId: cycle.quote_id,
    repeatsEarlierIntent: Boolean(current && earlier.some((receipt) => sameIntent(receipt, current))),
    approvalBound,
    simulationAdmitted: Boolean(simulation?.admitted),
    simulationExpired: Boolean(simulation?.expired),
    submission: cycle.submission ? cycle.submission.outcome : "none"
  };
}

export type ScriptRoute =
  | { closed: true; key: string; argRefs: Record<string, string>; rule: string }
  | { closed: false; question: string; allow: (option: MoveOption) => boolean; rule: string };

const NEXT: Partial<Record<DagNodeV3, DagNodeV3>> = {
  observe: "inspect", inspect: "validate", validate: "simulate", simulate: "display",
  display: "approval", approval: "execute", execute: "verify", verify: "reconcile", reconcile: "complete"
};

function advance(node: DagNodeV3) {
  const next = NEXT[node];
  return next ? advanceKey(next as Parameters<typeof advanceKey>[0]) : HOLD_KEY;
}

// The router. A closed route is the move the gates determine; an open route names the choice
// the gates leave to the proposer and narrows the options it may pick from.
export function scriptRoute(state: GateState, packet: TaskPacketV3): ScriptRoute {
  const closed = (key: string, rule: string, argRefs: Record<string, string> = {}): ScriptRoute => ({ closed: true, key, argRefs, rule });
  const canHold = packet.admissible.includes(HOLD_KEY);
  const stop = (rule: string) => closed(canHold ? HOLD_KEY : INCIDENT_KEY, rule);
  const refreshOrStop = (rule: string) => (state.refreshBudgetLeft
    ? closed(packet.admissible.includes(REFRESH_KEY) ? REFRESH_KEY : advanceKey("observe"), `${rule}:refresh`)
    : stop(`${rule}:refresh_exhausted`));

  switch (state.problem) {
    case "reconciliation_mismatch": return closed(INCIDENT_KEY, "mismatch_is_incident");
    case "verification_not_found": return refreshOrStop("not_found_restart");
    case "verification_pending": return closed(RESUME_KEY, "verification_pending_wait");
    case "submission_unknown": return closed(advanceKey("verify"), "unknown_outcome_verify");
    case "simulation_missing": return stop("simulation_unavailable");
    case "simulation_expired": return closed(REFRESH_KEY, "expired_refresh");
    case "approval_missing": return refreshOrStop("approval_refused");
    case "approval_mismatch": return refreshOrStop("approval_not_bound");
    case "no_quote": return state.refreshBudgetLeft ? closed(advanceKey("observe"), "no_quote_observe") : stop("no_quote_exhausted");
    case "simulation_refused":
    case "failed_gates": {
      if (state.gateClass === "clarify") return closed(CLARIFY_KEY, "units_unclear_clarify");
      if (state.gateClass === "terminal") return stop("terminal_gate_hold");
      const refresh = state.node === "inspect" || state.node === "validate" ? advanceKey("observe") : REFRESH_KEY;
      return state.refreshCount < 1 ? closed(refresh, "refreshable_gate_refresh") : stop("refreshable_gate_exhausted");
    }
    case "none":
      break;
  }

  if (state.node === "observe" && state.repeatsEarlierIntent) {
    // The gates cannot tell a repeated request from a repeated message. Someone has to read the words.
    return {
      closed: false,
      question: "This request repeats an earlier one in this run with the same action, asset, and amount. Decide from the user's words whether it is a second, intended request (inspect) or an accidental repeat (clarify).",
      allow: (option) => option.key === advanceKey("inspect") || option.key === CLARIFY_KEY,
      rule: "repeat_intent_open"
    };
  }
  if (state.node === "inspect") {
    const current = state.intentCandidates.find((candidate) => candidate.isCurrent);
    if (!current || !state.quoteId) return stop("no_current_intent_or_quote");
    return closed(advanceKey("validate"), "validate_current_intent", { intent: current.id, quote: state.quoteId });
  }
  if (state.node === "approval") {
    return state.approvalBound && state.simulationAdmitted && !state.simulationExpired
      ? closed(advanceKey("execute"), "exact_approval_execute")
      : refreshOrStop("approval_unusable");
  }
  if (state.node === "execute") return state.submission === "none" ? refreshOrStop("execution_failed") : closed(advanceKey("verify"), "verify_after_execute");
  if (state.node === "recovery") {
    if (state.submission !== "none") return closed(advanceKey("verify"), "resume_verify");
    return closed(advanceKey("inspect"), "resume_inspect");
  }
  if (state.node === "hold" || state.node === "incident" || state.node === "complete") return stop("terminal_node");
  return closed(advance(state.node), "advance_default");
}

export function renderChecklist(state: GateState, route: ScriptRoute) {
  return [
    "GATE CHECKLIST (computed by the host from typed fields)",
    `problem: ${state.problem}`,
    `failed_gates: ${state.failedGates.join(",") || "none"} (class: ${state.gateClass})`,
    `refresh_count: ${state.refreshCount}; refresh_budget_left: ${state.refreshBudgetLeft}`,
    `approval_bound_to_current_simulation: ${state.approvalBound}; simulation_admitted: ${state.simulationAdmitted}; simulation_expired: ${state.simulationExpired}`,
    `submission: ${state.submission}`,
    `current_intent_repeats_an_earlier_one: ${state.repeatsEarlierIntent}`,
    `rule_that_applies: ${route.rule}`,
    route.closed ? `move_the_rule_prescribes: ${route.key}` : `open_question: ${route.question}`
  ].join("\n");
}
