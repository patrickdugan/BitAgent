import { evaluateCompliance, getJurisdictionPolicy } from "./policy.js";
import type {
  ComplianceDecision,
  ComplianceEvaluationRequest,
  JurisdictionPolicyHost,
  JurisdictionPolicyLookupReceipt,
  JurisdictionPolicyQuery,
  UserType
} from "./types.js";

type JsonSchema = {
  type: "object";
  additionalProperties: false;
  required: string[];
  properties: Record<string, Record<string, unknown>>;
};

export const complianceToolSchemas: Record<string, JsonSchema> = {
  get_jurisdiction_policy: {
    type: "object",
    additionalProperties: false,
    required: ["residence_country", "current_location_country", "user_type"],
    properties: {
      residence_country: { type: "string", pattern: "^[A-Za-z]{2}$" },
      current_location_country: { type: "string", pattern: "^[A-Za-z]{2}$" },
      user_type: { type: "string", enum: ["retail", "professional", "institution", "unknown"] }
    }
  },
  "bitagent.compliance.evaluate": {
    type: "object",
    additionalProperties: false,
    required: [
      "action",
      "country_of_residence",
      "current_location_country",
      "age_eligibility",
      "product_requested",
      "custody_model",
      "user_type"
    ],
    properties: {
      action: {
        type: "string",
        enum: ["ENABLE_PRODUCT", "CHANGE_LEVERAGE", "CREATE_REFERRAL_BINDING", "RANK_CONTACTS", "PREPARE_FINANCIAL_PROMOTION", "ENABLE_OPERATOR_SERVICE", "START_AGENT_ASSISTED_OUTREACH", "CHANGE_COUNTRY", "CHANGE_USER_TYPE"]
      },
      country_of_residence: { type: "string", pattern: "^[A-Za-z]{2}$" },
      current_location_country: { type: "string", pattern: "^[A-Za-z]{2}$" },
      age_eligibility: { type: "string", enum: ["ELIGIBLE", "INELIGIBLE", "UNKNOWN"] },
      product_requested: { type: "string", minLength: 1, maxLength: 64 },
      product_description: { type: "string", maxLength: 512 },
      custody_model: { type: "string", enum: ["SELF_CUSTODY", "CUSTODIAL", "HYBRID", "UNKNOWN"] },
      user_type: { type: "string", enum: ["retail", "professional", "institution", "unknown"] },
      expected_policy_version: { type: "string", minLength: 1, maxLength: 128 },
      user_leverage_cap: { type: "number", exclusiveMinimum: 0 },
      strategy_leverage_cap: { type: "number", exclusiveMinimum: 0 },
      protocol_leverage_cap: { type: "number", exclusiveMinimum: 0 },
      contact_permission: { type: "string", enum: ["CONTACT_NONE", "CONTACT_PICK_ONE", "CONTACT_PICK_MULTIPLE", "CONTACT_LOCAL_RANKING", "CONTACT_FULL_LOCAL_SCAN"] },
      referral_provenance: { type: "string", enum: ["SELF_AGENT", "HUMAN_REFERRED", "AGENT_ASSISTED_HUMAN_REFERRAL", "SERVICE_OPERATOR_REFERRED", "AGENT_TO_AGENT"] },
      external_beneficiary_requested: { type: "boolean" },
      human_principal_authorized_external_beneficiary: { type: "boolean" },
      agent_assisted_outreach_requested: { type: "boolean" },
      autonomous_initial_send_requested: { type: "boolean" },
      token_denominated_reward: { type: "boolean" },
      financial_vulnerability_signal: { type: "boolean" }
    }
  }
};

export class ComplianceToolError extends Error {
  constructor(readonly code: "unknown_tool" | "invalid_arguments", message: string) {
    super(message);
    this.name = "ComplianceToolError";
  }
}

const USER_TYPES = new Set<UserType>(["retail", "professional", "institution", "unknown"]);
const ARGUMENT_KEYS = new Set(["residence_country", "current_location_country", "user_type"]);
const ACTIONS = new Set(["ENABLE_PRODUCT", "CHANGE_LEVERAGE", "CREATE_REFERRAL_BINDING", "RANK_CONTACTS", "PREPARE_FINANCIAL_PROMOTION", "ENABLE_OPERATOR_SERVICE", "START_AGENT_ASSISTED_OUTREACH", "CHANGE_COUNTRY", "CHANGE_USER_TYPE"]);
const AGE_STATES = new Set(["ELIGIBLE", "INELIGIBLE", "UNKNOWN"]);
const CUSTODY_MODELS = new Set(["SELF_CUSTODY", "CUSTODIAL", "HYBRID", "UNKNOWN"]);
const CONTACT_PERMISSIONS = new Set(["CONTACT_NONE", "CONTACT_PICK_ONE", "CONTACT_PICK_MULTIPLE", "CONTACT_LOCAL_RANKING", "CONTACT_FULL_LOCAL_SCAN"]);
const REFERRAL_PROVENANCE = new Set(["SELF_AGENT", "HUMAN_REFERRED", "AGENT_ASSISTED_HUMAN_REFERRAL", "SERVICE_OPERATOR_REFERRED", "AGENT_TO_AGENT"]);
const EVALUATION_KEYS = new Set(Object.keys(complianceToolSchemas["bitagent.compliance.evaluate"]!.properties));

