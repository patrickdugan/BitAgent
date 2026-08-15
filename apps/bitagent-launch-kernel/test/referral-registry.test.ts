import assert from "node:assert/strict";
import test from "node:test";
import { REFERRAL_TERM_BLOCKS } from "../src/referral/config.js";
import { ReferralLinkService } from "../src/referral/links.js";
import { ReferralRegistry } from "../src/referral/registry.js";
import { InMemoryReferralRegistryStore } from "../src/referral/store.js";
import { DeterministicPrincipalVestingSink } from "../src/referral/vesting.js";
import { buildTradeLayerVestingCreditCandidate } from "../src/referral/vesting.js";
import { ReferralSettlementAdapter } from "../src/referral/settlementAdapter.js";
import { AcquisitionMode, BeneficiaryKind, InvitationActor } from "../src/referral/types.js";

const now = new Date("2026-08-09T12:00:00.000Z");

function fixture() {
  const store = new InMemoryReferralRegistryStore();
  const registry = new ReferralRegistry(store, new DeterministicPrincipalVestingSink(), {
    now: () => now,
    verifyRecoverySignature: (material) => material.signature === "operator-valid-signature"
  });
  const links = new ReferralLinkService(Buffer.alloc(32, 4), "https://bitagent.example");
  return { registry, store, links };
}

function trade(referee: string, tradeId: string, height = 1000, notional = "1000000000000") {
  return {
    trade_id: tradeId,
    referee_principal_id: referee,
    block_height: height,
    eligible_notional_atomic: notional,
    fee_asset: "USDC_MICRO",
    canonical: true as const,
    settled: true as const,
    fee_bearing: true as const,
    evidence_refs: [`chain:${tradeId}`]
  };
}

async function humanInvitation(input: {
  registry: ReferralRegistry;
  links: ReferralLinkService;
  referrer: string;
  sourceAgentId?: string;
  assisted?: boolean;
}) {
  const issued = input.links.issue({
    referrerPrincipalId: input.referrer,
    sourceAgentId: input.sourceAgentId,
    acquisitionMode: input.assisted ? AcquisitionMode.AGENT_ASSISTED_SHARE : AcquisitionMode.HUMAN_MANUAL_SHARE,
    invitationActor: input.assisted ? InvitationActor.AGENT_ASSISTED : InvitationActor.HUMAN,
    now
  });
  await input.registry.registerInvitation(issued.invitation);
  return issued;
}

test("direct installs self-reference and account creation produces no reward", async () => {
  const { registry } = fixture();
  const binding = await registry.createPrincipal({ principalId: "principal-a", agentId: "agent-a" });
  assert.equal(binding.beneficiary_kind, BeneficiaryKind.SELF_AGENT);
  assert.equal(binding.beneficiary_principal_id, "principal-a");
  assert.equal(binding.source_agent_id, "agent-a");
  assert.equal(binding.acquisition_mode, AcquisitionMode.SELF_INSTALL);
  const state = await registry.getState();
  assert.equal(state.accruals.length, 0);
  assert.equal(state.vesting_assignments.length, 0);
});

test("human manual referral redirects the same single sponsor credit and activates only on trade", async () => {
  const { registry, links } = fixture();
  await registry.createPrincipal({ principalId: "referee", agentId: "referee-agent" });
  const issued = await humanInvitation({ registry, links, referrer: "human-referrer" });
  const binding = await registry.bindVerifiedInvitation({
    invitationId: issued.invitation.invitation_id,
    policyVersion: issued.invitation.policy_version,
    signature: issued.invitation.signature,
    refereePrincipalId: "referee",
    refereeAgentId: "referee-agent",
    finalSendActor: "HUMAN"
  });
  assert.equal(binding.status, "PENDING");
  assert.equal(binding.acquisition_mode, AcquisitionMode.HUMAN_MANUAL_SHARE);
  assert.equal((await registry.getState()).accruals.length, 0);

  const accrual = await registry.settleEligibleTrade(trade("referee", "trade-human"));
  assert.equal(accrual.sponsor_credit_atomic, "5000000");
  assert.equal(accrual.total_fee_atomic, "50000000");
  const state = await registry.getState();
  const active = state.bindings.find((row) => row.id === accrual.binding_id)!;
  assert.equal(active.status, "ACTIVE");
  assert.equal(active.start_height, 1000);
  assert.equal(active.expiry_height, 1000 + REFERRAL_TERM_BLOCKS);
  const assignment = state.vesting_assignments[0]!;
  assert.equal(assignment.beneficiary_principal_id, "human-referrer");
  assert.equal(assignment.principal_controlled, true);
  assert.equal(assignment.agent_spend_authority, false);
});

