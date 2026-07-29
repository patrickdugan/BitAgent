import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";

export type AkashBid = {
  provider: string;
  priceUact: string;
  uptimeBps: number;
  completedLeaseCount: number;
  signedByTrustedAuditor: boolean;
};

export function scoreAkashBids(bids: AkashBid[]): Array<AkashBid & { score: number }> {
  return bids.map((bid) => {
    if (!/^[1-9][0-9]*$/.test(bid.priceUact) || bid.uptimeBps < 0 || bid.uptimeBps > 10_000) {
      throw new IntegrationBoundaryError("compute_quote_error", "Invalid Akash bid", bid);
    }
    const pricePenalty = Math.min(4_000, Math.log10(Number(bid.priceUact) + 1) * 500);
    const historyBonus = Math.min(1_000, Math.log10(bid.completedLeaseCount + 1) * 250);
    const auditorBonus = bid.signedByTrustedAuditor ? 1_000 : 0;
    return { ...bid, score: Math.round(bid.uptimeBps + historyBonus + auditorBonus - pricePenalty) };
  }).sort((left, right) => {
    const scoreDifference = right.score - left.score;
    if (scoreDifference !== 0) return scoreDifference;
    return BigInt(left.priceUact) < BigInt(right.priceUact) ? -1 : 1;
  });
}

export function prepareAkashBrokerOperation(input: {
  action: "validate_sdl" | "create_deployment" | "query_bids" | "create_lease" | "upload_manifest" | "status" | "close";
  payload: unknown;
  authorizationHash: string;
}) {
  const operation = {
    schema: "akash_external_broker_operation_v1",
    action: input.action,
    payload: input.payload,
    authorizationHash: input.authorizationHash,
    sdkPackage: "@akashnetwork/chain-sdk@1.0.0-alpha.0",
    requiredRuntime: "node>=22.14.0",
    signerLocation: "external_broker"
  } as const;
  return { ...operation, operationHash: canonicalHash(operation) };
}
