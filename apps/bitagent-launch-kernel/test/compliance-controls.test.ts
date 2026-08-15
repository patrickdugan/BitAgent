import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryComplianceAuditLog, verifyComplianceAuditLog } from "../src/compliance/audit.js";
import { assertRoleCapability, validateOperatorService } from "../src/compliance/capabilities.js";
import {
  assertReferralDisclosure,
  defaultInitialOutreach,
  defaultReferralLinkMessage,
  validateFinancialPromotion,
  vulnerabilitySessionState
} from "../src/compliance/marketing.js";
import { evaluatePropagationReview } from "../src/compliance/monitoring.js";
import { importSelectedContact, createDeviceSalt } from "../src/referral/contacts.js";
import { ReferralLinkService } from "../src/referral/links.js";
import { DeterministicLabelRanker } from "../src/referral/ranking.js";
import { AcquisitionMode, InvitationActor } from "../src/referral/types.js";

test("required referral disclosure states activity economics and token-value variability", () => {
  const service = new ReferralLinkService(Buffer.alloc(32, 5), "https://bitagent.example");
  const issued = service.issue({
    referrerPrincipalId: "human-principal",
    acquisitionMode: AcquisitionMode.HUMAN_MANUAL_SHARE,
    invitationActor: InvitationActor.HUMAN,
    now: new Date("2026-08-09T00:00:00.000Z")
  });
  const message = defaultReferralLinkMessage({
    canonical_link: issued.url,
    link_service: service,
    token_denominated_reward: true
  });
  assert.equal(assertReferralDisclosure(message, true), true);
  assert.match(message, /\$0\.50 per \$100,000/);
  assert.match(message, /\$5 per \$1 million/);
  assert.match(message, /not simply on signing up/);
  assert.match(message, /value can rise or fall/);
});

test("prohibited earnings and unsupported comparative claims are rejected", () => {
  for (const claim of [
    "$5 per signup", "guaranteed returns", "risk-free trading", "easy money",
    "you cannot lose", "everyone is making money", "multi-level downline income"
  ]) {
    assert.throws(() => validateFinancialPromotion({ text: claim }), /prohibited claim/);
  }
  assert.throws(() => validateFinancialPromotion({ text: "BitAgent has lower fees" }), /requires evidence/);
  assert.equal(validateFinancialPromotion({
    text: "BitAgent has lower fees", evidence_supported_claims: ["lower_fees"]
  }), "BitAgent has lower fees");
});

test("rent and food urgency blocks leveraged promotion and referral pressure but keeps view-only", () => {
  for (const statement of [
    "this is my rent money",
    "I need to turn $20 into food",
    "I need to make money tonight",
    "I cannot afford to lose this"
  ]) {
    const state = vulnerabilitySessionState([statement]);
    assert.equal(state.financial_vulnerability_signal, true);
    assert.equal(state.high_risk_product_promotion, "BLOCKED");
    assert.equal(state.referral_pressure, "DISABLED");
    assert.equal(state.view_only_available, true);
    assert.equal(state.persistence, "SESSION_ONLY");
  }
});

test("initial copy discloses the relationship without making an earnings claim", () => {
  const message = defaultInitialOutreach("Contact A");
  assert.match(message, /self-custodial trading agent that can work from a phone/);
  assert.match(message, /small referral credit/);
  assert.doesNotMatch(message, /guaranteed|\$5 per signup|perpetual/i);
});

test("financial vulnerability and protected traits cannot become ranking labels", () => {
  for (const label of ["poverty", "debt", "financial_distress", "race", "health_status"]) {
    assert.throws(() => importSelectedContact({
      raw: { displayName: "Local only" },
      deviceSalt: createDeviceSalt(),
      labels: [label] as never
    }), /prohibited or unknown ranking labels/);
  }
  const forged = {
    local_hashed_id: "a".repeat(64), display_name_local_only: "Local", user_labels: ["poverty"],
    relationship_strength: 1, predicted_activation_probability: "0", predicted_notional_band: "LOW",
    onboarding_effort: 0, relationship_cost: 0, score: 0, explanation: "", campaign_state: "candidate"
  };
  assert.throws(() => new DeterministicLabelRanker().rank([forged] as never), /prohibited or unknown ranking labels/);
});

