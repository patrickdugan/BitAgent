import { publishActivity } from "../adapters/walletAdapter.js";
import type { OnboardingActivity } from "../types.js";
import { appendSurvivalEvent } from "./journal.js";
import { assessSurvival, canonicalHash, evaluateSpendIntent } from "./policy.js";
import type { SpendIntent, SurvivalPolicy, TreasurySnapshot } from "./types.js";

export const defaultSurvivalPolicy: SurvivalPolicy = {
  id: "agent-survival-v1",
  version: 1,
  allowedPurposes: ["compute", "network", "storage", "security", "recovery"],
  allowedRails: ["bitcoin_onchain", "lightning", "thorchain", "tradelayer", "fedimint", "ark", "dlc", "filecoin", "akash", "compute_market"],
  experimentalRails: ["fedimint", "ark", "dlc", "filecoin", "akash", "compute_market"],
  minimumRunwayDays: 30,
  protectedReserveSats: "750000",
  maxSingleSpendSats: "100000",
  maxAutonomousSpendSats: "30000",
  maxDailySpendSats: "150000",
  maxFeePerActionSats: "10000",
  maxSlippageBps: 100,
  maxIntentLifetimeSeconds: 600,
  maxObservationAgeSeconds: 300,
  minimumObserverQuorum: 2,
  railCapsSats: {
    bitcoin_onchain: "100000",
    lightning: "50000",
    thorchain: "100000",
    tradelayer: "100000",
    fedimint: "25000",
    ark: "25000",
    dlc: "25000",
    filecoin: "25000",
    akash: "25000",
    compute_market: "25000"
  }
};

export function buildDemoSnapshot(now: Date = new Date()): TreasurySnapshot {
  const observedAt = now.toISOString();
  return {
    capturedAt: observedAt,
    balancesSats: {
      bitcoin_onchain: "1500000",
      lightning: "100000",
      tradelayer: "50000"
    },
    protectedReserveSats: "750000",
    encumberedSats: "100000",
    spentTodaySats: "15000",
    essentialDailyBurnSats: "15000",
    pendingFlightSats: "0",
    observers: [
      { sourceId: "bitcoin-core-local", subject: "treasury_balance", observedAt, valueHash: canonicalHash("1650000"), healthy: true },
      { sourceId: "watch-only-replica", subject: "treasury_balance", observedAt, valueHash: canonicalHash("1650000"), healthy: true },
      { sourceId: "ldk-monitor", subject: "channel_monitor", observedAt, valueHash: canonicalHash("current"), healthy: true }
    ]
  };
}

export function buildDemoIntent(now: Date = new Date()): SpendIntent {
  const id = process.env.SURVIVAL_INTENT_ID || "survival-demo-compute";
  return {
    id,
    idempotencyKey: process.env.SURVIVAL_IDEMPOTENCY_KEY || id,
    purpose: "compute",
    budget: "operations",
    rail: "lightning",
    asset: "BTC",
    amountAtoms: process.env.SURVIVAL_AMOUNT_SATS || "25000",
    policyValueSats: process.env.SURVIVAL_AMOUNT_SATS || "25000",
    destination: process.env.SURVIVAL_DESTINATION || "ln-invoice-redacted",
    maxFeeSats: process.env.SURVIVAL_MAX_FEE_SATS || "500",
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    policyId: defaultSurvivalPolicy.id,
    sourceReceipts: []
  };
}

function activityForDecision(intent: SpendIntent, decision: ReturnType<typeof evaluateSpendIntent>, runwayDays: number | null): OnboardingActivity {
  const denied = decision.decision === "denied";
  return {
    id: `financial_survival:${intent.id}`,
    phase: "financial_survival",
    status: denied ? "error" : "pending",
    label: denied
      ? "Financial survival policy denied the intent"
      : "Financial intent staged for an external capability broker",
    meta: {
      intentHash: decision.intentHash,
      decision: decision.decision,
      reasonCodes: decision.reasonCodes,
      nextCapability: decision.nextCapability,
      runwayDays
    }
  };
}

export async function runFinancialSurvivalDemo(now: Date = new Date()) {
  const snapshot = buildDemoSnapshot(now);
  const intent = buildDemoIntent(now);
  const assessment = assessSurvival(snapshot, defaultSurvivalPolicy, now);
  const decision = evaluateSpendIntent(intent, defaultSurvivalPolicy, snapshot, now);

  const journal = [];
  journal.push(await appendSurvivalEvent({ type: "snapshot_assessed", occurredAt: now.toISOString(), payload: assessment }));
  journal.push(await appendSurvivalEvent({ type: "intent_proposed", occurredAt: now.toISOString(), intentId: intent.id, payload: intent }));
  journal.push(await appendSurvivalEvent({ type: "policy_decided", occurredAt: now.toISOString(), intentId: intent.id, payload: decision }));
  await publishActivity(activityForDecision(intent, decision, assessment.runwayDays));

  return { policy: defaultSurvivalPolicy, snapshot, assessment, intent, decision, journal };
}
