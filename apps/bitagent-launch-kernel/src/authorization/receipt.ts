import crypto, { type KeyObject } from "node:crypto";

import {
  AuthorizationError,
  HEX32,
  IDENTIFIER,
  canonicalJson,
  readAtoms,
  readEnum,
  readObject,
  readString,
  readTimestamp,
  requireKeys,
  sha256Hex
} from "./canonical.js";
import {
  CURRENCY,
  MCC,
  MERCHANT_ID,
  expectedAmountUnit,
  looksLikePan,
  normalizeNodeId,
  normalizeOnchainAddress,
  supportsOnchainNetwork
} from "./rails.js";
import type {
  AuthorizationDestination,
  AuthorizationGrant,
  AuthorizationInstrument,
  AuthorizationReason,
  AuthorizationReceipt,
  RevocationState,
  SignedRevocation,
  UsageMode
} from "./types.js";

/** Domain prefixes keep a signature over one document type from verifying as another. */
export const GRANT_SIGNING_DOMAIN = "bitagent/authorization-grant/v1\n";
export const REVOCATION_SIGNING_DOMAIN = "bitagent/authorization-revocation/v1\n";

const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const REASON_TEXT = /^[\x20-\x7e]{1,256}$/;
const CODE = "receipt_malformed" as const;

function readInstrument(value: unknown): AuthorizationInstrument {
  const input = readObject(value, "grant.instrument", CODE);
  const rail = readEnum(input.rail, "grant.instrument.rail", CODE, ["card", "lightning", "onchain"] as const);
  if (rail === "card") {
    requireKeys(input, ["rail", "instrumentId", "network", "currency"], [], "grant.instrument", CODE);
    const instrumentId = readString(input.instrumentId, "grant.instrument.instrumentId", CODE, IDENTIFIER);
    if (looksLikePan(instrumentId)) throw new AuthorizationError(CODE, "card instruments must be processor tokens, never a card number");
    return {
      rail,
      instrumentId,
      network: readEnum(input.network, "grant.instrument.network", CODE, ["visa", "mastercard", "amex", "discover"] as const),
      currency: readString(input.currency, "grant.instrument.currency", CODE, CURRENCY, 3)
    };
  }
  if (rail === "lightning") {
    requireKeys(input, ["rail", "nodeId", "network"], [], "grant.instrument", CODE);
    return {
      rail,
      nodeId: normalizeNodeId(input.nodeId, "grant.instrument.nodeId", CODE),
      network: readEnum(input.network, "grant.instrument.network", CODE, ["mainnet", "testnet", "testnet4", "signet", "regtest"] as const)
    };
  }
  requireKeys(input, ["rail", "chain", "network", "walletId"], [], "grant.instrument", CODE);
  const chain = readEnum(input.chain, "grant.instrument.chain", CODE, ["bitcoin", "litecoin"] as const);
  const network = readEnum(input.network, "grant.instrument.network", CODE, ["mainnet", "testnet", "testnet4", "signet", "regtest"] as const);
  if (!supportsOnchainNetwork(chain, network)) throw new AuthorizationError(CODE, `${chain} ${network} is not supported`);
  return { rail, chain, network, walletId: readString(input.walletId, "grant.instrument.walletId", CODE, IDENTIFIER) };
}

function readDestination(value: unknown, instrument: AuthorizationInstrument): AuthorizationDestination {
  const input = readObject(value, "grant.destination", CODE);
  if (input.rail !== instrument.rail) throw new AuthorizationError(CODE, "grant.destination.rail must match the instrument rail");
  if (instrument.rail === "card") {
    requireKeys(input, ["rail", "merchantId"], ["mccs"], "grant.destination", CODE);
    const merchantId = readString(input.merchantId, "grant.destination.merchantId", CODE, MERCHANT_ID);
    if (input.mccs === undefined) return { rail: "card", merchantId };
    if (!Array.isArray(input.mccs) || input.mccs.length < 1 || input.mccs.length > 64) {
      throw new AuthorizationError(CODE, "grant.destination.mccs must list 1 to 64 merchant category codes");
    }
    const mccs = [...new Set(input.mccs.map((item, index) => readString(item, `grant.destination.mccs[${index}]`, CODE, MCC, 4)))].sort();
    return { rail: "card", merchantId, mccs };
  }
  if (instrument.rail === "lightning") {
    requireKeys(input, ["rail", "payeeNodeId"], ["paymentHash"], "grant.destination", CODE);
    const payeeNodeId = normalizeNodeId(input.payeeNodeId, "grant.destination.payeeNodeId", CODE);
    if (input.paymentHash === undefined) return { rail: "lightning", payeeNodeId };
    return { rail: "lightning", payeeNodeId, paymentHash: readString(input.paymentHash, "grant.destination.paymentHash", CODE, HEX32, 64) };
  }
  requireKeys(input, ["rail", "address"], [], "grant.destination", CODE);
  return { rail: "onchain", address: normalizeOnchainAddress(instrument.chain, instrument.network, input.address as string, CODE) };
}

