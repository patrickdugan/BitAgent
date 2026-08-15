import { createHash } from "node:crypto";

import {
  PRODUCT_CATEGORIES,
  type ComplianceContextSnapshot,
  type ComplianceDecision,
  type ComplianceDecisionStatus,
  type ComplianceEvaluationRequest,
  type JurisdictionMode,
  type JurisdictionPolicy,
  type JurisdictionPolicyHost,
  type JurisdictionPolicyLookupReceipt,
  type JurisdictionPolicyQuery,
  type ProductCategory,
  type UserType
} from "./types.js";

const PRODUCTS = new Set<string>(PRODUCT_CATEGORIES);
const DERIVATIVES = new Set<ProductCategory>(["PERPETUAL", "FUTURE", "OPTION"]);
const REFERRAL_ACTIONS = new Set<ComplianceEvaluationRequest["action"]>([
  "CREATE_REFERRAL_BINDING",
  "RANK_CONTACTS",
  "PREPARE_FINANCIAL_PROMOTION",
  "START_AGENT_ASSISTED_OUTREACH"
]);
const TRADING_ACTIONS = new Set<ComplianceEvaluationRequest["action"]>([
  "ENABLE_PRODUCT",
  "CHANGE_LEVERAGE"
]);
const ACTIONS = new Set<ComplianceEvaluationRequest["action"]>([
  "ENABLE_PRODUCT", "CHANGE_LEVERAGE", "CREATE_REFERRAL_BINDING", "RANK_CONTACTS",
  "PREPARE_FINANCIAL_PROMOTION", "ENABLE_OPERATOR_SERVICE",
  "START_AGENT_ASSISTED_OUTREACH", "CHANGE_COUNTRY", "CHANGE_USER_TYPE"
]);
const MODES = new Set<JurisdictionMode>([
  "PERPS_ALLOWED", "PERPS_RESTRICTED", "SPOT_ONLY", "VIEW_ONLY", "UNSUPPORTED"
]);
const AGE_STATES = new Set(["ELIGIBLE", "INELIGIBLE", "UNKNOWN"]);
const CUSTODY_MODELS = new Set(["SELF_CUSTODY", "CUSTODIAL", "HYBRID", "UNKNOWN"]);
const CONTACT_PERMISSIONS = new Set(["CONTACT_NONE", "CONTACT_PICK_ONE", "CONTACT_PICK_MULTIPLE", "CONTACT_LOCAL_RANKING", "CONTACT_FULL_LOCAL_SCAN"]);
const REFERRAL_PROVENANCE = new Set(["SELF_AGENT", "HUMAN_REFERRED", "AGENT_ASSISTED_HUMAN_REFERRAL", "SERVICE_OPERATOR_REFERRED", "AGENT_TO_AGENT"]);
const KNOWN_MARKETING_RESTRICTIONS = new Set([
  "BLOCK_REFERRAL",
  "BLOCK_CONTACT_RANKING",
  "BLOCK_FINANCIAL_PROMOTION",
  "BLOCK_AGENT_ASSISTED_OUTREACH",
  "BLOCK_OPERATOR_SERVICE",
  "HUMAN_REVIEW_REQUIRED"
]);

export const PROHIBITED_CLAIM_CODES = [
  "GUARANTEED_RETURNS",
  "RISK_FREE_TRADING",
  "GUARANTEED_INCOME",
  "EASY_MONEY",
  "CANNOT_LOSE",
  "EVERYONE_IS_MAKING_MONEY",
  "SIGNUP_BONUS",
  "DOWNLOAD_BONUS",
  "IDENTITY_BONUS",
  "ACCOUNT_COUNT_BONUS",
  "MULTI_LEVEL_COMMISSION",
  "DOWNLINE_PERCENTAGE",
  "RANK_MULTIPLIER",
  "RECURSIVE_REFERRAL_EMISSION"
] as const;

