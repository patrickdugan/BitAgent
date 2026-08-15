import { hashObject, opaqueId, parseDecimal } from "../launch/canonical.js";
import { StrategyMandateError } from "./errors.js";
import type {
  StrategyCandidate,
  StrategyCovenant,
  StrategyCovenantApproval,
  StrategyMarketSnapshot,
  StrategyPortfolioState,
  StrategyProposal,
  StrategyTransactionManifest
} from "./types.js";
import {
  validateMarketSnapshot,
  validatePortfolioState,
  validateStrategyCovenant,
  validateStrategyCovenantApproval,
  validateStrategyProposal
} from "./validator.js";

function unsigned(value: string, label: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new StrategyMandateError("risk_rejected", `${label} must be an unsigned integer string`);
  }
  return BigInt(value);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function signedFloor(numerator: bigint, denominator: bigint) {
  return Number(numerator / denominator);
}

function usdAtomsFromSats(sats: bigint, priceCents: bigint) {
  return sats * priceCents / 100n;
}

function satsFromUsdAtoms(atoms: bigint, priceCents: bigint) {
  return atoms * 100n / priceCents;
}

export function candidateCore(candidate: StrategyCandidate) {
  const { candidateId: _id, candidateHash: _hash, ...core } = candidate;
  return core;
}

function validateInputs(input: {
  covenant: StrategyCovenant;
  approval: StrategyCovenantApproval;
  proposals: StrategyProposal[];
  market: StrategyMarketSnapshot;
  portfolio: StrategyPortfolioState;
  networkFeeSats: string;
  now: Date;
}) {
  const covenant = validateStrategyCovenant(input.covenant, input.now);
  validateStrategyCovenantApproval(input.approval, covenant, input.now);
  const market = validateMarketSnapshot(input.market);
  const portfolio = validatePortfolioState(input.portfolio);
  if (market.oraclePolicy !== covenant.execution.oraclePolicy) {
    throw new StrategyMandateError("market_state_invalid", "Market oracle policy is outside the covenant");
  }
  const marketAge = input.now.getTime() - Date.parse(market.observedAt);
  const portfolioAge = input.now.getTime() - Date.parse(portfolio.observedAt);
  if (marketAge < 0 || marketAge > covenant.execution.maxMarketAgeMs) {
    throw new StrategyMandateError("market_state_invalid", "Market snapshot is stale or future-dated");
  }
  if (portfolioAge < 0 || portfolioAge > covenant.execution.maxMarketAgeMs) {
    throw new StrategyMandateError("portfolio_state_invalid", "Portfolio state is stale or future-dated");
  }
  if (!covenant.channelIds.includes(portfolio.channelId)) {
    throw new StrategyMandateError("portfolio_state_invalid", "Portfolio channel is outside the covenant");
  }
  const bid = parseDecimal(market.bidPriceUsd, 2, "bidPriceUsd");
  const ask = parseDecimal(market.askPriceUsd, 2, "askPriceUsd");
  const mark = parseDecimal(market.markPriceUsd, 2, "markPriceUsd");
  if (bid > mark || mark > ask) throw new StrategyMandateError("market_state_invalid", "Market prices are crossed or inconsistent");
  const fee = unsigned(input.networkFeeSats, "networkFeeSats");
  if (fee > unsigned(covenant.risk.maxNetworkFeeSats, "maxNetworkFeeSats")) {
    throw new StrategyMandateError("risk_rejected", "Network fee exceeds the covenant cap");
  }

  if (input.proposals.length !== covenant.strategies.length) {
    throw new StrategyMandateError("proposal_invalid", "Every covenant strategy must produce exactly one proposal");
  }
  const proposalMap = new Map<string, StrategyProposal>();
  for (const raw of input.proposals) {
    const proposal = validateStrategyProposal(raw);
    const key = `${proposal.strategyId}@${proposal.strategyVersion}`;
    if (proposalMap.has(key)) throw new StrategyMandateError("proposal_invalid", `Duplicate proposal: ${key}`);
    proposalMap.set(key, proposal);
  }
  const proposals = covenant.strategies.map((module) => {
    const key = `${module.strategyId}@${module.strategyVersion}`;
    const proposal = proposalMap.get(key);
    if (!proposal || proposal.adapterHash !== module.adapterHash) {
      throw new StrategyMandateError("proposal_invalid", `Missing or mismatched committed proposal: ${key}`);
    }
    if (proposal.marketSnapshotHash !== market.snapshotHash) {
      throw new StrategyMandateError("proposal_invalid", `Proposal market root is stale: ${key}`);
    }
    if (Date.parse(proposal.generatedAt) > input.now.getTime() || Date.parse(proposal.expiresAt) <= input.now.getTime()) {
      throw new StrategyMandateError("proposal_invalid", `Proposal is stale or future-dated: ${key}`);
    }
    return proposal;
  });
  return { covenant, market, portfolio, proposals, bid, ask, mark, fee };
}

