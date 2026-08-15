import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateOutreachChannelPlan,
  marketingChannelToolSchemas
} from "../src/referral/channelPolicy.js";
import { MarketingToolError, MarketingToolRegistry } from "../src/referral/marketingTools.js";
import { calculateConsentSafeKFactor } from "../src/referral/kFactor.js";

test("consent-safe K-factor uses human-sent unique invitations and independent activations", () => {
  const result = calculateConsentSafeKFactor({
    eligiblePrincipals: 4,
    uniqueHumanSentInvitations: 8,
    independentQualifiedActivations: 2,
    excludedSelfControlledOrDuplicates: 3,
    suppressedRecipients: 1
  });
  assert.equal(result.invitations_per_principal_ppm, 2_000_000);
  assert.equal(result.qualified_activation_rate_ppm, 250_000);
  assert.equal(result.k_factor_ppm, 500_000);
  assert.equal(result.k_factor_decimal, "0.500000");
  assert.equal(result.excluded_self_controlled_or_duplicates, 3);
  assert.match(result.counting_rule, /exclude self-controlled identities/);
  assert.throws(() => calculateConsentSafeKFactor({
    eligiblePrincipals: 1,
    uniqueHumanSentInvitations: 1,
    independentQualifiedActivations: 2,
    excludedSelfControlledOrDuplicates: 0,
    suppressedRecipients: 0
  }));
});

test("initial WhatsApp outreach stays a reviewed manual-share candidate", () => {
  const plan = evaluateOutreachChannelPlan({
    channel: "whatsapp",
    phase: "initial",
    consentState: "selected_by_user",
    contactSource: "os_picker",
    localHashedId: "contact_hash_A",
    providerConfigured: true
  });
  assert.equal(plan.status, "READY_FOR_DRAFT");
  assert.equal(plan.next_action, "PREPARE_MANUAL_SHARE");
  assert.equal(plan.provider_send_allowed, false);
  assert.equal(plan.initial_send_performed, false);
  assert.equal(plan.requires_human_send_action, true);
});

test("provider follow-up requires opt-in and remains effect-free", () => {
  const plan = evaluateOutreachChannelPlan({
    channel: "whatsapp",
    phase: "follow_up",
    consentState: "opted_in",
    contactSource: "prior_opt_in_record",
    localHashedId: "contact_hash_A",
    providerConfigured: true
  });
  assert.equal(plan.status, "READY_FOR_DRAFT");
  assert.equal(plan.next_action, "PREPARE_OPTED_IN_FOLLOW_UP");
  assert.equal(plan.provider_send_allowed, false);
  assert.deepEqual(plan.reason_codes, ["OPT_IN_RECEIPT_AND_TEMPLATE_REQUIRED", "CANDIDATE_ONLY_NO_SEND"]);
  assert.equal(marketingChannelToolSchemas["bitagent.marketing.prepare_opted_in_follow_up"]!.effect, "none");
});

test("scraped, purchased, suppressed, and unconsented contacts fail closed", () => {
  for (const input of [
    { consentState: "none" as const, contactSource: "message_scrape" as const },
    { consentState: "selected_by_user" as const, contactSource: "purchased_list" as const },
    { consentState: "do_not_contact" as const, contactSource: "prior_opt_in_record" as const }
  ]) {
    const plan = evaluateOutreachChannelPlan({
      channel: "email",
      phase: "follow_up",
      localHashedId: "contact_hash_A",
      providerConfigured: true,
      ...input
    });
    assert.equal(plan.status, "BLOCKED");
    assert.equal(plan.next_action, "HOLD");
    assert.equal(plan.provider_send_allowed, false);
  }
});

test("marketing tool registry returns only candidate plans and rejects open arguments", () => {
  const registry = new MarketingToolRegistry();
  const coaching = registry.execute("bitagent.marketing.compose_coaching", {
    topic: "p2p_derivative_risk",
    channel: "whatsapp",
    locale: "en"
  }) as Record<string, unknown>;
  assert.equal(coaching.effect, "none");
  assert.equal(coaching.authority, "model_candidate");

  const followUp = registry.execute("bitagent.marketing.prepare_opted_in_follow_up", {
    channel: "whatsapp",
    localHashedId: "contact_hash_A",
    consentReceiptId: "consent:local:001",
    templateId: "bitagent-risk-referral-v1"
  }) as Record<string, unknown>;
  assert.equal(followUp.status, "REQUIRES_HOST_VERIFICATION");
  assert.equal(followUp.provider_send_allowed, false);
  assert.equal(followUp.send_performed, false);

  assert.throws(
    () => registry.execute("bitagent.marketing.plan_channel", {
      channel: "whatsapp",
      phase: "initial",
      consentState: "selected_by_user",
      contactSource: "os_picker",
      localHashedId: "contact_hash_A",
      providerConfigured: true,
      phoneNumber: "+15555550123"
    }),
    (error: unknown) => error instanceof MarketingToolError && error.code === "invalid_arguments"
  );
});
