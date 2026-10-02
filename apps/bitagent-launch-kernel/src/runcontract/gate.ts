import { hashObject } from "../launch/canonical.js";
import { ALL_GATES, MAX_QUOTE_SEQUENCE_LAG } from "./constants.js";
import { amountTextToAtoms, runContractCore } from "./contract.js";
import type { EvidenceRegistry } from "./registry.js";
import type {
  ActionEnvelope,
  ActionEnvelopeDraft,
  EvidenceReceipt,
  GateId,
  GateVerdict,
  RunBudgetState,
  RunContract,
  RunContractApproval
} from "./types.js";

export const GATE_POLICY_HASH = hashObject({ policy: "bitagent.run_contract_gate", version: 1, gates: ALL_GATES });

export type GatePhase = "simulate" | "approval" | "execute";

export type GateContext = {
  contract: RunContract;
  approval: RunContractApproval | null;
  budget: RunBudgetState;
  registry: EvidenceRegistry;
  now: Date;
  phase: GatePhase;
  // The host's own view of the chain tip, in the same units as quote receipts' `sequence`.
  tipSequence?: number;
  // The simulation hash the wallet approval or lease was issued for. Required at `execute`.
  leaseSimulationHash?: string;
  disabled?: ReadonlySet<GateId>;
};

function sum(values: string[]) {
  return values.reduce((total, value) => total + BigInt(value), 0n);
}

function committed(budget: RunBudgetState, asset: string) {
  return BigInt(budget.spentAtoms[asset] || "0")
    + sum(budget.inFlight.filter((action) => action.spend.asset === asset).map((action) => action.spend.atoms));
}

function committedFees(budget: RunBudgetState, asset: string) {
  return BigInt(budget.feeAtoms[asset] || "0")
    + sum(budget.inFlight.flatMap((action) => action.fees.filter((fee) => fee.asset === asset).map((fee) => fee.atoms)));
}

function scopedAsset(contract: RunContract, asset: string, roles: string[]) {
  return contract.scope.assets.find((entry) => entry.asset === asset && roles.includes(entry.role));
}

function priceQuorum(contract: RunContract, prices: (EvidenceReceipt | undefined)[], now: Date) {
  const fresh = prices.filter((price): price is EvidenceReceipt => Boolean(price
    && price.kind === "price"
    && typeof price.typed.sourceId === "string"
    && typeof price.typed.markPriceCents === "string"
    && now.getTime() - Date.parse(price.observedAt) <= contract.limits.maxQuoteAgeMs));
  const bySource = new Map(fresh.map((price) => [String(price.typed.sourceId), BigInt(String(price.typed.markPriceCents))]));
  if (bySource.size < contract.limits.minPriceSources) return "price_below_quorum";
  const marks = [...bySource.values()];
  const low = marks.reduce((left, right) => (left < right ? left : right));
  const high = marks.reduce((left, right) => (left > right ? left : right));
  if (low <= 0n) return "price_invalid";
  return (high - low) * 10_000n > BigInt(contract.limits.maxPriceDeviationBps) * low ? "price_conflict" : null;
}

function unitsConsistent(contract: RunContract, envelope: ActionEnvelopeDraft, intent?: EvidenceReceipt, quote?: EvidenceReceipt) {
  if (!intent || !quote) return "units_unverifiable";
  const decimals = contract.scope.assets.find((entry) => entry.asset === envelope.spend.asset)?.decimals;
  if (decimals === undefined) return "units_unverifiable";
  try {
    const stated = amountTextToAtoms(String(intent.typed.amountText ?? ""), String(intent.typed.amountUnit ?? ""), decimals);
    if (stated.toString() !== envelope.spend.atoms) return "amount_differs_from_user_text";
  } catch {
    return "amount_text_unparseable";
  }
  if (quote.typed.spendAsset !== envelope.spend.asset || quote.typed.spendAtoms !== envelope.spend.atoms) {
    return "quote_amount_differs_from_intent";
  }
  return quote.typed.actionClass === envelope.actionClass ? null : "quote_action_differs_from_intent";
}