function parseQuery(args: Record<string, unknown>): JurisdictionPolicyQuery {
  const unexpected = Object.keys(args).filter((key) => !ARGUMENT_KEYS.has(key));
  if (unexpected.length) {
    throw new ComplianceToolError("invalid_arguments", `Policy query contains unexpected fields: ${unexpected.join(", ")}`);
  }
  const residence = String(args.residence_country || "").trim().toUpperCase();
  const location = String(args.current_location_country || "").trim().toUpperCase();
  const userType = String(args.user_type || "") as UserType;
  if (!/^[A-Z]{2}$/.test(residence) || !/^[A-Z]{2}$/.test(location) || !USER_TYPES.has(userType)) {
    throw new ComplianceToolError(
      "invalid_arguments",
      "residence_country/current_location_country must be ISO alpha-2 and user_type must be recognized"
    );
  }
  return {
    residence_country: residence,
    current_location_country: location,
    user_type: userType
  };
}

function parseEvaluation(args: Record<string, unknown>): ComplianceEvaluationRequest {
  const unexpected = Object.keys(args).filter((key) => !EVALUATION_KEYS.has(key));
  if (unexpected.length) {
    throw new ComplianceToolError("invalid_arguments", `Compliance evaluation contains unexpected fields: ${unexpected.join(", ")}`);
  }
  const required = complianceToolSchemas["bitagent.compliance.evaluate"]!.required;
  const missing = required.filter((key) => args[key] === undefined);
  if (missing.length) throw new ComplianceToolError("invalid_arguments", `Compliance evaluation is missing: ${missing.join(", ")}`);
  if (!ACTIONS.has(String(args.action)) || !AGE_STATES.has(String(args.age_eligibility))
    || !CUSTODY_MODELS.has(String(args.custody_model)) || !USER_TYPES.has(String(args.user_type) as UserType)) {
    throw new ComplianceToolError("invalid_arguments", "Compliance evaluation contains an unsupported enum value");
  }
  const product = String(args.product_requested || "");
  if (!product || product.length > 64) throw new ComplianceToolError("invalid_arguments", "product_requested is invalid");
  const residence = String(args.country_of_residence || "").trim();
  const location = String(args.current_location_country || "").trim();
  if (!/^[A-Za-z]{2}$/.test(residence) || !/^[A-Za-z]{2}$/.test(location)) {
    throw new ComplianceToolError("invalid_arguments", "Country fields must be ISO alpha-2 codes");
  }
  if (args.product_description !== undefined && (typeof args.product_description !== "string" || args.product_description.length > 512)) {
    throw new ComplianceToolError("invalid_arguments", "product_description is invalid");
  }
  if (args.expected_policy_version !== undefined
    && (typeof args.expected_policy_version !== "string" || !args.expected_policy_version || args.expected_policy_version.length > 128)) {
    throw new ComplianceToolError("invalid_arguments", "expected_policy_version is invalid");
  }
  if (args.contact_permission !== undefined && !CONTACT_PERMISSIONS.has(String(args.contact_permission))) {
    throw new ComplianceToolError("invalid_arguments", "contact_permission is invalid");
  }
  if (args.referral_provenance !== undefined && !REFERRAL_PROVENANCE.has(String(args.referral_provenance))) {
    throw new ComplianceToolError("invalid_arguments", "referral_provenance is invalid");
  }
  for (const field of [
    "external_beneficiary_requested",
    "human_principal_authorized_external_beneficiary",
    "agent_assisted_outreach_requested",
    "autonomous_initial_send_requested",
    "token_denominated_reward",
    "financial_vulnerability_signal"
  ]) {
    if (args[field] !== undefined && typeof args[field] !== "boolean") {
      throw new ComplianceToolError("invalid_arguments", `${field} must be boolean`);
    }
  }
  for (const field of ["user_leverage_cap", "strategy_leverage_cap", "protocol_leverage_cap"]) {
    if (args[field] !== undefined && (typeof args[field] !== "number" || !Number.isFinite(args[field]) || Number(args[field]) <= 0)) {
      throw new ComplianceToolError("invalid_arguments", `${field} must be a positive finite number`);
    }
  }
  return structuredClone(args) as ComplianceEvaluationRequest;
}

export class ComplianceToolRegistry {
  constructor(private readonly host: JurisdictionPolicyHost) {}

  async call(
    name: "get_jurisdiction_policy",
    args: Record<string, unknown>
  ): Promise<JurisdictionPolicyLookupReceipt>;
  async call(
    name: "bitagent.compliance.evaluate",
    args: Record<string, unknown>
  ): Promise<ComplianceDecision>;
  async call(name: string, args: Record<string, unknown>): Promise<JurisdictionPolicyLookupReceipt | ComplianceDecision>;
  async call(name: string, args: Record<string, unknown>): Promise<JurisdictionPolicyLookupReceipt | ComplianceDecision> {
    if (name === "get_jurisdiction_policy") return getJurisdictionPolicy(this.host, parseQuery(args));
    if (name === "bitagent.compliance.evaluate") return evaluateCompliance(this.host, parseEvaluation(args));
    throw new ComplianceToolError("unknown_tool", `Unknown compliance tool: ${name}`);
  }
}