test("Growth Agent, Trading Agent, and harness capabilities are isolated", () => {
  assert.equal(assertRoleCapability("GROWTH_AGENT", "MESSAGE_DRAFT"), true);
  assert.equal(assertRoleCapability("TRADING_AGENT", "ORDER_PROPOSE"), true);
  assert.equal(assertRoleCapability("DETERMINISTIC_HARNESS", "ORDER_SIGN"), true);
  assert.throws(() => assertRoleCapability("GROWTH_AGENT", "ORDER_PROPOSE"), /cannot use/);
  assert.throws(() => assertRoleCapability("TRADING_AGENT", "CONTACT_READ_SELECTED"), /cannot use/);
  assert.throws(() => assertRoleCapability("GROWTH_AGENT", "REFERRAL_BIND"), /cannot use/);
});

test("operators can provide services but never receive wallet keys", () => {
  assert.throws(() => validateOperatorService({
    services: ["hosted_inference"], compensation: ["compute_fee"], receives_wallet_keys: true
  }), /never receive user wallet keys/);
  const valid = validateOperatorService({
    services: ["hosted_inference", "local_language_support"],
    compensation: ["compute_fee", "explicit_service_fee"],
    receives_wallet_keys: false
  });
  assert.equal(valid.status, "REQUIRES_HUMAN_AUTH");
  assert.equal(valid.local_authorization_and_signing_required, true);
});

test("compliance audit is hash-linked, immutable, and rejects contact/message contents", () => {
  const log = new InMemoryComplianceAuditLog(() => new Date("2026-08-09T12:00:00.000Z"));
  const first = log.append({
    event_type: "jurisdiction_policy_checked",
    policy_version: "2026-08-09.1",
    metadata: { status: "OK", policy_receipt_hash: "a".repeat(64) }
  });
  log.append({ event_type: "product_allowed", metadata: { product: "SPOT" } });
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.metadata), true);
  assert.equal(verifyComplianceAuditLog(log.list()), true);
  assert.throws(() => log.append({
    event_type: "agent_assisted_message_prepared", metadata: { message_content: "private" }
  }), /prohibited/);
  assert.throws(() => log.append({
    event_type: "contact_permission_granted", metadata: { phone_number: "+1 555" }
  }), /prohibited/);
  assert.throws(() => log.append({
    event_type: "manual_override_used", metadata: { operator: "not enough" }
  }), /human administrative principal/);
});

test("one propagation correlation never freezes funds and joint signals trigger review only", () => {
  const thresholds = {
    gamma_threshold: 0.5,
    common_strategy_threshold: 0.8,
    coordination_threshold: 0.8,
    cluster_threshold: 0.8,
    operator_concentration_threshold: 0.8,
    minimum_joint_signals: 2
  };
  const base = {
    agent_assisted_new_productive_users: 6,
    existing_agent_assisted_productive_users: 10,
    referral_depth: 1,
    shared_strategy_hash_rate: 0.1,
    shared_compute_provider_rate: 0.1,
    synchronized_execution_score: 0.1,
    geographic_cluster_score: 0.1,
    common_message_template_rate: 0.1,
    operator_concentration: 0.1,
    self_referral_rate: 0.1,
    agent_assisted_activation_rate: 0.2
  };
  const single = evaluatePropagationReview(base, thresholds);
  assert.equal(single.enhanced_review, false);
  assert.equal(single.freeze_user_funds, false);
  const joint = evaluatePropagationReview({
    ...base, shared_strategy_hash_rate: 0.9, synchronized_execution_score: 0.9
  }, thresholds);
  assert.equal(joint.enhanced_review, true);
  assert.equal(joint.freeze_user_funds, false);
  assert.ok(joint.actions.includes("require_manual_review"));
});
