import { AuthorizationError, readObject, requireKeys } from "./canonical.js";
import type { AuthorizationGate } from "./gate.js";
import type { AuthorizationDecision, MeterChargeResult, ReceiptStatus, SettlementResult } from "./types.js";

type ToolSchema = {
  type: "object";
  additionalProperties: false;
  required: string[];
  properties: Record<string, Record<string, unknown>>;
};

const objectField = { type: "object" };

/**
 * The only payment surface an agent tool gets. Claiming, failing or cancelling an attempt,
 * revoking a receipt and reading executor tickets are host operations and are absent here.
 */
export const authorizationToolSchemas: Record<string, ToolSchema> = {
  "bitagent.authz.inspect": {
    type: "object",
    additionalProperties: false,
    required: ["receipt"],
    properties: { receipt: objectField }
  },
  "bitagent.authz.card.charge": {
    type: "object",
    additionalProperties: false,
    required: ["receipt", "action"],
    properties: { receipt: objectField, action: objectField }
  },
  "bitagent.authz.lightning.pay": {
    type: "object",
    additionalProperties: false,
    required: ["receipt", "action"],
    properties: { receipt: objectField, action: objectField }
  },
  "bitagent.authz.onchain.send": {
    type: "object",
    additionalProperties: false,
    required: ["receipt", "action"],
    properties: { receipt: objectField, action: objectField }
  },
  "bitagent.authz.settlement.submit": {
    type: "object",
    additionalProperties: false,
    required: ["attemptId", "evidence"],
    properties: { attemptId: { type: "string", maxLength: 64 }, evidence: objectField }
  },
  "bitagent.authz.meter.submit": {
    type: "object",
    additionalProperties: false,
    required: ["receipt", "event"],
    properties: { receipt: objectField, event: objectField }
  }
};

const PAYMENT_TOOLS: Record<string, "card" | "lightning" | "onchain"> = {
  "bitagent.authz.card.charge": "card",
  "bitagent.authz.lightning.pay": "lightning",
  "bitagent.authz.onchain.send": "onchain"
};

export type AgentVisibleDecision = Omit<AuthorizationDecision, "ticket">;
export type AuthorizationToolResult = AgentVisibleDecision | SettlementResult | MeterChargeResult | ReceiptStatus;

/** Host hook that receives executor tickets for newly authorized attempts. */
export type TicketDispatch = (ticket: string, decision: AgentVisibleDecision) => void | Promise<void>;

export class AuthorizationToolRegistry {
  constructor(private readonly gate: AuthorizationGate, private readonly dispatch: TicketDispatch) {}

  async call(name: string, args: unknown): Promise<AuthorizationToolResult> {
    if (typeof name !== "string" || !Object.hasOwn(authorizationToolSchemas, name)) {
      throw new AuthorizationError("unknown_tool", `Unknown authorization tool: ${String(name).slice(0, 64)}`);
    }
    const input = readObject(args, "tool arguments", "invalid_arguments");
    requireKeys(input, authorizationToolSchemas[name].required, [], "tool arguments", "invalid_arguments");

    if (name === "bitagent.authz.inspect") return this.gate.inspect(input.receipt);
    if (name === "bitagent.authz.settlement.submit") return this.gate.settle({ attemptId: input.attemptId, evidence: input.evidence });
    if (name === "bitagent.authz.meter.submit") return this.gate.chargeMeter({ receipt: input.receipt, event: input.event });

    const rail = PAYMENT_TOOLS[name];
    const action = readObject(input.action, "action", "invalid_arguments");
    if (action.rail !== rail) throw new AuthorizationError("invalid_arguments", `${name} only accepts ${rail} actions`);
    const { ticket, ...visible } = await this.gate.authorize({ receipt: input.receipt, action });
    if (ticket && !visible.replayed) await this.dispatch(ticket, visible);
    return visible;
  }
}
