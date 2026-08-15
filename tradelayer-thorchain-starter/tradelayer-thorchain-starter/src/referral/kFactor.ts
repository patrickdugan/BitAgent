export type ConsentSafeKFactorInput = {
  eligiblePrincipals: number;
  uniqueHumanSentInvitations: number;
  independentQualifiedActivations: number;
  excludedSelfControlledOrDuplicates: number;
  suppressedRecipients: number;
};

function boundedCount(value: number, field: string, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > 1_000_000_000) {
    throw new Error(`${field} must be a safe integer from ${minimum} to 1000000000`);
  }
  return value;
}

function ppm(numerator: number, denominator: number) {
  if (denominator === 0) return 0;
  return Number((BigInt(numerator) * 1_000_000n) / BigInt(denominator));
}

function decimalFromPpm(value: number) {
  return (value / 1_000_000).toFixed(6);
}

export function calculateConsentSafeKFactor(input: ConsentSafeKFactorInput) {
  const eligiblePrincipals = boundedCount(input.eligiblePrincipals, "eligiblePrincipals", 1);
  const invitations = boundedCount(input.uniqueHumanSentInvitations, "uniqueHumanSentInvitations");
  const activations = boundedCount(input.independentQualifiedActivations, "independentQualifiedActivations");
  const excluded = boundedCount(input.excludedSelfControlledOrDuplicates, "excludedSelfControlledOrDuplicates");
  const suppressed = boundedCount(input.suppressedRecipients, "suppressedRecipients");
  if (activations > invitations) {
    throw new Error("independentQualifiedActivations cannot exceed uniqueHumanSentInvitations");
  }
  const invitationsPerPrincipalPpm = ppm(invitations, eligiblePrincipals);
  const qualifiedActivationRatePpm = ppm(activations, invitations);
  const kFactorPpm = ppm(activations, eligiblePrincipals);
  return {
    schema: "bitagent.consent_safe_k_factor.v1" as const,
    eligible_principals: eligiblePrincipals,
    unique_human_sent_invitations: invitations,
    independent_qualified_activations: activations,
    excluded_self_controlled_or_duplicates: excluded,
    suppressed_recipients: suppressed,
    invitations_per_principal_ppm: invitationsPerPrincipalPpm,
    qualified_activation_rate_ppm: qualifiedActivationRatePpm,
    k_factor_ppm: kFactorPpm,
    k_factor_decimal: decimalFromPpm(kFactorPpm),
    formula: "unique human-sent invitations per eligible principal x independent qualified activation rate",
    counting_rule: "Deduplicate recipients; exclude self-controlled identities, fabricated accounts, autonomous sends, and post-suppression outreach.",
    safe_levers: [
      "clearer opt-in explanations",
      "better setup help for people who asked",
      "accurate risk and referral disclosures",
      "respectful timing and suppression"
    ],
    effect: "none" as const
  };
}
