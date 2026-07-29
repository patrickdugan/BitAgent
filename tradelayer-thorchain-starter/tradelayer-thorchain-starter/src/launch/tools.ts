import { BitAgentLaunchKernel } from "./kernel.js";
import { LaunchKernelError } from "./errors.js";

type JsonSchema = {
  type: "object";
  additionalProperties: false;
  required: string[];
  properties: Record<string, Record<string, unknown>>;
};

const workflowId = { type: "string", minLength: 1, maxLength: 128 };

export const launchToolSchemas: Record<string, JsonSchema> = {
  "bitagent.wallet.connect": {
    type: "object",
    additionalProperties: false,
    required: ["workflowId", "mode"],
    properties: {
      workflowId,
      mode: { type: "string", enum: ["create", "connect"] },
      publicAddress: { type: "string" },
      walletSessionId: { type: "string" }
    }
  },
  "bitagent.deposit.prepare": {
    type: "object",
    additionalProperties: false,
    required: ["workflowId"],
    properties: { workflowId }
  },
  "bitagent.deposit.observe": {
    type: "object",
    additionalProperties: false,
    required: ["workflowId", "txid", "vout", "amountSats", "blockHeight", "currentHeight"],
    properties: {
      workflowId,
      txid: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
      vout: { type: "integer", minimum: 0 },
      amountSats: { type: "string", pattern: "^[1-9][0-9]*$" },
      blockHeight: { type: ["integer", "null"], minimum: 0 },
      currentHeight: { type: "integer", minimum: 0 }
    }
  },
  "bitagent.strategy.simulate": {
    type: "object",
    additionalProperties: false,
    required: ["workflowId", "amountSats"],
    properties: {
      workflowId,
      amountSats: { type: "string", pattern: "^[1-9][0-9]*$" }
    }
  },
  "bitagent.withdraw.simulate": {
    type: "object",
    additionalProperties: false,
    required: ["workflowId", "destinationAddress", "amountSats"],
    properties: {
      workflowId,
      destinationAddress: { type: "string", minLength: 14, maxLength: 90 },
      amountSats: { type: "string", pattern: "^[1-9][0-9]*$" }
    }
  },
  "bitagent.wallet.request_approval": {
    type: "object",
    additionalProperties: false,
    required: ["workflowId"],
    properties: { workflowId }
  },
  "bitagent.wallet.resolve_approval": {
    type: "object",
    additionalProperties: false,
    required: ["workflowId", "decision"],
    properties: {
      workflowId,
      decision: { type: "string", enum: ["approve", "reject", "cancel"] }
    }
  },
  "bitagent.action.execute": {
    type: "object",
    additionalProperties: false,
    required: ["workflowId"],
    properties: { workflowId }
  },
  "bitagent.action.verify": {
    type: "object",
    additionalProperties: false,
    required: ["workflowId"],
    properties: { workflowId }
  },
  "bitagent.workflow.get": {
    type: "object",
    additionalProperties: false,
    required: ["workflowId"],
    properties: { workflowId }
  }
};

function requireText(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (typeof value !== "string" || !value) {
    throw new LaunchKernelError("validation_error", `${key} is required`);
  }
  return value;
}

export function validateToolArguments(name: string, args: Record<string, unknown>) {
  const schema = launchToolSchemas[name];
  if (!schema) throw new LaunchKernelError("intent_unsupported", `Unknown tool: ${name}`);
  const unexpected = Object.keys(args).filter((key) => !(key in schema.properties));
  if (unexpected.length) {
    throw new LaunchKernelError("validation_error", `Unexpected tool arguments: ${unexpected.join(", ")}`);
  }
  const missing = schema.required.filter((key) => args[key] === undefined);
  if (missing.length) {
    throw new LaunchKernelError("validation_error", `Missing tool arguments: ${missing.join(", ")}`);
  }
  if (name === "bitagent.wallet.connect" && !["create", "connect"].includes(String(args.mode))) {
    throw new LaunchKernelError("validation_error", "mode must be create or connect");
  }
  if (name === "bitagent.wallet.resolve_approval"
    && !["approve", "reject", "cancel"].includes(String(args.decision))) {
    throw new LaunchKernelError("validation_error", "decision must be approve, reject, or cancel");
  }
  for (const key of ["amountSats"]) {
    if (args[key] !== undefined && !/^[1-9][0-9]*$/.test(String(args[key]))) {
      throw new LaunchKernelError("validation_error", `${key} must be a positive integer string`);
    }
  }
}

export class LaunchToolRegistry {
  constructor(private readonly kernel: BitAgentLaunchKernel) {}

  async call(name: string, args: Record<string, unknown>) {
    validateToolArguments(name, args);
    const workflowId = requireText(args, "workflowId");
    switch (name) {
      case "bitagent.wallet.connect":
        return this.kernel.connectWallet(workflowId, {
          mode: args.mode === "create" ? "create" : "connect",
          publicAddress: typeof args.publicAddress === "string" ? args.publicAddress : undefined,
          walletSessionId: typeof args.walletSessionId === "string" ? args.walletSessionId : undefined
        });
      case "bitagent.deposit.prepare":
        return this.kernel.prepareDeposit(workflowId);
      case "bitagent.deposit.observe":
        return this.kernel.observeDeposit(workflowId, {
          txid: requireText(args, "txid"),
          vout: Number(args.vout),
          amountSats: requireText(args, "amountSats"),
          blockHeight: args.blockHeight === null ? null : Number(args.blockHeight),
          currentHeight: Number(args.currentHeight)
        });
      case "bitagent.strategy.simulate":
        return this.kernel.simulateStrategy(workflowId, {
          amountSats: requireText(args, "amountSats")
        });
      case "bitagent.withdraw.simulate":
        return this.kernel.simulateWithdrawal(workflowId, {
          destinationAddress: requireText(args, "destinationAddress"),
          amountSats: requireText(args, "amountSats")
        });
      case "bitagent.wallet.request_approval":
        return this.kernel.requestApproval(workflowId);
      case "bitagent.wallet.resolve_approval":
        return this.kernel.resolveApproval(
          workflowId,
          args.decision === "approve" ? "approve" : args.decision === "cancel" ? "cancel" : "reject"
        );
      case "bitagent.action.execute":
        return this.kernel.execute(workflowId);
      case "bitagent.action.verify":
        return this.kernel.verify(workflowId);
      case "bitagent.workflow.get":
        return this.kernel.getPublic(workflowId);
      default:
        throw new LaunchKernelError("intent_unsupported", `Unknown tool: ${name}`);
    }
  }
}
