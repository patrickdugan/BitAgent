import type { LocalContactCandidate, NativeShareAction } from "./types.js";
import type { ReferralLinkService } from "./links.js";
import {
  normalizePromotionText,
  TOKEN_VALUE_DISCLOSURE,
  validateFinancialPromotion
} from "../compliance/marketing.js";

export const DEFAULT_INITIAL_MESSAGE = "Hey [name], I've been using BitAgent and thought you might find it interesting because [user-approved reason]. It's a self-custodial trading agent that can work from a phone. I get a small referral credit if someone I refer uses it, so I wanted to disclose that up front. Want me to send you the details?";

export const LINK_DISCLOSURE_EN = `The referrer receives 0.05 basis points of eligible trading activity for the referral term. That equals $0.50 per $100,000 of eligible notional and $5 per $1 million. The reward is based on trading activity, not simply on signing up. ${TOKEN_VALUE_DISCLOSURE}`;
export const LINK_DISCLOSURE_ES = "La persona que refiere recibe 0.05 puntos basicos de la actividad de trading elegible durante el plazo del referido. Eso equivale a $0.50 por cada $100,000 de nocional elegible y $5 por cada $1 millon. La recompensa depende de la actividad de trading, no simplemente del registro. El credito se asigna como tokens con vesting. Su valor futuro puede subir o bajar.";

export function normalizeOutboundText(value: string) {
  return normalizePromotionText(value);
}

function localName(value: string) {
  return normalizeOutboundText(value).replace(/\n/g, " ").slice(0, 120) || "there";
}

export function buildHostedDraftPacket(candidates: LocalContactCandidate[]) {
  return candidates.map((candidate, index) => ({
    pseudonym: `Contact ${String.fromCharCode(65 + index)}`,
    approved_features: candidate.user_labels.filter((label) => label !== "never_invite"),
    approved_reason: candidate.explanation,
    instruction: "Draft one honest, non-financial-advice invitation without adding a name or URL."
  }));
}

export function draftInitialMessage(input: {
  displayNameLocalOnly: string;
  userApprovedReason: string;
  agentDrafted: boolean;
}) {
  const message = DEFAULT_INITIAL_MESSAGE
    .replace("[name]", localName(input.displayNameLocalOnly))
    .replace("[user-approved reason]", normalizeOutboundText(input.userApprovedReason).replace(/\n/g, " "));
  return `${normalizeOutboundText(message)}${input.agentDrafted ? "\n\nDrafted with BitAgent" : ""}`;
}

export function draftLinkMessage(input: {
  canonicalLink: string;
  linkService: ReferralLinkService;
  locale?: "en" | "es";
  agentDrafted?: boolean;
}) {
  const verified = input.linkService.verify(normalizeOutboundText(input.canonicalLink));
  const prefix = input.locale === "es" ? "Aqui tienes el enlace de BitAgent:" : "Here’s the BitAgent link:";
  const disclosure = input.locale === "es" ? LINK_DISCLOSURE_ES : LINK_DISCLOSURE_EN;
  const text = `${prefix} ${verified.canonicalUrl}\n\n${disclosure}${input.agentDrafted ? "\n\nDrafted with BitAgent" : ""}`;
  validateReferralMessage(text);
  return normalizeOutboundText(text);
}

export function validateReferralMessage(value: string) {
  const text = normalizeOutboundText(value);
  const prohibited = [
    /\$\s*5\s+per\s+referral/i,
    /\$\s*5\s+per\s+sign\s*up/i,
    /fixed\s+(?:signup|sign-up)\s+bounty/i,
    /guarantee(?:d|s)?\s+(?:income|return|profit)/i,
    /risk[- ]?free|easy money|free money|you can(?:not|'t) lose|everyone is making money/i,
    /buy\s+(?:bitcoin|btc|ethereum|eth|usdc)\b/i,
    /risk\s+(?:rent|food|essential|bill)\s+money/i
  ];
  if (prohibited.some((pattern) => pattern.test(text))) throw new Error("Referral message contains a prohibited claim");
  validateFinancialPromotion({ text });
  return text;
}

export function assertEconomicDisclosure(value: string, locale: "en" | "es" = "en") {
  const text = normalizeOutboundText(value);
  const basisPoints = locale === "es" ? /0\.05 puntos basicos/i : /0\.05 basis points/i;
  const term = locale === "es" ? /durante el plazo del referido/i : /for the referral term/i;
  const million = locale === "es" ? /\$5 por cada \$1 millon/i : /\$5 per \$1 million/i;
  const activity = locale === "es" ? /actividad de trading, no simplemente del registro/i : /trading activity, not simply on signing up/i;
  const tokenRisk = locale === "es" ? /valor futuro puede subir o bajar/i : /future market value can rise or fall/i;
  if (!basisPoints.test(text) || !term.test(text) || !/\$0\.50/.test(text) || !/\$100,000/.test(text)
    || !million.test(text) || !activity.test(text) || !tokenRisk.test(text)) {
    throw new Error("Translated message changed or omitted the economic disclosure");
  }
  return true;
}

export function prepareNativeShareAction(input: {
  text: string;
  title?: string;
  linkService?: ReferralLinkService;
}): NativeShareAction {
  const text = validateReferralMessage(input.text);
  const urls = text.match(/https?:\/\/[^\s]+/g) || [];
  if (urls.length > 1) throw new Error("Referral outreach may contain at most one URL");
  let url: string | undefined;
  if (urls.length === 1) {
    if (!input.linkService) throw new Error("Referral link verifier is required");
    url = input.linkService.verify(urls[0]!).canonicalUrl;
  }
  return {
    schema: "bitagent_native_share_action_v1",
    title: normalizeOutboundText(input.title || "BitAgent referral"),
    text,
    url,
    effect: "none",
    requires_human_os_action: true,
    initial_send_performed: false,
    allowed_channels: ["sms", "email", "whatsapp", "signal", "other"]
  };
}

export function nextCampaignState(input: {
  current: LocalContactCandidate["campaign_state"];
  action: "draft" | "prepare_share" | "record_human_sent" | "approve_follow_up" | "record_follow_up_sent" | "not_interested" | "do_not_contact";
}) {
  if (["not_interested", "do_not_contact"].includes(input.current)) {
    throw new Error("Suppressed contacts cannot receive future suggestions");
  }
  const transitions: Record<typeof input.action, Array<LocalContactCandidate["campaign_state"]>> = {
    draft: ["candidate"],
    prepare_share: ["drafted"],
    record_human_sent: ["share_prepared"],
    approve_follow_up: ["human_sent"],
    record_follow_up_sent: ["follow_up_approved"],
    not_interested: ["candidate", "drafted", "share_prepared", "human_sent", "follow_up_approved"],
    do_not_contact: ["candidate", "drafted", "share_prepared", "human_sent", "follow_up_approved"]
  };
  if (!transitions[input.action].includes(input.current)) throw new Error("Campaign action is not allowed in the current state");
  const target: Record<typeof input.action, LocalContactCandidate["campaign_state"]> = {
    draft: "drafted",
    prepare_share: "share_prepared",
    record_human_sent: "human_sent",
    approve_follow_up: "follow_up_approved",
    record_follow_up_sent: "follow_up_sent",
    not_interested: "not_interested",
    do_not_contact: "do_not_contact"
  };
  return target[input.action];
}
