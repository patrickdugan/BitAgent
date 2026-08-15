import type { InfrastructurePlan, InfrastructureQuote } from "../economy/types.js";
import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";
import type { ComputeResources } from "./computeMarketAdapter.js";

function basePlan(provider: "bacalhau" | "golem", quote: InfrastructureQuote, payload: Record<string, unknown>): InfrastructurePlan {
  if (quote.provider !== provider || quote.service !== "compute") {
    throw new IntegrationBoundaryError("compute_lease_error", `${provider} adapter received an incompatible quote`);
  }
  return {
    provider,
    status: quote.mode === "mock" ? "mock" : "prepared",
    quote,
    payload,
    payloadHash: canonicalHash(payload),
    submitAuthority: "external_capability_broker"
  };
}

export function prepareBacalhauJob(input: {
  quote: InfrastructureQuote;
  jobId: string;
  image: string;
  command: string[];
  inputCid: string;
  expectedOutputSha256: string;
  resources: ComputeResources;
}): InfrastructurePlan {
  const payload = {
    apiVersion: "V1beta1",
    name: input.jobId,
    type: "batch",
    engine: { type: "docker", params: { image: input.image, entrypoint: input.command } },
    inputs: [{ source: `ipfs://${input.inputCid}`, target: "/inputs" }],
    resources: input.resources,
    outputVerification: { algorithm: "sha256", expected: input.expectedOutputSha256 },
    submitted: false
  };
  return basePlan("bacalhau", input.quote, payload);
}

export function prepareGolemTask(input: {
  quote: InfrastructureQuote;
  taskId: string;
  imageHash: string;
  command: string[];
  expectedOutputSha256: string;
  timeoutSeconds: number;
}): InfrastructurePlan {
  const payload = {
    api: "golem-js-task-v1",
    taskId: input.taskId,
    package: { imageHash: input.imageHash },
    commands: input.command,
    timeoutSeconds: input.timeoutSeconds,
    payment: { mode: "pay_as_you_go", cap: input.quote.providerPrice },
    outputVerification: { algorithm: "sha256", expected: input.expectedOutputSha256 },
    submitted: false
  };
  return basePlan("golem", input.quote, payload);
}

