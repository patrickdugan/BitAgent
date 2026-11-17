import crypto, { type KeyObject } from "node:crypto";

import {
  AuthorizationGate,
  AuthorizationToolRegistry,
  HmacCardCaptureVerifier,
  HmacMeterEventVerifier,
  PrincipalKeyStore,
  RevocationRegistry,
  issueAuthorizationReceipt,
  signCardCapture,
  signMeterCharge,
  signRevocation,
  type AuthorizationReceipt,
  type CardCaptureEvidence,
  type DecodedLightningInvoice,
  type MeterChargeEvent,
  type OnchainObservation
} from "../src/authorization/index.js";

export const NOW = new Date("2026-11-17T12:00:00.000Z");
export const AGENT = "agent-alpha";
export const PRINCIPAL = "principal-alice";
export const PRINCIPAL_KEY_ID = "alice-key-1";
export const OTHER_PRINCIPAL = "principal-bob";
export const OTHER_KEY_ID = "bob-key-1";
export const REGISTRY = "bitagent-revocations-1";
export const CARD_SECRET = "card-processor-webhook-secret-0123456789abcdef";
export const METER_SECRET = "meter-provider-secret-0123456789abcdefghijkl";
export const OTHER_METER_SECRET = "other-meter-provider-secret-0123456789abcdef";
export const METER_ID = "meter-gpu-1";
export const OTHER_METER_ID = "meter-gpu-2";
export const CARD_TOKEN = "card_tok_virtual_01";
export const MERCHANT = "merchant_compute_co";
export const ATTACKER_MERCHANT = "merchant_attacker";
export const PAYER_NODE = `02${"11".repeat(32)}`;
export const PAYEE = `02${"ab".repeat(32)}`;
export const ATTACKER_PAYEE = `03${"cd".repeat(32)}`;
// BIP173 test vectors (valid bech32, testnet hrp).
export const DEST_ADDRESS = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
export const ATTACKER_ADDRESS = "tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7";

export const minutes = (count: number) => count * 60_000;
export const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();
const random = (bytes = 16) => crypto.randomBytes(bytes).toString("hex");

export type Rail = "card" | "lightning" | "onchain";

export function grantFor(rail: Rail, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const common = {
    schema: "bitagent_authorization_grant_v1",
    principal: { id: PRINCIPAL, keyId: PRINCIPAL_KEY_ID },
    agentId: AGENT,
    notBefore: at(-minutes(60)),
    expiresAt: at(minutes(24 * 60)),
    revocationHandle: { registryId: REGISTRY, serial: `serial-${random(6)}` },
    nonce: random()
  };
  const rails: Record<Rail, Record<string, unknown>> = {
    card: {
      instrument: { rail: "card", instrumentId: CARD_TOKEN, network: "visa", currency: "USD" },
      destination: { rail: "card", merchantId: MERCHANT, mccs: ["7372"] },
      maxAmount: { asset: "USD", unit: "minor", value: "5000" },
      usage: { kind: "one_shot" }
    },
    lightning: {
      instrument: { rail: "lightning", nodeId: PAYER_NODE, network: "testnet4" },
      destination: { rail: "lightning", payeeNodeId: PAYEE },
      maxAmount: { asset: "BTC", unit: "msat", value: "100000000" },
      usage: { kind: "multi_use" }
    },
    onchain: {
      instrument: { rail: "onchain", chain: "bitcoin", network: "testnet4", walletId: "agent-hot-wallet" },
      destination: { rail: "onchain", address: DEST_ADDRESS },
      maxAmount: { asset: "BTC", unit: "sat", value: "200000" },
      usage: { kind: "one_shot" }
    }
  };
  return { ...common, ...rails[rail], ...overrides };
}

