import fs from "node:fs/promises";
import { DAG_CANDIDATE_SCHEMA, DAG_TASK_SCHEMA } from "./dagCandidate.js";
import { LaunchKernelError } from "./errors.js";

const MANIFEST_SCHEMA = "bitagent.bonsai_dag_runtime_manifest.v1";
const RECEIPT_SCHEMA = "bitagent.dag_validation_receipt.v2";
const SHA256 = /^[a-f0-9]{64}$/;
const FROZEN_RUNTIME = {
  registrationId: "ee2fa077968e6313aa4ddc96751a38eb0cd43e0e5b32a25e3f191ad16ab81f8c",
  baseModelSha256: "284a335aa3fb2ced3b1b01fcb40b08aa783e3b70832767f0dd2e3fdfa134bd54",
  sourceAdapterSha256: "ceb39699033124710f2537d1e65d3cb794f43f9e7c3313b3c93522da7df913be",
  loraGgufSha256: "9a11fe2cecf795f53dbea490b9897b28f3d3346a9f69a71ce28bbb195f7de704",
  hermesCommit: "482e895dc782e1de39563eb477a87e909522272f",
  runtimeManifest: "configs/bitagent_bonsai_runtime_v2.json",
  sidecarConfig: "configs/bitagent_dag_model_sidecar_v1.json"
} as const;

type JsonRecord = Record<string, unknown>;

function record(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LaunchKernelError("validation_error", `DAG runtime ${field} must be an object`);
  }
  return value as JsonRecord;
}

function exactSha(value: unknown, field: string) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new LaunchKernelError("validation_error", `DAG runtime ${field} must be a SHA-256 digest`);
  }
  return value;
}

function stringList(value: unknown, field: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new LaunchKernelError("validation_error", `DAG runtime ${field} must be a string array`);
  }
  return value as string[];
}

export function validateDagRuntimeManifest(value: unknown) {
  const manifest = record(value, "manifest");
  const environment = record(manifest.environment, "environment");
  const artifacts = record(manifest.artifacts, "artifacts");
  const hermesLite = record(manifest.hermesLite, "hermesLite");
  const contracts = record(manifest.contracts, "contracts");
  const context = record(manifest.context, "context");
  const authority = record(manifest.authority, "authority");
  const promotion = record(manifest.promotion, "promotion");
  if (manifest.schema !== MANIFEST_SCHEMA) {
    throw new LaunchKernelError("validation_error", "DAG runtime manifest schema mismatch");
  }
  if (contracts.task !== DAG_TASK_SCHEMA
    || contracts.candidate !== DAG_CANDIDATE_SCHEMA
    || contracts.validationReceipt !== RECEIPT_SCHEMA) {
    throw new LaunchKernelError("validation_error", "DAG runtime contract binding mismatch");
  }
  if (context.inclusiveWindowTokens !== 12_000 || context.activePacketTokens !== 4_000) {
    throw new LaunchKernelError("validation_error", "DAG runtime context budget drift");
  }
  if (authority.candidateOnly !== true
    || authority.approval !== false
    || authority.secretAccess !== false
    || authority.signing !== false
    || authority.execution !== false
    || authority.broadcast !== false) {
    throw new LaunchKernelError("validation_error", "DAG runtime authority boundary drift");
  }
  const requiredGates = stringList(promotion.requiredGates, "promotion.requiredGates");
  const passedGates = stringList(promotion.passedGates, "promotion.passedGates");
  if (passedGates.some((gate) => !requiredGates.includes(gate))) {
    throw new LaunchKernelError("validation_error", "DAG runtime passed an unknown promotion gate");
  }
  const operatorReady = promotion.operatorReady === true;
  if (operatorReady && (manifest.status !== "ready" || passedGates.length !== requiredGates.length)) {
    throw new LaunchKernelError("validation_error", "DAG runtime readiness is not backed by every promotion gate");
  }
  if (!operatorReady && manifest.status === "ready") {
    throw new LaunchKernelError("validation_error", "DAG runtime cannot be ready without operator promotion");
  }
  if (environment.id !== "moralitylab/bitagent-dag-ops-v2" || environment.version !== "0.3.1") {
    throw new LaunchKernelError("validation_error", "DAG runtime environment binding mismatch");
  }
  const frozenBindings = {
    registrationId: exactSha(environment.registrationId, "environment.registrationId"),
    baseModelSha256: exactSha(artifacts.baseModelSha256, "artifacts.baseModelSha256"),
    sourceAdapterSha256: exactSha(artifacts.sourceAdapterSha256, "artifacts.sourceAdapterSha256"),
    loraGgufSha256: exactSha(artifacts.loraGgufSha256, "artifacts.loraGgufSha256"),
    hermesCommit: hermesLite.commit,
    runtimeManifest: hermesLite.runtimeManifest,
    sidecarConfig: hermesLite.sidecarConfig
  };
  if (typeof hermesLite.commit !== "string" || !/^[a-f0-9]{40}$/.test(hermesLite.commit)) {
    throw new LaunchKernelError("validation_error", "DAG runtime Hermes commit must be exact");
  }
  if (Object.entries(FROZEN_RUNTIME).some(
    ([field, expected]) => frozenBindings[field as keyof typeof frozenBindings] !== expected
  )) {
    throw new LaunchKernelError("validation_error", "DAG runtime frozen artifact binding mismatch");
  }
  return {
    ...manifest,
    modelAvailable: operatorReady,
    safetyBoundary: "candidate_only_no_wallet_authority"
  };
}

export async function readDagRuntimeManifest(filePath: string) {
  try {
    return validateDagRuntimeManifest(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch (error) {
    if (error instanceof LaunchKernelError) throw error;
    throw new LaunchKernelError("provider_unavailable", "DAG runtime manifest is missing or invalid");
  }
}