function readUsage(value: unknown): UsageMode {
  const input = readObject(value, "grant.usage", CODE);
  const kind = readEnum(input.kind, "grant.usage.kind", CODE, ["one_shot", "multi_use", "metered"] as const);
  if (kind !== "metered") {
    requireKeys(input, ["kind"], [], "grant.usage", CODE);
    return { kind };
  }
  requireKeys(input, ["kind", "meterId"], [], "grant.usage", CODE);
  return { kind, meterId: readString(input.meterId, "grant.usage.meterId", CODE, IDENTIFIER) };
}

/** Validates and normalizes a grant. Throws AuthorizationError("receipt_malformed"). */
export function parseGrant(value: unknown): AuthorizationGrant {
  const input = readObject(value, "grant", CODE);
  requireKeys(
    input,
    ["schema", "principal", "agentId", "instrument", "destination", "maxAmount", "usage", "notBefore", "expiresAt", "revocationHandle", "nonce"],
    [],
    "grant",
    CODE
  );
  if (input.schema !== "bitagent_authorization_grant_v1") throw new AuthorizationError(CODE, "unsupported grant schema");
  const principal = readObject(input.principal, "grant.principal", CODE);
  requireKeys(principal, ["id", "keyId"], [], "grant.principal", CODE);
  const instrument = readInstrument(input.instrument);
  const destination = readDestination(input.destination, instrument);
  const maxAmount = readObject(input.maxAmount, "grant.maxAmount", CODE);
  requireKeys(maxAmount, ["asset", "unit", "value"], [], "grant.maxAmount", CODE);
  const expected = expectedAmountUnit(instrument);
  if (maxAmount.asset !== expected.asset || maxAmount.unit !== expected.unit) {
    throw new AuthorizationError(CODE, `grant.maxAmount must be ${expected.asset} in ${expected.unit} for this instrument`);
  }
  const maxValue = readAtoms(maxAmount.value, "grant.maxAmount.value", CODE);
  if (maxValue === "0") throw new AuthorizationError(CODE, "grant.maxAmount.value must be positive");
  const notBefore = readTimestamp(input.notBefore, "grant.notBefore", CODE);
  const expiresAt = readTimestamp(input.expiresAt, "grant.expiresAt", CODE);
  if (Date.parse(expiresAt) <= Date.parse(notBefore)) throw new AuthorizationError(CODE, "grant.expiresAt must follow notBefore");
  const handle = readObject(input.revocationHandle, "grant.revocationHandle", CODE);
  requireKeys(handle, ["registryId", "serial"], [], "grant.revocationHandle", CODE);
  return {
    schema: "bitagent_authorization_grant_v1",
    principal: {
      id: readString(principal.id, "grant.principal.id", CODE, IDENTIFIER),
      keyId: readString(principal.keyId, "grant.principal.keyId", CODE, IDENTIFIER)
    },
    agentId: readString(input.agentId, "grant.agentId", CODE, IDENTIFIER),
    instrument,
    destination,
    maxAmount: { asset: expected.asset, unit: expected.unit, value: maxValue },
    usage: readUsage(input.usage),
    notBefore,
    expiresAt,
    revocationHandle: {
      registryId: readString(handle.registryId, "grant.revocationHandle.registryId", CODE, IDENTIFIER),
      serial: readString(handle.serial, "grant.revocationHandle.serial", CODE, IDENTIFIER)
    },
    nonce: readString(input.nonce, "grant.nonce", CODE, NONCE)
  };
}

export function grantSigningPayload(grant: AuthorizationGrant): Buffer {
  return Buffer.from(GRANT_SIGNING_DOMAIN + canonicalJson(grant), "utf8");
}

export function receiptIdForGrant(grant: AuthorizationGrant): string {
  return sha256Hex(grantSigningPayload(grant));
}

/** Principal-side issuance: normalizes the grant, signs it, and attaches an initial revocation state. */
export function issueAuthorizationReceipt(grantInput: unknown, privateKey: KeyObject, now: Date): AuthorizationReceipt {
  const grant = parseGrant(grantInput);
  return {
    schema: "bitagent_authorization_receipt_v1",
    receiptId: receiptIdForGrant(grant),
    grant,
    signature: { algorithm: "Ed25519", value: crypto.sign(null, grantSigningPayload(grant), privateKey).toString("base64url") },
    revocation: {
      status: "active",
      registryId: grant.revocationHandle.registryId,
      serial: grant.revocationHandle.serial,
      checkedAt: now.toISOString()
    }
  };
}

