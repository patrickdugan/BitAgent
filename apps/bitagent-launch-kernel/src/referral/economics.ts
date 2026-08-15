import type { FeeAccumulatorState } from "./types.js";

export const FEE_DENOMINATOR_PPM = 1_000_000n;
export const TOTAL_FEE_PPM = 50n;
export const MAKER_REWARD_PPM = 25n;
export const SPONSOR_CREDIT_PPM = 5n;
export const PROTOCOL_REVENUE_PPM = 20n;

function atomic(value: string, field: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${field} must be an unsigned atomic integer string`);
  return BigInt(value);
}

export function emptyFeeAccumulator(feeAsset: string): FeeAccumulatorState {
  return {
    fee_asset: feeAsset,
    cumulative_eligible_notional_atomic: "0",
    cumulative_total_fee_atomic: "0",
    cumulative_maker_reward_atomic: "0",
    cumulative_sponsor_credit_atomic: "0",
    cumulative_protocol_revenue_atomic: "0"
  };
}

function cumulativeParts(notional: bigint) {
  const total = notional * TOTAL_FEE_PPM / FEE_DENOMINATOR_PPM;
  const sponsor = notional * SPONSOR_CREDIT_PPM / FEE_DENOMINATOR_PPM;
  const makerAndProtocol = total - sponsor;
  const maker = makerAndProtocol * MAKER_REWARD_PPM
    / (MAKER_REWARD_PPM + PROTOCOL_REVENUE_PPM);
  const protocol = makerAndProtocol - maker;
  return { total, maker, sponsor, protocol };
}

export function accrueFeeSplit(previous: FeeAccumulatorState, eligibleNotionalAtomic: string) {
  const increment = atomic(eligibleNotionalAtomic, "eligibleNotionalAtomic");
  if (increment <= 0n) throw new Error("eligibleNotionalAtomic must be positive");
  const beforeNotional = atomic(previous.cumulative_eligible_notional_atomic, "cumulative notional");
  const afterNotional = beforeNotional + increment;
  const before = cumulativeParts(beforeNotional);
  const after = cumulativeParts(afterNotional);
  const split = {
    total_fee_atomic: (after.total - before.total).toString(),
    maker_reward_atomic: (after.maker - before.maker).toString(),
    sponsor_credit_atomic: (after.sponsor - before.sponsor).toString(),
    protocol_revenue_atomic: (after.protocol - before.protocol).toString()
  };
  const total = BigInt(split.total_fee_atomic);
  if (total !== BigInt(split.maker_reward_atomic)
    + BigInt(split.sponsor_credit_atomic)
    + BigInt(split.protocol_revenue_atomic)) {
    throw new Error("Fee split invariant failed");
  }
  if (BigInt(split.sponsor_credit_atomic) > total) throw new Error("Sponsor credit exceeds fee collected");
  const next: FeeAccumulatorState = {
    fee_asset: previous.fee_asset,
    cumulative_eligible_notional_atomic: afterNotional.toString(),
    cumulative_total_fee_atomic: after.total.toString(),
    cumulative_maker_reward_atomic: after.maker.toString(),
    cumulative_sponsor_credit_atomic: after.sponsor.toString(),
    cumulative_protocol_revenue_atomic: after.protocol.toString()
  };
  return { split, next };
}

export function sponsorCreditForNotional(eligibleNotionalAtomic: string): string {
  return (atomic(eligibleNotionalAtomic, "eligibleNotionalAtomic")
    * SPONSOR_CREDIT_PPM / FEE_DENOMINATOR_PPM).toString();
}

export function notionalForReferralGoalAtomic(goalFeeAtomic: string): string {
  const goal = atomic(goalFeeAtomic, "goalFeeAtomic");
  if (goal <= 0n) throw new Error("goalFeeAtomic must be positive");
  return ((goal * FEE_DENOMINATOR_PPM + SPONSOR_CREDIT_PPM - 1n) / SPONSOR_CREDIT_PPM).toString();
}

export function referralGoalExamples(goalUsd = 5) {
  if (!Number.isSafeInteger(goalUsd) || ![1, 5, 10].includes(goalUsd)) {
    throw new Error("Referral goal must be $1, $5, or $10");
  }
  const totalNotionalUsd = goalUsd * 200_000;
  return {
    goal_usd: goalUsd,
    total_eligible_notional_usd: totalNotionalUsd,
    examples: [
      { active_referrals: 1, eligible_notional_each_usd: totalNotionalUsd },
      { active_referrals: 10, eligible_notional_each_usd: totalNotionalUsd / 10 },
      { active_referrals: 20, eligible_notional_each_usd: totalNotionalUsd / 20 }
    ],
    disclosure: "You receive 0.05 basis points of eligible trading by people you refer for one year. That equals $0.50 per $100,000 of eligible notional and $5 per $1 million. The credit is assigned as vesting tokens, so its later market value can move."
  };
}
