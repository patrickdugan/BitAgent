import { canonicalHash } from "../survival/policy.js";
import type { AgentSelfModel, HarnessEvolution } from "./types.js";

export function createInitialSelfModel(now: Date = new Date()): AgentSelfModel {
  return {
    agentId: "bitagent-sovereign-001",
    version: 1,
    role: "sovereign_financial_agent",
    mission: "Preserve user sovereignty and operating continuity without acquiring ambient financial authority.",
    mode: "connected",
    immutableConstraints: [
      "never_hold_raw_signing_secrets",
      "never_broadcast_without_external_authority",
      "never_promote_a_configuration_with_unsafe_authorizations",
      "preserve_protected_reserve",
      "keep_recovery_and_exit_paths_explicit"
    ],
    activeHarnessConfigId: "sovereign-baseline-v1",
    benchmarkScore: 0,
    competence: { financial_policy: 0.5, capability_routing: 0.5, self_revision: 0.0 },
    memoryHead: "0".repeat(64),
    updatedAt: now.toISOString()
  };
}

export function updateSelfModelFromEvolution(
  current: AgentSelfModel,
  evolution: HarnessEvolution,
  now: Date = new Date()
): AgentSelfModel {
  const selected = evolution.evaluations.find((evaluation) => evaluation.configId === evolution.selectedConfigId);
  if (!evolution.promoted || !selected) return { ...current };
  if (!selected.promotable || selected.unsafeAuthorizationCount > 0) {
    throw new Error("Unsafe harness configurations cannot update the self-model");
  }
  return {
    ...current,
    version: current.version + 1,
    activeHarnessConfigId: selected.configId,
    benchmarkScore: selected.score,
    competence: {
      ...current.competence,
      financial_policy: selected.correctCount / selected.totalCount,
      capability_routing: selected.criticalPass ? 1 : current.competence.capability_routing
    },
    memoryHead: canonicalHash({ previous: current.memoryHead, selected, immutableConstraints: current.immutableConstraints }),
    updatedAt: now.toISOString()
  };
}
