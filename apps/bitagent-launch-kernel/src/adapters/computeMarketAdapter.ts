import type { InfrastructurePlan, InfrastructureProvider, InfrastructureQuote } from "../economy/types.js";
import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";

export type ComputeResources = {
  cpuMillicores: number;
  memoryMiB: number;
  storageMiB: number;
  replicas: number;
};

export interface ComputeMarketAdapter {
  readonly provider: InfrastructureProvider;
  prepare(input: {
    quote: InfrastructureQuote;
    workloadId: string;
    image: string;
    command: string[];
    resources: ComputeResources;
  }): InfrastructurePlan;
}

function renderAkashSdl(input: {
  quote: InfrastructureQuote;
  workloadId: string;
  image: string;
  command: string[];
  resources: ComputeResources;
}): string {
  const cpuUnits = (input.resources.cpuMillicores / 1000).toString();
  return [
    'version: "2.0"',
    "services:",
    `  ${input.workloadId}:`,
    `    image: ${input.image}`,
    `    command: ${JSON.stringify(input.command)}`,
    "    expose:",
    "      - port: 8080",
    "        as: 8080",
    "        to:",
    "          - global: true",
    "profiles:",
    "  compute:",
    `    ${input.workloadId}:`,
    "      resources:",
    `        cpu: { units: ${cpuUnits} }`,
    `        memory: { size: ${input.resources.memoryMiB}Mi }`,
    `        storage: { size: ${input.resources.storageMiB}Mi }`,
    "  placement:",
    "    dcloud:",
    "      pricing:",
    `        ${input.workloadId}:`,
    `          denom: ${input.quote.providerPrice.denomination}`,
    `          amount: ${input.quote.providerPrice.amount}`,
    "deployment:",
    `  ${input.workloadId}:`,
    "    dcloud:",
    "      profile: dcloud",
    `      count: ${input.resources.replicas}`,
    ""
  ].join("\n");
}

export class AkashComputeAdapter implements ComputeMarketAdapter {
  readonly provider = "akash" as const;

  prepare(input: {
    quote: InfrastructureQuote;
    workloadId: string;
    image: string;
    command: string[];
    resources: ComputeResources;
  }): InfrastructurePlan {
    if (input.quote.provider !== "akash" || input.quote.service !== "compute") {
      throw new IntegrationBoundaryError("compute_lease_error", "Akash preparation requires an Akash compute quote");
    }
    if (!/^[a-z][a-z0-9-]{2,31}$/.test(input.workloadId) || !input.image.trim() || input.resources.replicas < 1) {
      throw new IntegrationBoundaryError("compute_lease_error", "Invalid Akash workload fields");
    }
    const payload = {
      network: "akash",
      mode: input.quote.mode,
      workloadId: input.workloadId,
      sdl: renderAkashSdl(input),
      resources: input.resources,
      signed: false,
      leaseCreated: false
    };
    return {
      provider: "akash",
      status: input.quote.mode === "mock" ? "mock" : "prepared",
      quote: input.quote,
      payload,
      payloadHash: canonicalHash(payload),
      submitAuthority: "external_capability_broker"
    };
  }
}

export class GenericComputeAdapter implements ComputeMarketAdapter {
  constructor(readonly provider: "generic" = "generic") {}

  prepare(input: {
    quote: InfrastructureQuote;
    workloadId: string;
    image: string;
    command: string[];
    resources: ComputeResources;
  }): InfrastructurePlan {
    if (input.quote.provider !== this.provider || input.quote.service !== "compute") {
      throw new IntegrationBoundaryError("compute_lease_error", "Compute quote does not match the selected provider");
    }
    const payload = { workloadId: input.workloadId, image: input.image, command: input.command, resources: input.resources };
    return {
      provider: this.provider,
      status: input.quote.mode === "mock" ? "mock" : "prepared",
      quote: input.quote,
      payload,
      payloadHash: canonicalHash(payload),
      submitAuthority: "external_capability_broker"
    };
  }
}
