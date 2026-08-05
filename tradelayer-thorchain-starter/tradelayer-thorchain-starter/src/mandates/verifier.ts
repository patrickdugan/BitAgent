import { canonicalJson, hashObject, opaqueId } from "../launch/canonical.js";
import { buildStrategyCandidate, candidateCore } from "./allocator.js";
import { StrategyMandateError } from "./errors.js";
import type {
  StrategyCandidate,
  StrategyCandidateVerification,
  StrategyCovenant,
  StrategyCovenantApproval,
  StrategyDecisionReceipt,
  StrategyMarketSnapshot,
  StrategyPortfolioState,
  StrategyProposal
} from "./types.js";

export type StrategyVerificationInput = {
  candidate: StrategyCandidate;
  covenant: StrategyCovenant;
  approval: StrategyCovenantApproval;
  proposals: StrategyProposal[];
  market: StrategyMarketSnapshot;
  portfolio: StrategyPortfolioState;
  networkFeeSats: string;
  now: Date;
};

export function verifyStrategyCandidate(input: StrategyVerificationInput): StrategyCandidateVerification {
  const reasons: string[] = [];
  let expected: StrategyCandidate | undefined;
  if (input.candidate.schema !== "bitagent_strategy_candidate_v1") reasons.push("candidate_schema_invalid");
  if (hashObject(candidateCore(input.candidate)) !== input.candidate.candidateHash) reasons.push("candidate_hash_invalid");
  if (opaqueId("strategy_candidate", candidateCore(input.candidate)) !== input.candidate.candidateId) reasons.push("candidate_id_invalid");
  if (input.candidate.authority !== "deterministic_host" || input.candidate.effect !== "none") reasons.push("candidate_authority_invalid");
  if (input.candidate.signingPerformed !== false || input.candidate.broadcastPerformed !== false) reasons.push("unauthorized_effect_claim");
  if (Date.parse(input.candidate.expiresAt) <= input.now.getTime()) reasons.push("candidate_expired");
  try {
    expected = buildStrategyCandidate({
      covenant: input.covenant,
      approval: input.approval,
      proposals: input.proposals,
      market: input.market,
      portfolio: input.portfolio,
      networkFeeSats: input.networkFeeSats,
      now: input.now
    });
    if (canonicalJson(expected) !== canonicalJson(input.candidate)) reasons.push("candidate_recomputation_mismatch");
  } catch (error) {
    reasons.push(error instanceof StrategyMandateError ? error.code : "candidate_recomputation_failed");
  }
  const core = {
    schema: "bitagent_strategy_candidate_verification_v1" as const,
    candidateHash: input.candidate.candidateHash,
    covenantHash: input.covenant.covenantHash,
    verified: reasons.length === 0,
    reasonCodes: [...new Set(reasons)],
    checkedAt: input.now.toISOString(),
    verifierHash: input.covenant.runtime.verifierHash,
    nextAuthority: expected?.nextAuthority || "none" as const
  };
  return { ...core, attestationHash: hashObject(core) };
}

export function decisionReceiptCore(receipt: StrategyDecisionReceipt) {
  const { receiptId: _id, receiptHash: _hash, ...core } = receipt;
  return core;
}

export function createStrategyDecisionReceipt(input: {
  candidate: StrategyCandidate;
  covenant: StrategyCovenant;
  proposals: StrategyProposal[];
  verification: StrategyCandidateVerification;
}): StrategyDecisionReceipt {
  if (!input.verification.verified
    || input.verification.candidateHash !== input.candidate.candidateHash
    || input.verification.covenantHash !== input.covenant.covenantHash) {
    throw new StrategyMandateError("candidate_invalid", "A verified exact candidate is required for a decision receipt");
  }
  const core = {
    schema: "bitagent_strategy_decision_receipt_v1" as const,
    covenantHash: input.covenant.covenantHash,
    baseModelHash: input.covenant.runtime.baseModelHash,
    adapterHashes: input.proposals.map((proposal) => proposal.adapterHash),
    allocatorHash: input.covenant.runtime.allocatorHash,
    verifierHash: input.covenant.runtime.verifierHash,
    marketSnapshotHash: input.candidate.marketSnapshotHash,
    proposalRoot: input.candidate.proposalRoot,
    candidateHash: input.candidate.candidateHash,
    verifierAttestationHash: input.verification.attestationHash,
    action: input.candidate.action,
    weightedTargetNetDeltaBps: input.candidate.weightedTargetNetDeltaBps,
    projectedNetDeltaBps: input.candidate.projectedNetDeltaBps,
    createdAt: input.verification.checkedAt,
    authority: "deterministic_host" as const,
    effect: "none" as const,
    signingPerformed: false as const,
    broadcastPerformed: false as const
  };
  return {
    receiptId: opaqueId("strategy_receipt", core),
    receiptHash: hashObject(core),
    ...core
  };
}

export function verifyStrategyDecisionReceipt(receipt: StrategyDecisionReceipt) {
  return receipt.schema === "bitagent_strategy_decision_receipt_v1"
    && receipt.authority === "deterministic_host"
    && receipt.effect === "none"
    && receipt.signingPerformed === false
    && receipt.broadcastPerformed === false
    && receipt.receiptHash === hashObject(decisionReceiptCore(receipt))
    && receipt.receiptId === opaqueId("strategy_receipt", decisionReceiptCore(receipt));
}
