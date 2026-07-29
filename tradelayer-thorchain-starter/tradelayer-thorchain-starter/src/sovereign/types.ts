import type {
  FinancialCapability,
  PolicyDecision,
  SpendIntent,
  SurvivalPolicy,
  TreasurySnapshot
} from "../survival/types.js";

export type AgentMode = "connected" | "degraded" | "offline" | "frozen";

export type SovereignCapability =
  | FinancialCapability
  | "request_near_chain_signature"
  | "propose_policy_update"
  | "write_memory";

export type CapabilityEffect =
  | "read_state"
  | "write_state"
  | "reserve_capital"
  | "request_signature"
  | "broadcast"
  | "self_modify";

export type AgentSelfModel = {
  agentId: string;
  version: number;
  role: "sovereign_financial_agent";
  mission: string;
  mode: AgentMode;
  immutableConstraints: string[];
  activeHarnessConfigId: string;
  benchmarkScore: number;
  competence: Record<string, number>;
  memoryHead: string;
  updatedAt: string;
};

export type CapabilityRequest = {
  requestId: string;
  agentId: string;
  capability: SovereignCapability;
  effects: CapabilityEffect[];
  scope: Record<string, string>;
  invocationFingerprint: string;
  expiresAt: string;
  intent?: SpendIntent;
};

export type CapabilityAuthorization = {
  decision: "denied" | "manual_required" | "authorized";
  reasonCodes: string[];
  requestFingerprint: string;
};

export type CapabilityLease = {
  leaseId: string;
  requestId: string;
  agentId: string;
  capability: SovereignCapability;
  effects: CapabilityEffect[];
  scopeHash: string;
  invocationFingerprint: string;
  status: "active" | "consumed" | "revoked";
  issuedAt: string;
  expiresAt: string;
  consumedAt?: string;
};

export type HarnessBenchmarkScenario = {
  id: string;
  description: string;
  critical: boolean;
  intent: SpendIntent;
  snapshot: TreasurySnapshot;
  expectedDecision: PolicyDecision["decision"];
};

export type HarnessConfigCandidate = {
  id: string;
  parentId?: string;
  policy: SurvivalPolicy;
  provenance: "baseline" | "bounded_mutation";
  mutation: string;
};

export type HarnessBenchmarkResult = {
  scenarioId: string;
  expectedDecision: PolicyDecision["decision"];
  actualDecision: PolicyDecision["decision"];
  correct: boolean;
  unsafeAuthorization: boolean;
  falseBlock: boolean;
  reasonCodes: string[];
};

export type CausalSurprise = {
  scenarioId: string;
  configId: string;
  expectedDecision: PolicyDecision["decision"];
  observedDecision: PolicyDecision["decision"];
  severity: "critical" | "repair";
  evidenceHash: string;
};

export type HarnessEvaluation = {
  configId: string;
  score: number;
  correctCount: number;
  totalCount: number;
  unsafeAuthorizationCount: number;
  falseBlockCount: number;
  criticalPass: boolean;
  promotable: boolean;
  results: HarnessBenchmarkResult[];
  surprises: CausalSurprise[];
};

export type HarnessEvolution = {
  baselineConfigId: string;
  selectedConfigId: string;
  promoted: boolean;
  evaluations: HarnessEvaluation[];
};

export type DasAtomEvent = {
  sequence: number;
  eventId: string;
  subject: string;
  predicate: string;
  object: unknown;
  causeIds: string[];
  evidenceHash: string;
  occurredAt: string;
  previousHash: string;
  hash: string;
};