/**
 * Parses an untrusted receipt into a fresh object (no aliasing with the caller's copy).
 * The grant must already be in canonical form, because the signature covers that form.
 */
export function parseReceipt(value: unknown): AuthorizationReceipt {
  const input = readObject(value, "receipt", CODE);
  requireKeys(input, ["schema", "receiptId", "grant", "signature", "revocation"], [], "receipt", CODE);
  if (input.schema !== "bitagent_authorization_receipt_v1") throw new AuthorizationError(CODE, "unsupported receipt schema");
  const grant = parseGrant(input.grant);
  if (canonicalJson(grant) !== canonicalJson(input.grant)) throw new AuthorizationError(CODE, "grant is not in canonical form");
  const signature = readObject(input.signature, "receipt.signature", CODE);
  requireKeys(signature, ["algorithm", "value"], [], "receipt.signature", CODE);
  if (signature.algorithm !== "Ed25519") throw new AuthorizationError(CODE, "receipt.signature.algorithm must be Ed25519");
  const revocation = readObject(input.revocation, "receipt.revocation", CODE);
  requireKeys(revocation, ["status", "registryId", "serial", "checkedAt"], ["revokedAt", "reason"], "receipt.revocation", CODE);
  if (revocation.registryId !== grant.revocationHandle.registryId || revocation.serial !== grant.revocationHandle.serial) {
    throw new AuthorizationError(CODE, "receipt.revocation does not match the grant's revocation handle");
  }
  const state: RevocationState = {
    status: readEnum(revocation.status, "receipt.revocation.status", CODE, ["active", "revoked"] as const),
    registryId: grant.revocationHandle.registryId,
    serial: grant.revocationHandle.serial,
    checkedAt: readTimestamp(revocation.checkedAt, "receipt.revocation.checkedAt", CODE)
  };
  if (revocation.revokedAt !== undefined) state.revokedAt = readTimestamp(revocation.revokedAt, "receipt.revocation.revokedAt", CODE);
  if (revocation.reason !== undefined) state.reason = readString(revocation.reason, "receipt.revocation.reason", CODE, REASON_TEXT, 256);
  return {
    schema: "bitagent_authorization_receipt_v1",
    receiptId: readString(input.receiptId, "receipt.receiptId", CODE, HEX32, 64),
    grant,
    signature: { algorithm: "Ed25519", value: readString(signature.value, "receipt.signature.value", CODE, SIGNATURE, 86) },
    revocation: state
  };
}

// ---- principal keys ---------------------------------------------------------------------

export type PrincipalKey = {
  keyId: string;
  principalId: string;
  publicKeyPem: string;
  status: "ACTIVE" | "REVOKED";
  notBefore: string;
  notAfter: string;
};

export class PrincipalKeyStore {
  private readonly keys = new Map<string, PrincipalKey & { key: KeyObject }>();

  constructor(keys: PrincipalKey[]) {
    for (const entry of keys) {
      const notBefore = Date.parse(entry?.notBefore);
      const notAfter = Date.parse(entry?.notAfter);
      if (!entry || !IDENTIFIER.test(entry.keyId) || !IDENTIFIER.test(entry.principalId) || this.keys.has(entry.keyId)
        || !["ACTIVE", "REVOKED"].includes(entry.status) || !Number.isFinite(notBefore) || !Number.isFinite(notAfter) || notBefore >= notAfter) {
        throw new AuthorizationError("invalid_configuration", "invalid or duplicate principal key");
      }
      const key = crypto.createPublicKey(entry.publicKeyPem);
      if (key.asymmetricKeyType !== "ed25519") throw new AuthorizationError("invalid_configuration", "principal keys must be Ed25519");
      this.keys.set(entry.keyId, { ...entry, key });
    }
  }

  /** Host operator action after a key compromise. There is no reverse operation. */
  revokeKey(keyId: string) {
    const entry = this.keys.get(keyId);
    if (entry) entry.status = "REVOKED";
  }

  /** Returns the reasons a signature by keyId on behalf of principalId must be refused at `now`. */
  check(keyId: string, principalId: string, now: Date): { key?: KeyObject; reasons: AuthorizationReason[] } {
    const entry = this.keys.get(keyId);
    if (!entry) return { reasons: ["unknown_signing_key"] };
    if (entry.principalId !== principalId) return { reasons: ["principal_key_mismatch"] };
    if (entry.status === "REVOKED") return { reasons: ["signing_key_revoked"] };
    const nowMs = now.getTime();
    if (nowMs < Date.parse(entry.notBefore) || nowMs >= Date.parse(entry.notAfter)) return { reasons: ["signing_key_not_valid_at_time"] };
    return { key: entry.key, reasons: [] };
  }
}

