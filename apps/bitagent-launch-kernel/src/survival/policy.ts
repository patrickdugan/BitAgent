import crypto from "node:crypto";
import type {
  FinancialCapability,
  PolicyDecision,
  SpendIntent,
  SurvivalAssessment,
  SurvivalPolicy,
  SurvivalRail,
  SurvivalReasonCode,
  TreasurySnapshot
} from "./types.js";

const INTEGER_ATOMS = /^(0|[1-9][0-9]*)$/;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalHash(value: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function atoms(value: string, field: string): bigint {
  if (!INTEGER_ATOMS.test(value)) throw new Error(`${field} must be an unsigned integer string`);
  return BigInt(value);
}

function nextCapability(rail: SurvivalRail): FinancialCapability {
  const capabilities: Record<SurvivalRail, FinancialCapability> = {
    bitcoin_onchain: "propose_psbt",
    lightning: "pay_invoice_capped",
    thorchain: "propose_swap",
    tradelayer: "propose_tradelayer_intake",
    fedimint: "propose_fedimint_payment",
    ark: "propose_vtxo_action",
    dlc: "propose_dlc",
    filecoin: "propose_filecoin_storage",
    akash: "propose_compute_lease",
    compute_market: "propose_compute_lease"
  };
  return capabilities[rail];
}

function totalBalance(snapshot: TreasurySnapshot): bigint {
  return Object.values(snapshot.balancesSats).reduce<bigint>((sum, value) => sum + atoms(value || "0", "balance"), 0n);
}

function observationReasons(snapshot: TreasurySnapshot, policy: SurvivalPolicy, nowMs: number): SurvivalReasonCode[] {
  const healthyBalanceObservers = new Set(
    snapshot.observers.filter((item) => item.healthy && item.subject === "treasury_balance").map((item) => item.sourceId)
  );
  const reasons: SurvivalReasonCode[] = [];
  if (healthyBalanceObservers.size < policy.minimumObserverQuorum) reasons.push("observer_quorum_missing");
  if (
    snapshot.observers.some(
      (item) => !Number.isFinite(Date.parse(item.observedAt)) || nowMs - Date.parse(item.observedAt) > policy.maxObservationAgeSeconds * 1000
    )
  ) {
    reasons.push("stale_observation");
  }
  if (snapshot.breakerAlerts?.length) reasons.push("breaker_active");
  return reasons;
}

export function assessSurvival(
  snapshot: TreasurySnapshot,
  policy: SurvivalPolicy,
  now: Date = new Date()
): SurvivalAssessment {
  const total = totalBalance(snapshot);
  const protectedReserve = [atoms(snapshot.protectedReserveSats, "snapshot.protectedReserveSats"), atoms(policy.protectedReserveSats, "policy.protectedReserveSats")]
    .reduce((highest, value) => (value > highest ? value : highest), 0n);
  const encumbered = atoms(snapshot.encumberedSats, "encumberedSats") + atoms(snapshot.pendingFlightSats, "pendingFlightSats");
  const available = total > protectedReserve + encumbered ? total - protectedReserve - encumbered : 0n;
  const burn = atoms(snapshot.essentialDailyBurnSats, "essentialDailyBurnSats");
  const runwayDays = burn === 0n ? null : Number(available / burn);
  const reasons = observationReasons(snapshot, policy, now.getTime());

  let mode: SurvivalAssessment["mode"] = "healthy";
  if (reasons.length) mode = "frozen";
  else if (total < protectedReserve) mode = "emergency";
  else if (runwayDays !== null && runwayDays < policy.minimumRunwayDays) mode = "conserve";

  return {
    mode,
    totalTreasurySats: total.toString(),
    availableOperatingSats: available.toString(),
    runwayDays,
    reasonCodes: reasons
  };
}

export function evaluateSpendIntent(
  intent: SpendIntent,
  policy: SurvivalPolicy,
  snapshot: TreasurySnapshot,
  now: Date = new Date()
): PolicyDecision {
  const hardReasons: SurvivalReasonCode[] = [];
  const manualReasons: SurvivalReasonCode[] = [];
  const expiresMs = Date.parse(intent.expiresAt);
  let valueSats = 0n;
  let feeSats = 0n;

  try {
    valueSats = atoms(intent.policyValueSats, "policyValueSats");
    feeSats = atoms(intent.maxFeeSats, "maxFeeSats");
    atoms(intent.amountAtoms, "amountAtoms");
    if (!intent.id || !intent.idempotencyKey || !intent.destination || valueSats === 0n) hardReasons.push("invalid_intent");
  } catch {
    hardReasons.push("invalid_intent");
  }

  if (intent.policyId !== policy.id) hardReasons.push("policy_mismatch");
  if (!Number.isFinite(expiresMs) || expiresMs <= now.getTime()) hardReasons.push("intent_expired");
  if (expiresMs - now.getTime() > policy.maxIntentLifetimeSeconds * 1000) hardReasons.push("intent_lifetime_exceeded");
  if (!policy.allowedPurposes.includes(intent.purpose)) hardReasons.push("unsupported_purpose");
  if (!policy.allowedRails.includes(intent.rail)) hardReasons.push("unsupported_rail");
  if ((intent.asset !== "BTC" || intent.rail === "thorchain") && !intent.quoteHash) hardReasons.push("quote_required");
  if ((intent.maxSlippageBps || 0) > policy.maxSlippageBps) hardReasons.push("slippage_exceeded");
  if (feeSats > atoms(policy.maxFeePerActionSats, "policy.maxFeePerActionSats")) hardReasons.push("fee_cap_exceeded");

  const requested = valueSats + feeSats;
  if (requested > atoms(policy.maxSingleSpendSats, "policy.maxSingleSpendSats")) hardReasons.push("single_spend_cap_exceeded");
  if (requested + atoms(snapshot.spentTodaySats, "spentTodaySats") > atoms(policy.maxDailySpendSats, "policy.maxDailySpendSats")) {
    hardReasons.push("daily_spend_cap_exceeded");
  }
  const railCap = policy.railCapsSats[intent.rail];
  if (!railCap || requested > atoms(railCap, `railCapsSats.${intent.rail}`)) hardReasons.push("rail_cap_exceeded");

  const assessment = assessSurvival(snapshot, policy, now);
  hardReasons.push(...assessment.reasonCodes);
  if (requested > atoms(assessment.availableOperatingSats, "availableOperatingSats")) hardReasons.push("protected_reserve_breach");
  if (intent.budget === "reserve") hardReasons.push("reserve_budget_forbidden");
  if (intent.budget === "strategy" || intent.purpose === "strategy") manualReasons.push("strategy_requires_manual_approval");
  if (requested > atoms(policy.maxAutonomousSpendSats, "policy.maxAutonomousSpendSats")) manualReasons.push("autonomous_cap_exceeded");
  if (policy.experimentalRails.includes(intent.rail)) manualReasons.push("experimental_rail_requires_manual_approval");

  const uniqueHard = [...new Set(hardReasons)];
  const uniqueManual = [...new Set(manualReasons)];
  const decision = uniqueHard.length ? "denied" : uniqueManual.length ? "manual_required" : "authorized";
  const reasonCodes = decision === "authorized" ? (["authorized"] as SurvivalReasonCode[]) : [...uniqueHard, ...uniqueManual];

  return {
    intentId: intent.id,
    intentHash: canonicalHash(intent),
    constraintsHash: canonicalHash({ policy, snapshotCapturedAt: snapshot.capturedAt, requestedSats: requested.toString() }),
    decision,
    reasonCodes,
    nextCapability: decision === "denied" ? undefined : nextCapability(intent.rail),
    expiresAt: intent.expiresAt
  };
}
