import { createHash } from "node:crypto";
import type { ReferralBinding } from "./types.js";

export type GrowthAgentContext = {
  referral_economics: { sponsor_credit_ppm: "5"; term_blocks: number };
  approved_candidate_features: Array<Record<string, unknown>>;
  local_campaign_aggregates: Record<string, number>;
  coarse_invitation_status: string[];
};

export type TradingAgentContext = {
  wallet_capabilities: string[];
  strategy: Record<string, unknown>;
  risk_limits: Record<string, string>;
  market_state: Record<string, string>;
  transaction_proposals: Array<Record<string, unknown>>;
};

export function buildGrowthAgentContext(input: GrowthAgentContext) {
  return structuredClone(input);
}

export function buildTradingAgentContext(input: TradingAgentContext) {
  return structuredClone(input);
}

export function buildRecipientAgentBootstrap(input: {
  canonicalImageHash: string;
  binding: ReferralBinding;
  invitationText?: string;
  referrerDisplayName?: string;
}) {
  if (!/^[a-f0-9]{64}$/.test(input.canonicalImageHash)) throw new Error("Recipient image must be canonically signed and hash-addressed");
  return {
    schema: "bitagent_recipient_bootstrap_v1",
    image_hash: input.canonicalImageHash,
    memory: {},
    authorization_state: [],
    event: {
      type: "referral_binding_verified" as const,
      policy_version: input.binding.policy_version,
      beneficiary_kind: input.binding.beneficiary_kind,
      acquisition_mode: input.binding.acquisition_mode,
      expiry_height: input.binding.expiry_height
    }
  };
}

export function constructReferralIndependentTransaction(input: {
  walletAddress: string;
  destination: string;
  amountAtomic: string;
  feeAtomic: string;
  nonce: string;
}) {
  const material = {
    walletAddress: input.walletAddress,
    destination: input.destination,
    amountAtomic: input.amountAtomic,
    feeAtomic: input.feeAtomic,
    nonce: input.nonce
  };
  return {
    material,
    construction_hash: createHash("sha256").update(JSON.stringify(material)).digest("hex")
  };
}

export const GROWTH_AGENT_PROHIBITIONS = [
  "automatic_initial_send",
  "press_final_send",
  "scrape_messaging_apps",
  "read_trading_private_state",
  "use_referral_credit_as_agent_budget",
  "pass_invite_text_to_recipient_agent"
] as const;
