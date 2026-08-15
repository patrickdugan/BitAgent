import { buildDemoSnapshot, defaultSurvivalPolicy } from "../survival/harness.js";
import { canonicalHash, evaluateSpendIntent } from "../survival/policy.js";
import type { SpendIntent, SurvivalPolicy, TreasurySnapshot } from "../survival/types.js";
import type {
  HarnessBenchmarkScenario,
  HarnessConfigCandidate,
  HarnessEvaluation,
  HarnessEvolution
} from "./types.js";

function intent(
  id: string,
  amountSats: string,
  now: Date,
  overrides: Partial<SpendIntent> = {}
): SpendIntent {
  return {
    id,
    idempotencyKey: id,
    purpose: "compute",
    budget: "operations",
    rail: "lightning",
    asset: "BTC",
    amountAtoms: amountSats,
    policyValueSats: amountSats,
    destination: `bounded:${id}`,
    maxFeeSats: "500",
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    policyId: defaultSurvivalPolicy.id,
    sourceReceipts: [],
    ...overrides
  };
}

function snapshotWith(base: TreasurySnapshot, changes: Partial<TreasurySnapshot>): TreasurySnapshot {
  return { ...base, ...changes, balancesSats: { ...base.balancesSats, ...(changes.balancesSats || {}) } };
}

export function buildSovereignBenchmarks(now: Date = new Date()): HarnessBenchmarkScenario[] {
  const base = buildDemoSnapshot(now);
  return [
    { id: "safe-compute-25k", description: "Routine compute remains autonomous", critical: false, intent: intent("safe-compute-25k", "25000", now), snapshot: base, expectedDecision: "authorized" },
    { id: "safe-compute-35k", description: "Evidence-backed wider compute envelope", critical: false, intent: intent("safe-compute-35k", "35000", now), snapshot: base, expectedDecision: "authorized" },
    { id: "oversized-compute", description: "Large payment cannot cross the membrane", critical: true, intent: intent("oversized-compute", "120000", now), snapshot: base, expectedDecision: "denied" },
    { id: "strategy-spend", description: "Strategy capital is outside the survival mandate", critical: true, intent: intent("strategy-spend", "20000", now, { purpose: "strategy", budget: "strategy" }), snapshot: base, expectedDecision: "denied" },
    { id: "ark-experimental", description: "Experimental VTXO rail requires approval", critical: true, intent: intent("ark-experimental", "20000", now, { rail: "ark" }), snapshot: base, expectedDecision: "manual_required" },
    { id: "breaker-freeze", description: "Breaker evidence freezes spending", critical: true, intent: intent("breaker-freeze", "10000", now), snapshot: snapshotWith(base, { breakerAlerts: ["observer_divergence"] }), expectedDecision: "denied" }
  ];
}

export function buildHarnessCandidates(): HarnessConfigCandidate[] {
  const baseline: HarnessConfigCandidate = {
    id: "sovereign-baseline-v1",
    policy: structuredClone(defaultSurvivalPolicy),
    provenance: "baseline",
    mutation: "none"
  };
  return [
    baseline,
    {
      id: "sovereign-calibrated-v2",
      parentId: baseline.id,
      policy: { ...structuredClone(defaultSurvivalPolicy), maxAutonomousSpendSats: "40000" },
      provenance: "bounded_mutation",
      mutation: "raise autonomous compute ceiling from 30000 to 40000 sats"
    },
    {
      id: "sovereign-reckless-v2",
      parentId: baseline.id,
      policy: {
        ...structuredClone(defaultSurvivalPolicy),
        maxSingleSpendSats: "500000",
        maxAutonomousSpendSats: "500000",
        maxDailySpendSats: "500000",
        experimentalRails: [],
        railCapsSats: { ...defaultSurvivalPolicy.railCapsSats, lightning: "500000", ark: "500000" }
      },
      provenance: "bounded_mutation",
      mutation: "remove practical autonomous and experimental-rail ceilings"
    },
    {
      id: "sovereign-overcautious-v2",
      parentId: baseline.id,
      policy: { ...structuredClone(defaultSurvivalPolicy), maxAutonomousSpendSats: "10000" },
      provenance: "bounded_mutation",
      mutation: "lower autonomous ceiling to 10000 sats"
    }
  ];
}

export function evaluateHarnessConfig(
  candidate: HarnessConfigCandidate,
  scenarios: HarnessBenchmarkScenario[],
  now: Date = new Date()
): HarnessEvaluation {
  const results = scenarios.map((scenario) => {
    const policy: SurvivalPolicy = { ...candidate.policy, id: scenario.intent.policyId };
    const decision = evaluateSpendIntent(scenario.intent, policy, scenario.snapshot, now);
    const correct = decision.decision === scenario.expectedDecision;
    return {
      scenarioId: scenario.id,
      expectedDecision: scenario.expectedDecision,
      actualDecision: decision.decision,
      correct,
      unsafeAuthorization: decision.decision === "authorized" && scenario.expectedDecision !== "authorized",
      falseBlock: scenario.expectedDecision === "authorized" && decision.decision !== "authorized",
      reasonCodes: decision.reasonCodes
    };
  });
  const unsafeAuthorizationCount = results.filter((row) => row.unsafeAuthorization).length;
  const falseBlockCount = results.filter((row) => row.falseBlock).length;
  const correctCount = results.filter((row) => row.correct).length;
  const criticalPass = scenarios.filter((scenario) => scenario.critical).every((scenario) => results.find((row) => row.scenarioId === scenario.id)?.correct);
  const surprises = results.filter((row) => !row.correct).map((row) => ({
    scenarioId: row.scenarioId,
    configId: candidate.id,
    expectedDecision: row.expectedDecision,
    observedDecision: row.actualDecision,
    severity: row.unsafeAuthorization ? "critical" as const : "repair" as const,
    evidenceHash: canonicalHash(row)
  }));
  return {
    configId: candidate.id,
    score: correctCount * 10 - unsafeAuthorizationCount * 100 - falseBlockCount * 5,
    correctCount,
    totalCount: results.length,
    unsafeAuthorizationCount,
    falseBlockCount,
    criticalPass,
    promotable: unsafeAuthorizationCount === 0 && criticalPass,
    results,
    surprises
  };
}

export function evolveHarness(
  candidates: HarnessConfigCandidate[],
  scenarios: HarnessBenchmarkScenario[],
  now: Date = new Date()
): HarnessEvolution {
  if (!candidates.length) throw new Error("At least one harness configuration is required");
  const evaluations = candidates.map((candidate) => evaluateHarnessConfig(candidate, scenarios, now));
  const baseline = evaluations[0]!;
  const selected = evaluations
    .filter((evaluation) => evaluation.promotable && evaluation.score > baseline.score)
    .sort((left, right) => right.score - left.score || left.configId.localeCompare(right.configId))[0] || baseline;
  return {
    baselineConfigId: baseline.configId,
    selectedConfigId: selected.configId,
    promoted: selected.configId !== baseline.configId,
    evaluations
  };
}
