import { canonicalHash } from "../survival/policy.js";
import type { PolicyDecision } from "../survival/types.js";
import type {
  AgentSelfModel,
  CapabilityAuthorization,
  CapabilityEffect,
  CapabilityLease,
  CapabilityRequest,
  SovereignCapability
} from "./types.js";

const CAPABILITY_EFFECTS: Record<SovereignCapability, CapabilityEffect[]> = {
  propose_psbt: ["read_state", "reserve_capital"],
  pay_invoice_capped: ["read_state", "reserve_capital", "request_signature"],
  propose_swap: ["read_state", "reserve_capital"],
  propose_tradelayer_intake: ["read_state", "reserve_capital"],
  propose_fedimint_payment: ["read_state", "reserve_capital", "request_signature"],
  propose_vtxo_action: ["read_state", "reserve_capital", "request_signature"],
  propose_dlc: ["read_state", "reserve_capital", "request_signature"],
  propose_filecoin_storage: ["read_state", "reserve_capital", "request_signature"],
  propose_compute_lease: ["read_state", "reserve_capital", "request_signature"],
  request_near_chain_signature: ["read_state", "request_signature"],
  propose_policy_update: ["read_state", "self_modify"],
  write_memory: ["write_state"]
};

export function capabilityRequestFingerprint(input: Omit<CapabilityRequest, "invocationFingerprint">): string {
  return canonicalHash({
    requestId: input.requestId,
    agentId: input.agentId,
    capability: input.capability,
    effects: [...input.effects].sort(),
    scope: input.scope,
    expiresAt: input.expiresAt,
    intentHash: input.intent ? canonicalHash(input.intent) : undefined
  });
}

export function authorizeCapabilityRequest(
  request: CapabilityRequest,
  selfModel: AgentSelfModel,
  policyDecision: PolicyDecision | undefined,
  now: Date = new Date()
): CapabilityAuthorization {
  const reasons: string[] = [];
  const { invocationFingerprint: _ignored, ...requestMaterial } = request;
  const expectedFingerprint = capabilityRequestFingerprint(requestMaterial);
  const allowedEffects = CAPABILITY_EFFECTS[request.capability];

  if (request.invocationFingerprint !== expectedFingerprint) reasons.push("fingerprint_mismatch");
  if (request.agentId !== selfModel.agentId) reasons.push("principal_mismatch");
  if (selfModel.mode === "frozen" || selfModel.mode === "offline") reasons.push("self_model_not_operational");
  if (!Number.isFinite(Date.parse(request.expiresAt)) || Date.parse(request.expiresAt) <= now.getTime()) reasons.push("request_expired");
  if (request.effects.some((effect) => !allowedEffects.includes(effect))) reasons.push("effect_not_declared");
  if (request.effects.includes("broadcast")) reasons.push("broadcast_not_delegable");
  if (request.effects.includes("reserve_capital") && !request.intent) reasons.push("financial_policy_evidence_missing");

  if (reasons.length) return { decision: "denied", reasonCodes: reasons, requestFingerprint: expectedFingerprint };
  if (request.effects.includes("self_modify")) {
    return { decision: "manual_required", reasonCodes: ["self_modification_requires_approval"], requestFingerprint: expectedFingerprint };
  }

  if (request.intent) {
    if (!policyDecision) {
      return { decision: "denied", reasonCodes: ["financial_policy_evidence_missing"], requestFingerprint: expectedFingerprint };
    }
    if (policyDecision.decision === "denied") {
      return { decision: "denied", reasonCodes: policyDecision.reasonCodes, requestFingerprint: expectedFingerprint };
    }
    if (policyDecision.decision === "manual_required") {
      return { decision: "manual_required", reasonCodes: policyDecision.reasonCodes, requestFingerprint: expectedFingerprint };
    }
    if (policyDecision.nextCapability !== request.capability) {
      return { decision: "denied", reasonCodes: ["capability_policy_mismatch"], requestFingerprint: expectedFingerprint };
    }
  }

  return { decision: "authorized", reasonCodes: ["exact_capability_authorized"], requestFingerprint: expectedFingerprint };
}

export class InMemoryCapabilityLeaseStore {
  private readonly leases = new Map<string, CapabilityLease>();

  issue(request: CapabilityRequest, authorization: CapabilityAuthorization, now: Date = new Date()): CapabilityLease {
    if (authorization.decision !== "authorized") throw new Error("Capability authorization is required before lease issue");
    const lease: CapabilityLease = {
      leaseId: canonicalHash({ requestId: request.requestId, fingerprint: request.invocationFingerprint, issuedAt: now.toISOString() }),
      requestId: request.requestId,
      agentId: request.agentId,
      capability: request.capability,
      effects: [...request.effects],
      scopeHash: canonicalHash(request.scope),
      invocationFingerprint: request.invocationFingerprint,
      status: "active",
      issuedAt: now.toISOString(),
      expiresAt: request.expiresAt
    };
    this.leases.set(lease.leaseId, lease);
    return { ...lease };
  }

  consume(leaseId: string, invocationFingerprint: string, now: Date = new Date()): CapabilityLease {
    const current = this.leases.get(leaseId);
    if (!current) throw new Error("Unknown capability lease");
    if (current.status !== "active") throw new Error("Capability lease is not active");
    if (current.invocationFingerprint !== invocationFingerprint) throw new Error("Capability lease fingerprint mismatch");
    if (Date.parse(current.expiresAt) <= now.getTime()) throw new Error("Capability lease expired");
    const consumed: CapabilityLease = { ...current, status: "consumed", consumedAt: now.toISOString() };
    this.leases.set(leaseId, consumed);
    return { ...consumed };
  }

  get(leaseId: string): CapabilityLease | undefined {
    const lease = this.leases.get(leaseId);
    return lease ? { ...lease } : undefined;
  }
}
