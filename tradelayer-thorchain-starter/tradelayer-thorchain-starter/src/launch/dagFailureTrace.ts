import fs from "node:fs/promises";
import path from "node:path";
import { canonicalJson, hashObject } from "./canonical.js";
import type { buildDagCandidateTask, validateDagCandidate } from "./dagCandidate.js";
import { LaunchKernelError } from "./errors.js";

type DagTask = ReturnType<typeof buildDagCandidateTask>;
type DagValidationReceipt = ReturnType<typeof validateDagCandidate>;

const appendQueues = new Map<string, Promise<void>>();

function failureKind(checks: DagValidationReceipt["checks"]) {
  if (!checks.schema_valid) return "malformed";
  if (!checks.authority_boundary) return "authority_escalation";
  if (!checks.evidence_visible) return "fabricated_evidence";
  if (!checks.task_bound) return "stale_task";
  if (!checks.legal_transition) return "wrong_transition";
  if (!checks.tool_allowed) return "forbidden_tool";
  return "candidate_mismatch";
}

export function buildDagFailureTrace(input: {
  task: DagTask;
  receipt: DagValidationReceipt;
  observedAt?: Date;
}) {
  if (input.receipt.ok) {
    throw new LaunchKernelError("validation_error", "Successful DAG candidates are not failure traces");
  }
  const observedAt = (input.observedAt || new Date()).toISOString();
  const failedChecks = Object.entries(input.receipt.checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const core = {
    schema: "bitagent.dag_failure_trace.v2",
    task_id: input.task.packet.task_id,
    family: input.task.packet.family,
    current_node: input.task.packet.workflow_state.current_node,
    condition: input.task.packet.workflow_state.condition,
    workflow_state_hash: input.task.packet.workflow_binding.state_hash,
    structured_plan_hash: input.task.packet.workflow_binding.plan_hash,
    failure_kind: failureKind(input.receipt.checks),
    violations: failedChecks,
    proposed_candidate: input.receipt.proposed_candidate,
    repair_target: input.receipt.candidate,
    source: "launch_server_deterministic_ldt",
    optimizer_eligible: false,
    observed_at: observedAt,
    authority: "no_effect",
    authorization: false,
    signing: false,
    execution: false,
    broadcast: false,
    secret_access: false
  };
  const traceId = `${input.task.packet.task_id}:${hashObject(core).slice(0, 24)}`;
  const withId = { ...core, trace_id: traceId };
  return { ...withId, trace_sha256: hashObject(withId) };
}

export async function appendDagFailureTrace(filePath: string, trace: ReturnType<typeof buildDagFailureTrace>) {
  const absolute = path.resolve(filePath);
  const prior = appendQueues.get(absolute) || Promise.resolve();
  const pending = prior.then(async () => {
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.appendFile(absolute, `${canonicalJson(trace)}\n`, "utf8");
  });
  appendQueues.set(absolute, pending.catch(() => undefined));
  try {
    await pending;
  } catch {
    throw new LaunchKernelError("provider_unavailable", "DAG failure trace could not be persisted");
  }
}
