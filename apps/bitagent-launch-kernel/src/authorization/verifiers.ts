import { AuthorizationError, constantTimeEqual, hmacBase64url } from "./canonical.js";
import type { CardCaptureEvidence, CardCaptureVerifier, MeterChargeEvent, MeterEventVerifier } from "./types.js";

const CARD_DOMAIN = "bitagent/card-capture/v1\n";
const METER_DOMAIN = "bitagent/meter-charge/v1\n";

function requireSecret(secret: Buffer | string, label: string) {
  if (Buffer.byteLength(secret) < 32) throw new AuthorizationError("invalid_configuration", `${label} must be at least 32 bytes`);
}

/** Processor-side signing of a capture webhook (the processor's own code does this in production). */
export function signCardCapture(evidence: Omit<CardCaptureEvidence, "signature">, secret: Buffer | string): CardCaptureEvidence {
  return { ...evidence, signature: hmacBase64url(secret, CARD_DOMAIN, evidence) };
}

/** Verifies capture webhooks with the processor's shared webhook secret. */
export class HmacCardCaptureVerifier implements CardCaptureVerifier {
  constructor(private readonly secret: Buffer | string) {
    requireSecret(secret, "card processor secret");
  }

  verify(evidence: CardCaptureEvidence): boolean {
    const { signature, ...material } = evidence;
    return constantTimeEqual(signature, hmacBase64url(this.secret, CARD_DOMAIN, material));
  }
}

/** Metering-provider signing of a usage charge. */
export function signMeterCharge(event: Omit<MeterChargeEvent, "signature">, secret: Buffer | string): MeterChargeEvent {
  return { ...event, signature: hmacBase64url(secret, METER_DOMAIN, event) };
}

/** Verifies meter charges with a per-meter secret; an unknown meter never verifies. */
export class HmacMeterEventVerifier implements MeterEventVerifier {
  private readonly secrets: Map<string, Buffer | string>;

  constructor(secrets: Record<string, Buffer | string>) {
    this.secrets = new Map(Object.entries(secrets));
    for (const [meterId, secret] of this.secrets) requireSecret(secret, `meter secret for ${meterId}`);
  }

  verify(event: MeterChargeEvent): boolean {
    const secret = this.secrets.get(event.meterId);
    if (!secret) return false;
    const { signature, ...material } = event;
    return constantTimeEqual(signature, hmacBase64url(secret, METER_DOMAIN, material));
  }
}