test("agent-assisted manual share attributes economics to the human and preserves separate provenance", async () => {
  const { registry, links } = fixture();
  await registry.createPrincipal({ principalId: "referee", agentId: "recipient-agent" });
  const issued = await humanInvitation({
    registry, links, referrer: "human-owner", sourceAgentId: "growth-agent", assisted: true
  });
  const binding = await registry.bindVerifiedInvitation({
    invitationId: issued.invitation.invitation_id,
    policyVersion: issued.invitation.policy_version,
    signature: issued.invitation.signature,
    refereePrincipalId: "referee",
    refereeAgentId: "recipient-agent",
    contactAccessAuthorizedByPrincipalId: "human-owner",
    messagePreparationAuthorizedByPrincipalId: "human-owner",
    finalSendActor: "HUMAN"
  });
  assert.equal(binding.beneficiary_principal_id, "human-owner");
  assert.equal(binding.source_agent_id, "growth-agent");
  assert.equal(binding.invitation_actor, InvitationActor.AGENT_ASSISTED);
  assert.equal(binding.acquisition_mode, AcquisitionMode.AGENT_ASSISTED_SHARE);
  assert.equal(binding.final_send_actor, "HUMAN");
});

test("agent-assisted binding rejects missing human authorizations or a non-human final send", async () => {
  const { registry, links } = fixture();
  await registry.createPrincipal({ principalId: "referee", agentId: "recipient-agent" });
  const issued = await humanInvitation({
    registry, links, referrer: "human-owner", sourceAgentId: "growth-agent", assisted: true
  });
  await assert.rejects(() => registry.bindVerifiedInvitation({
    invitationId: issued.invitation.invitation_id,
    policyVersion: issued.invitation.policy_version,
    signature: issued.invitation.signature,
    refereePrincipalId: "referee",
    refereeAgentId: "recipient-agent",
    finalSendActor: "AGENT" as never
  }), /human/i);
});

test("binding can change before first trade and is fixed after activation", async () => {
  const { registry, links } = fixture();
  await registry.createPrincipal({ principalId: "referee", agentId: "agent" });
  const first = await humanInvitation({ registry, links, referrer: "referrer-1" });
  await registry.bindVerifiedInvitation({
    invitationId: first.invitation.invitation_id,
    policyVersion: first.invitation.policy_version,
    signature: first.invitation.signature,
    refereePrincipalId: "referee", refereeAgentId: "agent", finalSendActor: "HUMAN"
  });
  const second = await humanInvitation({ registry, links, referrer: "referrer-2" });
  await registry.bindVerifiedInvitation({
    invitationId: second.invitation.invitation_id,
    policyVersion: second.invitation.policy_version,
    signature: second.invitation.signature,
    refereePrincipalId: "referee", refereeAgentId: "agent", finalSendActor: "HUMAN"
  });
  await registry.settleEligibleTrade(trade("referee", "fixed-trade"));
  const third = await humanInvitation({ registry, links, referrer: "referrer-3" });
  await assert.rejects(() => registry.bindVerifiedInvitation({
    invitationId: third.invitation.invitation_id,
    policyVersion: third.invitation.policy_version,
    signature: third.invitation.signature,
    refereePrincipalId: "referee", refereeAgentId: "agent", finalSendActor: "HUMAN"
  }), /fixed/);
});

test("expiry automatically returns the referee to self-reference", async () => {
  const { registry, links } = fixture();
  await registry.createPrincipal({ principalId: "referee", agentId: "agent" });
  const issued = await humanInvitation({ registry, links, referrer: "referrer" });
  await registry.bindVerifiedInvitation({
    invitationId: issued.invitation.invitation_id,
    policyVersion: issued.invitation.policy_version,
    signature: issued.invitation.signature,
    refereePrincipalId: "referee", refereeAgentId: "agent", finalSendActor: "HUMAN"
  });
  await registry.settleEligibleTrade(trade("referee", "activator", 500));
  const self = await registry.advanceHeight("referee", 500 + REFERRAL_TERM_BLOCKS);
  assert.equal(self.beneficiary_kind, BeneficiaryKind.SELF_AGENT);
  assert.equal(self.beneficiary_principal_id, "referee");
  assert.equal(self.status, "PENDING");
});

test("reorganized trade reverses accrual, vesting, rounding, and activation", async () => {
  const { registry } = fixture();
  await registry.createPrincipal({ principalId: "referee", agentId: "agent" });
  await registry.settleEligibleTrade(trade("referee", "reorg-trade"));
  const reversed = await registry.reverseCanonicalTrade({ tradeId: "reorg-trade", reason: "REORG" });
  assert.equal(reversed.reversed, true);
  const state = await registry.getState();
  assert.equal(state.vesting_assignments[0]?.status, "REVERSED");
  assert.equal(state.fee_accumulators.USDC_MICRO?.cumulative_eligible_notional_atomic, "0");
  const binding = state.bindings.find((row) => row.id === reversed.binding_id)!;
  assert.equal(binding.status, "PENDING");
  assert.equal(binding.first_eligible_trade_height, null);
  assert.equal(binding.canonical_chain_status, "REORGED");
});

