import type { ReferralLinkService } from "../referral/links.js";
import type { ReferralAttribution } from "./types.js";
import { LaunchKernelError } from "./errors.js";

export function parseReferralLink(
  value: string,
  now: Date,
  linkService?: ReferralLinkService
): ReferralAttribution {
  if (!linkService) {
    throw new LaunchKernelError("provider_unavailable", "Signed referral verification is not configured");
  }
  try {
    const verified = linkService.verify(value);
    return {
      invitationId: verified.invitationId,
      policyVersion: verified.policyVersion,
      signature: verified.signature,
      intendedWorkflow: "deposit_bitcoin",
      status: "pending",
      capturedAt: now.toISOString()
    };
  } catch (error) {
    throw new LaunchKernelError(
      "validation_error",
      error instanceof Error ? error.message : "Referral link is malformed"
    );
  }
}
