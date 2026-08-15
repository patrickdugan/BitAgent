import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateEffectiveLeverageCap,
  evaluateCompliance,
  evaluateComplianceDecision,
  getJurisdictionPolicy,
  requiresComplianceReevaluation
} from "../src/compliance/policy.js";
import { ComplianceToolRegistry } from "../src/compliance/tools.js";
import type {
  ComplianceEvaluationRequest,
  JurisdictionPolicy,
  JurisdictionPolicyHost,
  JurisdictionPolicyServiceResult,
  SignedJurisdictionPolicyEnvelope
} from "../src/compliance/types.js";

const NOW = new Date("2026-08-09T12:00:00.000Z");

function policy(overrides: Partial<JurisdictionPolicy> = {}): JurisdictionPolicy {
  return {
    residence_country: "CL",
    current_location_country: "CL",
    user_type: "retail",
    supported: true,
    mode: "PERPS_ALLOWED",
    max_leverage: 5,
    referral_allowed: true,
    agent_assisted_referral_allowed: true,
    local_marketing_restrictions: [],
    required_disclosures: [],
    product_restrictions: [],
    explicitly_allowed_products: ["SWAP", "BRIDGE"],
    review_required: false,
    policy_version: "2026-08-09.1",
    ...overrides
  };
}

function envelope(policyValue = policy(), overrides: Partial<SignedJurisdictionPolicyEnvelope> = {}): SignedJurisdictionPolicyEnvelope {
  return {
    schema: "bitagent_signed_jurisdiction_policy_v1",
    policy: policyValue,
    key_id: "jurisdiction-policy-key-1",
    issued_at: "2026-08-09T00:00:00.000Z",
    expires_at: "2026-08-10T00:00:00.000Z",
    signature: "external-signature",
    ...overrides
  };
}

function host(input: {
  result?: JurisdictionPolicyServiceResult;
  verified?: boolean;
  now?: Date;
} = {}): JurisdictionPolicyHost {
  return {
    getJurisdictionPolicy: () => input.result || { status: "OK", envelope: envelope() },
    verifyPolicyEnvelope: () => input.verified ?? true,
    now: () => input.now || NOW
  };
}

function request(overrides: Partial<ComplianceEvaluationRequest> = {}): ComplianceEvaluationRequest {
  return {
    action: "ENABLE_PRODUCT",
    country_of_residence: "CL",
    current_location_country: "CL",
    age_eligibility: "ELIGIBLE",
    product_requested: "PERPETUAL",
    custody_model: "SELF_CUSTODY",
    user_type: "retail",
    ...overrides
  };
}

test("unsupported jurisdiction blocks trading and preserves view-only", async () => {
  const unsupported = policy({ supported: false, mode: "UNSUPPORTED", max_leverage: null });
  const decision = await evaluateCompliance(host({ result: { status: "OK", envelope: envelope(unsupported) } }), request());
  assert.equal(decision.status, "BLOCK");
  assert.equal(decision.trading_permission, "NONE");
  assert.equal(decision.view_only_available, true);
  assert.ok(decision.reason_codes.includes("JURISDICTION_UNSUPPORTED"));
});

test("unknown, error, expired, invalid-signature, and mismatched policies fail closed", async () => {
  const cases: JurisdictionPolicyHost[] = [
    host({ result: { status: "UNKNOWN", reason_code: "NO_TABLE_ROW" } }),
    host({ result: { status: "ERROR", reason_code: "SERVICE_DOWN" } }),
    host({ result: { status: "OK", envelope: envelope(policy(), { expires_at: "2026-08-09T11:59:59.000Z" }) } }),
    host({ verified: false }),
    host({ result: { status: "OK", envelope: envelope(policy({ residence_country: "US" })) } })
  ];
  for (const fixture of cases) {
    const decision = await evaluateCompliance(fixture, request());
    assert.equal(decision.status, "REQUIRE_REVIEW");
    assert.equal(decision.trading_permission, "NONE");
    assert.equal(decision.referral_mode, "LINK_ONLY");
    assert.equal(decision.escalation, "REQUIRED");
  }
});

test("malformed signed policy payloads and verifier exceptions fail closed", async () => {
  const malformed = policy({ mode: "ALLOW_EVERYTHING" as never });
  const malformedDecision = await evaluateCompliance(
    host({ result: { status: "OK", envelope: envelope(malformed) } }),
    request()
  );
  assert.equal(malformedDecision.status, "REQUIRE_REVIEW");
  assert.ok(malformedDecision.reason_codes.includes("POLICY_PAYLOAD_INVALID"));

  const throwingHost = host();
  throwingHost.verifyPolicyEnvelope = () => { throw new Error("key service unavailable"); };
  const verifierDecision = await evaluateCompliance(throwingHost, request());
  assert.equal(verifierDecision.status, "REQUIRE_REVIEW");
  assert.ok(verifierDecision.reason_codes.includes("POLICY_SIGNATURE_INVALID"));
});

test("perpetual restrictions cannot be bypassed through spot, synthetic, or tokenized labels", async () => {
  const spotOnly = policy({ mode: "SPOT_ONLY", max_leverage: null });
  const lookup = await getJurisdictionPolicy(
    host({ result: { status: "OK", envelope: envelope(spotOnly) } }),
    { residence_country: "CL", current_location_country: "CL", user_type: "retail" }
  );
  for (const disguised of [
    request({ product_requested: "SPOT", product_description: "BTC perpetual swap with a funding rate" }),
    request({ product_requested: "SYNTHETIC", product_description: "synthetic perpetual exposure" }),
    request({ product_requested: "TOKENIZED_POSITION", product_description: "tokenized perpetual position" })
  ]) {
    const decision = evaluateComplianceDecision(disguised, lookup);
    assert.equal(decision.status, "BLOCK");
    assert.ok(decision.reason_codes.includes("DERIVATIVE_RENAMING_CANNOT_BYPASS_POLICY"));
  }
});