export function complianceCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(complianceCanonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${complianceCanonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function complianceHash(value: unknown): string {
  return createHash("sha256").update(complianceCanonicalJson(value)).digest("hex");
}

function normalizeCountry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function validUserType(value: unknown): value is UserType {
  return ["retail", "professional", "institution", "unknown"].includes(String(value));
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function productArray(value: unknown): value is ProductCategory[] {
  return Array.isArray(value) && value.every((item) => PRODUCTS.has(String(item)));
}

function validPolicyPayload(value: unknown): value is JurisdictionPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const policy = value as Partial<JurisdictionPolicy>;
  return normalizeCountry(policy.residence_country) !== null
    && normalizeCountry(policy.current_location_country) !== null
    && validUserType(policy.user_type)
    && typeof policy.supported === "boolean"
    && MODES.has(policy.mode as JurisdictionMode)
    && (policy.max_leverage === null || validCap(policy.max_leverage))
    && typeof policy.referral_allowed === "boolean"
    && typeof policy.agent_assisted_referral_allowed === "boolean"
    && stringArray(policy.local_marketing_restrictions)
    && stringArray(policy.required_disclosures)
    && productArray(policy.product_restrictions)
    && (policy.explicitly_allowed_products === undefined || productArray(policy.explicitly_allowed_products))
    && typeof policy.review_required === "boolean"
    && typeof policy.policy_version === "string"
    && policy.policy_version.length > 0
    && policy.policy_version.length <= 128;
}

function lookupFailure(
  query: JurisdictionPolicyQuery,
  now: Date,
  status: JurisdictionPolicyLookupReceipt["status"],
  ...reasonCodes: string[]
): JurisdictionPolicyLookupReceipt {
  return {
    schema: "bitagent_jurisdiction_policy_lookup_v1",
    authority: "deterministic_policy_service",
    effect: "none",
    status,
    checked_at: now.toISOString(),
    query,
    policy: null,
    policy_version: null,
    policy_expires_at: null,
    policy_receipt_hash: null,
    key_id: null,
    reason_codes: reasonCodes
  };
}

export async function getJurisdictionPolicy(
  host: JurisdictionPolicyHost,
  input: JurisdictionPolicyQuery
): Promise<JurisdictionPolicyLookupReceipt> {
  const now = host.now();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Compliance host clock returned an invalid date");
  }
  const residence = normalizeCountry(input.residence_country);
  const location = normalizeCountry(input.current_location_country);
  const query: JurisdictionPolicyQuery = {
    residence_country: residence || "",
    current_location_country: location || "",
    user_type: input.user_type
  };
  if (!residence || !location || !validUserType(input.user_type)) {
    return lookupFailure(query, now, "ERROR", "INVALID_POLICY_QUERY");
  }

  let result;
  try {
    result = await host.getJurisdictionPolicy(query);
  } catch {
    return lookupFailure(query, now, "ERROR", "POLICY_SERVICE_ERROR");
  }
  if (result.status !== "OK") {
    return lookupFailure(query, now, result.status, result.reason_code || `POLICY_${result.status}`);
  }
  const envelope = result.envelope;
  if (!envelope || envelope.schema !== "bitagent_signed_jurisdiction_policy_v1"
    || typeof envelope.key_id !== "string" || !envelope.key_id
    || typeof envelope.signature !== "string" || !envelope.signature
    || !validPolicyPayload(envelope.policy)) {
    return lookupFailure(query, now, "ERROR", "POLICY_PAYLOAD_INVALID");
  }
  let signatureValid = false;
  try {
    signatureValid = await host.verifyPolicyEnvelope(envelope);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return lookupFailure(query, now, "INVALID_SIGNATURE", "POLICY_SIGNATURE_INVALID");
  }

  const issuedAt = Date.parse(envelope.issued_at);
  const expiresAt = Date.parse(envelope.expires_at);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > now.getTime()) {
    return lookupFailure(query, now, "ERROR", "POLICY_TIME_INVALID");
  }
  if (expiresAt <= now.getTime()) {
    return lookupFailure(query, now, "EXPIRED", "POLICY_EXPIRED");
  }
  const policy = envelope.policy;
  if (
    normalizeCountry(policy.residence_country) !== residence
    || normalizeCountry(policy.current_location_country) !== location
    || policy.user_type !== query.user_type
  ) {
    return lookupFailure(query, now, "BINDING_MISMATCH", "POLICY_QUERY_BINDING_MISMATCH");
  }
  if (!policy.policy_version.trim() || policy.supported === (policy.mode === "UNSUPPORTED")) {
    return lookupFailure(query, now, "ERROR", "POLICY_PAYLOAD_INCONSISTENT");
  }

  return {
    schema: "bitagent_jurisdiction_policy_lookup_v1",
    authority: "deterministic_policy_service",
    effect: "none",
    status: "OK",
    checked_at: now.toISOString(),
    query,
    policy: structuredClone(policy),
    policy_version: policy.policy_version,
    policy_expires_at: envelope.expires_at,
    policy_receipt_hash: complianceHash(envelope),
    key_id: envelope.key_id,
    reason_codes: ["SIGNED_POLICY_VERIFIED"]
  };
}

