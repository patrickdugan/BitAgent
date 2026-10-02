import { canonicalJson } from "../launch/canonical.js";
import {
  DAG_CANDIDATE_V3_SCHEMA,
  type DagDecisionV3,
  type DagNodeV3,
  type ModelCandidateV3
} from "./types.js";

export const DAG_NODES_V3: DagNodeV3[] = [
  "observe", "inspect", "validate", "simulate", "display", "approval",
  "execute", "verify", "reconcile", "complete", "hold", "recovery", "incident"
];

export const DAG_NEXT_V3: Record<DagNodeV3, DagNodeV3[]> = {
  observe: ["inspect", "hold", "incident"],
  inspect: ["validate", "observe", "hold", "incident"],
  validate: ["simulate", "observe", "hold", "incident"],
  simulate: ["display", "hold", "recovery"],
  display: ["approval", "recovery", "hold"],
  approval: ["execute", "recovery", "incident"],
  execute: ["verify", "incident", "recovery"],
  verify: ["reconcile", "recovery", "hold", "incident"],
  reconcile: ["complete", "recovery", "incident"],
  complete: [],
  hold: ["observe", "validate", "recovery", "incident"],
  recovery: ["observe", "inspect", "validate", "display", "approval", "verify", "reconcile", "incident"],
  incident: ["recovery"]
};

// The host tool that performs entry into each node.
export const NODE_TOOL: Record<Exclude<DagNodeV3, "hold" | "recovery" | "incident">, string> = {
  observe: "market.observe",
  inspect: "host.inspect_evidence",
  validate: "host.validate_arguments",
  simulate: "host.simulate_action",
  display: "host.display_exact_effects_and_fees",
  approval: "wallet.request_approval",
  execute: "host.execute_approved",
  verify: "host.verify_effect",
  reconcile: "host.reconcile_ledger",
  complete: "host.persist_verified_state"
};

export const HOLD_TOOL = "host.hold_for_review";
export const CLARIFY_TOOL = "host.request_clarification";
export const REFRESH_TOOL = "host.refresh_evidence";
export const RESUME_TOOL = "host.resume_persisted_state";
export const INCIDENT_TOOL = "incident.revoke_and_freeze";

export const ALLOWED_CANDIDATE_TOOLS = [
  ...Object.values(NODE_TOOL), HOLD_TOOL, CLARIFY_TOOL, REFRESH_TOOL, RESUME_TOOL, INCIDENT_TOOL
].sort();

export const HOLD_KEY = `hold/hold/${HOLD_TOOL}`;
export const CLARIFY_KEY = `clarify/hold/${CLARIFY_TOOL}`;
export const REFRESH_KEY = `recover/recovery/${REFRESH_TOOL}`;
export const RESUME_KEY = `recover/recovery/${RESUME_TOOL}`;
export const INCIDENT_KEY = `escalate/incident/${INCIDENT_TOOL}`;

// Every candidate key that enters `node`. Re-observing is a refresh, so it is a `recover` move.
export function keysInto(node: DagNodeV3): string[] {
  if (node === "hold") return [HOLD_KEY, CLARIFY_KEY];
  if (node === "recovery") return [REFRESH_KEY, RESUME_KEY];
  if (node === "incident") return [INCIDENT_KEY];
  const decision: DagDecisionV3 = node === "observe" ? "recover" : "advance";
  return [`${decision}/${node}/${NODE_TOOL[node]}`];
}

export function advanceKey(node: Exclude<DagNodeV3, "hold" | "recovery" | "incident">) {
  return keysInto(node)[0]!;
}

export function candidateKey(candidate: Pick<ModelCandidateV3, "decision" | "next_node" | "tool">) {
  return `${candidate.decision}/${candidate.next_node}/${candidate.tool}`;
}

export function candidateFromKey(input: {
  taskId: string;
  key: string;
  argRefs?: Record<string, string>;
  evidenceIds?: string[];
  reasonCode: string;
  riskFlags?: string[];
}): ModelCandidateV3 {
  const [decision, nextNode, tool] = input.key.split("/");
  return {
    schema: DAG_CANDIDATE_V3_SCHEMA,
    task_id: input.taskId,
    decision: decision as DagDecisionV3,
    next_node: nextNode as DagNodeV3,
    tool: tool!,
    arg_refs: input.argRefs || {},
    evidence_ids: input.evidenceIds || [],
    reason_code: input.reasonCode,
    risk_flags: input.riskFlags || [],
    authority: "model_candidate",
    effect: "none"
  };
}

const RESPONSE_FIELDS = [
  "schema", "task_id", "decision", "next_node", "tool", "arg_refs", "evidence_ids",
  "reason_code", "risk_flags", "authority", "effect"
];

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function stringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((item) => typeof item === "string");
}

// Exact-key shape check. A literal amount or address cannot ride along in an unknown field.
export function isCandidateShapeV3(value: unknown): value is ModelCandidateV3 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (canonicalJson(Object.keys(row).sort()) !== canonicalJson([...RESPONSE_FIELDS].sort())) return false;
  return row.schema === DAG_CANDIDATE_V3_SCHEMA
    && typeof row.task_id === "string"
    && typeof row.decision === "string"
    && typeof row.next_node === "string"
    && typeof row.tool === "string"
    && stringRecord(row.arg_refs)
    && stringArray(row.evidence_ids)
    && typeof row.reason_code === "string"
    && stringArray(row.risk_flags)
    && row.authority === "model_candidate"
    && row.effect === "none";
}
