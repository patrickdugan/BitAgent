export const REFERRAL_POLICY_VERSION = "referral-v1";

export const SETTLEMENT_NETWORK_TARGET_BLOCK_SECONDS = 10 * 60;
export const SECONDS_PER_REFERRAL_YEAR = 365 * 24 * 60 * 60;
export const REFERRAL_TERM_BLOCKS = Math.floor(
  SECONDS_PER_REFERRAL_YEAR / SETTLEMENT_NETWORK_TARGET_BLOCK_SECONDS
);

export const CANONICAL_REFERRAL_PATH = "/invite";
export const CANONICAL_REFERRAL_FIELDS = ["invitation", "policy", "sig"] as const;
export const DEFAULT_REFERRAL_GOAL_USD = 5;
