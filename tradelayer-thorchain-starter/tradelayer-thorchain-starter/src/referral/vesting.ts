import { createHash } from "node:crypto";
import type { VestingAssignment } from "./types.js";

export type VestingAssignmentInput = {
  bindingId: string;
  tradeId: string;
  beneficiaryPrincipalId: string;
  feeAsset: string;
  feeValueAtAccrualAtomic: string;
  now: Date;
};

export interface PrincipalVestingSink {
  prepareAssignment(input: VestingAssignmentInput): Promise<VestingAssignment>;
}

function unsigned(value: string, field: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${field} must be an unsigned integer string`);
  return BigInt(value);
}

export class DeterministicPrincipalVestingSink implements PrincipalVestingSink {
  constructor(private readonly rate: {
    tokenUnitsNumerator?: bigint;
    tokenUnitsDenominator?: bigint;
    estimatedFeeValueNumerator?: bigint;
    estimatedFeeValueDenominator?: bigint;
  } = {}) {}

  async prepareAssignment(input: VestingAssignmentInput): Promise<VestingAssignment> {
    const feeValue = unsigned(input.feeValueAtAccrualAtomic, "feeValueAtAccrualAtomic");
    const tokenNumerator = this.rate.tokenUnitsNumerator ?? 1n;
    const tokenDenominator = this.rate.tokenUnitsDenominator ?? 1n;
    const valueNumerator = this.rate.estimatedFeeValueNumerator ?? 1n;
    const valueDenominator = this.rate.estimatedFeeValueDenominator ?? 1n;
    if (tokenNumerator < 0n || tokenDenominator <= 0n || valueNumerator < 0n || valueDenominator <= 0n) {
      throw new Error("Vesting conversion ratios must be non-negative with positive denominators");
    }
    const tokenUnits = feeValue * tokenNumerator / tokenDenominator;
    const estimated = tokenUnits * valueNumerator / valueDenominator;
    const assignmentId = createHash("sha256")
      .update(`referral-vesting\n${input.bindingId}\n${input.tradeId}`)
      .digest("hex");
    return {
      assignment_id: assignmentId,
      binding_id: input.bindingId,
      trade_id: input.tradeId,
      beneficiary_principal_id: input.beneficiaryPrincipalId,
      fee_asset: input.feeAsset,
      fee_value_at_accrual_atomic: feeValue.toString(),
      token_units_assigned: tokenUnits.toString(),
      vested_token_units: "0",
      unvested_token_units: tokenUnits.toString(),
      current_estimated_token_value_atomic: estimated.toString(),
      principal_controlled: true,
      agent_spend_authority: false,
      status: "ASSIGNED",
      assigned_at: input.now.toISOString()
    };
  }
}

export function buildTradeLayerVestingCreditCandidate(input: {
  assignment: VestingAssignment;
  principalWalletAddress: string;
  vestingTokenPropertyId: number;
  blockHeight: number;
}) {
  if (!input.assignment.principal_controlled || input.assignment.agent_spend_authority) {
    throw new Error("Only principal-controlled referral assignments may enter the vesting path");
  }
  if (!Number.isSafeInteger(input.vestingTokenPropertyId) || input.vestingTokenPropertyId < 1) {
    throw new Error("TradeLayer vesting property ID must be a positive integer");
  }
  if (!Number.isSafeInteger(input.blockHeight) || input.blockHeight < 0) throw new Error("Block height is invalid");
  return {
    schema: "bitagent_tradelayer_vesting_credit_candidate_v1" as const,
    source_contract: "tradelayer.js/src/tally.js#TallyMap.updateBalance",
    liquidity_reward_precedent: "tradelayer.js/src/logic.js+orderbook.js -> property 3 reward credit",
    principal_wallet_address: input.principalWalletAddress,
    token_property_id: input.vestingTokenPropertyId,
    token_units_atomic: input.assignment.token_units_assigned,
    credit_bucket: "vesting" as const,
    event_type: "referralSponsorCredit",
    block_height: input.blockHeight,
    trade_id: input.assignment.trade_id,
    authority: "deterministic_host_candidate" as const,
    effect: "none" as const,
    execution_blocker: "Sibling TallyMap currently crosses JavaScript number boundaries; an integer-safe host adapter is required."
  };
}
