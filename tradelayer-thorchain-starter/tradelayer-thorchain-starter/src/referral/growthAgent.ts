import { referralGoalExamples } from "./economics.js";
import type { ReferralLinkService } from "./links.js";
import { draftInitialMessage, draftLinkMessage, prepareNativeShareAction } from "./messaging.js";
import { DeterministicLabelRanker } from "./ranking.js";
import type { LocalReferralContactStore, ContactPermissionLevel, MobilePlatform } from "./contacts.js";
import { buildContactSelectionPlan } from "./contacts.js";

type ClosedToolSchema = {
  type: "object";
  additionalProperties: false;
  required: string[];
  properties: Record<string, Record<string, unknown>>;
  authority: "local_host" | "human";
  effect: "none" | "local_state_only";
};

export const growthAgentToolSchemas: Record<string, ClosedToolSchema> = {
  "bitagent.growth.explain": {
    type: "object", additionalProperties: false, required: [], properties: {},
    authority: "local_host", effect: "none"
  },
  "bitagent.growth.calculate_goal": {
    type: "object", additionalProperties: false, required: ["goalUsd"],
    properties: { goalUsd: { type: "integer", enum: [1, 5, 10] } },
    authority: "local_host", effect: "none"
  },
  "bitagent.growth.request_contact_selection": {
    type: "object", additionalProperties: false, required: ["principalId", "platform", "level"],
    properties: {
      principalId: { type: "string" }, platform: { type: "string", enum: ["web", "android", "ios"] },
      level: { type: "integer", minimum: 0, maximum: 3 }, androidRelease: { type: "integer" },
      broadDisclosureAccepted: { type: "boolean" }
    },
    authority: "human", effect: "local_state_only"
  },
  "bitagent.growth.rank_selected_contacts": {
    type: "object", additionalProperties: false, required: ["localHashedIds"],
    properties: { localHashedIds: { type: "array", items: { type: "string" } } },
    authority: "local_host", effect: "none"
  },
  "bitagent.growth.draft_message": {
    type: "object", additionalProperties: false, required: ["localHashedId", "approvedReason", "agentDrafted"],
    properties: {
      localHashedId: { type: "string" }, approvedReason: { type: "string" }, agentDrafted: { type: "boolean" }
    },
    authority: "local_host", effect: "local_state_only"
  },
  "bitagent.growth.prepare_native_share": {
    type: "object", additionalProperties: false, required: ["text"],
    properties: { text: { type: "string" }, title: { type: "string" } },
    authority: "human", effect: "none"
  },
  "bitagent.growth.record_response": {
    type: "object", additionalProperties: false, required: ["localHashedId", "response"],
    properties: { localHashedId: { type: "string" }, response: { type: "string", enum: ["not_interested", "do_not_contact"] } },
    authority: "human", effect: "local_state_only"
  },
  "bitagent.growth.approve_follow_up": {
    type: "object", additionalProperties: false, required: ["localHashedId"],
    properties: { localHashedId: { type: "string" } },
    authority: "human", effect: "local_state_only"
  },
  "bitagent.growth.earnings": {
    type: "object", additionalProperties: false, required: [], properties: {},
    authority: "local_host", effect: "none"
  }
};

export const GROWTH_AGENT_EXPLANATION = "You receive 0.05 basis points of eligible trading by people you refer for one year. That equals $0.50 per $100,000 of eligible notional and $5 per $1 million. The credit is assigned as vesting tokens, so its later market value can move.";

export class GrowthAgentLocalHost {
  private readonly ranker = new DeterministicLabelRanker();
  private readonly authorizations = new Map<string, ContactPermissionLevel>();

  constructor(
    private readonly contacts: LocalReferralContactStore,
    private readonly linkService: ReferralLinkService
  ) {}

  explain() {
    return { text: GROWTH_AGENT_EXPLANATION, phone_only_supported: true, pc_path_supported: true };
  }

  calculateGoal(goalUsd: 1 | 5 | 10) {
    return referralGoalExamples(goalUsd);
  }

  authorizeContactSelection(input: {
    principalId: string;
    authorizedByPrincipalId: string;
    platform: MobilePlatform;
    level: ContactPermissionLevel;
    androidRelease?: number;
    broadDisclosureAccepted?: boolean;
  }) {
    if (input.principalId !== input.authorizedByPrincipalId) throw new Error("Contact access requires the principal's authorization");
    if (input.level === 3 && !input.broadDisclosureAccepted) throw new Error("Level 3 requires the prominent broad-access disclosure");
    const plan = buildContactSelectionPlan(input);
    this.authorizations.set(input.principalId, input.level);
    return { plan, authorized_by_principal_id: input.authorizedByPrincipalId };
  }

  rankSelectedContacts(input: { principalId: string; localHashedIds: string[] }) {
    if ((this.authorizations.get(input.principalId) || 0) < 1) throw new Error("Contact selection is not authorized");
    const allowed = new Set(input.localHashedIds);
    return this.ranker.rank(this.contacts.list().filter((row) => allowed.has(row.local_hashed_id)));
  }

  draftInitial(input: { localHashedId: string; approvedReason: string; agentDrafted: boolean }) {
    const candidate = this.contacts.list().find((row) => row.local_hashed_id === input.localHashedId);
    if (!candidate) throw new Error("Unknown local contact candidate");
    return draftInitialMessage({
      displayNameLocalOnly: candidate.display_name_local_only,
      userApprovedReason: input.approvedReason,
      agentDrafted: input.agentDrafted
    });
  }

  draftDetails(input: { canonicalLink: string; locale?: "en" | "es"; agentDrafted?: boolean }) {
    return draftLinkMessage({ ...input, linkService: this.linkService });
  }

  prepareShare(text: string) {
    return prepareNativeShareAction({ text, linkService: this.linkService });
  }
}
