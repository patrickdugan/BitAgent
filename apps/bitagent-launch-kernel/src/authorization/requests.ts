import { AuthorizationError, HEX32, IDENTIFIER, readAtoms, readEnum, readObject, readString, readTimestamp, requireKeys } from "./canonical.js";
import { CURRENCY, MCC, MERCHANT_ID } from "./rails.js";
import type { MeterChargeEvent, PaymentAction, Rail, SettlementEvidence } from "./types.js";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const INVOICE = /^ln[a-z0-9]{1,2046}$/;
const ADDRESS_TEXT = /^[A-Za-z0-9]{14,90}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{16,256}$/;
const AUTH_CODE = /^[A-Za-z0-9]{1,32}$/;

/** Strictly parses an agent's payment request. Throws AuthorizationError("action_malformed"). */
export function parsePaymentAction(value: unknown): PaymentAction {
  const code = "action_malformed" as const;
  const input = readObject(value, "action", code);
  const rail = readEnum(input.rail, "action.rail", code, ["card", "lightning", "onchain"] as const);
  if (rail === "card") {
    requireKeys(input, ["rail", "idempotencyKey", "merchantId", "mcc", "amountMinor", "currency"], [], "action", code);
    return {
      rail,
      idempotencyKey: readString(input.idempotencyKey, "action.idempotencyKey", code, IDEMPOTENCY_KEY),
      merchantId: readString(input.merchantId, "action.merchantId", code, MERCHANT_ID),
      mcc: readString(input.mcc, "action.mcc", code, MCC, 4),
      amountMinor: readAtoms(input.amountMinor, "action.amountMinor", code),
      currency: readString(input.currency, "action.currency", code, CURRENCY, 3)
    };
  }
  if (rail === "lightning") {
    requireKeys(input, ["rail", "idempotencyKey", "invoice", "maxFeeMsat"], [], "action", code);
    return {
      rail,
      idempotencyKey: readString(input.idempotencyKey, "action.idempotencyKey", code, IDEMPOTENCY_KEY),
      invoice: readString(input.invoice, "action.invoice", code, INVOICE, 2048),
      maxFeeMsat: readAtoms(input.maxFeeMsat, "action.maxFeeMsat", code)
    };
  }
  requireKeys(input, ["rail", "idempotencyKey", "address", "amountSats", "maxFeeSats"], [], "action", code);
  return {
    rail,
    idempotencyKey: readString(input.idempotencyKey, "action.idempotencyKey", code, IDEMPOTENCY_KEY),
    address: readString(input.address, "action.address", code, ADDRESS_TEXT, 90),
    amountSats: readAtoms(input.amountSats, "action.amountSats", code),
    maxFeeSats: readAtoms(input.maxFeeSats, "action.maxFeeSats", code)
  };
}

/** Strictly parses rail settlement evidence. Throws AuthorizationError("evidence_malformed"). */
export function parseSettlementEvidence(value: unknown): SettlementEvidence {
  const code = "evidence_malformed" as const;
  const input = readObject(value, "evidence", code);
  const rail: Rail = readEnum(input.rail, "evidence.rail", code, ["card", "lightning", "onchain"] as const);
  if (rail === "card") {
    requireKeys(
      input,
      ["rail", "processorEventId", "reference", "instrumentId", "merchantId", "amountMinor", "currency", "authorizationCode", "signature"],
      [],
      "evidence",
      code
    );
    return {
      rail,
      processorEventId: readString(input.processorEventId, "evidence.processorEventId", code, IDENTIFIER),
      reference: readString(input.reference, "evidence.reference", code, IDENTIFIER),
      instrumentId: readString(input.instrumentId, "evidence.instrumentId", code, IDENTIFIER),
      merchantId: readString(input.merchantId, "evidence.merchantId", code, MERCHANT_ID),
      amountMinor: readAtoms(input.amountMinor, "evidence.amountMinor", code),
      currency: readString(input.currency, "evidence.currency", code, CURRENCY, 3),
      authorizationCode: readString(input.authorizationCode, "evidence.authorizationCode", code, AUTH_CODE, 32),
      signature: readString(input.signature, "evidence.signature", code, SIGNATURE, 256)
    };
  }
  if (rail === "lightning") {
    requireKeys(input, ["rail", "paymentHash", "preimage"], [], "evidence", code);
    return {
      rail,
      paymentHash: readString(input.paymentHash, "evidence.paymentHash", code, HEX32, 64),
      preimage: readString(input.preimage, "evidence.preimage", code, HEX32, 64)
    };
  }
  requireKeys(input, ["rail", "txid"], [], "evidence", code);
  return { rail, txid: readString(input.txid, "evidence.txid", code, HEX32, 64) };
}

/** Strictly parses a metering provider's charge. Throws AuthorizationError("meter_event_malformed"). */
export function parseMeterChargeEvent(value: unknown): MeterChargeEvent {
  const code = "meter_event_malformed" as const;
  const input = readObject(value, "event", code);
  requireKeys(
    input,
    ["receiptId", "meterId", "eventId", "sequence", "windowStart", "windowEnd", "quantity", "unitPrice", "amount", "signature"],
    [],
    "event",
    code
  );
  if (!Number.isSafeInteger(input.sequence) || (input.sequence as number) < 0) {
    throw new AuthorizationError(code, "event.sequence must be a non-negative safe integer");
  }
  return {
    receiptId: readString(input.receiptId, "event.receiptId", code, HEX32, 64),
    meterId: readString(input.meterId, "event.meterId", code, IDENTIFIER),
    eventId: readString(input.eventId, "event.eventId", code, IDENTIFIER),
    sequence: input.sequence as number,
    windowStart: readTimestamp(input.windowStart, "event.windowStart", code),
    windowEnd: readTimestamp(input.windowEnd, "event.windowEnd", code),
    quantity: readAtoms(input.quantity, "event.quantity", code),
    unitPrice: readAtoms(input.unitPrice, "event.unitPrice", code),
    amount: readAtoms(input.amount, "event.amount", code),
    signature: readString(input.signature, "event.signature", code, SIGNATURE, 256)
  };
}
