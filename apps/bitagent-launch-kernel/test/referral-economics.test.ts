import assert from "node:assert/strict";
import test from "node:test";
import {
  accrueFeeSplit,
  emptyFeeAccumulator,
  MAKER_REWARD_PPM,
  PROTOCOL_REVENUE_PPM,
  referralGoalExamples,
  SPONSOR_CREDIT_PPM,
  sponsorCreditForNotional,
  TOTAL_FEE_PPM
} from "../src/referral/economics.js";

test("one million USDC of eligible notional produces exactly $50/$25/$5/$20", () => {
  const { split } = accrueFeeSplit(emptyFeeAccumulator("USDC_MICRO"), "1000000000000");
  assert.deepEqual(split, {
    total_fee_atomic: "50000000",
    maker_reward_atomic: "25000000",
    sponsor_credit_atomic: "5000000",
    protocol_revenue_atomic: "20000000"
  });
});

test("one hundred thousand USDC produces exactly $0.50 sponsor value before smaller-unit rounding", () => {
  assert.equal(sponsorCreditForNotional("100000000000"), "500000");
});

test("fee constants are integer ppm and sum exactly", () => {
  assert.equal(TOTAL_FEE_PPM, MAKER_REWARD_PPM + SPONSOR_CREDIT_PPM + PROTOCOL_REVENUE_PPM);
  for (const value of [TOTAL_FEE_PPM, MAKER_REWARD_PPM, SPONSOR_CREDIT_PPM, PROTOCOL_REVENUE_PPM]) {
    assert.equal(typeof value, "bigint");
  }
});

test("deterministic cumulative rounding carries sub-atomic remainders without violating fee equality", () => {
  const sequence = [1, 19_999, 20_000, 159_999, 1, 800_001, 17, 999_983].map(String);
  const run = () => {
    let state = emptyFeeAccumulator("ATOMIC");
    const rows = [];
    for (const notional of sequence) {
      const next = accrueFeeSplit(state, notional);
      const split = next.split;
      assert.equal(
        BigInt(split.total_fee_atomic),
        BigInt(split.maker_reward_atomic) + BigInt(split.sponsor_credit_atomic) + BigInt(split.protocol_revenue_atomic)
      );
      assert.ok(BigInt(split.sponsor_credit_atomic) <= BigInt(split.total_fee_atomic));
      rows.push(split);
      state = next.next;
    }
    return { state, rows };
  };
  const first = run();
  const second = run();
  assert.deepEqual(second, first);
  assert.equal(first.state.cumulative_sponsor_credit_atomic, sponsorCreditForNotional("2000000"));
});

test("property sweep preserves non-negative exact fee splits", () => {
  let state = emptyFeeAccumulator("PROPERTY");
  let seed = 0x12345678;
  for (let index = 0; index < 2_000; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const notional = BigInt((seed % 2_000_000) + 1).toString();
    const result = accrueFeeSplit(state, notional);
    const values = Object.values(result.split).map(BigInt);
    assert.ok(values.every((value) => value >= 0n));
    assert.equal(values[0], values[1] + values[2] + values[3]);
    state = result.next;
  }
});

test("goal calculator calls $5 a goal, not a per-referral bounty", () => {
  const five = referralGoalExamples(5);
  assert.equal(five.total_eligible_notional_usd, 1_000_000);
  assert.deepEqual(five.examples, [
    { active_referrals: 1, eligible_notional_each_usd: 1_000_000 },
    { active_referrals: 10, eligible_notional_each_usd: 100_000 },
    { active_referrals: 20, eligible_notional_each_usd: 50_000 }
  ]);
  assert.doesNotMatch(JSON.stringify(five), /\$5 per referral/i);
});
