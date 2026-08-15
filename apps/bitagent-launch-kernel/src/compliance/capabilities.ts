export const GROWTH_AGENT_CAPABILITIES = [
  "CONTACT_READ_SELECTED",
  "CONTACT_RANK_LOCAL",
  "MESSAGE_DRAFT",
  "TRANSLATE",
  "REFERRAL_LINK_REQUEST",
  "REFERRAL_STATUS_AGGREGATE"
] as const;

export const TRADING_AGENT_CAPABILITIES = [
  "MARKET_READ",
  "PORTFOLIO_READ",
  "STRATEGY_PROPOSE",
  "ORDER_PROPOSE",
  "POSITION_MONITOR"
] as const;

export const HARNESS_ONLY_CAPABILITIES = [
  "ORDER_SIGN",
  "ORDER_SUBMIT",
  "REFERRAL_SETTLE",
  "REFERRAL_BIND",
  "POLICY_OVERRIDE"
] as const;

export type ComplianceRole = "GROWTH_AGENT" | "TRADING_AGENT" | "DETERMINISTIC_HARNESS";
export type GovernedCapability =
  | (typeof GROWTH_AGENT_CAPABILITIES)[number]
  | (typeof TRADING_AGENT_CAPABILITIES)[number]
  | (typeof HARNESS_ONLY_CAPABILITIES)[number];

export function assertRoleCapability(role: ComplianceRole, capability: GovernedCapability) {
  const allowed = role === "GROWTH_AGENT"
    ? new Set<string>(GROWTH_AGENT_CAPABILITIES)
    : role === "TRADING_AGENT"
      ? new Set<string>(TRADING_AGENT_CAPABILITIES)
      : new Set<string>(HARNESS_ONLY_CAPABILITIES);
  if (!allowed.has(capability)) throw new Error(`${role} cannot use ${capability}`);
  return true;
}

export function validateOperatorService(input: {
  services: Array<"onboarding" | "local_language_support" | "hosted_inference" | "monitoring" | "education" | "device_setup" | "strategy_configuration">;
  compensation: Array<"referral_credit" | "compute_fee" | "explicit_service_fee">;
  receives_wallet_keys: boolean;
}) {
  if (input.receives_wallet_keys) throw new Error("A service operator must never receive user wallet keys");
  return {
    ...structuredClone(input),
    local_authorization_and_signing_required: true as const,
    status: "REQUIRES_HUMAN_AUTH" as const
  };
}
