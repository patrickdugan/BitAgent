import crypto from "node:crypto";
import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";

export type InfrastructureLifecycleState = "quoted" | "authorized" | "launched" | "verified" | "invoiced" | "terminated";

export type InfrastructureLifecycleEvent = {
  sequence: number;
  state: InfrastructureLifecycleState;
  provider: string;
  operationId: string;
  occurredAt: string;
  evidenceHash: string;
  previousHash: string;
  hash: string;
};

const ALLOWED: Record<InfrastructureLifecycleState, InfrastructureLifecycleState[]> = {
  quoted: ["authorized", "terminated"],
  authorized: ["launched", "terminated"],
  launched: ["verified", "terminated"],
  verified: ["invoiced", "terminated"],
  invoiced: ["terminated"],
  terminated: []
};

export class InfrastructureLifecycle {
  private readonly events: InfrastructureLifecycleEvent[] = [];

  constructor(readonly provider: string, readonly operationId: string) {}

  transition(state: InfrastructureLifecycleState, evidence: unknown, occurredAt: string): InfrastructureLifecycleEvent {
    const previous = this.events.at(-1);
    if (!previous && state !== "quoted") throw new IntegrationBoundaryError("compute_lease_error", "Infrastructure lifecycle must start at quoted");
    if (previous && !ALLOWED[previous.state].includes(state)) {
      throw new IntegrationBoundaryError("compute_lease_error", "Invalid infrastructure lifecycle transition", { from: previous.state, to: state });
    }
    const material = {
      sequence: this.events.length,
      state,
      provider: this.provider,
      operationId: this.operationId,
      occurredAt,
      evidenceHash: canonicalHash(evidence),
      previousHash: previous?.hash || "0".repeat(64)
    };
    const event = { ...material, hash: canonicalHash(material) };
    this.events.push(event);
    return { ...event };
  }

  list(): InfrastructureLifecycleEvent[] {
    return this.events.map((event) => ({ ...event }));
  }
}

export function verifyDeterministicOutput(input: { output: Uint8Array | string; expectedSha256: string }): {
  valid: boolean;
  observedSha256: string;
} {
  const observedSha256 = crypto.createHash("sha256").update(input.output).digest("hex");
  return { valid: observedSha256 === input.expectedSha256.toLowerCase(), observedSha256 };
}