export function createWorld(options: { minConfirmations?: number; agentId?: string } = {}) {
  const clock = { now: NOW };
  const principal = crypto.generateKeyPairSync("ed25519");
  const other = crypto.generateKeyPairSync("ed25519");
  const pem = (key: KeyObject) => key.export({ type: "spki", format: "pem" }).toString();
  const keys = new PrincipalKeyStore([
    { keyId: PRINCIPAL_KEY_ID, principalId: PRINCIPAL, publicKeyPem: pem(principal.publicKey), status: "ACTIVE", notBefore: at(-minutes(60 * 24 * 365)), notAfter: at(minutes(60 * 24 * 365)) },
    { keyId: OTHER_KEY_ID, principalId: OTHER_PRINCIPAL, publicKeyPem: pem(other.publicKey), status: "ACTIVE", notBefore: at(-minutes(60 * 24 * 365)), notAfter: at(minutes(60 * 24 * 365)) }
  ]);
  const registry = new RevocationRegistry(REGISTRY, keys);
  const invoices = new Map<string, DecodedLightningInvoice>();
  const chain = new Map<string, OnchainObservation>();
  const observerCalls: string[] = [];
  const gate = new AuthorizationGate({
    agentId: options.agentId ?? AGENT,
    keys,
    revocations: registry,
    ticketKey: crypto.randomBytes(32),
    lightningDecoder: {
      decode: async (invoice) => {
        const decoded = invoices.get(invoice);
        if (!decoded) throw new Error("unknown invoice");
        return { ...decoded };
      }
    },
    onchainObserverFor: (instrument) =>
      instrument.chain === "bitcoin" && instrument.network === "testnet4"
        ? {
            observeWithdrawal: async (txid) => {
              observerCalls.push(txid);
              const observation = chain.get(txid);
              return observation ? structuredClone(observation) : { txid, state: "missing", confirmations: 0, outputs: [] };
            }
          }
        : undefined,
    cardVerifier: new HmacCardCaptureVerifier(CARD_SECRET),
    meterVerifier: new HmacMeterEventVerifier({ [METER_ID]: METER_SECRET, [OTHER_METER_ID]: OTHER_METER_SECRET }),
    now: () => clock.now,
    minConfirmations: options.minConfirmations ?? 1
  });
  const dispatched: string[] = [];
  const tools = new AuthorizationToolRegistry(gate, (ticket) => {
    dispatched.push(ticket);
  });

  return {
    clock,
    keys,
    registry,
    gate,
    tools,
    dispatched,
    invoices,
    chain,
    observerCalls,
    principalKey: principal.privateKey,
    otherKey: other.privateKey,

    issue(rail: Rail, overrides: Record<string, unknown> = {}, signer: KeyObject = principal.privateKey): AuthorizationReceipt {
      return issueAuthorizationReceipt(grantFor(rail, overrides), signer, clock.now);
    },

    revoke(receipt: AuthorizationReceipt, reason = "principal withdrew authority") {
      return registry.revoke(
        signRevocation(
          { registryId: REGISTRY, principalId: PRINCIPAL, keyId: PRINCIPAL_KEY_ID, serial: receipt.grant.revocationHandle.serial, signedAt: clock.now.toISOString(), reason },
          principal.privateKey
        ),
        clock.now
      );
    },

    invoice(input: { amountMsat?: string; payee?: string; network?: DecodedLightningInvoice["network"]; expiresAt?: string } = {}) {
      const preimage = random(32);
      const paymentHash = crypto.createHash("sha256").update(Buffer.from(preimage, "hex")).digest("hex");
      const invoice = `lntb${random(20)}`;
      invoices.set(invoice, {
        network: input.network ?? "testnet4",
        payeeNodeId: input.payee ?? PAYEE,
        paymentHash,
        ...(input.amountMsat === "" ? {} : { amountMsat: input.amountMsat ?? "2500000" }),
        expiresAt: input.expiresAt ?? at(minutes(30))
      });
      return { invoice, preimage, paymentHash };
    },

    tx(input: Partial<OnchainObservation> & { outputs: OnchainObservation["outputs"] }) {
      const txid = random(32);
      chain.set(txid, { txid, state: "confirmed", confirmations: 3, feeSats: "500", ...input });
      return txid;
    },

    capture(attemptId: string, overrides: Partial<CardCaptureEvidence> = {}, secret = CARD_SECRET): CardCaptureEvidence {
      const { signature: _ignored, ...fields } = {
        rail: "card" as const,
        processorEventId: `evt_${random(8)}`,
        reference: attemptId,
        instrumentId: CARD_TOKEN,
        merchantId: MERCHANT,
        amountMinor: "1200",
        currency: "USD",
        authorizationCode: "A1B2C3",
        signature: "",
        ...overrides
      };
      return signCardCapture(fields, secret);
    },

    meterEvent(receipt: AuthorizationReceipt, overrides: Partial<MeterChargeEvent> = {}, secret = METER_SECRET): MeterChargeEvent {
      const { signature: _ignored, ...fields } = {
        receiptId: receipt.receiptId,
        meterId: METER_ID,
        eventId: `meter-evt-${random(6)}`,
        sequence: 1,
        windowStart: at(-minutes(30)),
        windowEnd: at(-minutes(20)),
        quantity: "10",
        unitPrice: "25",
        amount: "250",
        signature: "",
        ...overrides
      };
      return signMeterCharge(fields, secret);
    }
  };
}

export type World = ReturnType<typeof createWorld>;

export function cardAction(overrides: Record<string, unknown> = {}) {
  return { rail: "card", idempotencyKey: `card-${random(6)}`, merchantId: MERCHANT, mcc: "7372", amountMinor: "1200", currency: "USD", ...overrides };
}

export function lightningAction(invoice: string, overrides: Record<string, unknown> = {}) {
  return { rail: "lightning", idempotencyKey: `ln-${random(6)}`, invoice, maxFeeMsat: "5000", ...overrides };
}

export function onchainAction(overrides: Record<string, unknown> = {}) {
  return { rail: "onchain", idempotencyKey: `btc-${random(6)}`, address: DEST_ADDRESS, amountSats: "150000", maxFeeSats: "1000", ...overrides };
}

/** Authorize and claim in one step, as host plus executor would. */
export async function authorizeAndClaim(world: World, receipt: AuthorizationReceipt, action: Record<string, unknown>) {
  const decision = await world.gate.authorize({ receipt, action });
  if (decision.decision !== "authorized" || !decision.ticket) throw new Error(`expected authorization, got ${decision.reasons.join(",")}`);
  const claim = await world.gate.claim(decision.ticket);
  if (!claim.claimed) throw new Error(`expected claim, got ${claim.reasons.join(",")}`);
  return { decision, order: claim.order, attemptId: decision.attemptId!, ticket: decision.ticket };
}
