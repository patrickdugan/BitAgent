import { CONTACT_LABELS, type ContactLabel, type LocalContactCandidate } from "./types.js";

const WEIGHTS: Partial<Record<ContactLabel, number>> = {
  interested_in_crypto: 16,
  interested_in_markets: 18,
  interested_in_side_income: 4,
  owns_pc: 5,
  phone_only: 8,
  android_user: 5,
  needs_local_language: -2,
  trusted_relationship: 14,
  likely_to_try_recommendation: 18,
  needs_setup_help: -6,
  experienced_wallet_user: 12,
  never_invite: -10_000
};

function includes(candidate: LocalContactCandidate, label: ContactLabel) {
  return candidate.user_labels.includes(label);
}

function explanation(candidate: LocalContactCandidate) {
  const reasons: string[] = [];
  if (includes(candidate, "interested_in_markets")) reasons.push("interested in markets");
  if (includes(candidate, "android_user")) reasons.push("comfortable with Android");
  if (includes(candidate, "likely_to_try_recommendation")) reasons.push("likely to try something you recommend");
  if (includes(candidate, "phone_only")) reasons.push("suited to the phone-only flow");
  if (includes(candidate, "needs_setup_help")) reasons.push("may need setup help");
  if (candidate.relationship_strength <= 1) reasons.push("the relationship is marked as weak");
  if (!reasons.length) return "This person has few explicit product-fit labels, so they rank conservatively.";
  if (candidate.relationship_strength <= 1) return `This person ranked lower because ${reasons.join(", ")}.`;
  return `You marked this person as ${reasons.join(", ")}.`;
}

export interface ContactRanker {
  rank(candidates: LocalContactCandidate[]): LocalContactCandidate[];
}

export class DeterministicLabelRanker implements ContactRanker {
  rank(candidates: LocalContactCandidate[]) {
    for (const candidate of candidates) {
      const invalid = candidate.user_labels.filter((label) => !CONTACT_LABELS.includes(label));
      if (invalid.length) throw new Error(`Candidate contains prohibited or unknown ranking labels: ${invalid.join(", ")}`);
    }
    return candidates
      .filter((candidate) => !includes(candidate, "never_invite")
        && !["not_interested", "do_not_contact"].includes(candidate.campaign_state))
      .map((candidate) => {
        const labelScore = candidate.user_labels.reduce((total, label) => total + (WEIGHTS[label] || 0), 0);
        const relationshipScore = candidate.relationship_strength * 8;
        const onboardingEffort = includes(candidate, "needs_setup_help") ? 12 : includes(candidate, "experienced_wallet_user") ? 2 : 6;
        const relationshipCost = candidate.relationship_strength <= 1 ? 12 : 3;
        const score = labelScore + relationshipScore - onboardingEffort - relationshipCost;
        const activationBps = Math.max(250, Math.min(8000, 800 + score * 55));
        const notionalBand = includes(candidate, "experienced_wallet_user") || includes(candidate, "interested_in_markets")
          ? "HIGH" as const
          : includes(candidate, "interested_in_crypto") ? "MEDIUM" as const : "LOW" as const;
        return {
          ...structuredClone(candidate),
          predicted_activation_probability: `${activationBps}/10000`,
          predicted_notional_band: notionalBand,
          onboarding_effort: onboardingEffort,
          relationship_cost: relationshipCost,
          score,
          explanation: explanation({ ...candidate, onboarding_effort: onboardingEffort, relationship_cost: relationshipCost })
        };
      })
      .sort((left, right) => right.score - left.score || left.local_hashed_id.localeCompare(right.local_hashed_id));
  }
}
