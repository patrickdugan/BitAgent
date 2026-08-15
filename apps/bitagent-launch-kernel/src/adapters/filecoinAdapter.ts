import { infrastructureConfig } from "../config.js";
import type { InfrastructurePlan, InfrastructureQuote } from "../economy/types.js";
import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";

export const FILECOIN_CALIBRATION = {
  network: "calibration",
  chainId: 314159,
  rpcUrl: infrastructureConfig.filecoinCalibrationRpc
} as const;

export function prepareFilecoinStoragePlan(input: {
  quote: InfrastructureQuote;
  payloadCid: string;
  pieceCid?: string;
  sizeBytes: string;
  durationEpochs: number;
  clientAddress?: string;
  providerAddress?: string;
}): InfrastructurePlan {
  if (input.quote.provider !== "filecoin" || input.quote.service !== "storage") {
    throw new IntegrationBoundaryError("filecoin_deal_error", "Filecoin storage preparation requires a Filecoin storage quote");
  }
  if (!/^[1-9][0-9]*$/.test(input.sizeBytes) || input.durationEpochs <= 0 || !input.payloadCid.trim()) {
    throw new IntegrationBoundaryError("filecoin_deal_error", "Invalid Filecoin storage plan fields");
  }
  const payload = {
    network: FILECOIN_CALIBRATION.network,
    chainId: FILECOIN_CALIBRATION.chainId,
    dealMode: "direct",
    payloadCid: input.payloadCid,
    pieceCid: input.pieceCid,
    sizeBytes: input.sizeBytes,
    durationEpochs: input.durationEpochs,
    clientAddress: input.clientAddress,
    providerAddress: input.providerAddress,
    signed: false,
    published: false
  };
  return {
    provider: "filecoin",
    status: input.clientAddress && input.providerAddress && input.pieceCid ? "prepared" : "mock",
    quote: input.quote,
    payload,
    payloadHash: canonicalHash(payload),
    submitAuthority: "external_capability_broker"
  };
}

export async function probeFilecoinCalibration(
  rpcUrl: string = FILECOIN_CALIBRATION.rpcUrl,
  timeoutMs = 5_000
): Promise<{ healthy: boolean; height?: number; headKey?: unknown; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "Filecoin.ChainHead", params: [] }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { result?: { Height?: number; Cids?: unknown }; error?: { message?: string } };
    if (!body.result || typeof body.result.Height !== "number") throw new Error(body.error?.message || "Missing chain head");
    return { healthy: true, height: body.result.Height, headKey: body.result.Cids };
  } catch (error) {
    return { healthy: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

