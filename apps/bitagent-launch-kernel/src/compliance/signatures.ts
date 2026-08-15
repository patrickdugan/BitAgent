import { createPublicKey, verify } from "node:crypto";
import fs from "node:fs/promises";

import { complianceCanonicalJson } from "./policy.js";
import type {
  JurisdictionPolicyHost,
  JurisdictionPolicyQuery,
  JurisdictionPolicyServiceResult,
  SignedJurisdictionPolicyEnvelope
} from "./types.js";

export type PolicyTrustKey = {
  key_id: string;
  algorithm: "Ed25519";
  public_key_pem: string;
  status: "ACTIVE" | "RETIRED" | "REVOKED";
  not_before: string;
  not_after: string;
};

export type PolicyTrustDocument = {
  schema: "bitagent_policy_trust_document_v1";
  keys: PolicyTrustKey[];
};

export function jurisdictionPolicySigningPayload(envelope: SignedJurisdictionPolicyEnvelope): string {
  const { signature: _signature, ...payload } = envelope;
  return complianceCanonicalJson(payload);
}

function validTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class RotatingPolicyTrustStore {
  private readonly keys: Map<string, PolicyTrustKey>;

  constructor(document: PolicyTrustDocument) {
    if (document.schema !== "bitagent_policy_trust_document_v1" || !Array.isArray(document.keys)) {
      throw new Error("Invalid jurisdiction-policy trust document");
    }
    this.keys = new Map();
    for (const key of document.keys) {
      if (!key || key.algorithm !== "Ed25519" || !key.key_id || this.keys.has(key.key_id)
        || !["ACTIVE", "RETIRED", "REVOKED"].includes(key.status)
        || validTime(key.not_before) === null || validTime(key.not_after) === null
        || validTime(key.not_before)! >= validTime(key.not_after)!) {
        throw new Error("Invalid or duplicate jurisdiction-policy trust key");
      }
      createPublicKey(key.public_key_pem);
      this.keys.set(key.key_id, structuredClone(key));
    }
  }

  verify(envelope: SignedJurisdictionPolicyEnvelope, now: Date): boolean {
    const key = this.keys.get(envelope.key_id);
    if (!key || key.status === "REVOKED") return false;
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs) || nowMs < validTime(key.not_before)! || nowMs >= validTime(key.not_after)!) {
      return false;
    }
    let signature: Buffer;
    try {
      signature = Buffer.from(envelope.signature, "base64url");
      if (signature.length !== 64) return false;
      return verify(
        null,
        Buffer.from(jurisdictionPolicySigningPayload(envelope), "utf8"),
        createPublicKey(key.public_key_pem),
        signature
      );
    } catch {
      return false;
    }
  }

  static async fromFile(filePath: string): Promise<RotatingPolicyTrustStore> {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as PolicyTrustDocument;
    return new RotatingPolicyTrustStore(parsed);
  }
}

export class SignedHttpJurisdictionPolicyHost implements JurisdictionPolicyHost {
  constructor(private readonly options: {
    endpoint: string;
    trustStore: RotatingPolicyTrustStore;
    authorization?: string;
    timeoutMs?: number;
    now?: () => Date;
    fetchImpl?: typeof fetch;
  }) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== "https:" && !["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname)) {
      throw new Error("Jurisdiction policy endpoint must use HTTPS outside loopback");
    }
    if (options.timeoutMs !== undefined
      && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 60_000)) {
      throw new Error("Jurisdiction policy timeout must be 100-60000ms");
    }
  }

  now(): Date {
    return this.options.now?.() || new Date();
  }

  verifyPolicyEnvelope(envelope: SignedJurisdictionPolicyEnvelope): boolean {
    return this.options.trustStore.verify(envelope, this.now());
  }

  async getJurisdictionPolicy(query: JurisdictionPolicyQuery): Promise<JurisdictionPolicyServiceResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs || 10_000);
    try {
      const response = await (this.options.fetchImpl || fetch)(this.options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(this.options.authorization ? { authorization: this.options.authorization } : {})
        },
        body: JSON.stringify({ schema: "bitagent_jurisdiction_policy_query_v1", ...query }),
        signal: controller.signal
      });
      if (!response.ok) return { status: "ERROR", reason_code: `POLICY_HTTP_${response.status}` };
      const contentLength = Number(response.headers.get("content-length") || "0");
      if (contentLength > 256_000) return { status: "ERROR", reason_code: "POLICY_RESPONSE_TOO_LARGE" };
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > 256_000) {
        return { status: "ERROR", reason_code: "POLICY_RESPONSE_TOO_LARGE" };
      }
      const value = JSON.parse(text) as JurisdictionPolicyServiceResult;
      if (!value || !["OK", "UNKNOWN", "ERROR"].includes(String(value.status))) {
        return { status: "ERROR", reason_code: "POLICY_RESPONSE_INVALID" };
      }
      return value;
    } catch {
      return { status: "ERROR", reason_code: "POLICY_SERVICE_ERROR" };
    } finally {
      clearTimeout(timeout);
    }
  }
}
