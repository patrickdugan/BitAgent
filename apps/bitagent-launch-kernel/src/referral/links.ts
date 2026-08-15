import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  CANONICAL_REFERRAL_FIELDS,
  CANONICAL_REFERRAL_PATH,
  REFERRAL_POLICY_VERSION
} from "./config.js";
import {
  AcquisitionMode,
  BeneficiaryKind,
  InvitationActor,
  type InvitationRecord
} from "./types.js";

function safePolicy(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/.test(value)) throw new Error("Referral policy version is malformed");
  return value;
}

function signatureMaterial(invitationId: string, policyVersion: string) {
  return `bitagent-referral\n${invitationId}\n${policyVersion}`;
}

function sign(secret: Buffer, invitationId: string, policyVersion: string) {
  return createHmac("sha256", secret).update(signatureMaterial(invitationId, policyVersion)).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class ReferralLinkService {
  private readonly origin: string;

  constructor(
    private readonly secret: Buffer,
    baseUrl = "https://bitagent.local"
  ) {
    if (secret.length < 32) throw new Error("Referral signing key must be at least 32 bytes");
    const base = new URL(baseUrl);
    this.origin = base.origin;
  }

  issue(input: {
    referrerPrincipalId: string;
    sourceAgentId?: string;
    beneficiaryKind?: BeneficiaryKind.HUMAN_PRINCIPAL | BeneficiaryKind.ORGANIZATION_PRINCIPAL;
    acquisitionMode: AcquisitionMode.HUMAN_MANUAL_SHARE | AcquisitionMode.AGENT_ASSISTED_SHARE;
    invitationActor: InvitationActor.HUMAN | InvitationActor.AGENT_ASSISTED;
    now?: Date;
    expiresAt?: Date;
  }): { invitation: InvitationRecord; url: string } {
    const now = input.now || new Date();
    const expiresAt = input.expiresAt || new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (!input.referrerPrincipalId.trim()) throw new Error("Referrer principal is required");
    if (expiresAt.getTime() <= now.getTime()) throw new Error("Invitation expiry must be in the future");
    if (input.acquisitionMode === AcquisitionMode.AGENT_ASSISTED_SHARE && !input.sourceAgentId) {
      throw new Error("Agent-assisted invitation requires source agent provenance");
    }
    if (input.acquisitionMode === AcquisitionMode.AGENT_ASSISTED_SHARE
      && input.invitationActor !== InvitationActor.AGENT_ASSISTED) {
      throw new Error("Agent-assisted acquisition requires agent-assisted invitation provenance");
    }
    if (input.acquisitionMode === AcquisitionMode.HUMAN_MANUAL_SHARE
      && input.invitationActor !== InvitationActor.HUMAN) {
      throw new Error("Human manual acquisition requires a human invitation actor");
    }
    const invitationId = randomBytes(16).toString("base64url");
    const policyVersion = safePolicy(REFERRAL_POLICY_VERSION);
    const signature = sign(this.secret, invitationId, policyVersion);
    const invitation: InvitationRecord = {
      invitation_id: invitationId,
      referrer_principal_id: input.referrerPrincipalId,
      source_agent_id: input.sourceAgentId,
      beneficiary_kind: input.beneficiaryKind || BeneficiaryKind.HUMAN_PRINCIPAL,
      acquisition_mode: input.acquisitionMode,
      invitation_actor: input.invitationActor,
      policy_version: policyVersion,
      issued_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      signature,
      status: "ISSUED",
      coarse_status: "invitation_prepared"
    };
    return { invitation, url: this.buildUrl(invitationId, policyVersion, signature) };
  }

  buildUrl(invitationId: string, policyVersion: string, signature: string) {
    if (!/^[a-zA-Z0-9_-]{22}$/.test(invitationId)) throw new Error("Invitation identifier is malformed");
    if (!/^[a-zA-Z0-9_-]{43}$/.test(signature)) throw new Error("Referral signature is malformed");
    const url = new URL(CANONICAL_REFERRAL_PATH, this.origin);
    url.searchParams.set("invitation", invitationId);
    url.searchParams.set("policy", safePolicy(policyVersion));
    url.searchParams.set("sig", signature);
    return url.toString();
  }

  verify(value: string) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Referral link is malformed");
    }
    if (url.origin !== this.origin || url.pathname !== CANONICAL_REFERRAL_PATH || url.hash
      || url.username || url.password) {
      throw new Error("Referral link origin or path is not canonical");
    }
    const keys = [...url.searchParams.keys()];
    if (keys.length !== CANONICAL_REFERRAL_FIELDS.length
      || keys.some((key) => !CANONICAL_REFERRAL_FIELDS.includes(key as never))
      || CANONICAL_REFERRAL_FIELDS.some((key) => url.searchParams.getAll(key).length !== 1)) {
      throw new Error("Referral link contains unapproved or duplicate fields");
    }
    const invitationId = String(url.searchParams.get("invitation") || "");
    const policyVersion = safePolicy(String(url.searchParams.get("policy") || ""));
    const signature = String(url.searchParams.get("sig") || "");
    const canonical = this.buildUrl(invitationId, policyVersion, signature);
    if (url.toString() !== canonical) throw new Error("Referral link is not canonically encoded");
    if (!safeEqual(signature, sign(this.secret, invitationId, policyVersion))) {
      throw new Error("Referral signature is invalid");
    }
    return { invitationId, policyVersion, signature, canonicalUrl: canonical };
  }
}

export function referralSigningKeyFromEnvironment() {
  const encoded = String(process.env.BITAGENT_REFERRAL_SIGNING_KEY || "").trim();
  if (!encoded) throw new Error("BITAGENT_REFERRAL_SIGNING_KEY is required for signed referral links");
  const secret = Buffer.from(encoded, "base64url");
  if (secret.length < 32) throw new Error("BITAGENT_REFERRAL_SIGNING_KEY must decode to at least 32 bytes");
  return secret;
}