test("one-hop identity chains cannot multiply sponsor credit", async () => {
  const { registry, links } = fixture();
  for (const [principal, agent] of [["a", "agent-a"], ["b", "agent-b"], ["c", "agent-c"]]) {
    await registry.createPrincipal({ principalId: principal!, agentId: agent! });
  }
  const aToB = await humanInvitation({ registry, links, referrer: "a" });
  await registry.bindVerifiedInvitation({
    invitationId: aToB.invitation.invitation_id, policyVersion: aToB.invitation.policy_version,
    signature: aToB.invitation.signature, refereePrincipalId: "b", refereeAgentId: "agent-b", finalSendActor: "HUMAN"
  });
  const bToC = await humanInvitation({ registry, links, referrer: "b" });
  await registry.bindVerifiedInvitation({
    invitationId: bToC.invitation.invitation_id, policyVersion: bToC.invitation.policy_version,
    signature: bToC.invitation.signature, refereePrincipalId: "c", refereeAgentId: "agent-c", finalSendActor: "HUMAN"
  });
  const accrual = await registry.settleEligibleTrade(trade("c", "chain-trade"));
  const state = await registry.getState();
  assert.equal(accrual.sponsor_credit_atomic, "5000000");
  assert.deepEqual(state.vesting_assignments.map((row) => row.beneficiary_principal_id), ["b"]);
  assert.equal(state.vesting_assignments.reduce((sum, row) => sum + BigInt(row.token_units_assigned), 0n), 5_000_000n);
});

test("administrative recovery requires a valid operator signature and logs the action without extending the term", async () => {
  const { registry } = fixture();
  const binding = await registry.createPrincipal({ principalId: "referee", agentId: "agent" });
  await registry.settleEligibleTrade(trade("referee", "recovery-trade", 700));
  const active = (await registry.getState()).bindings.find((row) => row.id === binding.id)!;
  await assert.rejects(() => registry.administrativeRecovery({
    bindingId: active.id, operatorPrincipalId: "operator", reason: "KEY_COMPROMISE",
    replacementBeneficiaryPrincipalId: "referee", replacementBeneficiaryKind: BeneficiaryKind.SELF_AGENT,
    approvalReceiptHash: "a".repeat(64), signature: "invalid"
  }), /invalid/);
  const recovered = await registry.administrativeRecovery({
    bindingId: active.id, operatorPrincipalId: "operator", reason: "KEY_COMPROMISE",
    replacementBeneficiaryPrincipalId: "referee", replacementBeneficiaryKind: BeneficiaryKind.SELF_AGENT,
    approvalReceiptHash: "a".repeat(64), signature: "operator-valid-signature"
  });
  assert.equal(recovered.binding.expiry_height, active.expiry_height);
  assert.equal((await registry.getState()).recovery_actions.length, 1);
});

test("creating many identities produces no account-count reward", async () => {
  const { registry } = fixture();
  for (let index = 0; index < 100; index += 1) {
    await registry.createPrincipal({ principalId: `principal-${index}`, agentId: `agent-${index}` });
  }
  const state = await registry.getState();
  assert.equal(state.bindings.length, 100);
  assert.equal(state.accruals.length, 0);
  assert.equal(state.vesting_assignments.length, 0);
});

test("settlement adapter emits wallet-safe aggregate activity and prepares a non-executing TradeLayer vesting candidate", async () => {
  const { registry } = fixture();
  await registry.createPrincipal({ principalId: "referee", agentId: "agent" });
  const activities: any[] = [];
  const adapter = new ReferralSettlementAdapter(registry, { publish: async (activity) => activities.push(activity) });
  const accrual = await adapter.observeCanonicalSettlement(trade("referee", "adapter-trade", 900));
  assert.equal(activities[0]?.phase, "referral_growth");
  assert.equal(activities[0]?.meta?.feeValueAtAccrualAtomic, "5000000");
  assert.doesNotMatch(JSON.stringify(activities), /contact|phone|email|message/i);
  const assignment = (await registry.getState()).vesting_assignments[0]!;
  const candidate = buildTradeLayerVestingCreditCandidate({
    assignment, principalWalletAddress: "tb1qprincipal", vestingTokenPropertyId: 3, blockHeight: 900
  });
  assert.equal(candidate.credit_bucket, "vesting");
  assert.equal(candidate.effect, "none");
  assert.match(candidate.execution_blocker, /integer-safe/);
  await adapter.observeRollback({ tradeId: accrual.trade_id, reason: "REORG" });
  assert.equal(activities[1]?.meta?.reversed, true);
});
