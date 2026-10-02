import { hashObject, parseDecimal } from "../launch/canonical.js";
import { buildStrategyCandidate } from "../mandates/allocator.js";
import { StrategyMandateError } from "../mandates/errors.js";
import type { StrategyCovenant, StrategyCovenantApproval, StrategyPolicyHint } from "../mandates/types.js";
import {
  createMarketSnapshot,
  createPortfolioState,
  createStrategyCovenant,
  createStrategyCovenantApproval,
  createStrategyProposal
} from "../mandates/validator.js";
import { verifyStrategyCandidate } from "../mandates/verifier.js";
import { researchGuardrails } from "./config.js";

export const POLICY_HINTS: StrategyPolicyHint[] = [
  "HOLD", "QUOTE_BOTH_SIDES", "SHIFT_BID", "SHIFT_ASK", "REDUCE_DELTA", "REBALANCE_TO_TARGET", "CANCEL_STALE"
];

// Mirrors src/mandates/validator.ts, which stays the enforcing authority. The
// leverage ceiling is the tighter research guardrail, not the protocol maximum.
export const COVENANT_BOUNDS = {
  strategies: { minimum: 1, maximum: 8 },
  weightBps: { minimum: 1, maximum: 10_000, mustTotal: 10_000 },
  absoluteMaxDriftBps: { minimum: 0, maximum: 2_500 },
  maxGrossLeverageBps: { minimum: 0, maximum: researchGuardrails.maxGrossLeverageBps },
  maxNetDeltaBps: { minimum: 0, maximum: 10_000 },
  maxOrderFractionNavBps: { minimum: 1, maximum: 10_000 },
  maxDailyLossBps: { minimum: 1, maximum: 10_000 },
  maxDrawdownBps: { minimum: 1, maximum: 10_000 },
  maxSlippageBps: { minimum: 0, maximum: 5_000 },
  targetNetDeltaBps: { minimum: -10_000, maximum: 10_000 }
} as const;

export type CovenantDraft = {
  mandateId: string;
  capitalCapUsd: string;
  strategies: Array<{ strategyId: string; weightBps: number }>;
  absoluteMaxDriftBps: number;
  risk: {
    maxGrossLeverageBps: number;
    maxNetDeltaBps: number;
    maxOrderFractionNavBps: number;
    maxDailyLossBps: number;
    maxDrawdownBps: number;
    maxSlippageBps: number;
    maxNetworkFeeSats: string;
  };
};

export type StressScenario = {
  label: string;
  market: { bidPriceUsd: string; askPriceUsd: string; markPriceUsd: string };
  portfolio: {
    capitalUsd: string;
    currentNetDeltaBps: number;
    grossLeverageBps: number;
    dailyLossBps: number;
    drawdownBps: number;
  };
  targets: Array<{ strategyId: string; targetNetDeltaBps: number; policyHint: StrategyPolicyHint }>;
  networkFeeSats?: string;
};

const NO_EFFECT = {
  scenarioSource: "model_hypothetical_not_market_data" as const,
  covenantApproval: "not_requested" as const,
  strategyAdapters: "research_placeholders_not_committed_code" as const,
  authority: "deterministic_host" as const,
  effect: "none" as const,
  signingPerformed: false as const,
  broadcastPerformed: false as const,
  fundedExecutionAllowed: false as const
};

