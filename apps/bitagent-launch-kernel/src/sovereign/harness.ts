import { prepareNearChainSignature } from "../adapters/nearChainSignatureAdapter.js";
import { canonicalHash, evaluateSpendIntent } from "../survival/policy.js";
import { authorizeCapabilityRequest, capabilityRequestFingerprint, InMemoryCapabilityLeaseStore } from "./capabilities.js";
import { buildHarnessCandidates, buildSovereignBenchmarks, evolveHarness } from "./evolution.js";
import { createInitialSelfModel, updateSelfModelFromEvolution } from "./selfModel.js";
import type { CapabilityRequest, DasAtomEvent, HarnessConfigCandidate } from "./types.js";

const GENESIS_HASH = "0".repeat(64);

export function buildDasAtomEvents(
  rows: Array<{ subject: string; predicate: string; object: unknown; causeIds?: string[] }>,
  occurredAt: string
): DasAtomEvent[] {
  let previousHash = GENESIS_HASH;
  return rows.map((row, sequence) => {
    const material = {
      sequence,
      eventId: canonicalHash({ sequence, row, occurredAt }),
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      causeIds: row.causeIds || [],
      evidenceHash: canonicalHash(row.object),
      occurredAt,
      previousHash
    };
    const event = { ...material, hash: canonicalHash(material) };
    previousHash = event.hash;
    return event;
  });
}

export function verifyDasAtomEvents(events: DasAtomEvent[]): boolean {
  let previousHash = GENESIS_HASH;
  for (let sequence = 0; sequence < events.length; sequence += 1) {
    const event = events[sequence];
    if (!event || event.sequence !== sequence || event.previousHash !== previousHash) return false;
    const { hash, ...material } = event;
    if (canonicalHash(material) !== hash) return false;
    previousHash = hash;
  }
  return true;
}

function mettaSymbol(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function renderMettaSnapshot(input: {
  agentId: string;
  configId: string;
  leaseId: string;
  capability: string;
  leaseStatus: string;
  benchmarkScore: number;
}): string {
  return [
    "; Sovereign harness inspection snapshot. Runtime authority remains external.",
    `(Agent ${mettaSymbol(input.agentId)})`,
    `(HarnessConfig ${mettaSymbol(input.configId)})`,
    `(active-config ${mettaSymbol(input.agentId)} ${mettaSymbol(input.configId)})`,
    `(benchmark-score ${mettaSymbol(input.configId)} ${input.benchmarkScore})`,
    `(CapabilityLease ${mettaSymbol(input.leaseId)})`,
    `(lease-capability ${mettaSymbol(input.leaseId)} ${mettaSymbol(input.capability)})`,
    `(lease-status ${mettaSymbol(input.leaseId)} ${mettaSymbol(input.leaseStatus)})`,
    `(runtime-commit-authority external-host)`,
    ""
  ].join("\n");
}

export function runSovereignHarnessDemo(now: Date = new Date()) {
  const candidates = buildHarnessCandidates();
  const scenarios = buildSovereignBenchmarks(now);
  const evolution = evolveHarness(candidates, scenarios, now);
  const selectedConfig = candidates.find((candidate) => candidate.id === evolution.selectedConfigId) as HarnessConfigCandidate;
  const selfModelBefore = createInitialSelfModel(now);
  const selfModelAfter = updateSelfModelFromEvolution(selfModelBefore, evolution, now);

  const leaseScenario = scenarios.find((scenario) => scenario.id === "safe-compute-35k")!;
  const policyDecision = evaluateSpendIntent(leaseScenario.intent, selectedConfig.policy, leaseScenario.snapshot, now);
  const requestMaterial: Omit<CapabilityRequest, "invocationFingerprint"> = {
    requestId: "cap-safe-compute-35k",
    agentId: selfModelAfter.agentId,
    capability: "pay_invoice_capped",
    effects: ["read_state", "reserve_capital", "request_signature"],
    scope: {
      rail: leaseScenario.intent.rail,
      amountSats: leaseScenario.intent.policyValueSats,
      destination: leaseScenario.intent.destination
    },
    expiresAt: leaseScenario.intent.expiresAt,
    intent: leaseScenario.intent
  };
  const capabilityRequest: CapabilityRequest = {
    ...requestMaterial,
    invocationFingerprint: capabilityRequestFingerprint(requestMaterial)
  };
  const authorization = authorizeCapabilityRequest(capabilityRequest, selfModelAfter, policyDecision, now);
  const leaseStore = new InMemoryCapabilityLeaseStore();
  const activeLease = leaseStore.issue(capabilityRequest, authorization, now);
  const signaturePreparation = prepareNearChainSignature({
    lease: activeLease,
    targetChain: "bitcoin",
    derivationPath: process.env.NEAR_CHAIN_SIGNATURE_PATH || "bitcoin,0",
    payloadHash: canonicalHash({ intent: leaseScenario.intent, leaseId: activeLease.leaseId }),
    nearAccount: process.env.NEAR_ACCOUNT_ID
  });
  const consumedLease = leaseStore.consume(activeLease.leaseId, capabilityRequest.invocationFingerprint, now);

  const atomRows = [
    ...evolution.evaluations.map((evaluation) => ({ subject: evaluation.configId, predicate: "benchmark-evaluated", object: evaluation })),
    { subject: selfModelAfter.agentId, predicate: "harness-config-selected", object: evolution },
    { subject: activeLease.leaseId, predicate: "capability-lease-issued", object: activeLease },
    { subject: consumedLease.leaseId, predicate: "capability-lease-consumed", object: consumedLease, causeIds: [activeLease.leaseId] },
    { subject: selfModelAfter.agentId, predicate: "self-model-updated", object: selfModelAfter }
  ];
  const events = buildDasAtomEvents(atomRows, now.toISOString());
  const selectedEvaluation = evolution.evaluations.find((evaluation) => evaluation.configId === evolution.selectedConfigId)!;
  const mettaSnapshot = renderMettaSnapshot({
    agentId: selfModelAfter.agentId,
    configId: selectedConfig.id,
    leaseId: consumedLease.leaseId,
    capability: consumedLease.capability,
    leaseStatus: consumedLease.status,
    benchmarkScore: selectedEvaluation.score
  });

  return {
    schema: "sovereign_agent_harness_demo_v1",
    generatedAt: now.toISOString(),
    principles: {
      modelRole: "bounded proposer and configuration-candidate generator",
      stateAuthority: "host-owned structured self-model and causal event log",
      financialAuthority: "external capability lease and signer",
      adaptationRule: "promote only benchmark-improving configurations with zero unsafe authorizations"
    },
    scenarios,
    candidates: candidates.map(({ policy, ...candidate }) => ({ ...candidate, policyHash: canonicalHash(policy) })),
    evolution,
    selfModelBefore,
    selfModelAfter,
    capabilityRequest,
    authorization,
    activeLease,
    consumedLease,
    signaturePreparation,
    events,
    eventsValid: verifyDasAtomEvents(events),
    mettaSnapshot
  };
}
