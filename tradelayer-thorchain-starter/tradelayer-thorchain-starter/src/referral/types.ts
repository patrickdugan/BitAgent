export enum BeneficiaryKind {
  SELF_AGENT = "SELF_AGENT",
  HUMAN_PRINCIPAL = "HUMAN_PRINCIPAL",
  ORGANIZATION_PRINCIPAL = "ORGANIZATION_PRINCIPAL"
}

export enum AcquisitionMode {
  SELF_INSTALL = "SELF_INSTALL",
  HUMAN_MANUAL_SHARE = "HUMAN_MANUAL_SHARE",
  AGENT_ASSISTED_SHARE = "AGENT_ASSISTED_SHARE",
  AGENT_TO_AGENT = "AGENT_TO_AGENT"
}

export enum InvitationActor {
  HUMAN = "HUMAN",
  AGENT_ASSISTED = "AGENT_ASSISTED",
  AGENT_AUTOMATED_INTERNAL = "AGENT_AUTOMATED_INTERNAL"
}

export type ReferralBindingStatus =
  | "PENDING"
  | "ACTIVE"
  | "EXPIRED"
  | "REPLACED"
  | "RECOVERED";

export type CanonicalChainStatus = "UNANCHORED" | "CANONICAL" | "REORGED";

export type ReferralBinding = {
  id: string;
  referee_principal_id: string;
  referee_agent_id: string;
  beneficiary_principal_id: string;
  source_agent_id?: string;
  beneficiary_kind: BeneficiaryKind;
  acquisition_mode: AcquisitionMode;
  invitation_actor: InvitationActor;
  policy_version: string;
  created_at: string;
  first_eligible_trade_height: number | null;
  start_height: number | null;
  expiry_height: number | null;
  status: ReferralBindingStatus;
  canonical_chain_status: CanonicalChainStatus;
  signature?: string;
  invitation_id?: string;
  contact_access_authorized_by_principal_id?: string;
  message_preparation_authorized_by_principal_id?: string;
  final_send_actor: "HUMAN" | null;
  replaced_binding_id?: string;
};

export type FeeAccumulatorState = {
  fee_asset: string;
  cumulative_eligible_notional_atomic: string;
  cumulative_total_fee_atomic: string;
  cumulative_maker_reward_atomic: string;
  cumulative_sponsor_credit_atomic: string;
  cumulative_protocol_revenue_atomic: string;
};

export type ReferralAccrual = {
  binding_id: string;
  trade_id: string;
  block_height: number;
  eligible_notional_atomic: string;
  fee_asset: string;
  total_fee_atomic: string;
  maker_reward_atomic: string;
  sponsor_credit_atomic: string;
  protocol_revenue_atomic: string;
  fee_value_at_accrual_atomic: string;
  vesting_token_units: string;
  vested_token_units: string;
  unvested_token_units: string;
  current_estimated_token_value_atomic: string;
  evidence_refs: string[];
  reversed: boolean;
  reversal_reason?: "REFUND" | "REVERT" | "FAILURE" | "REORG";
  rounding_state_before: FeeAccumulatorState;
  rounding_state_after: FeeAccumulatorState;
};

export type VestingAssignment = {
  assignment_id: string;
  binding_id: string;
  trade_id: string;
  beneficiary_principal_id: string;
  fee_asset: string;
  fee_value_at_accrual_atomic: string;
  token_units_assigned: string;
  vested_token_units: string;
  unvested_token_units: string;
  current_estimated_token_value_atomic: string;
  principal_controlled: true;
  agent_spend_authority: false;
  status: "ASSIGNED" | "REVERSED";
  assigned_at: string;
  reversed_at?: string;
};

export type InvitationRecord = {
  invitation_id: string;
  referrer_principal_id: string;
  source_agent_id?: string;
  beneficiary_kind: BeneficiaryKind.HUMAN_PRINCIPAL | BeneficiaryKind.ORGANIZATION_PRINCIPAL;
  acquisition_mode: AcquisitionMode.HUMAN_MANUAL_SHARE | AcquisitionMode.AGENT_ASSISTED_SHARE;
  invitation_actor: InvitationActor.HUMAN | InvitationActor.AGENT_ASSISTED;
  policy_version: string;
  issued_at: string;
  expires_at: string;
  signature: string;
  status: "ISSUED" | "BOUND" | "REVOKED" | "EXPIRED";
  coarse_status:
    | "invitation_prepared"
    | "human_sent"
    | "link_opened"
    | "onboarding_started"
    | "activated"
    | "expired";
};

export type AdministrativeRecoveryAction = {
  recovery_id: string;
  binding_id: string;
  operator_principal_id: string;
  reason: "FRAUD" | "KEY_COMPROMISE" | "INVALID_SIGNATURE";
  replacement_beneficiary_principal_id: string;
  replacement_beneficiary_kind: BeneficiaryKind;
  approval_receipt_hash: string;
  signature: string;
  occurred_at: string;
};

export type ReferralRegistryState = {
  schema: "bitagent_referral_registry_v1";
  bindings: ReferralBinding[];
  invitations: InvitationRecord[];
  accruals: ReferralAccrual[];
  vesting_assignments: VestingAssignment[];
  fee_accumulators: Record<string, FeeAccumulatorState>;
  recovery_actions: AdministrativeRecoveryAction[];
};

export type EligibleSettledTrade = {
  trade_id: string;
  referee_principal_id: string;
  block_height: number;
  eligible_notional_atomic: string;
  fee_asset: string;
  canonical: true;
  settled: true;
  fee_bearing: true;
  evidence_refs: string[];
};

export const CONTACT_LABELS = [
  "interested_in_crypto",
  "interested_in_markets",
  "interested_in_side_income",
  "owns_pc",
  "phone_only",
  "android_user",
  "needs_local_language",
  "trusted_relationship",
  "likely_to_try_recommendation",
  "needs_setup_help",
  "experienced_wallet_user",
  "never_invite"
] as const;

export type ContactLabel = (typeof CONTACT_LABELS)[number];

export type CampaignState =
  | "candidate"
  | "drafted"
  | "share_prepared"
  | "human_sent"
  | "follow_up_approved"
  | "follow_up_sent"
  | "not_interested"
  | "do_not_contact";

export type LocalContactCandidate = {
  local_hashed_id: string;
  display_name_local_only: string;
  selected_channel_local_only?: "sms" | "email" | "whatsapp" | "signal" | "other";
  user_labels: ContactLabel[];
  relationship_strength: 0 | 1 | 2 | 3;
  predicted_activation_probability: string;
  predicted_notional_band: "LOW" | "MEDIUM" | "HIGH";
  onboarding_effort: number;
  relationship_cost: number;
  score: number;
  explanation: string;
  campaign_state: CampaignState;
};

export type NativeShareAction = {
  schema: "bitagent_native_share_action_v1";
  title: string;
  text: string;
  url?: string;
  effect: "none";
  requires_human_os_action: true;
  initial_send_performed: false;
  allowed_channels: ["sms", "email", "whatsapp", "signal", "other"];
};
