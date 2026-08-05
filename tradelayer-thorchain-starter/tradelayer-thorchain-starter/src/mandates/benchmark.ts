import { performance } from "node:perf_hooks";
import { hashObject } from "../launch/canonical.js";
import { buildStrategyCandidate } from "./allocator.js";
import type {
  StrategyCandidate,
  StrategyCovenant,
  StrategyCovenantApproval,
  StrategyMarketSnapshot,
  StrategyPortfolioState,
  StrategyProposal
} from "./types.js";
import {
  createMarketSnapshot,
  createPortfolioState,
  createStrategyCovenant,
  createStrategyCovenantApproval,
  createStrategyProposal,
  validateStrategyProposal
} from "./validator.js";
import { verifyStrategyCandidate } from "./verifier.js";

export type StrategyBenchmarkMode = "direct_baseline" | "single_enclave" | "sharded_verification" | "hybrid_fast_path";

export type StrategyBenchmarkScenario = {
  covenant: StrategyCovenant;
  approval: StrategyCovenantApproval;
  proposals: StrategyProposal[];
  market: StrategyMarketSnapshot;
  portfolio: StrategyPortfolioState;
  networkFeeSats: string;
  now: Date;
};

type TimingRow = {
  proposalValidationMs: number;
  allocationMs: number;
  verificationMs: number;
  asynchronousAuditMs: number;
  totalMs: number;
};

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] || 0;
}

function summarize(rows: TimingRow[]) {
  const keys = Object.keys(rows[0]!) as Array<keyof TimingRow>;
  return Object.fromEntries(keys.map((key) => [key, {
    p50: percentile(rows.map((row) => row[key]), 0.5),
    p95: percentile(rows.map((row) => row[key]), 0.95),
    p99: percentile(rows.map((row) => row[key]), 0.99)
  }]));
}

export function createStrategyBenchmarkScenario(now = new Date("2026-08-05T12:00:00.000Z")): StrategyBenchmarkScenario {
  const adapterHashes = ["passive-maker", "funding-capture", "delta-hedge", "reserve"]
    .map((strategy) => hashObject({ kind: "scripted-benchmark-adapter", strategy }));
  const covenant = createStrategyCovenant({
    schema: "bitagent_strategy_covenant_v1",
    mandateId: "btc-hedge-maker-v1",
    version: 1,
    owner: { walletAccount: "tb1qbenchmarkowner0000000000000000000000000", walletProvider: "bitcoin_wallet" },
    capital: { asset: "tlUSD", capAtoms: "100000000000" },
    channelIds: ["tl-channel-42"],
    strategies: [
      { strategyId: "btc_usd_passive_maker", strategyVersion: "1", weightBps: 5_000, adapterHash: adapterHashes[0]! },
      { strategyId: "funding_capture", strategyVersion: "1", weightBps: 2_500, adapterHash: adapterHashes[1]! },
      { strategyId: "delta_hedge", strategyVersion: "1", weightBps: 1_500, adapterHash: adapterHashes[2]! },
      { strategyId: "reserve", strategyVersion: "1", weightBps: 1_000, adapterHash: adapterHashes[3]! }
    ],
    allocation: { absoluteMaxDriftBps: 50 },
    risk: {
      maxGrossLeverageBps: 12_000,
      maxNetDeltaBps: 1_000,
      maxOrderFractionNavBps: 200,
      maxDailyLossBps: 150,
      maxDrawdownBps: 500,
      maxSlippageBps: 12,
      maxNetworkFeeSats: "5000"
    },
    execution: {
      instruments: ["TLBTC/TLUSD"],
      permittedActions: ["place_limit", "cancel", "reduce_position", "rebalance"],
      orderTtlMs: 3_000,
      maxMarketAgeMs: 2_000,
      oraclePolicy: "tl-oracle-set-v2",
      counterpartyPolicy: "verified-channel-peers"
    },
    runtime: {
      baseModelHash: hashObject({ model: "bonsai-8b-benchmark-placeholder" }),
      allocatorHash: hashObject({ module: "bitagent-deterministic-allocator-v1" }),
      verifierHash: hashObject({ module: "bitagent-deterministic-verifier-v1" })
    },
    effectiveAt: new Date(now.getTime() - 60_000).toISOString(),
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString()
  });
  const approval = createStrategyCovenantApproval({
    schema: "bitagent_strategy_covenant_approval_v1",
    covenantHash: covenant.covenantHash,
    walletSessionId: "benchmark-wallet-session",
    status: "approved",
    approvedAt: new Date(now.getTime() - 30_000).toISOString(),
    expiresAt: covenant.expiresAt,
    walletApprovalRef: "opaque:benchmark-wallet-approval"
  });
  const market = createMarketSnapshot({
    schema: "bitagent_strategy_market_snapshot_v1",
    pair: "TLBTC/TLUSD",
    bidPriceUsd: "64990.00",
    askPriceUsd: "65010.00",
    markPriceUsd: "65000.00",
    oraclePolicy: covenant.execution.oraclePolicy,
    observedAt: now.toISOString(),
    source: "scripted-covenant-benchmark"
  });
  const targets = [1_000, 400, -800, 0];
  const hints = ["QUOTE_BOTH_SIDES", "SHIFT_BID", "REDUCE_DELTA", "HOLD"] as const;
  const proposals = covenant.strategies.map((strategy, index) => createStrategyProposal({
    schema: "bitagent_strategy_proposal_v1",
    strategyId: strategy.strategyId,
    strategyVersion: strategy.strategyVersion,
    adapterHash: strategy.adapterHash,
    marketSnapshotHash: market.snapshotHash,
    targetNetDeltaBps: targets[index]!,
    policyHint: hints[index]!,
    generatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5_000).toISOString()
  }));
  const portfolio = createPortfolioState({
    schema: "bitagent_strategy_portfolio_v1",
    channelId: "tl-channel-42",
    capitalAtoms: "100000000000",
    currentNetDeltaBps: -200,
    grossLeverageBps: 8_000,
    dailyLossBps: 0,
    drawdownBps: 0,
    nonce: 2841,
    observedAt: now.toISOString()
  });
  return { covenant, approval, proposals, market, portfolio, networkFeeSats: "900", now };
}

