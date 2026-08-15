import fs from "node:fs/promises";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

export type StarterOrderOperatorEvidencePaths = {
  preflightPath: string;
  releasePath: string;
};

export type StarterOrderOperatorEvidence = {
  schema: "bitagent_starter_order_operator_evidence_v1";
  safetyBoundary: "read_only_no_sign_or_broadcast";
  observedAt: string;
  approvalAvailable: false;
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

function preflightView(source: JsonRecord): JsonRecord | null {
  if (source.schema !== "bitagent_tradelayer_starter_order_preflight_v1") return null;
  const gates = record(source.gates);
  return {
    schema: source.schema,
    status: text(source.status),
    planHash: text(source.planHash),
    assessedAt: text(source.assessedAt),
    maxAgeMs: number(source.maxAgeMs),
    minimumIndependentNodes: number(source.minimumIndependentNodes),
    observedNodeCount: number(source.observedNodeCount),
    gates: {
      independentNodeCount: bool(gates.independentNodeCount),
      freshSnapshots: bool(gates.freshSnapshots),
      tx5Active: bool(gates.tx5Active),
      tx5ChainDerived: bool(gates.tx5ChainDerived),
      tx5CodeHash: bool(gates.tx5CodeHash),
      intendedProperties: bool(gates.intendedProperties),
      walletTlBtcBalance: bool(gates.walletTlBtcBalance),
      quoteFresh: bool(gates.quoteFresh),
      postOnlyExact: bool(gates.postOnlyExact)
    },
    reasons: textList(source.reasons),
    evidenceHash: text(source.evidenceHash)
  };
}

function releaseView(source: JsonRecord): JsonRecord | null {
  if (source.schema !== "bitagent.tradelayer.tx5-release.v1") return null;
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

export function defaultStarterOrderOperatorEvidencePaths(projectDir: string): StarterOrderOperatorEvidencePaths {
  return {
    preflightPath: path.join(projectDir, ".runtime", "testnet-agent", "starter-order", "preflight.json"),
    releasePath: path.join(projectDir, "config", "tradelayer-tx5-release.json")
  };
}

export async function readStarterOrderOperatorEvidence(
  paths: StarterOrderOperatorEvidencePaths,
  now: () => Date = () => new Date()
): Promise<StarterOrderOperatorEvidence> {
  const errors: string[] = [];
  const [preflightSource, releaseSource] = await Promise.all([
    readJson("preflight", paths.preflightPath, errors),
    readJson("release", paths.releasePath, errors)
  ]);
  const preflight = preflightSource ? preflightView(preflightSource) : null;
  const release = releaseSource ? releaseView(releaseSource) : null;
  if (preflightSource && !preflight) errors.push("preflight:invalid_schema");
  if (releaseSource && !release) errors.push("release:invalid_schema");
  return {
    schema: "bitagent_starter_order_operator_evidence_v1",
    safetyBoundary: "read_only_no_sign_or_broadcast",
    observedAt: now().toISOString(),
    approvalAvailable: false,
    preflight,
    release,
    errors: errors.sort()
  };
}
