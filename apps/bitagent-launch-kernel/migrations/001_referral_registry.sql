PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS referral_bindings (
  id TEXT PRIMARY KEY,
  referee_principal_id TEXT NOT NULL,
  referee_agent_id TEXT NOT NULL,
  beneficiary_principal_id TEXT NOT NULL,
  source_agent_id TEXT,
  beneficiary_kind TEXT NOT NULL CHECK (beneficiary_kind IN ('SELF_AGENT', 'HUMAN_PRINCIPAL', 'ORGANIZATION_PRINCIPAL')),
  acquisition_mode TEXT NOT NULL CHECK (acquisition_mode IN ('SELF_INSTALL', 'HUMAN_MANUAL_SHARE', 'AGENT_ASSISTED_SHARE', 'AGENT_TO_AGENT')),
  invitation_actor TEXT NOT NULL CHECK (invitation_actor IN ('HUMAN', 'AGENT_ASSISTED', 'AGENT_AUTOMATED_INTERNAL')),
  policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  first_eligible_trade_height INTEGER,
  start_height INTEGER,
  expiry_height INTEGER,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'EXPIRED', 'REPLACED', 'RECOVERED')),
  canonical_chain_status TEXT NOT NULL CHECK (canonical_chain_status IN ('UNANCHORED', 'CANONICAL', 'REORGED')),
  signature TEXT,
  invitation_id TEXT,
  contact_access_authorized_by_principal_id TEXT,
  message_preparation_authorized_by_principal_id TEXT,
  final_send_actor TEXT CHECK (final_send_actor IS NULL OR final_send_actor = 'HUMAN'),
  replaced_binding_id TEXT REFERENCES referral_bindings(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS referral_binding_one_current_idx
ON referral_bindings (referee_principal_id)
WHERE status IN ('PENDING', 'ACTIVE');

CREATE TABLE IF NOT EXISTS referral_invitations (
  invitation_id TEXT PRIMARY KEY,
  referrer_principal_id TEXT NOT NULL,
  source_agent_id TEXT,
  beneficiary_kind TEXT NOT NULL CHECK (beneficiary_kind IN ('HUMAN_PRINCIPAL', 'ORGANIZATION_PRINCIPAL')),
  acquisition_mode TEXT NOT NULL CHECK (acquisition_mode IN ('HUMAN_MANUAL_SHARE', 'AGENT_ASSISTED_SHARE')),
  invitation_actor TEXT NOT NULL CHECK (invitation_actor IN ('HUMAN', 'AGENT_ASSISTED')),
  policy_version TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  signature TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ISSUED', 'BOUND', 'REVOKED', 'EXPIRED')),
  coarse_status TEXT NOT NULL CHECK (coarse_status IN ('invitation_prepared', 'human_sent', 'link_opened', 'onboarding_started', 'activated', 'expired'))
);

CREATE TABLE IF NOT EXISTS referral_fee_accumulators (
  fee_asset TEXT PRIMARY KEY,
  cumulative_eligible_notional_atomic TEXT NOT NULL,
  cumulative_total_fee_atomic TEXT NOT NULL,
  cumulative_maker_reward_atomic TEXT NOT NULL,
  cumulative_sponsor_credit_atomic TEXT NOT NULL,
  cumulative_protocol_revenue_atomic TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS referral_accruals (
  trade_id TEXT PRIMARY KEY,
  binding_id TEXT NOT NULL REFERENCES referral_bindings(id),
  block_height INTEGER NOT NULL,
  eligible_notional_atomic TEXT NOT NULL,
  fee_asset TEXT NOT NULL,
  total_fee_atomic TEXT NOT NULL,
  maker_reward_atomic TEXT NOT NULL,
  sponsor_credit_atomic TEXT NOT NULL,
  protocol_revenue_atomic TEXT NOT NULL,
  fee_value_at_accrual_atomic TEXT NOT NULL,
  vesting_token_units TEXT NOT NULL,
  vested_token_units TEXT NOT NULL,
  unvested_token_units TEXT NOT NULL,
  current_estimated_token_value_atomic TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  reversed INTEGER NOT NULL DEFAULT 0 CHECK (reversed IN (0, 1)),
  reversal_reason TEXT CHECK (reversal_reason IS NULL OR reversal_reason IN ('REFUND', 'REVERT', 'FAILURE', 'REORG')),
  rounding_state_before_json TEXT NOT NULL,
  rounding_state_after_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS referral_vesting_assignments (
  assignment_id TEXT PRIMARY KEY,
  binding_id TEXT NOT NULL REFERENCES referral_bindings(id),
  trade_id TEXT NOT NULL UNIQUE REFERENCES referral_accruals(trade_id),
  beneficiary_principal_id TEXT NOT NULL,
  fee_asset TEXT NOT NULL,
  fee_value_at_accrual_atomic TEXT NOT NULL,
  token_units_assigned TEXT NOT NULL,
  vested_token_units TEXT NOT NULL,
  unvested_token_units TEXT NOT NULL,
  current_estimated_token_value_atomic TEXT NOT NULL,
  principal_controlled INTEGER NOT NULL CHECK (principal_controlled = 1),
  agent_spend_authority INTEGER NOT NULL CHECK (agent_spend_authority = 0),
  status TEXT NOT NULL CHECK (status IN ('ASSIGNED', 'REVERSED')),
  assigned_at TEXT NOT NULL,
  reversed_at TEXT
);

CREATE TABLE IF NOT EXISTS referral_recovery_actions (
  recovery_id TEXT PRIMARY KEY,
  binding_id TEXT NOT NULL REFERENCES referral_bindings(id),
  operator_principal_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('FRAUD', 'KEY_COMPROMISE', 'INVALID_SIGNATURE')),
  replacement_beneficiary_principal_id TEXT NOT NULL,
  replacement_beneficiary_kind TEXT NOT NULL,
  approval_receipt_hash TEXT NOT NULL,
  signature TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

-- Deliberately absent: contact names, phone numbers, emails, photos, address-book
-- membership, message text, recipient identity graphs, model IDs, strategies,
-- wallet configuration, tool permissions, and RPC endpoints.
