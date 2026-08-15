import type { OnboardingActivity } from "../types.js";
import type { ReferralRegistry } from "./registry.js";
import type { EligibleSettledTrade } from "./types.js";

export interface ReferralActivityPublisher {
  publish(activity: OnboardingActivity): Promise<unknown>;
}

export class ReferralSettlementAdapter {
  constructor(
    private readonly registry: ReferralRegistry,
    private readonly activityPublisher?: ReferralActivityPublisher
  ) {}

  async observeCanonicalSettlement(trade: EligibleSettledTrade) {
    const accrual = await this.registry.settleEligibleTrade(trade);
    await this.activityPublisher?.publish({
      id: `referral:${accrual.trade_id}`,
      phase: "referral_growth",
      status: "success",
      label: "Sponsor credit assigned to the principal vesting account",
      txid: accrual.trade_id,
      meta: {
        bindingId: accrual.binding_id,
        feeAsset: accrual.fee_asset,
        feeValueAtAccrualAtomic: accrual.fee_value_at_accrual_atomic,
        tokenUnitsAssigned: accrual.vesting_token_units,
        vestedTokenUnits: accrual.vested_token_units,
        unvestedTokenUnits: accrual.unvested_token_units,
        currentEstimatedTokenValueAtomic: accrual.current_estimated_token_value_atomic,
        reversed: false
      }
    });
    return accrual;
  }

  async observeRollback(input: {
    tradeId: string;
    reason: "REFUND" | "REVERT" | "FAILURE" | "REORG";
  }) {
    const accrual = await this.registry.reverseCanonicalTrade(input);
    await this.activityPublisher?.publish({
      id: `referral:${accrual.trade_id}`,
      phase: "referral_growth",
      status: "error",
      label: "Sponsor credit reversed with the canonical trade",
      txid: accrual.trade_id,
      meta: { bindingId: accrual.binding_id, reversed: true, reason: input.reason }
    });
    return accrual;
  }
}