export function verifyReceiptSignature(receipt: AuthorizationReceipt, keys: PrincipalKeyStore, now: Date): AuthorizationReason[] {
  if (receiptIdForGrant(receipt.grant) !== receipt.receiptId) return ["receipt_id_mismatch"];
  const { key, reasons } = keys.check(receipt.grant.principal.keyId, receipt.grant.principal.id, now);
  if (!key) return reasons;
  const signature = Buffer.from(receipt.signature.value, "base64url");
  if (signature.length !== 64 || !crypto.verify(null, grantSigningPayload(receipt.grant), key, signature)) return ["signature_invalid"];
  return [];
}

// ---- revocation -------------------------------------------------------------------------

export function revocationSigningPayload(revocation: Omit<SignedRevocation, "signature">): Buffer {
  return Buffer.from(REVOCATION_SIGNING_DOMAIN + canonicalJson(revocation), "utf8");
}

export function signRevocation(input: Omit<SignedRevocation, "schema" | "signature">, privateKey: KeyObject): SignedRevocation {
  const material = { schema: "bitagent_authorization_revocation_v1" as const, ...input };
  return { ...material, signature: crypto.sign(null, revocationSigningPayload(material), privateKey).toString("base64url") };
}

/**
 * Append-only revocation registry keyed by (principal, serial). Only an active key of the
 * receipt's own principal can revoke, and nothing can un-revoke.
 */
export class RevocationRegistry {
  private readonly revoked = new Map<string, { revokedAt: string; reason: string; keyId: string }>();

  constructor(readonly registryId: string, private readonly keys: PrincipalKeyStore) {
    if (!IDENTIFIER.test(registryId)) throw new AuthorizationError("invalid_configuration", "invalid registry id");
  }

  revoke(value: unknown, now: Date): { accepted: boolean; reasons: AuthorizationReason[]; state?: RevocationState } {
    let revocation: SignedRevocation;
    try {
      const input = readObject(value, "revocation", "revocation_malformed");
      requireKeys(input, ["schema", "registryId", "principalId", "keyId", "serial", "signedAt", "reason", "signature"], [], "revocation", "revocation_malformed");
      if (input.schema !== "bitagent_authorization_revocation_v1") throw new AuthorizationError("revocation_malformed", "unsupported schema");
      revocation = {
        schema: "bitagent_authorization_revocation_v1",
        registryId: readString(input.registryId, "registryId", "revocation_malformed", IDENTIFIER),
        principalId: readString(input.principalId, "principalId", "revocation_malformed", IDENTIFIER),
        keyId: readString(input.keyId, "keyId", "revocation_malformed", IDENTIFIER),
        serial: readString(input.serial, "serial", "revocation_malformed", IDENTIFIER),
        signedAt: readTimestamp(input.signedAt, "signedAt", "revocation_malformed"),
        reason: readString(input.reason, "reason", "revocation_malformed", REASON_TEXT, 256),
        signature: readString(input.signature, "signature", "revocation_malformed", SIGNATURE, 86)
      };
    } catch (error) {
      return { accepted: false, reasons: [error instanceof AuthorizationError ? (error.code as AuthorizationReason) : "revocation_malformed"] };
    }
    if (revocation.registryId !== this.registryId) return { accepted: false, reasons: ["revocation_registry_mismatch"] };
    const { key, reasons } = this.keys.check(revocation.keyId, revocation.principalId, now);
    if (!key) return { accepted: false, reasons };
    const { signature, ...material } = revocation;
    if (!crypto.verify(null, revocationSigningPayload(material), key, Buffer.from(signature, "base64url"))) {
      return { accepted: false, reasons: ["signature_invalid"] };
    }
    const slot = `${revocation.principalId}\u0000${revocation.serial}`;
    if (!this.revoked.has(slot)) {
      this.revoked.set(slot, { revokedAt: now.toISOString(), reason: revocation.reason, keyId: revocation.keyId });
    }
    return { accepted: true, reasons: [], state: this.status(revocation.principalId, revocation.serial, now) };
  }

  status(principalId: string, serial: string, now: Date): RevocationState {
    const entry = this.revoked.get(`${principalId}\u0000${serial}`);
    const base = { registryId: this.registryId, serial, checkedAt: now.toISOString() };
    return entry ? { status: "revoked", ...base, revokedAt: entry.revokedAt, reason: entry.reason } : { status: "active", ...base };
  }
}