function executeBenchmarkIteration(mode: StrategyBenchmarkMode, scenario: StrategyBenchmarkScenario) {
  const started = performance.now();
  for (const proposal of scenario.proposals) validateStrategyProposal(proposal);
  const proposalsDone = performance.now();
  const candidate = buildStrategyCandidate(scenario);
  const allocationDone = performance.now();
  let verificationDone = allocationDone;
  let auditDone = allocationDone;
  let verified = false;
  if (mode !== "direct_baseline") {
    const passes = mode === "sharded_verification" ? 3 : 1;
    verified = true;
    for (let index = 0; index < passes; index += 1) {
      verified = verifyStrategyCandidate({ ...scenario, candidate }).verified && verified;
    }
    verificationDone = performance.now();
    auditDone = verificationDone;
    if (mode === "hybrid_fast_path") {
      verified = verifyStrategyCandidate({ ...scenario, candidate }).verified && verified;
      auditDone = performance.now();
    }
  }
  const row: TimingRow = {
    proposalValidationMs: proposalsDone - started,
    allocationMs: allocationDone - proposalsDone,
    verificationMs: verificationDone - allocationDone,
    asynchronousAuditMs: auditDone - verificationDone,
    totalMs: auditDone - started
  };
  return { candidate, verified, row };
}

export function runStrategyCovenantBenchmark(input: {
  scenario?: StrategyBenchmarkScenario;
  iterations?: number;
  modes?: StrategyBenchmarkMode[];
}) {
  const scenario = input.scenario || createStrategyBenchmarkScenario();
  const iterations = input.iterations ?? 250;
  if (!Number.isSafeInteger(iterations) || iterations < 10 || iterations > 10_000) {
    throw new Error("Benchmark iterations must be an integer from 10 through 10000");
  }
  const modes = input.modes || ["direct_baseline", "single_enclave", "sharded_verification", "hybrid_fast_path"];
  const results = modes.map((mode) => {
    const warmupIterations = Math.min(50, iterations);
    for (let index = 0; index < warmupIterations; index += 1) executeBenchmarkIteration(mode, scenario);
    const rows: TimingRow[] = [];
    let candidate: StrategyCandidate | undefined;
    let everyVerificationPassed = mode !== "direct_baseline";
    for (let index = 0; index < iterations; index += 1) {
      const result = executeBenchmarkIteration(mode, scenario);
      rows.push(result.row);
      candidate = result.candidate;
      everyVerificationPassed = result.verified && everyVerificationPassed;
    }
    return {
      mode,
      iterations,
      warmupIterations,
      verificationStatus: mode === "direct_baseline" ? "not_run" as const : everyVerificationPassed ? "passed" as const : "failed" as const,
      everyVerificationPassed,
      candidateSafetyEligible: mode !== "direct_baseline" && everyVerificationPassed,
      independentVerifierImplementations: 1,
      candidateHash: candidate!.candidateHash,
      timingsMs: summarize(rows),
      limitations: mode === "direct_baseline"
        ? ["Lower-bound benchmark only: skips independent policy verification and is never execution-eligible."]
        : mode === "sharded_verification"
          ? ["Three verifier passes use one implementation; this measures repeated-work latency, not compromise independence."]
          : mode === "hybrid_fast_path"
            ? ["The asynchronous audit is executed locally after verification; queue, network, signer, and counterparty latency are excluded."]
            : ["TEE transition, signer, counterparty, and chain latency are excluded."]
    };
  });
  return {
    schema: "bitagent_strategy_covenant_benchmark_v1",
    generatedAt: new Date().toISOString(),
    scenarioHash: hashObject({
      covenantHash: scenario.covenant.covenantHash,
      marketSnapshotHash: scenario.market.snapshotHash,
      portfolioStateRoot: scenario.portfolio.stateRoot,
      proposalHashes: scenario.proposals.map((proposal) => proposal.proposalHash)
    }),
    taskResult: results.filter((result) => result.mode !== "direct_baseline")
      .every((result) => result.everyVerificationPassed),
    measurementReliability: "local_process_only",
    claimSupport: "latency_directional_not_production",
    operationalDecision: "continue_candidate_only_shadow_testing",
    unmeasuredStages: ["T6 channel signature", "T7 counterparty cosign", "T8 TradeLayer state update"],
    results
  };
}