export function classifyProductRequest(input: {
  product_requested: string;
  product_description?: string;
}): { product: ProductCategory | null; renamed_derivative: boolean } {
  const declaredText = String(input.product_requested || "").trim().toUpperCase().replace(/[ -]+/g, "_");
  const declared = PRODUCTS.has(declaredText) ? declaredText as ProductCategory : null;
  const description = `${declaredText} ${String(input.product_description || "")}`.toLowerCase();
  let detected: ProductCategory | null = null;
  if (/\bperp(?:etual)?s?\b|perpetual[_ -]?swap|funding[_ -]?rate|tokeni[sz]ed[_ -]?perpetual/.test(description)) {
    detected = "PERPETUAL";
  } else if (/\bfutures?\b|dated[_ -]?future/.test(description)) {
    detected = "FUTURE";
  } else if (/\boptions?\b|\bput\b|\bcall\b/.test(description)) {
    detected = "OPTION";
  } else if (!declared && /synthetic|tokeni[sz]ed[_ -]?position/.test(description)) {
    // An unknown synthetic/tokenized label is never downgraded to spot.
    detected = "PERPETUAL";
  }
  return {
    product: detected || declared,
    renamed_derivative: Boolean(detected && detected !== declared)
  };
}

function modeProducts(policy: JurisdictionPolicy): ProductCategory[] {
  const base: ProductCategory[] = policy.mode === "PERPS_ALLOWED"
    ? ["SPOT", "PERPETUAL"]
    : policy.mode === "PERPS_RESTRICTED" || policy.mode === "SPOT_ONLY"
      ? ["SPOT"]
      : [];
  const explicit = (policy.explicitly_allowed_products || []).filter((item) => PRODUCTS.has(item));
  const allowed = new Set<ProductCategory>([...base, ...explicit]);
  if (policy.referral_allowed) allowed.add("REFERRAL");
  for (const restriction of policy.product_restrictions) allowed.delete(restriction);
  if (policy.mode !== "PERPS_ALLOWED") allowed.delete("PERPETUAL");
  if (["SPOT_ONLY", "VIEW_ONLY", "UNSUPPORTED"].includes(policy.mode)) {
    allowed.delete("FUTURE");
    allowed.delete("OPTION");
  }
  if (!policy.supported || policy.mode === "UNSUPPORTED" || policy.mode === "VIEW_ONLY") allowed.clear();
  return PRODUCT_CATEGORIES.filter((product) => allowed.has(product));
}

