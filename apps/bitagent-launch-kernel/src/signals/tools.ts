import { SignalKernelError } from "./errors.js";
import { CommittedSignalKernel } from "./kernel.js";

type JsonSchema = {
  type: "object";
  additionalProperties: false;
  required: string[];
  properties: Record<string, Record<string, unknown>>;
};

const workflowId = { type: "string", minLength: 1, maxLength: 128 };
const signalSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema", "signalId", "codebase", "producerKeyId", "strategyId", "strategyVersion", "market", "side",
    "amountSats", "limitPriceUsd", "postOnly", "generatedAt", "expiresAt", "inputSnapshotHash", "payloadHash", "signature"
  ],
  properties: {
    schema: { type: "string", const: "bitagent_tradelayer_signal_v1" },
    signalId: { type: "string", minLength: 1, maxLength: 128 },
    codebase: {
      type: "object",
      additionalProperties: false,
      required: ["codebaseId", "kind", "digest"],
      properties: {
        codebaseId: { type: "string", minLength: 1, maxLength: 64 },
        kind: { type: "string", enum: ["git_commit", "sha256_source_tree"] },
        digest: { type: "string", pattern: "^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$" }
      }
    },
    producerKeyId: { type: "string", minLength: 1, maxLength: 128 },
    strategyId: { type: "string", minLength: 1, maxLength: 128 },
    strategyVersion: { type: "string", minLength: 1, maxLength: 64 },
    market: { type: "string", const: "TLBTC/TLUSD" },
    side: { type: "string", enum: ["buy_tlbtc", "sell_tlbtc"] },
    amountSats: { type: "string", pattern: "^[1-9][0-9]*$" },
    limitPriceUsd: { type: "string", pattern: "^[1-9][0-9]*(?:\\.[0-9]{1,2})?$" },
    postOnly: { type: "boolean", const: true },
    generatedAt: { type: "string", format: "date-time" },
    expiresAt: { type: "string", format: "date-time" },
    inputSnapshotHash: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
    payloadHash: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
    signature: { type: "string", pattern: "^[A-Za-z0-9+/]+={0,2}$" }
  }
};

export const committedSignalToolSchemas: Record<string, JsonSchema> = {
  "bitagent.signal.start": {
    type: "object",
    additionalProperties: false,
    required: ["workflowId"],
    properties: { workflowId }
  },
  "bitagent.signal.ingest": {
    type: "object",
    additionalProperties: false,
    required: ["workflowId", "signal"],
    properties: {
      workflowId,
      signal: signalSchema
    }
  },
  "bitagent.signal.simulate": {
    type: "object",
    additionalProperties: false,
    required: ["workflowId"],
    properties: { workflowId }
  },
  "bitagent.signal.request_approval": {
    type: "object",
    additionalProperties: false,
    required: ["workflowId"],
    properties: { workflowId }
  },
  "bitagent.signal.resolve_approval": {
    type: "object",
    additionalProperties: false,
    required: ["workflowId", "decision"],
    properties: {
      workflowId,
      decision: { type: "string", enum: ["approve", "reject", "cancel"] }
    }
  },
  "bitagent.signal.execute": {
    type: "object",
    additionalProperties: false,
    required: ["workflowId"],
    properties: { workflowId }
  },
  "bitagent.signal.verify": {
    type: "object",
    additionalProperties: false,
    required: ["workflowId"],
    properties: { workflowId }
  },
  "bitagent.signal.get": {
    type: "object",
    additionalProperties: false,
    required: ["workflowId"],
    properties: { workflowId }
  }
};

function requireText(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (typeof value !== "string" || !value) {
    throw new SignalKernelError("signal_schema_error", `${key} is required`);
  }
  return value;
}

export function validateCommittedSignalToolArguments(name: string, args: Record<string, unknown>) {
  const schema = committedSignalToolSchemas[name];
  if (!schema) throw new SignalKernelError("signal_schema_error", `Unknown committed-signal tool: ${name}`);
  const unexpected = Object.keys(args).filter((key) => !(key in schema.properties));
  if (unexpected.length) {
    throw new SignalKernelError("signal_schema_error", `Unexpected tool arguments: ${unexpected.join(", ")}`);
  }
  const missing = schema.required.filter((key) => args[key] === undefined);
  if (missing.length) {
    throw new SignalKernelError("signal_schema_error", `Missing tool arguments: ${missing.join(", ")}`);
  }
  if (name === "bitagent.signal.resolve_approval"
    && !["approve", "reject", "cancel"].includes(String(args.decision))) {
    throw new SignalKernelError("signal_schema_error", "decision must be approve, reject, or cancel");
  }
}

export class CommittedSignalToolRegistry {
  constructor(private readonly kernel: CommittedSignalKernel) {}

  async call(name: string, args: Record<string, unknown>) {
    validateCommittedSignalToolArguments(name, args);
    const id = requireText(args, "workflowId");
    switch (name) {
      case "bitagent.signal.start":
        return this.kernel.start({ workflowId: id });
      case "bitagent.signal.ingest":
        return this.kernel.ingest(id, args.signal);
      case "bitagent.signal.simulate":
        return this.kernel.simulate(id);
      case "bitagent.signal.request_approval":
        return this.kernel.requestApproval(id);
      case "bitagent.signal.resolve_approval":
        return this.kernel.resolveApproval(
          id,
          args.decision === "approve" ? "approve" : args.decision === "cancel" ? "cancel" : "reject"
        );
      case "bitagent.signal.execute":
        return this.kernel.execute(id);
      case "bitagent.signal.verify":
        return this.kernel.verify(id);
      case "bitagent.signal.get":
        return this.kernel.getPublic(id);
      default:
        throw new SignalKernelError("signal_schema_error", `Unknown committed-signal tool: ${name}`);
    }
  }
}
