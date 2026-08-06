import fs from "node:fs/promises";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

export type ReserveOperatorEvidencePaths = {
  candidatePath: string;
  preflightPath: string;
  releasePath: string;
};

export type ReserveOperatorEvidence = {
  schema: "bitagent_reserve_operator_evidence_v1";
  safetyBoundary: "read_only_no_sign_or_broadcast";
  observedAt: string;
  approvalAvailable: false;
  candidate: JsonRecord | null;
  preflight: JsonRecord | null;
  release: JsonRecord | null;
  errors: string[];
};

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function readJson(label: string, filePath: string, errors: string[]): Promise<JsonRecord | null> {
  try {
    return record(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch (error) {
    const code = record(error).code;
    errors.push(`${label}:${code === "ENOENT" ? "missing" : "invalid"}`);
    return null;
  }
}

function candidateView(source: JsonRecord): JsonRecord | null {
  if (source.schema !== "bitagent_local_testnet4_reserve_candidate_v1") return null;
  const chain = record(source.chain);
  const effects = record(source.exactEffects);
  const reserve = record(effects.reserveOutput);
  const data = record(effects.tradeLayerDataOutput);
  const change = record(effects.walletChangeOutput);
  const cancellation = record(source.cancellation);
  const preconditions = record(source.unresolvedPreconditions);
  const inputs = Array.isArray(effects.inputUtxos)
    ? effects.inputUtxos.map(record).map((input) => ({
      txid: text(input.txid),
      vout: number(input.vout),
      valueSats: text(input.valueSats),
      address: text(input.address)
    }))
    : [];

  return {
    schema: source.schema,
    state: text(source.state),
    network: text(chain.chain),
    blockHeight: number(chain.blocks),
    initialBlockDownload: bool(chain.initialblockdownload),
    exactEffects: {
      inputUtxos: inputs,
      reserveOutput: {
        vout: number(reserve.vout),
        address: text(reserve.address),
        valueSats: text(reserve.valueSats)
      },
      tradeLayerDataOutput: {
        vout: number(data.vout),
        payloadBytes: number(data.payloadBytes)
      },
      walletChangeOutput: {
        vout: number(change.vout),
        address: text(change.address),
        valueSats: text(change.valueSats)
      },
      feeRateSatVb: number(effects.feeRateSatVb),
      feeSats: text(effects.feeSats),
      unsignedTxid: text(effects.unsignedTxid),
      unsignedPsbtHash: text(effects.unsignedPsbtHash),
      approvalHash: text(effects.approvalHash)
    },
    unresolvedPreconditions: {
      tx11ActiveAtCandidateHeight: bool(preconditions.tx11ActiveAtCandidateHeight),
      synchronizedProceduralRegistryVerified: bool(preconditions.synchronizedProceduralRegistryVerified),
      dataCarrierPolicyMempoolVerified: bool(preconditions.dataCarrierPolicyMempoolVerified),
      independentGuardianAvailable: bool(preconditions.independentGuardianAvailable)
    },
    launchReady: bool(source.launchReady),
    cancellation: {
      status: text(cancellation.status),
      inputLockReleased: bool(cancellation.inputLockReleased),
      signingPerformed: bool(cancellation.signingPerformed),
      broadcastPerformed: bool(cancellation.broadcastPerformed)
    },
    signingPerformed: bool(source.signingPerformed),
    broadcastPerformed: bool(source.broadcastPerformed)
  };
}

function preflightView(source: JsonRecord): JsonRecord | null {
  const listenerSource = source.schema === "bitagent_tradelayer_listener_preflight_v1";
  if (!listenerSource && source.schema !== "bitagent_tradelayer_reserve_preflight_v1") return null;
  const gates = record(source.gates);
  return {
    schema: "bitagent_tradelayer_reserve_preflight_v1",
    sourceSchema: text(source.schema),
    status: text(source.status),
    planHash: text(source.planHash),
    assessedAt: text(source.assessedAt),
    maxAgeMs: number(source.maxAgeMs),
    minimumIndependentNodes: number(source.minimumIndependentNodes),
    observedNodeCount: listenerSource
      ? (Array.isArray(source.observations) ? source.observations.length : 0)
      : (Array.isArray(source.nodes) ? source.nodes.length : 0),
    gates: {
      independentNodeCount: listenerSource
        ? bool(gates.independentLiveListeners)
        : bool(gates.independentNodeCount),
      freshSnapshots: listenerSource ? bool(gates.freshObservations) : bool(gates.freshSnapshots),
      tx11Active: bool(gates.tx11Active),
      tx11ChainDerived: bool(gates.tx11ChainDerived),
      tx11CodeHash: bool(gates.tx11CodeHash),
      intendedTlBtcProperty: bool(gates.intendedTlBtcProperty),
      templateParity: bool(gates.templateParity),
      contractParity: bool(gates.contractParity),
      reserveRedeemAddress: bool(gates.reserveRedeemAddress)
    },
    contractMode: text(source.contractMode),
    reasons: textList(source.reasons),
    evidenceHash: text(source.evidenceHash)
  };
}

function releaseView(source: JsonRecord): JsonRecord | null {
  if (source.schema !== "bitagent.tradelayer.tx11-release.v1") return null;
  return {
    schema: source.schema,
    releaseId: text(source.releaseId),
    status: text(source.status),
    codeHash: text(source.codeHash),
    deploymentCommit: text(source.deploymentCommit),
    tradelayerCommits: textList(source.tradelayerCommits),
    promotionRequirements: textList(source.promotionRequirements)
  };
}

export function defaultReserveOperatorEvidencePaths(projectDir: string): ReserveOperatorEvidencePaths {
  return {
    candidatePath: path.join(projectDir, ".runtime", "testnet-agent", "reserve-intake-candidate", "summary.json"),
    preflightPath: path.join(projectDir, ".runtime", "testnet-agent", "reserve-intake-candidate", "listener-preflight.json"),
    releasePath: path.join(projectDir, "config", "tradelayer-tx11-release.json")
  };
}

export async function readReserveOperatorEvidence(
  paths: ReserveOperatorEvidencePaths,
  now: () => Date = () => new Date()
): Promise<ReserveOperatorEvidence> {
  const errors: string[] = [];
  const [candidateSource, preflightSource, releaseSource] = await Promise.all([
    readJson("candidate", paths.candidatePath, errors),
    readJson("preflight", paths.preflightPath, errors),
    readJson("release", paths.releasePath, errors)
  ]);
  const candidate = candidateSource ? candidateView(candidateSource) : null;
  const preflight = preflightSource ? preflightView(preflightSource) : null;
  const release = releaseSource ? releaseView(releaseSource) : null;
  if (candidateSource && !candidate) errors.push("candidate:invalid_schema");
  if (preflightSource && !preflight) errors.push("preflight:invalid_schema");
  if (releaseSource && !release) errors.push("release:invalid_schema");

  return {
    schema: "bitagent_reserve_operator_evidence_v1",
    safetyBoundary: "read_only_no_sign_or_broadcast",
    observedAt: now().toISOString(),
    approvalAvailable: false,
    candidate,
    preflight,
    release,
    errors: errors.sort()
  };
}