export function buildStrategyCandidate(input: {
  covenant: StrategyCovenant;
  approval: StrategyCovenantApproval;
  proposals: StrategyProposal[];
  market: StrategyMarketSnapshot;
  portfolio: StrategyPortfolioState;
  networkFeeSats: string;
  now: Date;
}): StrategyCandidate {
  const { covenant, market, portfolio, proposals, bid, ask, mark, fee } = validateInputs(input);
  const flags: string[] = [];
  const proposalRoot = hashObject(proposals.map((proposal) => proposal.proposalHash));
  const weightedNumerator = proposals.reduce((sum, proposal, index) =>
    sum + BigInt(proposal.targetNetDeltaBps) * BigInt(covenant.strategies[index]!.weightBps), 0n);
  const weighted = signedFloor(weightedNumerator, 10_000n);
  let target = clamp(weighted, -covenant.risk.maxNetDeltaBps, covenant.risk.maxNetDeltaBps);
  if (target !== weighted) flags.push("target_projected_to_net_delta_limit");

  let forcedToNeutral = false;
  if (portfolio.grossLeverageBps > covenant.risk.maxGrossLeverageBps) {
    flags.push("gross_leverage_circuit_breaker");
    forcedToNeutral = true;
  }
  if (portfolio.dailyLossBps >= covenant.risk.maxDailyLossBps) {
    flags.push("daily_loss_circuit_breaker");
    forcedToNeutral = true;
  }
  if (portfolio.drawdownBps >= covenant.risk.maxDrawdownBps) {
    flags.push("drawdown_circuit_breaker");
    forcedToNeutral = true;
  }
  if (forcedToNeutral) target = 0;

  const observedCapital = unsigned(portfolio.capitalAtoms, "portfolio.capitalAtoms");
  const capitalCap = unsigned(covenant.capital.capAtoms, "covenant.capital.capAtoms");
  const scopedCapital = observedCapital > capitalCap ? capitalCap : observedCapital;
  if (observedCapital > capitalCap) flags.push("capital_scoped_to_covenant_cap");
  const deltaBps = target - portfolio.currentNetDeltaBps;
  let action: StrategyCandidate["action"] = "hold";
  let side: StrategyCandidate["side"];
  let quantitySats = 0n;
  let projectedNetDeltaBps = portfolio.currentNetDeltaBps;
  let limitPriceUsd: string | undefined;

  if (Math.abs(deltaBps) > covenant.allocation.absoluteMaxDriftBps && scopedCapital > 0n) {
    action = forcedToNeutral ? "reduce_position" : "place_limit";
    if (!covenant.execution.permittedActions.includes(action)) {
      throw new StrategyMandateError("risk_rejected", `Required action is not covenant-permitted: ${action}`);
    }
    side = deltaBps > 0 ? "buy_tlbtc" : "sell_tlbtc";
    limitPriceUsd = side === "buy_tlbtc" ? market.bidPriceUsd : market.askPriceUsd;
    const desiredNotional = scopedCapital * BigInt(Math.abs(deltaBps)) / 10_000n;
    const orderCap = scopedCapital * BigInt(covenant.risk.maxOrderFractionNavBps) / 10_000n;
    const orderNotional = desiredNotional > orderCap ? orderCap : desiredNotional;
    if (orderNotional < desiredNotional) flags.push("order_scoped_to_nav_fraction");
    quantitySats = satsFromUsdAtoms(orderNotional, mark);
    if (quantitySats === 0n) {
      action = "hold";
      side = undefined;
      limitPriceUsd = undefined;
      flags.push("order_below_integer_satoshi");
    } else {
      const appliedNotional = usdAtomsFromSats(quantitySats, mark);
      const appliedBps = Number(appliedNotional * 10_000n / scopedCapital);
      projectedNetDeltaBps = portfolio.currentNetDeltaBps + (deltaBps > 0 ? appliedBps : -appliedBps);
      if (deltaBps > 0) projectedNetDeltaBps = Math.min(projectedNetDeltaBps, target);
      else projectedNetDeltaBps = Math.max(projectedNetDeltaBps, target);
    }
  } else if (deltaBps !== 0) {
    flags.push("allocation_within_drift_corridor");
  }

  const expiryMs = Math.min(
    input.now.getTime() + covenant.execution.orderTtlMs,
    Date.parse(covenant.expiresAt),
    ...proposals.map((proposal) => Date.parse(proposal.expiresAt))
  );
  const expiresAt = new Date(expiryMs).toISOString();
  const actionFee = action === "hold" ? 0n : fee;
  const lockedAtoms = side === "buy_tlbtc" ? usdAtomsFromSats(quantitySats, bid) : undefined;
  const manifest: StrategyTransactionManifest = {
    wallet: covenant.owner.walletAccount,
    channelId: portfolio.channelId,
    chain: "bitcoin-testnet4",
    asset: side === "buy_tlbtc" ? "tlUSD" : "tlBTC",
    verifiedContract: "TradeLayer tx5",
    exactAmount: side === "buy_tlbtc" ? (lockedAtoms || 0n).toString() : quantitySats.toString(),
    amountUnit: side === "buy_tlbtc" ? "token_atoms" : "sats",
    recipientOrProtocol: "TradeLayer",
    route: "channel_limit_order",
    networkFeeSats: actionFee.toString(),
    protocolFeeAtoms: "0",
    slippageCeilingBps: covenant.risk.maxSlippageBps,
    expectedResult: action === "hold"
      ? "No transaction; allocation remains inside the covenant corridor."
      : `If fully filled, net delta moves from ${portfolio.currentNetDeltaBps} to ${projectedNetDeltaBps} bps. Fill is not guaranteed.`,
    permission: action === "hold" ? "none" : action,
    expiresAt
  };
  const core = {
    schema: "bitagent_strategy_candidate_v1" as const,
    covenantHash: covenant.covenantHash,
    proposalRoot,
    marketSnapshotHash: market.snapshotHash,
    portfolioStateRoot: portfolio.stateRoot,
    action,
    channelId: portfolio.channelId,
    instrument: "TLBTC/TLUSD" as const,
    side,
    quantitySats: quantitySats.toString(),
    limitPriceUsd,
    networkFeeSats: actionFee.toString(),
    nonce: portfolio.nonce,
    createdAt: input.now.toISOString(),
    expiresAt,
    weightedTargetNetDeltaBps: target,
    projectedNetDeltaBps,
    riskFlags: flags,
    manifest,
    authority: "deterministic_host" as const,
    effect: "none" as const,
    nextAuthority: action === "hold" ? "none" as const : "wallet_user" as const,
    signingPerformed: false as const,
    broadcastPerformed: false as const
  };
  return {
    candidateId: opaqueId("strategy_candidate", core),
    candidateHash: hashObject(core),
    ...core
  };
}
