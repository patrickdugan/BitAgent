import type { ComplianceDecision } from "./types.js";
import type { ReferralLinkService } from "../referral/links.js";

export const REFERRAL_DISCLOSURE = "It is a paid referral link. The referrer receives 0.05 basis points of eligible trading activity for one year. That equals $0.50 per $100,000 of eligible notional and $5 per $1 million. The reward is based on trading activity, not simply on signing up.";
export const TOKEN_VALUE_DISCLOSURE = "The credit is assigned as vesting tokens. Their future market value can rise or fall.";

const PROHIBITED_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "SIGNUP_REWARD_CLAIM", pattern: /\$\s*5\s+per\s+(?:sign\s*up|signup|referral)/i },
  { code: "GUARANTEED_RETURNS", pattern: /guaranteed?\s+(?:returns?|profits?|income|\$)/i },
  { code: "RISK_FREE_TRADING", pattern: /risk[- ]?free\s+(?:trading|income|returns?)/i },
  { code: "EASY_MONEY", pattern: /\beasy money\b|\bfree money\b/i },
  { code: "CANNOT_LOSE", pattern: /\b(?:you|users?)\s+can(?:not|'t)\s+lose\b/i },
  { code: "EVERYONE_IS_MAKING_MONEY", pattern: /\beveryone\s+is\s+making\s+money\b/i },
  { code: "PASSIVE_INCOME_GUARANTEE", pattern: /guaranteed?\s+passive\s+income/i },
  { code: "MULTI_LEVEL_COMMISSION", pattern: /multi[- ]level|downline|recursive\s+referral|rank\s+multiplier/i }
];

const EVIDENCE_REQUIRED_PATTERNS: Array<{ claim: string; pattern: RegExp }> = [
  { claim: "lower_fees", pattern: /\blower fees?\b/i },
  { claim: "better_execution", pattern: /\bbetter execution\b/i },
  { claim: "higher_returns", pattern: /\bhigher returns?\b/i },
  { claim: "safer_trading", pattern: /\bsafer trading\b/i },
  { claim: "faster_execution", pattern: /\bfaster execution\b/i },
  { claim: "better_yield", pattern: /\bbetter yield\b/i }
];

export function normalizePromotionText(value: string) {
  return String(value)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function detectFinancialVulnerability(value: string) {
  const text = normalizePromotionText(value);
  return /\b(?:rent money|turn \$?\d+(?:\.\d+)? into food|make money tonight|cannot afford to lose this|can't afford to lose this)\b/i.test(text);
}

export function vulnerabilitySessionState(messages: string[]) {
  const financialVulnerabilitySignal = messages.some(detectFinancialVulnerability);
  return {
    financial_vulnerability_signal: financialVulnerabilitySignal,
    high_risk_product_promotion: financialVulnerabilitySignal ? "BLOCKED" as const : "POLICY_GATED" as const,
    referral_pressure: financialVulnerabilitySignal ? "DISABLED" as const : "POLICY_GATED" as const,
    view_only_available: true as const,
    persistence: "SESSION_ONLY" as const
  };
}

export function assertReferralDisclosure(value: string, tokenDenominatedReward = false) {
  const text = normalizePromotionText(value);
  const required = [
    /0\.05 basis points/i,
    /for one year/i,
    /\$0\.50 per \$100,000/i,
    /\$5 per \$1 million/i,
    /trading activity, not simply on signing up/i
  ];
  if (required.some((pattern) => !pattern.test(text))) {
    throw new Error("Referral promotion omitted or changed the required economic disclosure");
  }
  if (tokenDenominatedReward && !/vesting tokens[\s\S]*value can rise or fall/i.test(text)) {
    throw new Error("Token-denominated referral promotion omitted the variable-value disclosure");
  }
  return true;
}

export function validateFinancialPromotion(input: {
  text: string;
  decision?: ComplianceDecision;
  referral?: boolean;
  token_denominated_reward?: boolean;
  evidence_supported_claims?: string[];
}) {
  const text = normalizePromotionText(input.text);
  const prohibited = PROHIBITED_PATTERNS.find(({ pattern }) => pattern.test(text));
  if (prohibited) throw new Error(`Financial promotion contains prohibited claim: ${prohibited.code}`);

  const supported = new Set(input.evidence_supported_claims || []);
  const unsupported = EVIDENCE_REQUIRED_PATTERNS.find(({ claim, pattern }) => pattern.test(text) && !supported.has(claim));
  if (unsupported) throw new Error(`Financial promotion claim requires evidence: ${unsupported.claim}`);

  if (input.decision) {
    if (!["ALLOW", "ALLOW_WITH_DISCLOSURE", "REQUIRE_HUMAN_AUTH"].includes(input.decision.status)) {
      throw new Error("Financial promotion is not permitted by the current compliance decision");
    }
    if (/\bperp(?:etual)?s?\b|perpetual swap/i.test(text)
      && !input.decision.allowed_products.includes("PERPETUAL")) {
      throw new Error("Perpetual product claims are unavailable in this jurisdiction");
    }
    if (input.decision.financial_vulnerability_signal && /leverage|perp(?:etual)?/i.test(text)) {
      throw new Error("Leveraged-product promotion is blocked for this vulnerable session");
    }
  }
  if (input.referral) assertReferralDisclosure(text, Boolean(input.token_denominated_reward));
  return text;
}

export function defaultInitialOutreach(name: string) {
  const safeName = normalizePromotionText(name).replace(/\n/g, " ").slice(0, 120) || "there";
  return `Hey ${safeName}, I've been using BitAgent and thought you might find it interesting.\nIt is a self-custodial trading agent that can work from a phone.\n\nI get a small referral credit if someone I refer uses it, so I wanted to disclose that up front.\n\nWant me to send you the details?`;
}

export function defaultReferralLinkMessage(input: {
  canonical_link: string;
  link_service: ReferralLinkService;
  token_denominated_reward?: boolean;
}) {
  const link = input.link_service.verify(normalizePromotionText(input.canonical_link)).canonicalUrl;
  const token = input.token_denominated_reward ? `\n\n${TOKEN_VALUE_DISCLOSURE}` : "";
  const text = `Here's the BitAgent link: ${link}\n\n${REFERRAL_DISCLOSURE}\n\nThe app shows the applicable fees and product restrictions before you authorize anything.${token}`;
  validateFinancialPromotion({
    text,
    referral: true,
    token_denominated_reward: input.token_denominated_reward
  });
  return text;
}
