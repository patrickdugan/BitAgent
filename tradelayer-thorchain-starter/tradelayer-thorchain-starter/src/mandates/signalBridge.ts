import { hashObject } from "../launch/canonical.js";
import { StrategyMandateError } from "./errors.js";
import type {
  StrategyCandidate,
  StrategyCandidateVerification,
  StrategyCommittedSignalDraft,
  StrategyCovenant
} from "./types.js";

export function buildCommittedSignalDraft(input: {
  candidate: StrategyCandidate;
  verification: StrategyCandidateVerification;
  covenant: StrategyCovenant;
  codebase: {
    codebaseId: string;
    kind: "git_commit" | "sha256_source_tree";
    digest: string;
  };
  producerKeyId: string;
  now: Date;
}) {
  const { candidate, verification, covenant } = input;
  if (!verification.verified || verification.candidateHash !== candidate.candidateHash
    || verification.covenantHash !== covenant.covenantHash) {
    throw new StrategyMandateError("candidate_invalid", "An exact verified strategy candidate is required");
  }
  if (candidate.action === "hold" || !candidate.side || !candidate.limitPriceUsd || candidate.quantitySats === "0") {
    throw new StrategyMandateError("candidate_invalid", "A hold decision cannot become a TradeLayer signal");
  }
  if (Date.parse(candidate.expiresAt) <= input.now.getTime()
    || Date.parse(verification.checkedAt) > input.now.getTime()) {
    throw new StrategyMandateError("candidate_invalid", "Candidate or verification timestamp is stale or future-dated");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.codebase.codebaseId)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.producerKeyId)
    || (input.codebase.kind === "git_commit" && !/^[0-9a-f]{40}$/.test(input.codebase.digest))
    || (input.codebase.kind === "sha256_source_tree" && !/^[0-9a-f]{64}$/.test(input.codebase.digest))) {
    throw new StrategyMandateError("candidate_invalid", "Signal producer commitment is invalid");
  }
  const bindings = {
    covenantHash: covenant.covenantHash,
    candidateHash: candidate.candidateHash,
    proposalRoot: candidate.proposalRoot,
    marketSnapshotHash: candidate.marketSnapshotHash,
    portfolioStateRoot: candidate.portfolioStateRoot,
    verifierAttestationHash: verification.attestationHash
  };
  const signalInput = {
    schema: "bitagent_tradelayer_signal_v1" as const,
    signalId: candidate.candidateId,
    codebase: structuredClone(input.codebase),
    producerKeyId: input.producerKeyId,
    strategyId: `mandate:${covenant.mandateId}`,
    strategyVersion: String(covenant.version),
    market: "TLBTC/TLUSD" as const,
    side: candidate.side,
    amountSats: candidate.quantitySats,
    limitPriceUsd: candidate.limitPriceUsd,
    postOnly: true as const,
    generatedAt: candidate.createdAt,
    expiresAt: candidate.expiresAt,
    inputSnapshotHash: hashObject(bindings)
  };
  const core = {
    schema: "bitagent_strategy_signal_draft_v1" as const,
    bindings,
    signalInput,
    authority: "deterministic_host" as const,
    effect: "none" as const,
    nextAuthority: "approved_signal_producer" as const,
    signingPerformed: false as const,
    broadcastPerformed: false as const
  };
  const draft: StrategyCommittedSignalDraft = { ...core, draftHash: hashObject(core) };
  return draft;
}
