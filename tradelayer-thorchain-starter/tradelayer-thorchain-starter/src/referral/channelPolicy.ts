export const MARKETING_CHANNELS = [
  "native_share",
  "whatsapp",
  "sms",
  "email",
  "signal"
] as const;

export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];
export type OutreachPhase = "initial" | "follow_up";
export type OutreachConsentState =
  | "none"
  | "selected_by_user"
  | "opted_in"
  | "not_interested"
  | "do_not_contact";
export type ContactSource =
  | "os_picker"
  | "prior_opt_in_record"
  | "uploaded_list"
  | "message_scrape"
  | "purchased_list"
  | "public_scrape";

type ClosedToolSchema = {
  type: "object";
  additionalProperties: false;
  required: string[];
  properties: Record<string, Record<string, unknown>>;
  authority: "local_host" | "human";
  effect: "none";
};

export const marketingChannelToolSchemas: Record<string, ClosedToolSchema> = {
  "bitagent.marketing.calculate_k_factor": {
    type: "object",
    additionalProperties: false,
    required: ["eligiblePrincipals", "uniqueHumanSentInvitations", "independentQualifiedActivations", "excludedSelfControlledOrDuplicates", "suppressedRecipients"],
    properties: {
      eligiblePrincipals: { type: "integer", minimum: 1, maximum: 1000000000 },
      uniqueHumanSentInvitations: { type: "integer", minimum: 0, maximum: 1000000000 },
      independentQualifiedActivations: { type: "integer", minimum: 0, maximum: 1000000000 },
      excludedSelfControlledOrDuplicates: { type: "integer", minimum: 0, maximum: 1000000000 },
      suppressedRecipients: { type: "integer", minimum: 0, maximum: 1000000000 }
    },
    authority: "local_host",
    effect: "none"
  },
  "bitagent.marketing.plan_channel": {
    type: "object",
    additionalProperties: false,
    required: ["channel", "phase", "consentState", "contactSource", "localHashedId"],
    properties: {
      channel: { type: "string", enum: [...MARKETING_CHANNELS] },
      phase: { type: "string", enum: ["initial", "follow_up"] },
      consentState: {
        type: "string",
        enum: ["none", "selected_by_user", "opted_in", "not_interested", "do_not_contact"]
      },
      contactSource: { type: "string", enum: ["os_picker", "prior_opt_in_record"] },
      localHashedId: { type: "string", pattern: "^[A-Za-z0-9_-]{8,128}$" },
      providerConfigured: { type: "boolean" }
    },
    authority: "local_host",
    effect: "none"
  },
  "bitagent.marketing.prepare_opted_in_follow_up": {
    type: "object",
    additionalProperties: false,
    required: ["channel", "localHashedId", "consentReceiptId", "templateId"],
    properties: {
      channel: { type: "string", enum: ["whatsapp", "sms", "email"] },
      localHashedId: { type: "string", pattern: "^[A-Za-z0-9_-]{8,128}$" },
      consentReceiptId: { type: "string", pattern: "^[A-Za-z0-9:_-]{8,160}$" },
      templateId: { type: "string", pattern: "^[A-Za-z0-9._-]{3,80}$" }
    },
    authority: "human",
    effect: "none"
  },
  "bitagent.marketing.compose_coaching": {
    type: "object",
    additionalProperties: false,
    required: ["topic", "channel", "locale"],
    properties: {
      topic: {
        type: "string",
        enum: ["agent_value", "p2p_derivative_risk", "referral_economics"]
      },
      channel: { type: "string", enum: [...MARKETING_CHANNELS] },
      locale: { type: "string", enum: ["en", "es"] }
    },
    authority: "local_host",
    effect: "none"
  }
};

const API_FOLLOW_UP_CHANNELS = new Set<MarketingChannel>(["whatsapp", "sms", "email"]);
const ALLOWED_CONTACT_SOURCES = new Set<ContactSource>(["os_picker", "prior_opt_in_record"]);

export type OutreachChannelPlan = {
  schema: "bitagent.outreach_channel_plan.v1";
  status: "READY_FOR_DRAFT" | "BLOCKED";
  next_action: "PREPARE_MANUAL_SHARE" | "PREPARE_OPTED_IN_FOLLOW_UP" | "HOLD";
  channel: MarketingChannel;
  phase: OutreachPhase;
  contact_source_allowed: boolean;
  provider_send_allowed: false;
  initial_send_performed: false;
  requires_human_review: true;
  requires_human_send_action: true;
  reason_codes: string[];
};

export function evaluateOutreachChannelPlan(input: {
  channel: MarketingChannel;
  phase: OutreachPhase;
  consentState: OutreachConsentState;
  contactSource: ContactSource;
  localHashedId?: string;
  providerConfigured?: boolean;
}): OutreachChannelPlan {
  const reasonCodes: string[] = [];
  if (!ALLOWED_CONTACT_SOURCES.has(input.contactSource)) reasonCodes.push("CONTACT_SOURCE_NOT_ALLOWED");
  if (!input.localHashedId || !/^[A-Za-z0-9_-]{8,128}$/.test(input.localHashedId)) {
    reasonCodes.push("LOCAL_CONTACT_SELECTION_REQUIRED");
  }
  if (input.consentState === "do_not_contact" || input.consentState === "not_interested") {
    reasonCodes.push("CONTACT_SUPPRESSED");
  } else if (input.consentState === "none") {
    reasonCodes.push("CONSENT_OR_USER_SELECTION_REQUIRED");
  } else if (input.phase === "follow_up" && input.consentState !== "opted_in") {
    reasonCodes.push("FOLLOW_UP_OPT_IN_REQUIRED");
  }

  if (reasonCodes.length) {
    return {
      schema: "bitagent.outreach_channel_plan.v1",
      status: "BLOCKED",
      next_action: "HOLD",
      channel: input.channel,
      phase: input.phase,
      contact_source_allowed: ALLOWED_CONTACT_SOURCES.has(input.contactSource),
      provider_send_allowed: false,
      initial_send_performed: false,
      requires_human_review: true,
      requires_human_send_action: true,
      reason_codes: reasonCodes
    };
  }

  const optedInProviderCandidate = input.phase === "follow_up"
    && input.consentState === "opted_in"
    && Boolean(input.providerConfigured)
    && API_FOLLOW_UP_CHANNELS.has(input.channel);
  return {
    schema: "bitagent.outreach_channel_plan.v1",
    status: "READY_FOR_DRAFT",
    next_action: optedInProviderCandidate
      ? "PREPARE_OPTED_IN_FOLLOW_UP"
      : "PREPARE_MANUAL_SHARE",
    channel: input.channel,
    phase: input.phase,
    contact_source_allowed: true,
    provider_send_allowed: false,
    initial_send_performed: false,
    requires_human_review: true,
    requires_human_send_action: true,
    reason_codes: optedInProviderCandidate
      ? ["OPT_IN_RECEIPT_AND_TEMPLATE_REQUIRED", "CANDIDATE_ONLY_NO_SEND"]
      : ["NATIVE_SHARE_OR_MANUAL_DRAFT_ONLY", "HUMAN_FINAL_SEND_REQUIRED"]
  };
}
