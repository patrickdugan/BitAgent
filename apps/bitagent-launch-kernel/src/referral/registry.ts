import { createHash } from "node:crypto";
import { REFERRAL_POLICY_VERSION, REFERRAL_TERM_BLOCKS } from "./config.js";
import { accrueFeeSplit, emptyFeeAccumulator } from "./economics.js";
import type { ReferralRegistryStore } from "./store.js";
import {
  AcquisitionMode,
  BeneficiaryKind,
  InvitationActor,
  type AdministrativeRecoveryAction,
  type EligibleSettledTrade,
  type InvitationRecord,
  type ReferralAccrual,
  type ReferralBinding,
  type ReferralRegistryState
} from "./types.js";
import type { PrincipalVestingSink } from "./vesting.js";

function id(prefix: string, material: unknown) {
  return `${prefix}_${createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 32)}`;
}

function positiveInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
}

function requireId(value: string, field: string) {
  const normalized = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(normalized)
    || ["__proto__", "prototype", "constructor"].includes(normalized)) throw new Error(`${field} is malformed`);
  return normalized;
}

function currentBinding(state: ReferralRegistryState, refereePrincipalId: string) {
  return [...state.bindings]
    .reverse()
    .find((binding) => binding.referee_principal_id === refereePrincipalId
      && ["PENDING", "ACTIVE"].includes(binding.status));
}

function createSelfBinding(input: {
  state: ReferralRegistryState;
  refereePrincipalId: string;
  refereeAgentId: string;
  now: Date;
  replacedBindingId?: string;
}) {
  const material = {
    referee: input.refereePrincipalId,
    agent: input.refereeAgentId,
    createdAt: input.now.toISOString(),
    sequence: input.state.bindings.length
  };
  const binding: ReferralBinding = {
    id: id("binding", material),
    referee_principal_id: input.refereePrincipalId,
    referee_agent_id: input.refereeAgentId,
    beneficiary_principal_id: input.refereePrincipalId,
    source_agent_id: input.refereeAgentId,
    beneficiary_kind: BeneficiaryKind.SELF_AGENT,
    acquisition_mode: AcquisitionMode.SELF_INSTALL,
    invitation_actor: InvitationActor.HUMAN,
    policy_version: REFERRAL_POLICY_VERSION,
    created_at: input.now.toISOString(),
    first_eligible_trade_height: null,
    start_height: null,
    expiry_height: null,
    status: "PENDING",
    canonical_chain_status: "UNANCHORED",
    final_send_actor: null,
    replaced_binding_id: input.replacedBindingId
  };
  input.state.bindings.push(binding);
  return binding;
}

function expireAtHeight(state: ReferralRegistryState, binding: ReferralBinding, height: number, now: Date) {
  if (binding.status !== "ACTIVE" || binding.expiry_height === null || height < binding.expiry_height) return binding;
  binding.status = "EXPIRED";
  const invitation = binding.invitation_id
    ? state.invitations.find((row) => row.invitation_id === binding.invitation_id)
    : undefined;
  if (invitation) {
    invitation.status = "EXPIRED";
    invitation.coarse_status = "expired";
  }
  return createSelfBinding({
    state,
    refereePrincipalId: binding.referee_principal_id,
    refereeAgentId: binding.referee_agent_id,
    now,
    replacedBindingId: binding.id
  });
}

function activate(binding: ReferralBinding, height: number) {
  if (binding.status !== "PENDING") return;
  binding.first_eligible_trade_height = height;
  binding.start_height = height;
  binding.expiry_height = height + REFERRAL_TERM_BLOCKS;
  binding.status = "ACTIVE";
  binding.canonical_chain_status = "CANONICAL";
}

