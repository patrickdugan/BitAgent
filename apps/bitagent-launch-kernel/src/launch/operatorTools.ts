import { LaunchKernelError } from "./errors.js";
import {
  readReserveOperatorEvidence,
  type ReserveOperatorEvidencePaths
} from "./operatorEvidence.js";

export const reserveOperatorToolSchemas = {
  "bitagent.operator.reserve_intake": {
    type: "object",
    additionalProperties: false,
    required: [],
    properties: {}
  }
} as const;

export class ReserveOperatorToolRegistry {
  constructor(
    private readonly paths: ReserveOperatorEvidencePaths,
    private readonly now: () => Date = () => new Date()
  ) {}

  async call(name: string, args: Record<string, unknown>) {
    if (name !== "bitagent.operator.reserve_intake") {
      throw new LaunchKernelError("intent_unsupported", `Unknown operator tool: ${name}`);
    }
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length > 0) {
      throw new LaunchKernelError("validation_error", "Reserve operator inspection accepts no model arguments");
    }
    return readReserveOperatorEvidence(this.paths, this.now);
  }
}