export function buildResearchBrief() {
  return {
    kind: "research_brief" as const,
    lane: "Strategy Covenant (candidate-only, Bitcoin testnet4)",
    roles: {
      chatgpt: "Research and explain trading-system ideas, then express one as a covenant draft and hypothetical scenarios.",
      deterministicHost: "Validates the draft, runs the real allocator and verifier on each scenario, and reports what it would propose.",
      walletUser: "The only party that can approve a covenant hash or an exact transaction, on their self-hosted BitAgent."
    },
    hardLimits: {
      instrument: "TLBTC/TLUSD only",
      orderType: "post-only limit orders (TradeLayer tx5); a circuit breaker produces reduce_position",
      leverage: "At most 1x gross on this surface, because product eligibility has not been established.",
      bounds: COVENANT_BOUNDS,
      policyHints: POLICY_HINTS
    },
    allocationMath: [
      "weighted target = trunc(sum(weightBps * targetNetDeltaBps) / 10000), clamped to +/- maxNetDeltaBps",
      "gross leverage above the cap, or daily loss / drawdown at the cap, forces the target to 0",
      "no order inside the absoluteMaxDriftBps corridor",
      "order notional is capped by capital and maxOrderFractionNavBps, then converted to whole sats at the mark price"
    ],
    researchProtocol: [
      "State the hypothesis and the market mechanism that would make it true.",
      "Name the data that would test it and what result would falsify it.",
      "Express it as 1 to 8 named strategies with weights totalling 10000 bps and explicit risk caps.",
      "Stress-test calm, trending, gapping, and loss-limit scenarios; include ones meant to break it.",
      "Report where the host held, scaled down, or tripped a circuit breaker, and what remains untested."
    ],
    notEvidence: [
      "A replay uses numbers you supplied. It is not a backtest, a forecast, or market data.",
      "Fills are never guaranteed, and nothing here predicts profit.",
      "A valid draft is not approved, committed, signed, or executable."
    ],
    reference: "docs/strategy-covenant.md",
    ...NO_EFFECT
  };
}

function draftCovenant(draft: CovenantDraft, now: Date) {
  const placeholder = (module: string) => hashObject({ kind: "chatgpt-research-placeholder", module });
  return createStrategyCovenant({
    schema: "bitagent_strategy_covenant_v1",
    mandateId: draft.mandateId,
    version: 1,
    owner: { walletAccount: "research-draft-unbound", walletProvider: "bitcoin_wallet" },
    capital: { asset: "tlUSD", capAtoms: parseDecimal(draft.capitalCapUsd, 8, "capitalCapUsd").toString() },
    channelIds: ["research-channel"],
    strategies: draft.strategies.map((strategy) => ({
      strategyId: strategy.strategyId,
      strategyVersion: "draft",
      weightBps: strategy.weightBps,
      adapterHash: placeholder(`adapter:${strategy.strategyId}`)
    })),
    allocation: { absoluteMaxDriftBps: draft.absoluteMaxDriftBps },
    risk: { ...draft.risk },
    execution: {
      instruments: ["TLBTC/TLUSD"],
      permittedActions: ["place_limit", "cancel", "reduce_position", "rebalance"],
      orderTtlMs: 3_000,
      maxMarketAgeMs: 2_000,
      oraclePolicy: "research-hypothetical-oracle",
      counterpartyPolicy: "research-hypothetical-peers"
    },
    runtime: {
      baseModelHash: placeholder("base-model"),
      allocatorHash: placeholder("allocator"),
      verifierHash: placeholder("verifier")
    },
    effectiveAt: new Date(now.getTime() - 60_000).toISOString(),
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString()
  });
}