function validCap(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function calculateEffectiveLeverageCap(input: {
  jurisdiction_cap: number;
  user_cap: number;
  strategy_cap: number;
  protocol_cap: number;
}): number {
  const caps = [input.jurisdiction_cap, input.user_cap, input.strategy_cap, input.protocol_cap];
  if (!caps.every(validCap)) throw new Error("Every leverage cap must be a positive finite number");
  return Math.min(...caps);
}

function contextHash(request: ComplianceEvaluationRequest, policyVersion: string | null) {
  return complianceHash({
    action: request.action,
    country_of_residence: normalizeCountry(request.country_of_residence),
    current_location_country: normalizeCountry(request.current_location_country),
    age_eligibility: request.age_eligibility,
    product_requested: request.product_requested,
    product_description: request.product_description,
    custody_model: request.custody_model,
    user_type: request.user_type,
    policy_version: policyVersion,
    referral_provenance: request.referral_provenance,
    external_beneficiary_requested: request.external_beneficiary_requested,
    financial_vulnerability_signal: request.financial_vulnerability_signal
  });
}

function decisionBase(
  request: ComplianceEvaluationRequest,
  lookup: JurisdictionPolicyLookupReceipt,
  status: ComplianceDecisionStatus,
  reasons: string[]
): ComplianceDecision {
  return {
    schema: "bitagent_compliance_decision_v1",
    status,
    compliance_state: status === "BLOCK" ? "BLOCKED" : "UNKNOWN",
    trading_permission: "NONE",
    jurisdiction_mode: lookup.policy?.mode || "UNKNOWN",
    allowed_products: [],
    max_leverage: null,
    referral_mode: "LINK_ONLY",
    outreach_mode: "DISABLED",
    required_disclosures: [],
    prohibited_claims: [...PROHIBITED_CLAIM_CODES],
    reason_codes: [...new Set(reasons)],
    policy_version: lookup.policy_version,
    policy_expires_at: lookup.policy_expires_at,
    policy_receipt_hash: lookup.policy_receipt_hash,
    evaluated_context_hash: contextHash(request, lookup.policy_version),
    escalation: "REQUIRED",
    view_only_available: true,
    financial_vulnerability_signal: Boolean(request.financial_vulnerability_signal)
  };
}

function relevantMarketingRestriction(policy: JurisdictionPolicy, request: ComplianceEvaluationRequest) {
  const actionCodes: Partial<Record<ComplianceEvaluationRequest["action"], string>> = {
    CREATE_REFERRAL_BINDING: "BLOCK_REFERRAL",
    RANK_CONTACTS: "BLOCK_CONTACT_RANKING",
    PREPARE_FINANCIAL_PROMOTION: "BLOCK_FINANCIAL_PROMOTION",
    START_AGENT_ASSISTED_OUTREACH: "BLOCK_AGENT_ASSISTED_OUTREACH",
    ENABLE_OPERATOR_SERVICE: "BLOCK_OPERATOR_SERVICE"
  };
  const expected = actionCodes[request.action];
  if (expected && policy.local_marketing_restrictions.includes(expected)) return expected;
  if (
    (REFERRAL_ACTIONS.has(request.action) || request.action === "ENABLE_OPERATOR_SERVICE")
    && policy.local_marketing_restrictions.includes("HUMAN_REVIEW_REQUIRED")
  ) return "HUMAN_REVIEW_REQUIRED";
  if (
    (REFERRAL_ACTIONS.has(request.action) || request.action === "ENABLE_OPERATOR_SERVICE")
    && policy.local_marketing_restrictions.some((item) => !KNOWN_MARKETING_RESTRICTIONS.has(item))
  ) return "UNINTERPRETED_LOCAL_MARKETING_RESTRICTION";
  return null;
}

export function evaluateComplianceDecision(
  request: ComplianceEvaluationRequest,
  lookup: JurisdictionPolicyLookupReceipt
): ComplianceDecision {
  if (lookup.status !== "OK" || !lookup.policy) {
    return decisionBase(request, lookup, "REQUIRE_REVIEW", [
      ...lookup.reason_codes,
      "POLICY_UNAVAILABLE_FAIL_CLOSED"
    ]);
  }
  const policy = lookup.policy;
  if (!ACTIONS.has(request.action)
    || !AGE_STATES.has(String(request.age_eligibility))
    || !CUSTODY_MODELS.has(String(request.custody_model))
    || !validUserType(request.user_type)
    || (request.contact_permission !== undefined && !CONTACT_PERMISSIONS.has(String(request.contact_permission)))
    || (request.referral_provenance !== undefined && !REFERRAL_PROVENANCE.has(String(request.referral_provenance)))) {
    return decisionBase(request, lookup, "REQUIRE_REVIEW", ["COMPLIANCE_FACTS_INVALID"]);
  }
  const residence = normalizeCountry(request.country_of_residence);
  const location = normalizeCountry(request.current_location_country);
  if (!residence || !location) {
    return decisionBase(request, lookup, "REQUIRE_REVIEW", ["JURISDICTION_FACTS_MISSING"]);
  }
  if (
    residence !== lookup.query.residence_country
    || location !== lookup.query.current_location_country
    || request.user_type !== lookup.query.user_type
  ) {
    return decisionBase(request, lookup, "REQUIRE_REVIEW", ["JURISDICTION_CHANGED_REEVALUATION_REQUIRED"]);
  }
  if (request.expected_policy_version && request.expected_policy_version !== policy.policy_version) {
    return decisionBase(request, lookup, "REQUIRE_REVIEW", ["POLICY_VERSION_CHANGED"]);
  }
  if (request.age_eligibility === "INELIGIBLE") {
    return decisionBase(request, lookup, "BLOCK", ["AGE_INELIGIBLE"]);
  }
  if (request.age_eligibility === "UNKNOWN" && TRADING_ACTIONS.has(request.action)) {
    return decisionBase(request, lookup, "REQUIRE_REVIEW", ["AGE_ELIGIBILITY_UNKNOWN"]);
  }
  if (TRADING_ACTIONS.has(request.action) && request.custody_model === "UNKNOWN") {
    return decisionBase(request, lookup, "REQUIRE_REVIEW", ["CUSTODY_MODEL_UNKNOWN"]);
  }
  if (TRADING_ACTIONS.has(request.action) && request.user_type === "unknown") {
    return decisionBase(request, lookup, "REQUIRE_REVIEW", ["USER_TYPE_UNKNOWN"]);
  }
  if (!policy.supported || policy.mode === "UNSUPPORTED") {
    return decisionBase(request, lookup, "BLOCK", ["JURISDICTION_UNSUPPORTED"]);
  }
  if (policy.review_required) {
    return decisionBase(request, lookup, "REQUIRE_REVIEW", ["POLICY_REVIEW_REQUIRED"]);
  }
  const marketingRestriction = relevantMarketingRestriction(policy, request);
  if (marketingRestriction === "HUMAN_REVIEW_REQUIRED" || marketingRestriction === "UNINTERPRETED_LOCAL_MARKETING_RESTRICTION") {
    return decisionBase(request, lookup, "REQUIRE_REVIEW", [marketingRestriction]);
  }
  if (marketingRestriction) {
    return decisionBase(request, lookup, "BLOCK", [marketingRestriction]);
  }

  const classification = classifyProductRequest(request);
  if (!classification.product) {
    return decisionBase(request, lookup, "BLOCK", ["PRODUCT_CLASSIFICATION_UNKNOWN"]);
  }
  const allowedProducts = modeProducts(policy);
  if (policy.mode === "VIEW_ONLY") {
    return decisionBase(request, lookup, "BLOCK", ["VIEW_ONLY_JURISDICTION"]);
  }
  if (!allowedProducts.includes(classification.product)) {
    return decisionBase(request, lookup, "BLOCK", [
      classification.renamed_derivative ? "DERIVATIVE_RENAMING_CANNOT_BYPASS_POLICY" : "PRODUCT_NOT_ALLOWED",
      `PRODUCT_${classification.product}_BLOCKED`
    ]);
  }

  const vulnerable = Boolean(request.financial_vulnerability_signal);
  if (vulnerable && (DERIVATIVES.has(classification.product) || REFERRAL_ACTIONS.has(request.action))) {
    return decisionBase(request, lookup, "BLOCK", [
      "FINANCIAL_VULNERABILITY_TRIGGERED",
      DERIVATIVES.has(classification.product)
        ? "HIGH_RISK_PRODUCT_PROMOTION_BLOCKED"
        : "REFERRAL_PRESSURE_DISABLED"
    ]);
  }
  if (request.autonomous_initial_send_requested) {
    return decisionBase(request, lookup, "BLOCK", ["AUTONOMOUS_INITIAL_MESSAGE_BLOCKED"]);
  }
  if (request.action === "RANK_CONTACTS" && (!request.contact_permission || request.contact_permission === "CONTACT_NONE")) {
    return decisionBase(request, lookup, "BLOCK", ["CONTACT_PERMISSION_REQUIRED"]);
  }
  if (request.action === "CREATE_REFERRAL_BINDING") {
    if (!policy.referral_allowed) {
      return decisionBase(request, lookup, "BLOCK", ["REFERRAL_NOT_ALLOWED"]);
    }
    if (request.external_beneficiary_requested && !request.human_principal_authorized_external_beneficiary) {
      return decisionBase(request, lookup, "REQUIRE_HUMAN_AUTH", ["EXTERNAL_BENEFICIARY_REQUIRES_HUMAN_AUTH"]);
    }
    if (request.referral_provenance === "AGENT_TO_AGENT" && !request.human_principal_authorized_external_beneficiary) {
      return decisionBase(request, lookup, "REQUIRE_HUMAN_AUTH", ["AGENT_TO_AGENT_HAS_NO_AUTOMATIC_ATTRIBUTION"]);
    }
  }
  if (request.agent_assisted_outreach_requested && !policy.agent_assisted_referral_allowed) {
    return decisionBase(request, lookup, "BLOCK", ["AGENT_ASSISTED_REFERRAL_NOT_ALLOWED"]);
  }

  const disclosures = new Set(policy.required_disclosures);
  if (DERIVATIVES.has(classification.product)) disclosures.add("DERIVATIVES_RISK");
  if (REFERRAL_ACTIONS.has(request.action) || classification.product === "REFERRAL") {
    disclosures.add("REFERRER_RECEIVES_0_05_BP");
  }
  if (request.token_denominated_reward) disclosures.add("TOKEN_VALUE_VARIABLE");

  let maxLeverage: number | null = null;
  if (classification.product === "PERPETUAL") {
    if (!validCap(policy.max_leverage)) {
      return decisionBase(request, lookup, "BLOCK", ["JURISDICTION_LEVERAGE_CAP_MISSING"]);
    }
    if (request.action === "CHANGE_LEVERAGE") {
      if (
        !validCap(request.user_leverage_cap)
        || !validCap(request.strategy_leverage_cap)
        || !validCap(request.protocol_leverage_cap)
      ) {
        return decisionBase(request, lookup, "REQUIRE_REVIEW", ["LEVERAGE_CAP_INPUT_MISSING"]);
      }
      maxLeverage = calculateEffectiveLeverageCap({
        jurisdiction_cap: policy.max_leverage,
        user_cap: request.user_leverage_cap,
        strategy_cap: request.strategy_leverage_cap,
        protocol_cap: request.protocol_leverage_cap
      });
    } else {
      maxLeverage = policy.max_leverage;
    }
  }

  let status: ComplianceDecisionStatus = disclosures.size ? "ALLOW_WITH_DISCLOSURE" : "ALLOW";
  if (request.action === "ENABLE_OPERATOR_SERVICE") status = "REQUIRE_HUMAN_AUTH";
  const referralMode = policy.referral_allowed ? "ONE_HOP" as const : "LINK_ONLY" as const;
  const outreachMode = policy.referral_allowed && policy.agent_assisted_referral_allowed
    ? "HUMAN_SEND_REQUIRED" as const
    : "DISABLED" as const;
  return {
    schema: "bitagent_compliance_decision_v1",
    status,
    compliance_state: "VERIFIED",
    trading_permission: TRADING_ACTIONS.has(request.action) ? "POLICY_ALLOWED" : "NONE",
    jurisdiction_mode: policy.mode,
    allowed_products: allowedProducts,
    max_leverage: maxLeverage,
    referral_mode: referralMode,
    outreach_mode: outreachMode,
    required_disclosures: [...disclosures],
    prohibited_claims: [...PROHIBITED_CLAIM_CODES],
    reason_codes: [
      "JURISDICTION_SUPPORTED",
      `${classification.product}_ALLOWED`,
      ...(classification.renamed_derivative ? ["ECONOMIC_EXPOSURE_CLASSIFIED_AS_DERIVATIVE"] : [])
    ],
    policy_version: policy.policy_version,
    policy_receipt_hash: lookup.policy_receipt_hash,
    evaluated_context_hash: contextHash(request, policy.policy_version),
    escalation: "NONE",
    view_only_available: true,
    financial_vulnerability_signal: vulnerable
  };
}

export async function evaluateCompliance(
  host: JurisdictionPolicyHost,
  request: ComplianceEvaluationRequest
): Promise<ComplianceDecision> {
  const lookup = await getJurisdictionPolicy(host, {
    residence_country: request.country_of_residence || "",
    current_location_country: request.current_location_country || "",
    user_type: request.user_type
  });
  return evaluateComplianceDecision(request, lookup);
}

export function requiresComplianceReevaluation(
  previous: ComplianceContextSnapshot,
  next: ComplianceContextSnapshot
): boolean {
  return previous.country_of_residence !== next.country_of_residence
    || previous.current_location_country !== next.current_location_country
    || previous.user_type !== next.user_type
    || previous.product_requested !== next.product_requested
    || previous.external_beneficiary_requested !== next.external_beneficiary_requested
    || previous.policy_version !== next.policy_version;
}

export function isDerivative(product: ProductCategory) {
  return DERIVATIVES.has(product);
}

export function modeAllowsPerpetuals(mode: JurisdictionMode) {
  return mode === "PERPS_ALLOWED";
}