// Evaluates every gate against one exact action. Each gate returns a reason code or null; a disabled
// gate reports true so knockout experiments can measure what that gate alone was preventing.
export function evaluateGates(envelope: ActionEnvelopeDraft, context: GateContext): GateVerdict {
  const { contract, budget, now } = context;
  const { limits, scope } = contract;
  const intent = context.registry.resolve(envelope.intentRef);
  const quote = context.registry.resolve(envelope.quoteRef);
  const prices = envelope.priceRefs.map((id) => context.registry.resolve(id));
  const nowMs = now.getTime();

  const gates: Record<GateId, () => string | null> = {
    G01_contract_active: () => {
      if (hashObject(runContractCore(contract)) !== contract.contractHash) return "contract_hash_mismatch";
      if (envelope.contractHash !== contract.contractHash) return "envelope_contract_mismatch";
      if (!context.approval || context.approval.contractHash !== contract.contractHash) return "contract_not_approved";
      if (context.approval.status !== "approved") return "contract_revoked";
      if (nowMs < Date.parse(contract.effectiveAt)) return "contract_not_effective";
      return nowMs >= Date.parse(contract.stop.expiresAt) ? "contract_expired" : null;
    },
    G02_chain_allowed: () => {
      if (!scope.chains.includes(envelope.chain)) return "chain_out_of_scope";
      if (!quote || quote.chain !== envelope.chain) return "quote_chain_mismatch";
      return envelope.destination.chain === envelope.chain ? null : "destination_chain_mismatch";
    },
    G03_asset_allowed: () => {
      if (!scopedAsset(contract, envelope.spend.asset, ["spend", "both"])) return "spend_asset_out_of_scope";
      if (!scopedAsset(contract, envelope.receiveMin.asset, ["receive", "both"])) return "receive_asset_out_of_scope";
      return envelope.fees.every((fee) => scopedAsset(contract, fee.asset, ["spend", "receive", "both"]))
        ? null : "fee_asset_out_of_scope";
    },
    G04_venue_allowed: () => (scope.venues.some((venue) => venue.id === envelope.venueId) ? null : "venue_out_of_scope"),
    G05_destination_allowed: () => {
      const label = envelope.actionClass === "withdraw" ? "self" : "venue";
      return scope.destinations.some((entry) => entry.label === label
        && entry.chain === envelope.destination.chain
        && entry.address === envelope.destination.address) ? null : "destination_out_of_scope";
    },
    G06_action_allowed: () => (scope.actions.includes(envelope.actionClass) ? null : "action_out_of_scope"),
    G07_per_action_cap: () => {
      const cap = limits.perActionMaxAtoms[envelope.spend.asset];
      if (cap === undefined) return "per_action_cap_undefined";
      return BigInt(envelope.spend.atoms) <= BigInt(cap) ? null : "per_action_cap_exceeded";
    },
    G08_cumulative_cap: () => {
      const cap = limits.cumulativeMaxAtoms[envelope.spend.asset];
      if (cap === undefined) return "cumulative_cap_undefined";
      return committed(budget, envelope.spend.asset) + BigInt(envelope.spend.atoms) <= BigInt(cap)
        ? null : "cumulative_cap_exceeded";
    },
    G09_quote_fresh: () => {
      if (!quote) return "quote_unregistered";
      if (quote.flags.includes("stale")) return "quote_flagged_stale";
      if (nowMs - Date.parse(quote.observedAt) > limits.maxQuoteAgeMs) return "quote_too_old";
      if (quote.expiresAt && nowMs >= Date.parse(quote.expiresAt)) return "quote_expired";
      if (context.tipSequence !== undefined && quote.sequence !== undefined
        && context.tipSequence - Number(quote.sequence) > MAX_QUOTE_SEQUENCE_LAG) return "quote_behind_tip";
      return nowMs >= Date.parse(envelope.expiresAt) ? "simulation_expired" : null;
    },
    G10_price_quorum: () => priceQuorum(contract, prices, now),
    G11_slippage_bound: () => (envelope.effectiveSlippageBps <= limits.maxSlippageBps ? null : "slippage_exceeded"),
    G12_fee_cap: () => {
      for (const asset of new Set(envelope.fees.map((fee) => fee.asset))) {
        const cap = limits.maxTotalFeeAtoms[asset];
        if (cap === undefined) return "fee_cap_undefined";
        const next = sum(envelope.fees.filter((fee) => fee.asset === asset).map((fee) => fee.atoms));
        if (committedFees(budget, asset) + next > BigInt(cap)) return "fee_cap_exceeded";
      }
      return null;
    },
    G13_units_consistent: () => unitsConsistent(contract, envelope, intent, quote),
    G14_idempotent: () => {
      if (budget.idempotencyKeys.includes(envelope.idempotencyKey)) return "duplicate_action";
      if (budget.inFlight.some((action) => action.idempotencyKey === envelope.idempotencyKey)) return "duplicate_action";
      return budget.inFlight.length === 0 ? null : "action_in_flight";
    },
    G15_evidence_attested: () => {
      if (!intent || !quote || prices.some((price) => !price)) return "evidence_unregistered";
      if (intent.kind !== "user_utterance" || intent.source.trust !== "host_verified") return "intent_not_user_attested";
      if (quote.kind !== "quote" || quote.source.trust === "untrusted_text") return "quote_not_attested";
      if (prices.some((price) => price!.kind !== "price" || price!.source.trust === "untrusted_text")) return "price_not_attested";
      return [intent, quote, ...prices].some((receipt) => receipt!.flags.includes("unverified_claim"))
        ? "evidence_unverified_claim" : null;
    },
    G16_strategy_bound: () => {
      if (!contract.strategy || !["place_limit", "cancel", "reduce_position"].includes(envelope.actionClass)) return null;
      return envelope.strategyParamsHash === contract.strategy.paramsHash ? null : "strategy_params_mismatch";
    },
    G17_simulation_bound: () => {
      if (context.phase !== "execute") return null;
      return context.leaseSimulationHash === envelope.simulationHash ? null : "approval_not_bound_to_simulation";
    },
    G18_run_limits: () => {
      if (budget.actionsUsed + budget.inFlight.length >= limits.maxActions) return "max_actions_reached";
      return budget.modelTurnsUsed > contract.stop.maxModelTurns ? "max_model_turns_reached" : null;
    }
  };

  const reasonCodes: string[] = [];
  const checks = Object.fromEntries(ALL_GATES.map((gate) => {
    const reason = context.disabled?.has(gate) ? null : gates[gate]();
    if (reason) reasonCodes.push(`${gate}:${reason}`);
    return [gate, reason === null];
  })) as Record<GateId, boolean>;
  const admitted = reasonCodes.length === 0;
  return {
    schema: "bitagent.gate_verdict.v1",
    admitted,
    checks,
    reasonCodes,
    nextAuthority: !admitted ? "none"
      : contract.autonomy.mode === "delegated_within_contract" ? "lease" : "wallet_user",
    policyHash: GATE_POLICY_HASH
  };
}

export function gateEnvelope(envelope: ActionEnvelopeDraft, context: GateContext): ActionEnvelope {
  return { ...envelope, gate: evaluateGates(envelope, context) };
}

export function failedGates(verdict: GateVerdict) {
  return ALL_GATES.filter((gate) => !verdict.checks[gate]);
}