function replayScenario(
  covenant: StrategyCovenant,
  approval: StrategyCovenantApproval,
  scenario: StressScenario,
  now: Date
) {
  const market = createMarketSnapshot({
    schema: "bitagent_strategy_market_snapshot_v1",
    pair: "TLBTC/TLUSD",
    ...scenario.market,
    oraclePolicy: covenant.execution.oraclePolicy,
    observedAt: now.toISOString(),
    source: NO_EFFECT.scenarioSource
  });
  const portfolio = createPortfolioState({
    schema: "bitagent_strategy_portfolio_v1",
    channelId: covenant.channelIds[0]!,
    capitalAtoms: parseDecimal(scenario.portfolio.capitalUsd, 8, "capitalUsd").toString(),
    currentNetDeltaBps: scenario.portfolio.currentNetDeltaBps,
    grossLeverageBps: scenario.portfolio.grossLeverageBps,
    dailyLossBps: scenario.portfolio.dailyLossBps,
    drawdownBps: scenario.portfolio.drawdownBps,
    nonce: 0,
    observedAt: now.toISOString()
  });
  const proposals = scenario.targets.map((target) => createStrategyProposal({
    schema: "bitagent_strategy_proposal_v1",
    strategyId: target.strategyId,
    strategyVersion: "draft",
    adapterHash: covenant.strategies.find((module) => module.strategyId === target.strategyId)?.adapterHash
      || hashObject({ kind: "chatgpt-research-unknown-strategy", strategyId: target.strategyId }),
    marketSnapshotHash: market.snapshotHash,
    targetNetDeltaBps: target.targetNetDeltaBps,
    policyHint: target.policyHint,
    generatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5_000).toISOString()
  }));
  const replayInput = {
    covenant,
    approval,
    proposals,
    market,
    portfolio,
    networkFeeSats: scenario.networkFeeSats || researchGuardrails.defaultNetworkFeeSats,
    now
  };
  const candidate = buildStrategyCandidate(replayInput);
  const verification = verifyStrategyCandidate({ ...replayInput, candidate });
  return {
    label: scenario.label,
    status: "replayed" as const,
    action: candidate.action,
    side: candidate.side,
    quantitySats: candidate.quantitySats,
    limitPriceUsd: candidate.limitPriceUsd,
    weightedTargetNetDeltaBps: candidate.weightedTargetNetDeltaBps,
    projectedNetDeltaBps: candidate.projectedNetDeltaBps,
    riskFlags: candidate.riskFlags,
    networkFeeSats: candidate.networkFeeSats,
    expectedResult: candidate.manifest.expectedResult,
    verifierAgreed: verification.verified,
    wouldRequire: candidate.nextAuthority === "wallet_user"
      ? "wallet_approval_of_the_exact_transaction" as const
      : "nothing" as const
  };
}

function rejection(error: unknown, fallback: string) {
  return error instanceof StrategyMandateError
    ? { reasonCode: error.code as string, message: error.message }
    : { reasonCode: fallback, message: "The host could not evaluate these values." };
}

export function runStrategyStressTest(
  input: { covenantDraft: CovenantDraft; scenarios?: StressScenario[] },
  now: Date = new Date()
) {
  const draft = input.covenantDraft;
  const rejected = (reason: { reasonCode: string; message: string }) => ({
    kind: "research_stress_test" as const,
    draftStatus: "rejected" as const,
    ...reason,
    scenarios: [],
    ...NO_EFFECT
  });
  if (draft.risk.maxGrossLeverageBps > researchGuardrails.maxGrossLeverageBps) {
    return rejected({
      reasonCode: "leverage_permission_none",
      message: "Product eligibility is unresolved on this surface, so research drafts may not exceed 1x gross leverage (10000 bps)."
    });
  }
  let covenant: StrategyCovenant;
  try {
    covenant = draftCovenant(draft, now);
  } catch (error) {
    return rejected(rejection(error, "covenant_invalid"));
  }
  // The allocator requires an approval record. This placeholder exists only
  // inside the replay and is never returned or persisted.
  const approval = createStrategyCovenantApproval({
    schema: "bitagent_strategy_covenant_approval_v1",
    covenantHash: covenant.covenantHash,
    walletSessionId: "research-replay",
    status: "approved",
    approvedAt: new Date(now.getTime() - 30_000).toISOString(),
    expiresAt: covenant.expiresAt,
    walletApprovalRef: "opaque:research-replay-not-a-wallet-approval"
  });
  const scenarios = (input.scenarios || []).map((scenario) => {
    try {
      return replayScenario(covenant, approval, scenario, now);
    } catch (error) {
      return { label: scenario.label, status: "rejected" as const, ...rejection(error, "scenario_invalid") };
    }
  });
  const replayed = scenarios.filter(
    (scenario): scenario is ReturnType<typeof replayScenario> => scenario.status === "replayed"
  );
  const actions: Record<string, number> = {};
  for (const scenario of replayed) actions[scenario.action] = (actions[scenario.action] || 0) + 1;
  return {
    kind: "research_stress_test" as const,
    draftStatus: "valid" as const,
    draft,
    scenarios,
    summary: {
      replayed: replayed.length,
      rejected: scenarios.length - replayed.length,
      actions,
      circuitBreakers: [...new Set(replayed.flatMap((scenario) =>
        scenario.riskFlags.filter((flag) => flag.endsWith("_circuit_breaker"))))]
    },
    replayHash: hashObject({ draft, scenarios }),
    ...NO_EFFECT
  };
}
