import type { ReferralAttribution, SupportedIntent } from "./types.js";
import { LaunchKernelError } from "./errors.js";

const WORKFLOWS: Record<string, SupportedIntent> = {
  deposit: "deposit_bitcoin",
  deposit_bitcoin: "deposit_bitcoin",
  strategy: "starter_strategy",
  starter_strategy: "starter_strategy",
  withdraw: "withdraw_bitcoin",
  withdraw_bitcoin: "withdraw_bitcoin"
};

function safeId(value: string | null, field: string) {
  const text = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(text)) {
    throw new LaunchKernelError("validation_error", `${field} is missing or malformed`);
  }
  return text;
}

export function parseReferralLink(value: string, now: Date): ReferralAttribution {
  let url: URL;
  try {
    url = new URL(value, "https://bitagent.local");
  } catch {
    throw new LaunchKernelError("validation_error", "Referral link is malformed");
  }

  const workflow = WORKFLOWS[String(url.searchParams.get("workflow") || "").toLowerCase()];
  if (!workflow) {
    throw new LaunchKernelError("validation_error", "Referral workflow is not supported");
  }

  const strategyTemplateId = url.searchParams.get("strategy") || undefined;
  if (strategyTemplateId && workflow !== "starter_strategy") {
    throw new LaunchKernelError(
      "validation_error",
      "strategy is allowed only for the starter strategy referral workflow"
    );
  }

  return {
    referrerId: safeId(url.searchParams.get("ref"), "ref"),
    campaignId: safeId(url.searchParams.get("campaign"), "campaign"),
    intendedWorkflow: workflow,
    strategyTemplateId: strategyTemplateId ? safeId(strategyTemplateId, "strategy") : undefined,
    status: "pending",
    capturedAt: now.toISOString()
  };
}

export function buildReferralLink(
  baseUrl: string,
  input: Omit<ReferralAttribution, "status" | "capturedAt" | "activatedAt">
) {
  const url = new URL(baseUrl);
  url.searchParams.set("ref", safeId(input.referrerId, "ref"));
  url.searchParams.set("campaign", safeId(input.campaignId, "campaign"));
  url.searchParams.set("workflow", input.intendedWorkflow);
  if (input.strategyTemplateId) url.searchParams.set("strategy", safeId(input.strategyTemplateId, "strategy"));
  return url.toString();
}
