import crypto from "node:crypto";

import type { AuthorizationReason } from "./types.js";

export class AuthorizationError extends Error {
  constructor(
    readonly code: AuthorizationReason | "invalid_configuration" | "unknown_tool" | "invalid_arguments",
    message: string
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

/**
 * Canonical JSON with code-unit key order (not locale order), safe integers only,
 * and plain objects only, so the same document always hashes and signs identically.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) throw new AuthorizationError("invalid_configuration", "canonical numbers must be safe integers");
      return String(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new AuthorizationError("invalid_configuration", "canonical values must be plain objects");
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
    }
    default:
      throw new AuthorizationError("invalid_configuration", `canonical JSON cannot encode ${typeof value}`);
  }
}

export function sha256Hex(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function hmacBase64url(key: Buffer | string, domain: string, value: unknown): string {
  return crypto.createHmac("sha256", key).update(domain).update(canonicalJson(value)).digest("base64url");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- strict readers for untrusted input -------------------------------------------------

type Code = AuthorizationError["code"];

export function readObject(value: unknown, label: string, code: Code): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AuthorizationError(code, `${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new AuthorizationError(code, `${label} must be a plain object`);
  return value as Record<string, unknown>;
}

export function requireKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
  code: Code
) {
  const allowed = new Set([...required, ...optional]);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new AuthorizationError(code, `${label} has unexpected fields: ${unexpected.join(", ")}`);
  const missing = required.filter((key) => value[key] === undefined);
  if (missing.length) throw new AuthorizationError(code, `${label} is missing fields: ${missing.join(", ")}`);
}

export function readString(value: unknown, label: string, code: Code, pattern: RegExp, maximum = 128): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || !pattern.test(value)) {
    throw new AuthorizationError(code, `${label} is invalid`);
  }
  return value;
}

export function readEnum<T extends string>(value: unknown, label: string, code: Code, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new AuthorizationError(code, `${label} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

const ATOMS = /^(0|[1-9][0-9]{0,29})$/;

export function readAtoms(value: unknown, label: string, code: Code): string {
  return readString(value, label, code, ATOMS, 30);
}

/** Accepts only the exact output of Date#toISOString, so one instant has one spelling. */
export function readTimestamp(value: unknown, label: string, code: Code): string {
  if (typeof value !== "string" || value.length > 32) throw new AuthorizationError(code, `${label} must be an ISO timestamp`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new AuthorizationError(code, `${label} must be a canonical ISO-8601 UTC timestamp`);
  }
  return value;
}

export const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
export const HEX32 = /^[0-9a-f]{64}$/;
