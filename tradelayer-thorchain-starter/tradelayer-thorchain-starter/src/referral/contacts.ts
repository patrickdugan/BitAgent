import { createHash, randomBytes } from "node:crypto";
import { CONTACT_LABELS, type ContactLabel, type LocalContactCandidate } from "./types.js";

export type ContactPermissionLevel = 0 | 1 | 2 | 3;
export type MobilePlatform = "web" | "android" | "ios";

export type ContactSelectionPlan = {
  level: ContactPermissionLevel;
  platform: MobilePlatform;
  mechanism:
    | "none"
    | "web_contact_picker"
    | "android_17_contact_picker"
    | "android_action_pick"
    | "android_optional_read_contacts"
    | "ios_limited_contact_picker"
    | "ios_limited_contacts_scan";
  fields: Array<"name" | "phone" | "email">;
  local_processing_only: true;
  broad_access: boolean;
  requires_prominent_disclosure: boolean;
  denied_fallback: "copy_referral_link";
};

export type RawSelectedContactLocalOnly = {
  displayName?: string;
  phoneNumbers?: string[];
  emailAddresses?: string[];
};

const FORBIDDEN_IMPORTED_FIELDS = new Set([
  "note", "notes", "photo", "photos", "image", "birthday", "organization",
  "callLog", "sms", "messageHistory", "address"
]);

export const PROHIBITED_MOBILE_PERMISSIONS = [
  "android.permission.READ_CALL_LOG",
  "android.permission.READ_SMS",
  "android.permission.SEND_SMS",
  "android.permission.BIND_ACCESSIBILITY_SERVICE",
  "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"
] as const;

export function buildContactSelectionPlan(input: {
  platform: MobilePlatform;
  level: ContactPermissionLevel;
  androidRelease?: number;
}): ContactSelectionPlan {
  const fields: Array<"name" | "phone" | "email"> = input.level === 0 ? [] : ["name", "phone", "email"];
  if (input.level === 0) {
    return {
      level: 0, platform: input.platform, mechanism: "none", fields,
      local_processing_only: true, broad_access: false,
      requires_prominent_disclosure: false, denied_fallback: "copy_referral_link"
    };
  }
  if (input.platform === "android") {
    const mechanism = input.level === 3
      ? "android_optional_read_contacts"
      : (input.androidRelease || 0) >= 17
        ? "android_17_contact_picker"
        : "android_action_pick";
    return {
      level: input.level, platform: input.platform, mechanism, fields,
      local_processing_only: true, broad_access: input.level === 3,
      requires_prominent_disclosure: input.level === 3,
      denied_fallback: "copy_referral_link"
    };
  }
  if (input.platform === "ios") {
    return {
      level: input.level, platform: input.platform,
      mechanism: input.level === 3 ? "ios_limited_contacts_scan" : "ios_limited_contact_picker",
      fields, local_processing_only: true, broad_access: input.level === 3,
      requires_prominent_disclosure: input.level === 3,
      denied_fallback: "copy_referral_link"
    };
  }
  if (input.level === 3) throw new Error("Complete address-book scan is unavailable in the browser surface");
  return {
    level: input.level, platform: "web", mechanism: "web_contact_picker", fields,
    local_processing_only: true, broad_access: false,
    requires_prominent_disclosure: false, denied_fallback: "copy_referral_link"
  };
}

export function createDeviceSalt() {
  return randomBytes(32).toString("base64url");
}

function normalizeLocalValue(value: string) {
  return value.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, "").trim();
}

export function localContactHash(deviceSalt: string, localIdentity: string) {
  if (!deviceSalt || !localIdentity) throw new Error("Device salt and local contact identity are required");
  return createHash("sha256").update(`${deviceSalt}\n${normalizeLocalValue(localIdentity)}`).digest("hex");
}

export function importSelectedContact(input: {
  raw: RawSelectedContactLocalOnly & Record<string, unknown>;
  deviceSalt: string;
  labels?: ContactLabel[];
  relationshipStrength?: 0 | 1 | 2 | 3;
}): LocalContactCandidate {
  const unexpectedSensitive = Object.keys(input.raw).filter((key) => FORBIDDEN_IMPORTED_FIELDS.has(key));
  if (unexpectedSensitive.length) throw new Error(`Contact picker returned prohibited fields: ${unexpectedSensitive.join(", ")}`);
  const displayName = normalizeLocalValue(String(input.raw.displayName || "Contact"));
  const phone = Array.isArray(input.raw.phoneNumbers) ? normalizeLocalValue(String(input.raw.phoneNumbers[0] || "")) : "";
  const email = Array.isArray(input.raw.emailAddresses) ? normalizeLocalValue(String(input.raw.emailAddresses[0] || "")) : "";
  const identity = phone || email || displayName;
  const labels = [...new Set(input.labels || [])];
  const invalidLabels = labels.filter((label) => !CONTACT_LABELS.includes(label));
  if (invalidLabels.length) throw new Error(`Contact contains prohibited or unknown ranking labels: ${invalidLabels.join(", ")}`);
  return {
    local_hashed_id: localContactHash(input.deviceSalt, identity),
    display_name_local_only: displayName,
    user_labels: labels,
    relationship_strength: input.relationshipStrength ?? 0,
    predicted_activation_probability: "0",
    predicted_notional_band: "LOW",
    onboarding_effort: 0,
    relationship_cost: 0,
    score: 0,
    explanation: "Not ranked yet.",
    campaign_state: "candidate"
  };
}

export class LocalReferralContactStore {
  private readonly candidates = new Map<string, LocalContactCandidate>();

  put(candidate: LocalContactCandidate) {
    this.candidates.set(candidate.local_hashed_id, structuredClone(candidate));
  }

  list() {
    return [...this.candidates.values()].map((row) => structuredClone(row));
  }

  clearAll() {
    const deleted = this.candidates.size;
    this.candidates.clear();
    return { deleted, remaining: 0 };
  }
}

export function hostedCandidateProjection(candidates: LocalContactCandidate[]) {
  return candidates.map((candidate, index) => ({
    pseudonym: `Contact ${String.fromCharCode(65 + index)}`,
    user_approved_product_fit_features: [...candidate.user_labels].filter((label) => label !== "never_invite"),
    relationship_strength: candidate.relationship_strength,
    predicted_notional_band: candidate.predicted_notional_band,
    onboarding_effort: candidate.onboarding_effort,
    relationship_cost: candidate.relationship_cost
  }));
}

export function buildReferralTelemetryEvent(input: {
  selectedCount: number;
  rankedCount: number;
  permissionLevel: ContactPermissionLevel;
}) {
  for (const [field, value] of Object.entries(input)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
  }
  return {
    event: "referral_local_funnel_aggregate",
    selected_count: input.selectedCount,
    ranked_count: input.rankedCount,
    permission_level: input.permissionLevel,
    contains_contact_identifiers: false as const
  };
}