export class ReferralRegistry {
  private operation: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: ReferralRegistryStore,
    private readonly vestingSink: PrincipalVestingSink,
    private readonly options: {
      now?: () => Date;
      verifyRecoverySignature?: (material: Omit<AdministrativeRecoveryAction, "recovery_id" | "occurred_at">) => boolean;
    } = {}
  ) {}

  private now() {
    return this.options.now?.() || new Date();
  }

  private transact<T>(fn: (state: ReferralRegistryState) => Promise<T> | T): Promise<T> {
    const next = this.operation.then(async () => {
      const state = await this.store.load();
      const result = await fn(state);
      await this.store.save(state);
      return result;
    });
    this.operation = next.catch(() => undefined);
    return next;
  }

  async getState() {
    await this.operation;
    return this.store.load();
  }

  createPrincipal(input: { principalId: string; agentId: string }) {
    return this.transact((state) => {
      const principalId = requireId(input.principalId, "principalId");
      const agentId = requireId(input.agentId, "agentId");
      const existing = currentBinding(state, principalId);
      if (existing) return structuredClone(existing);
      return structuredClone(createSelfBinding({ state, refereePrincipalId: principalId, refereeAgentId: agentId, now: this.now() }));
    });
  }

  registerInvitation(invitation: InvitationRecord) {
    return this.transact((state) => {
      if (state.invitations.some((row) => row.invitation_id === invitation.invitation_id)) {
        throw new Error("Invitation already exists");
      }
      state.invitations.push(structuredClone(invitation));
      return structuredClone(invitation);
    });
  }

  markInvitationStatus(
    invitationId: string,
    status: InvitationRecord["coarse_status"]
  ) {
    return this.transact((state) => {
      const invitation = state.invitations.find((row) => row.invitation_id === invitationId);
      if (!invitation) throw new Error("Unknown invitation");
      const order: InvitationRecord["coarse_status"][] = [
        "invitation_prepared", "human_sent", "link_opened", "onboarding_started", "activated", "expired"
      ];
      if (order.indexOf(status) < order.indexOf(invitation.coarse_status)) {
        throw new Error("Invitation status cannot move backward");
      }
      invitation.coarse_status = status;
      return structuredClone(invitation);
    });
  }

  bindVerifiedInvitation(input: {
    invitationId: string;
    policyVersion: string;
    signature: string;
    refereePrincipalId: string;
    refereeAgentId: string;
    contactAccessAuthorizedByPrincipalId?: string;
    messagePreparationAuthorizedByPrincipalId?: string;
    finalSendActor: "HUMAN";
  }) {
    return this.transact((state) => {
      const now = this.now();
      const invitation = state.invitations.find((row) => row.invitation_id === input.invitationId);
      if (!invitation || invitation.status !== "ISSUED") throw new Error("Invitation is unavailable");
      if (Date.parse(invitation.expires_at) <= now.getTime()) {
        invitation.status = "EXPIRED";
        invitation.coarse_status = "expired";
        throw new Error("Invitation is expired");
      }
      if (invitation.policy_version !== input.policyVersion || invitation.signature !== input.signature) {
        throw new Error("Invitation policy or signature mismatch");
      }
      if (input.finalSendActor !== "HUMAN") throw new Error("A human must perform the final initial-message send");
      if (invitation.acquisition_mode === AcquisitionMode.AGENT_ASSISTED_SHARE
        && (input.contactAccessAuthorizedByPrincipalId !== invitation.referrer_principal_id
          || input.messagePreparationAuthorizedByPrincipalId !== invitation.referrer_principal_id)) {
        throw new Error("Agent-assisted contact access and drafting require the beneficiary human's authorization");
      }
      const refereePrincipalId = requireId(input.refereePrincipalId, "refereePrincipalId");
      const refereeAgentId = requireId(input.refereeAgentId, "refereeAgentId");
      let existing = currentBinding(state, refereePrincipalId);
      if (!existing) {
        existing = createSelfBinding({ state, refereePrincipalId, refereeAgentId, now });
      }
      if (existing.status !== "PENDING" || existing.first_eligible_trade_height !== null) {
        throw new Error("Referral binding is fixed after the first eligible settled trade");
      }
      existing.status = "REPLACED";
      const binding: ReferralBinding = {
        id: id("binding", { invitation: invitation.invitation_id, refereePrincipalId }),
        referee_principal_id: refereePrincipalId,
        referee_agent_id: refereeAgentId,
        beneficiary_principal_id: invitation.referrer_principal_id,
        source_agent_id: invitation.source_agent_id,
        beneficiary_kind: invitation.beneficiary_kind,
        acquisition_mode: invitation.acquisition_mode,
        invitation_actor: invitation.invitation_actor,
        policy_version: invitation.policy_version,
        created_at: now.toISOString(),
        first_eligible_trade_height: null,
        start_height: null,
        expiry_height: null,
        status: "PENDING",
        canonical_chain_status: "UNANCHORED",
        signature: invitation.signature,
        invitation_id: invitation.invitation_id,
        contact_access_authorized_by_principal_id: input.contactAccessAuthorizedByPrincipalId,
        message_preparation_authorized_by_principal_id: input.messagePreparationAuthorizedByPrincipalId,
        final_send_actor: input.finalSendActor,
        replaced_binding_id: existing.id
      };
      state.bindings.push(binding);
      invitation.status = "BOUND";
      invitation.coarse_status = "onboarding_started";
      return structuredClone(binding);
    });
  }

  advanceHeight(refereePrincipalId: string, blockHeight: number) {
    return this.transact((state) => {
      positiveInteger(blockHeight, "blockHeight");
      const binding = currentBinding(state, refereePrincipalId);
      if (!binding) throw new Error("Referee has no binding");
      return structuredClone(expireAtHeight(state, binding, blockHeight, this.now()));
    });
  }

  settleEligibleTrade(trade: EligibleSettledTrade): Promise<ReferralAccrual> {
    return this.transact(async (state) => {
      positiveInteger(trade.block_height, "block_height");
      if (!/^[1-9][0-9]*$/.test(trade.eligible_notional_atomic)) throw new Error("Eligible notional must be positive atomic units");
      if (!trade.canonical || !trade.settled || !trade.fee_bearing || trade.evidence_refs.length === 0) {
        throw new Error("Only evidenced canonical settled fee-bearing trades are eligible");
      }
      const duplicate = state.accruals.find((row) => row.trade_id === trade.trade_id);
      if (duplicate) return structuredClone(duplicate);
      let binding = currentBinding(state, trade.referee_principal_id);
      if (!binding) throw new Error("Referee has no self or referral binding");
      binding = expireAtHeight(state, binding, trade.block_height, this.now());
      activate(binding, trade.block_height);

      const previous = structuredClone(state.fee_accumulators[trade.fee_asset]
        || emptyFeeAccumulator(trade.fee_asset));
      const { split, next } = accrueFeeSplit(previous, trade.eligible_notional_atomic);
      const assignment = await this.vestingSink.prepareAssignment({
        bindingId: binding.id,
        tradeId: trade.trade_id,
        beneficiaryPrincipalId: binding.beneficiary_principal_id,
        feeAsset: trade.fee_asset,
        feeValueAtAccrualAtomic: split.sponsor_credit_atomic,
        now: this.now()
      });
      if (!assignment.principal_controlled || assignment.agent_spend_authority) {
        throw new Error("Referral vesting assignment must remain principal controlled");
      }
      const accrual: ReferralAccrual = {
        binding_id: binding.id,
        trade_id: requireId(trade.trade_id, "trade_id"),
        block_height: trade.block_height,
        eligible_notional_atomic: trade.eligible_notional_atomic,
        fee_asset: requireId(trade.fee_asset, "fee_asset"),
        ...split,
        fee_value_at_accrual_atomic: split.sponsor_credit_atomic,
        vesting_token_units: assignment.token_units_assigned,
        vested_token_units: assignment.vested_token_units,
        unvested_token_units: assignment.unvested_token_units,
        current_estimated_token_value_atomic: assignment.current_estimated_token_value_atomic,
        evidence_refs: [...new Set(trade.evidence_refs)].sort(),
        reversed: false,
        rounding_state_before: previous,
        rounding_state_after: next
      };
      state.fee_accumulators[trade.fee_asset] = next;
      state.accruals.push(accrual);
      state.vesting_assignments.push(assignment);
      const invitation = binding.invitation_id
        ? state.invitations.find((row) => row.invitation_id === binding.invitation_id)
        : undefined;
      if (invitation) invitation.coarse_status = "activated";
      return structuredClone(accrual);
    });
  }

  reverseCanonicalTrade(input: {
    tradeId: string;
    reason: "REFUND" | "REVERT" | "FAILURE" | "REORG";
  }) {
    return this.transact((state) => {
      const accrual = state.accruals.find((row) => row.trade_id === input.tradeId);
      if (!accrual) throw new Error("Unknown referral accrual");
      if (accrual.reversed) return structuredClone(accrual);
      const accrualIndex = state.accruals.indexOf(accrual);
      const later = state.accruals.slice(accrualIndex + 1)
        .find((row) => !row.reversed && row.fee_asset === accrual.fee_asset);
      if (later) throw new Error("Canonical rollback must reverse fee-asset accruals from newest to oldest");
      accrual.reversed = true;
      accrual.reversal_reason = input.reason;
      state.fee_accumulators[accrual.fee_asset] = structuredClone(accrual.rounding_state_before);
      const assignment = state.vesting_assignments.find((row) => row.trade_id === accrual.trade_id);
      if (!assignment) throw new Error("Vesting assignment is missing for accrual");
      assignment.status = "REVERSED";
      assignment.reversed_at = this.now().toISOString();
      const binding = state.bindings.find((row) => row.id === accrual.binding_id);
      if (!binding) throw new Error("Binding is missing for accrual");
      const remaining = state.accruals.filter((row) => row.binding_id === binding.id && !row.reversed);
      if (remaining.length === 0) {
        binding.first_eligible_trade_height = null;
        binding.start_height = null;
        binding.expiry_height = null;
        binding.status = "PENDING";
        binding.canonical_chain_status = "REORGED";
        const invitation = binding.invitation_id
          ? state.invitations.find((row) => row.invitation_id === binding.invitation_id)
          : undefined;
        if (invitation) invitation.coarse_status = "onboarding_started";
      }
      return structuredClone(accrual);
    });
  }

  administrativeRecovery(input: {
    bindingId: string;
    operatorPrincipalId: string;
    reason: AdministrativeRecoveryAction["reason"];
    replacementBeneficiaryPrincipalId: string;
    replacementBeneficiaryKind: BeneficiaryKind;
    replacementSourceAgentId?: string;
    approvalReceiptHash: string;
    signature: string;
  }) {
    return this.transact((state) => {
      const now = this.now();
      const binding = state.bindings.find((row) => row.id === input.bindingId);
      if (!binding || !["PENDING", "ACTIVE"].includes(binding.status)) throw new Error("Binding is not recoverable");
      const material = {
        binding_id: input.bindingId,
        operator_principal_id: requireId(input.operatorPrincipalId, "operatorPrincipalId"),
        reason: input.reason,
        replacement_beneficiary_principal_id: requireId(input.replacementBeneficiaryPrincipalId, "replacementBeneficiaryPrincipalId"),
        replacement_beneficiary_kind: input.replacementBeneficiaryKind,
        approval_receipt_hash: input.approvalReceiptHash,
        signature: input.signature
      };
      if (!/^[a-f0-9]{64}$/.test(input.approvalReceiptHash)
        || !this.options.verifyRecoverySignature?.(material)) {
        throw new Error("Administrative recovery signature or approval receipt is invalid");
      }
      binding.status = "RECOVERED";
      const self = input.replacementBeneficiaryKind === BeneficiaryKind.SELF_AGENT;
      const replacement: ReferralBinding = {
        ...binding,
        id: id("binding", { recovery: input.approvalReceiptHash, previous: binding.id }),
        beneficiary_principal_id: input.replacementBeneficiaryPrincipalId,
        beneficiary_kind: input.replacementBeneficiaryKind,
        acquisition_mode: self ? AcquisitionMode.SELF_INSTALL : AcquisitionMode.HUMAN_MANUAL_SHARE,
        invitation_actor: InvitationActor.HUMAN,
        source_agent_id: self ? binding.referee_agent_id : input.replacementSourceAgentId,
        created_at: now.toISOString(),
        status: binding.start_height === null ? "PENDING" : "ACTIVE",
        signature: input.signature,
        invitation_id: undefined,
        replaced_binding_id: binding.id,
        final_send_actor: self ? null : "HUMAN"
      };
      state.bindings.push(replacement);
      const action: AdministrativeRecoveryAction = {
        recovery_id: id("recovery", material),
        ...material,
        occurred_at: now.toISOString()
      };
      state.recovery_actions.push(action);
      return { binding: structuredClone(replacement), action: structuredClone(action) };
    });
  }

  async dashboard(refereePrincipalId: string, blockHeight: number) {
    await this.advanceHeight(refereePrincipalId, blockHeight);
    const state = await this.getState();
    const binding = currentBinding(state, refereePrincipalId);
    if (!binding) throw new Error("Referee has no current binding");
    const assignments = state.vesting_assignments.filter((row) =>
      row.beneficiary_principal_id === refereePrincipalId && row.status === "ASSIGNED");
    const sum = (field: keyof Pick<typeof assignments[number],
      "fee_value_at_accrual_atomic" | "token_units_assigned" | "vested_token_units" | "unvested_token_units" | "current_estimated_token_value_atomic">) =>
      assignments.reduce((total, row) => total + BigInt(row[field]), 0n).toString();
    return {
      policy_version: REFERRAL_POLICY_VERSION,
      sponsor_credit_ppm: "5",
      current_binding: structuredClone(binding),
      term_progress_blocks: binding.start_height === null || binding.expiry_height === null
        ? null
        : {
          start_height: binding.start_height,
          expiry_height: binding.expiry_height,
          elapsed: Math.max(0, Math.min(blockHeight, binding.expiry_height) - binding.start_height),
          total: binding.expiry_height - binding.start_height
        },
      earnings: {
        fee_value_at_accrual_atomic: sum("fee_value_at_accrual_atomic"),
        token_units_assigned: sum("token_units_assigned"),
        vested_token_units: sum("vested_token_units"),
        unvested_token_units: sum("unvested_token_units"),
        current_estimated_token_value_atomic: sum("current_estimated_token_value_atomic")
      }
    };
  }
}