test("policy updates and jurisdiction fact changes invalidate stale decisions", async () => {
  const lookup = await getJurisdictionPolicy(host(), {
    residence_country: "CL", current_location_country: "CL", user_type: "retail"
  });
  const stale = evaluateComplianceDecision(request({ expected_policy_version: "2026-08-08.9" }), lookup);
  assert.equal(stale.status, "REQUIRE_REVIEW");
  assert.ok(stale.reason_codes.includes("POLICY_VERSION_CHANGED"));

  const previous = {
    country_of_residence: "CL", current_location_country: "CL", user_type: "retail" as const,
    product_requested: "SPOT", external_beneficiary_requested: false, policy_version: "2026-08-09.1"
  };
  assert.equal(requiresComplianceReevaluation(previous, { ...previous, current_location_country: "AR" }), true);
  assert.equal(requiresComplianceReevaluation(previous, { ...previous, policy_version: "2026-08-10.1" }), true);
  assert.equal(requiresComplianceReevaluation(previous, { ...previous, product_requested: "PERPETUAL" }), true);
  assert.equal(requiresComplianceReevaluation(previous, previous), false);
});

test("leverage cap is the minimum of jurisdiction, user, strategy, and protocol caps", async () => {
  assert.equal(calculateEffectiveLeverageCap({
    jurisdiction_cap: 5, user_cap: 3, strategy_cap: 2, protocol_cap: 10
  }), 2);
  const decision = await evaluateCompliance(host(), request({
    action: "CHANGE_LEVERAGE",
    user_leverage_cap: 3,
    strategy_leverage_cap: 2,
    protocol_leverage_cap: 10
  }));
  assert.equal(decision.status, "ALLOW_WITH_DISCLOSURE");
  assert.equal(decision.max_leverage, 2);
  assert.ok(decision.required_disclosures.includes("DERIVATIVES_RISK"));
  const missing = await evaluateCompliance(host(), request({ action: "CHANGE_LEVERAGE" }));
  assert.equal(missing.status, "REQUIRE_REVIEW");
  assert.equal(missing.max_leverage, null);
});

test("external and agent-to-agent referral attribution requires human authorization", async () => {
  const noHuman = await evaluateCompliance(host(), request({
    action: "CREATE_REFERRAL_BINDING",
    product_requested: "REFERRAL",
    external_beneficiary_requested: true,
    referral_provenance: "AGENT_TO_AGENT"
  }));
  assert.equal(noHuman.status, "REQUIRE_HUMAN_AUTH");
  assert.equal(noHuman.referral_mode, "LINK_ONLY");

  const authorized = await evaluateCompliance(host(), request({
    action: "CREATE_REFERRAL_BINDING",
    product_requested: "REFERRAL",
    external_beneficiary_requested: true,
    human_principal_authorized_external_beneficiary: true,
    referral_provenance: "HUMAN_REFERRED",
    token_denominated_reward: true
  }));
  assert.equal(authorized.status, "ALLOW_WITH_DISCLOSURE");
  assert.equal(authorized.referral_mode, "ONE_HOP");
  assert.ok(authorized.required_disclosures.includes("REFERRER_RECEIVES_0_05_BP"));
  assert.ok(authorized.required_disclosures.includes("TOKEN_VALUE_VARIABLE"));
});

test("agent-assisted outreach and autonomous initial sending obey policy", async () => {
  const disabled = policy({ agent_assisted_referral_allowed: false });
  const denied = await evaluateCompliance(
    host({ result: { status: "OK", envelope: envelope(disabled) } }),
    request({ action: "START_AGENT_ASSISTED_OUTREACH", product_requested: "REFERRAL", agent_assisted_outreach_requested: true })
  );
  assert.equal(denied.status, "BLOCK");
  assert.ok(denied.reason_codes.includes("AGENT_ASSISTED_REFERRAL_NOT_ALLOWED"));

  const autoSend = await evaluateCompliance(host(), request({
    action: "START_AGENT_ASSISTED_OUTREACH",
    product_requested: "REFERRAL",
    agent_assisted_outreach_requested: true,
    autonomous_initial_send_requested: true
  }));
  assert.equal(autoSend.status, "BLOCK");
  assert.ok(autoSend.reason_codes.includes("AUTONOMOUS_INITIAL_MESSAGE_BLOCKED"));
});

test("tool registry accepts only minimum jurisdiction facts and returns no effects", async () => {
  const tools = new ComplianceToolRegistry(host());
  const lookup = await tools.call("get_jurisdiction_policy", {
    residence_country: "cl", current_location_country: "cl", user_type: "retail"
  });
  assert.equal(lookup.status, "OK");
  assert.equal(lookup.effect, "none");
  await assert.rejects(() => tools.call("get_jurisdiction_policy", {
    residence_country: "CL", current_location_country: "CL", user_type: "retail", ip: "127.0.0.1"
  }), /unexpected fields/);
  await assert.rejects(() => tools.call("bitagent.compliance.evaluate", {
    ...request({ action: "RANK_CONTACTS", product_requested: "REFERRAL" }),
    contact_permission: "CONTACT_ALL"
  }), /contact_permission is invalid/);
});
