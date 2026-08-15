import { AcquisitionMode, BeneficiaryKind, InvitationActor } from "../src/referral/types.js";
import { REFERRAL_TERM_BLOCKS } from "../src/referral/config.js";
import { ReferralLinkService } from "../src/referral/links.js";
import { ReferralRegistry } from "../src/referral/registry.js";
import { InMemoryReferralRegistryStore } from "../src/referral/store.js";
import { DeterministicPrincipalVestingSink } from "../src/referral/vesting.js";

const now = new Date("2026-08-09T12:00:00.000Z");
const links = new ReferralLinkService(Buffer.alloc(32, 7), "https://bitagent.example");
const registry = new ReferralRegistry(
  new InMemoryReferralRegistryStore(),
  new DeterministicPrincipalVestingSink(),
  { now: () => now }
);

await registry.createPrincipal({ principalId: "direct-principal", agentId: "direct-agent" });
const direct = await registry.settleEligibleTrade({
  trade_id: "trade-direct-million",
  referee_principal_id: "direct-principal",
  block_height: 1_000,
  eligible_notional_atomic: "1000000000000",
  fee_asset: "USDC_MICRO",
  canonical: true,
  settled: true,
  fee_bearing: true,
  evidence_refs: ["fixture:canonical-trade-direct"]
});

await registry.createPrincipal({ principalId: "human-referee", agentId: "human-referee-agent" });
const humanIssued = links.issue({
  referrerPrincipalId: "human-referrer",
  acquisitionMode: AcquisitionMode.HUMAN_MANUAL_SHARE,
  invitationActor: InvitationActor.HUMAN,
  now
});
await registry.registerInvitation(humanIssued.invitation);
await registry.markInvitationStatus(humanIssued.invitation.invitation_id, "human_sent");
const humanBinding = await registry.bindVerifiedInvitation({
  invitationId: humanIssued.invitation.invitation_id,
  policyVersion: humanIssued.invitation.policy_version,
  signature: humanIssued.invitation.signature,
  refereePrincipalId: "human-referee",
  refereeAgentId: "human-referee-agent",
  finalSendActor: "HUMAN"
});
await registry.settleEligibleTrade({
  trade_id: "trade-human-million",
  referee_principal_id: "human-referee",
  block_height: 2_000,
  eligible_notional_atomic: "1000000000000",
  fee_asset: "USDC_MICRO",
  canonical: true,
  settled: true,
  fee_bearing: true,
  evidence_refs: ["fixture:canonical-trade-human"]
});
const activeHumanBinding = (await registry.getState()).bindings.find(
  (binding) => binding.id === humanBinding.id
)!;

await registry.createPrincipal({ principalId: "assisted-referee", agentId: "assisted-referee-agent" });
const assistedIssued = links.issue({
  referrerPrincipalId: "assisted-human-referrer",
  sourceAgentId: "growth-agent-01",
  acquisitionMode: AcquisitionMode.AGENT_ASSISTED_SHARE,
  invitationActor: InvitationActor.AGENT_ASSISTED,
  now
});
await registry.registerInvitation(assistedIssued.invitation);
const assistedBinding = await registry.bindVerifiedInvitation({
  invitationId: assistedIssued.invitation.invitation_id,
  policyVersion: assistedIssued.invitation.policy_version,
  signature: assistedIssued.invitation.signature,
  refereePrincipalId: "assisted-referee",
  refereeAgentId: "assisted-referee-agent",
  contactAccessAuthorizedByPrincipalId: "assisted-human-referrer",
  messagePreparationAuthorizedByPrincipalId: "assisted-human-referrer",
  finalSendActor: "HUMAN"
});

const returnedToSelf = await registry.advanceHeight(
  "human-referee",
  activeHumanBinding.expiry_height || 2_000 + REFERRAL_TERM_BLOCKS
);

console.log(JSON.stringify({
  schema: "bitagent_referral_vertical_slice_demo_v1",
  direct_self_reference: {
    beneficiary_kind: BeneficiaryKind.SELF_AGENT,
    sponsor_credit_atomic: direct.sponsor_credit_atomic,
    sponsor_credit_usd: "$5.00"
  },
  human_referral: {
    beneficiary_kind: humanBinding.beneficiary_kind,
    acquisition_mode: humanBinding.acquisition_mode,
    canonical_link: humanIssued.url,
    link_fields: [...new URL(humanIssued.url).searchParams.keys()]
  },
  agent_assisted_manual_invitation: {
    beneficiary_principal_id: assistedBinding.beneficiary_principal_id,
    source_agent_id: assistedBinding.source_agent_id,
    invitation_actor: assistedBinding.invitation_actor,
    final_send_actor: assistedBinding.final_send_actor
  },
  automatic_expiry: {
    expiry_height: activeHumanBinding.expiry_height,
    next_beneficiary_kind: returnedToSelf.beneficiary_kind,
    next_beneficiary_principal_id: returnedToSelf.beneficiary_principal_id
  }
}, null, 2));
