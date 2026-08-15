import {
  MARKETING_CHANNELS,
  evaluateOutreachChannelPlan,
  marketingChannelToolSchemas,
  type ContactSource,
  type MarketingChannel,
  type OutreachConsentState,
  type OutreachPhase
} from "./channelPolicy.js";
import { calculateConsentSafeKFactor } from "./kFactor.js";

export class MarketingToolError extends Error {
  constructor(readonly code: "unknown_tool" | "invalid_arguments", message: string) {
    super(message);
    this.name = "MarketingToolError";
  }
}

function requireClosedArguments(name: string, args: Record<string, unknown>) {
  const schema = marketingChannelToolSchemas[name];
  if (!schema) throw new MarketingToolError("unknown_tool", `Unknown marketing tool: ${name}`);
  const allowed = new Set(Object.keys(schema.properties));
  const unexpected = Object.keys(args).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw new MarketingToolError("invalid_arguments", `Unexpected arguments: ${unexpected.join(", ")}`);
  }
  const missing = schema.required.filter((key) => args[key] === undefined);
  if (missing.length) throw new MarketingToolError("invalid_arguments", `Missing arguments: ${missing.join(", ")}`);
}

function marketingChannel(value: unknown): MarketingChannel {
  if (!MARKETING_CHANNELS.includes(value as MarketingChannel)) {
    throw new MarketingToolError("invalid_arguments", "channel is invalid");
  }
  return value as MarketingChannel;
}

function boundedId(value: unknown, pattern: RegExp, field: string) {
  const normalized = String(value || "");
  if (!pattern.test(normalized)) throw new MarketingToolError("invalid_arguments", `${field} is invalid`);
  return normalized;
}

export class MarketingToolRegistry {
  execute(name: string, args: Record<string, unknown>) {
    requireClosedArguments(name, args);
    if (name === "bitagent.marketing.calculate_k_factor") {
      return calculateConsentSafeKFactor({
        eligiblePrincipals: Number(args.eligiblePrincipals),
        uniqueHumanSentInvitations: Number(args.uniqueHumanSentInvitations),
        independentQualifiedActivations: Number(args.independentQualifiedActivations),
        excludedSelfControlledOrDuplicates: Number(args.excludedSelfControlledOrDuplicates),
        suppressedRecipients: Number(args.suppressedRecipients)
      });
    }
    if (name === "bitagent.marketing.plan_channel") {
      const phase = String(args.phase) as OutreachPhase;
      const consentState = String(args.consentState) as OutreachConsentState;
      const contactSource = String(args.contactSource) as ContactSource;
      if (!["initial", "follow_up"].includes(phase)) throw new MarketingToolError("invalid_arguments", "phase is invalid");
      if (!["none", "selected_by_user", "opted_in", "not_interested", "do_not_contact"].includes(consentState)) {
        throw new MarketingToolError("invalid_arguments", "consentState is invalid");
      }
      if (!["os_picker", "prior_opt_in_record"].includes(contactSource)) {
        throw new MarketingToolError("invalid_arguments", "contactSource is invalid");
      }
      if (args.providerConfigured !== undefined && typeof args.providerConfigured !== "boolean") {
        throw new MarketingToolError("invalid_arguments", "providerConfigured must be boolean");
      }
      return evaluateOutreachChannelPlan({
        channel: marketingChannel(args.channel),
        phase,
        consentState,
        contactSource,
        localHashedId: boundedId(args.localHashedId, /^[A-Za-z0-9_-]{8,128}$/, "localHashedId"),
        providerConfigured: Boolean(args.providerConfigured)
      });
    }

    if (name === "bitagent.marketing.compose_coaching") {
      const topic = String(args.topic);
      const locale = String(args.locale);
      if (!["agent_value", "p2p_derivative_risk", "referral_economics"].includes(topic)) {
        throw new MarketingToolError("invalid_arguments", "topic is invalid");
      }
      if (!["en", "es"].includes(locale)) throw new MarketingToolError("invalid_arguments", "locale is invalid");
      return {
        schema: "bitagent.marketing_coaching_plan.v1",
        topic,
        channel: marketingChannel(args.channel),
        locale,
        required_checks: topic === "p2p_derivative_risk"
          ? ["fresh_jurisdiction_policy", "derivative_risk_disclosure", "no_performance_claim"]
          : topic === "referral_economics"
            ? ["one_hop_economics", "vesting_value_variability", "no_income_claim"]
            : ["agent_authority_boundary", "no_performance_claim"],
        authority: "model_candidate",
        effect: "none"
      };
    }

    const channel = marketingChannel(args.channel);
    if (!["whatsapp", "sms", "email"].includes(channel)) {
      throw new MarketingToolError("invalid_arguments", "follow-up provider channel is invalid");
    }
    return {
      schema: "bitagent.opted_in_follow_up_candidate.v1",
      channel,
      local_hashed_id: boundedId(args.localHashedId, /^[A-Za-z0-9_-]{8,128}$/, "localHashedId"),
      consent_receipt_id: boundedId(args.consentReceiptId, /^[A-Za-z0-9:_-]{8,160}$/, "consentReceiptId"),
      template_id: boundedId(args.templateId, /^[A-Za-z0-9._-]{3,80}$/, "templateId"),
      status: "REQUIRES_HOST_VERIFICATION",
      required_host_checks: ["opt_in_receipt_valid", "template_approved", "contact_not_suppressed"],
      provider_send_allowed: false,
      send_performed: false,
      requires_human_review: true,
      effect: "none"
    };
  }
}
