export const PRODUCT_CATEGORIES = [
  "SPOT",
  "PERPETUAL",
  "FUTURE",
  "OPTION",
  "LENDING",
  "BORROWING",
  "STAKING",
  "LIQUIDITY_PROVISION",
  "COPY_STRATEGY",
  "AUTOMATED_STRATEGY",
  "BRIDGE",
  "SWAP",
  "PAYMENT",
  "REFERRAL",
  "COMPUTE_SERVICE"
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export type UserType = "retail" | "professional" | "institution" | "unknown";
export type AgeEligibility = "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";
export type CustodyModel = "SELF_CUSTODY" | "CUSTODIAL" | "HYBRID" | "UNKNOWN";
export type JurisdictionMode =
  | "PERPS_ALLOWED"
  | "PERPS_RESTRICTED"
  | "SPOT_ONLY"
  | "VIEW_ONLY"
  | "UNSUPPORTED";

export type ComplianceAction =
  | "ENABLE_PRODUCT"
  | "CHANGE_LEVERAGE"
  | "CREATE_REFERRAL_BINDING"
  | "RANK_CONTACTS"
  | "PREPARE_FINANCIAL_PROMOTION"
  | "ENABLE_OPERATOR_SERVICE"
  | "START_AGENT_ASSISTED_OUTREACH"
  | "CHANGE_COUNTRY"
  | "CHANGE_USER_TYPE";

export type ContactPermission =
  | "CONTACT_NONE"
  | "CONTACT_PICK_ONE"
  | "CONTACT_PICK_MULTIPLE"
  | "CONTACT_LOCAL_RANKING"
  | "CONTACT_FULL_LOCAL_SCAN";

export type ReferralProvenance =
  | "SELF_AGENT"
  | "HUMAN_REFERRED"
  | "AGENT_ASSISTED_HUMAN_REFERRAL"
  | "SERVICE_OPERATOR_REFERRED"
  | "AGENT_TO_AGENT";

export type JurisdictionPolicy = {
  residence_country: string;
  current_location_country: string;
  user_type: UserType;
  supported: boolean;
  mode: JurisdictionMode;
  max_leverage: number | null;
  referral_allowed: boolean;
  agent_assisted_referral_allowed: boolean;
  local_marketing_restrictions: string[];
  required_disclosures: string[];
  product_restrictions: ProductCategory[];
  explicitly_allowed_products?: ProductCategory[];
  review_required: boolean;
  policy_version: string;
};

export type SignedJurisdictionPolicyEnvelope = {
  schema: "bitagent_signed_jurisdiction_policy_v1";
  policy: JurisdictionPolicy;
  key_id: string;
  issued_at: string;
  expires_at: string;
  signature: string;
};

export type JurisdictionPolicyServiceResult =
  | { status: "OK"; envelope: SignedJurisdictionPolicyEnvelope }
  | { status: "UNKNOWN" | "ERROR"; reason_code?: string };

export type JurisdictionPolicyQuery = {
  residence_country: string;
  current_location_country: string;
  user_type: UserType;
};

export type JurisdictionPolicyLookupReceipt = {
  schema: "bitagent_jurisdiction_policy_lookup_v1";
  authority: "deterministic_policy_service";
  effect: "none";
  status: "OK" | "UNKNOWN" | "ERROR" | "EXPIRED" | "INVALID_SIGNATURE" | "BINDING_MISMATCH";
  checked_at: string;
  query: JurisdictionPolicyQuery;
  policy: JurisdictionPolicy | null;
  policy_version: string | null;
  policy_expires_at: string | null;
  policy_receipt_hash: string | null;
  key_id: string | null;
  reason_codes: string[];
};

export type ComplianceEvaluationRequest = {
  action: ComplianceAction;
  country_of_residence?: string;
  current_location_country?: string;
  age_eligibility: AgeEligibility;
  product_requested: string;
  product_description?: string;
  custody_model: CustodyModel;
  user_type: UserType;
  expected_policy_version?: string;
  user_leverage_cap?: number;
  strategy_leverage_cap?: number;
  protocol_leverage_cap?: number;
  contact_permission?: ContactPermission;
  referral_provenance?: ReferralProvenance;
  external_beneficiary_requested?: boolean;
  human_principal_authorized_external_beneficiary?: boolean;
  agent_assisted_outreach_requested?: boolean;
  autonomous_initial_send_requested?: boolean;
  token_denominated_reward?: boolean;
  financial_vulnerability_signal?: boolean;
};

export type ComplianceDecisionStatus =
  | "ALLOW"
  | "ALLOW_WITH_DISCLOSURE"
  | "REQUIRE_HUMAN_AUTH"
  | "REQUIRE_REVIEW"
  | "BLOCK";

export type ComplianceDecision = {
  schema: "bitagent_compliance_decision_v1";
  status: ComplianceDecisionStatus;
  compliance_state: "VERIFIED" | "UNKNOWN" | "BLOCKED";
  trading_permission: "NONE" | "POLICY_ALLOWED";
  jurisdiction_mode: JurisdictionMode | "UNKNOWN";
  allowed_products: ProductCategory[];
  max_leverage: number | null;
  referral_mode: "LINK_ONLY" | "ONE_HOP" | "BLOCKED";
  outreach_mode: "HUMAN_SEND_REQUIRED" | "DISABLED";
  required_disclosures: string[];
  prohibited_claims: string[];
  reason_codes: string[];
  policy_version: string | null;
  policy_expires_at: string | null;
  policy_receipt_hash: string | null;
  evaluated_context_hash: string;
  escalation: "NONE" | "REQUIRED";
  view_only_available: true;
  financial_vulnerability_signal: boolean;
};

export type ComplianceContextSnapshot = Pick<
  ComplianceEvaluationRequest,
  | "country_of_residence"
  | "current_location_country"
  | "user_type"
  | "product_requested"
  | "external_beneficiary_requested"
> & { policy_version: string | null };

export type JurisdictionPolicyHost = {
  getJurisdictionPolicy(
    query: JurisdictionPolicyQuery
  ): Promise<JurisdictionPolicyServiceResult> | JurisdictionPolicyServiceResult;
  verifyPolicyEnvelope(
    envelope: SignedJurisdictionPolicyEnvelope
  ): Promise<boolean> | boolean;
  now(): Date;
};
