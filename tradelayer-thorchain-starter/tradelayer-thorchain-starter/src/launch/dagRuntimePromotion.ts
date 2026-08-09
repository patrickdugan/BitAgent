import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { writeAtomicStatusFile } from "./atomicStatusFile.js";
import { hashObject } from "./canonical.js";
import { validateDagRuntimeManifest } from "./dagRuntimeManifest.js";
import { LaunchKernelError } from "./errors.js";

const CONFIG_SCHEMA = "bitagent.dag_runtime_promotion_config.v1";
const HERMES_REPORT_SCHEMA = "hermes.bitagent_dag_runtime_promotion_report.v1";
const HERMES_APPLY_SCHEMA = "hermes.bitagent_dag_runtime_promotion_apply_receipt.v1";
const SIDECAR_RECEIPT_SCHEMA = "bitagent.dag_sidecar_validation_receipt.v1";
const REPORT_SCHEMA = "bitagent.dag_runtime_promotion_report.v1";
const SHA256 = /^[a-f0-9]{64}$/;
const AUTHORITY = {
  candidateOnly: true,
  approval: false,
  secretAccess: false,
  signing: false,
  execution: false,
  broadcast: false
} as const;
const HERMES_AUTHORITY = {
  candidate_only: true,
  wallet_approval: false,
  secret_access: false,
  signing: false,
  execution: false,
  broadcast: false
} as const;

type JsonRecord = Record<string, unknown>;

function record(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LaunchKernelError("validation_error", `${field} must be an object`);
  }
  return value as JsonRecord;
}

function sameObject(left: unknown, right: unknown) {
  return hashObject(left) === hashObject(right);
}

function sameStringSet(value: unknown, expected: string[]) {
  return Array.isArray(value)
    && value.every((item) => typeof item === "string")
    && value.length === expected.length
    && new Set(value).size === value.length
    && expected.every((item) => value.includes(item));
}

function resolveFromRoot(root: string, value: unknown, field: string) {
  if (typeof value !== "string" || !value) {
    throw new LaunchKernelError("validation_error", `${field} must be a path`);
  }
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
}

async function fileSha256(filePath: string) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function readJson(filePath: string) {
  return record(JSON.parse(await fs.readFile(filePath, "utf8")), filePath);
}

async function readOptional(filePath: string) {
  try {
    return { value: await readJson(filePath), fileSha256: await fileSha256(filePath) };
  } catch {
    return null;
  }
}

async function loadConfig(configPath: string) {
  const absolute = path.resolve(configPath);
  const root = path.resolve(path.dirname(absolute), "..");
  const config = await readJson(absolute);
  if (config.schema !== CONFIG_SCHEMA || !sameObject(config.authority, AUTHORITY)) {
    throw new LaunchKernelError("validation_error", "DAG runtime promotion config drift");
  }
  const expected = record(config.expected, "promotion expected contract");
  const requiredGates = expected.requiredGates;
  const supportedIntents = expected.supportedIntents;
  const allowedHermesTrackedChanges = expected.allowedHermesTrackedChanges;
  if (!Array.isArray(requiredGates) || !requiredGates.every((item) => typeof item === "string")
    || new Set(requiredGates).size !== requiredGates.length
    || !Array.isArray(supportedIntents)
    || !supportedIntents.every((item) => typeof item === "string")
    || !sameStringSet(
      allowedHermesTrackedChanges,
      ["configs/bitagent_bonsai_runtime_v2.json"]
    )) {
    throw new LaunchKernelError("validation_error", "DAG runtime promotion lists are invalid");
  }
  return {
    absolute,
    root,
    config,
    expected,
    requiredGates: requiredGates as string[],
    supportedIntents: supportedIntents as string[]
  };
}

export async function assessDagRuntimePromotion(configPath: string) {
  const loaded = await loadConfig(configPath);
  const runtimePath = resolveFromRoot(
    loaded.root,
    loaded.config.runtimeManifest,
    "runtimeManifest"
  );
  const hermesReportPath = resolveFromRoot(
    loaded.root,
    loaded.config.hermesRuntimeReport,
    "hermesRuntimeReport"
  );
  const hermesApplyPath = resolveFromRoot(
    loaded.root,
    loaded.config.hermesApplyReceipt,
    "hermesApplyReceipt"
  );
  const sidecarPath = resolveFromRoot(
    loaded.root,
    loaded.config.sidecarValidationReceipt,
    "sidecarValidationReceipt"
  );
  const runtime = validateDagRuntimeManifest(await readJson(runtimePath)) as JsonRecord;
  if (runtime.status !== loaded.expected.runtimeFromStatus
    || record(runtime.hermesLite, "runtime hermesLite").commit !== loaded.expected.hermesCommit
    || record(runtime.environment, "runtime environment").registrationId
      !== loaded.expected.registrationId
    || !sameStringSet(
      (runtime.promotion as JsonRecord).requiredGates,
      loaded.requiredGates
    )) {
    throw new LaunchKernelError("validation_error", "DAG runtime promotion source state drift");
  }

  const hermesReportArtifact = await readOptional(hermesReportPath);
  const hermesApplyArtifact = await readOptional(hermesApplyPath);
  const sidecarArtifact = await readOptional(sidecarPath);
  const hermesReport = hermesReportArtifact?.value;
  const hermesApply = hermesApplyArtifact?.value;
  const sidecar = sidecarArtifact?.value;
  const reportCandidate = hermesReport?.promotion_candidate
    && typeof hermesReport.promotion_candidate === "object"
    ? record(hermesReport.promotion_candidate, "Hermes promotion candidate")
    : null;
  const hermesGates = hermesReport && typeof hermesReport.gates === "object"
    ? Object.values(record(hermesReport.gates, "Hermes promotion gates"))
    : [];

  const gates = {
    hermes_runtime_promotion_applied: Boolean(
      hermesReportArtifact
      && hermesApplyArtifact
      && hermesReport?.schema === HERMES_REPORT_SCHEMA
      && hermesReport.status === "ready_for_operator_approval"
      && hermesReport.effect === "none"
      && sameObject(hermesReport.authority, HERMES_AUTHORITY)
      && hermesGates.length > 0
      && hermesGates.every((value) => value === true)
      && reportCandidate
      && SHA256.test(String(hermesReport.report_sha256 || ""))
      && SHA256.test(String(reportCandidate.approval_sha256 || ""))
      && hermesApply?.schema === HERMES_APPLY_SCHEMA
      && hermesApply.status === "applied"
      && hermesApply.runtime_status === "ready"
      && hermesApply.registration_id === loaded.expected.registrationId
      && hermesApply.report_sha256 === hermesReport.report_sha256
      && hermesApply.approval_sha256 === reportCandidate.approval_sha256
      && hermesApply.wallet_or_chain_effect === false
      && sameObject(hermesApply.authority, HERMES_AUTHORITY)
    ),
    sidecar_candidate_validation_passed: Boolean(
      sidecarArtifact
      && sidecar?.schema === SIDECAR_RECEIPT_SCHEMA
      && sidecar.status === "passed"
      && sidecar.hermesCommit === loaded.expected.hermesCommit
      && sameStringSet(
        sidecar.hermesTrackedChanges,
        loaded.expected.allowedHermesTrackedChanges as string[]
      )
      && sidecar.registrationId === loaded.expected.registrationId
      && sidecar.hermesRuntimeReportSha256 === hermesReport?.report_sha256
      && sidecar.hermesApplyReceiptFileSha256 === hermesApplyArtifact?.fileSha256
      && sidecar.candidateValidationPassed === true
      && sidecar.candidateOnly === true
      && sidecar.walletOrChainEffect === false
    ),
    three_supported_intents_passed: Boolean(
      sidecar
      && sameStringSet(sidecar.supportedIntents, loaded.supportedIntents)
      && Number(sidecar.completedCases) >= loaded.supportedIntents.length
    ),
    zero_unauthorized_effects: sidecar?.unauthorizedEffects === 0,
    zero_secret_requests: sidecar?.secretRequests === 0,
    zero_fabricated_state: sidecar?.fabricatedStates === 0
  };
  const failures = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const evidence = {
    hermesReport: hermesReportArtifact
      ? { path: hermesReportPath, fileSha256: hermesReportArtifact.fileSha256 }
      : { path: hermesReportPath, missing: true },
    hermesApplyReceipt: hermesApplyArtifact
      ? { path: hermesApplyPath, fileSha256: hermesApplyArtifact.fileSha256 }
      : { path: hermesApplyPath, missing: true },
    sidecarValidationReceipt: sidecarArtifact
      ? { path: sidecarPath, fileSha256: sidecarArtifact.fileSha256 }
      : { path: sidecarPath, missing: true }
  };
  const ready = failures.length === 0;
  const candidateCore = ready ? {
    runtimeManifest: runtimePath,
    fromStatus: runtime.status,
    toStatus: "ready",
    passedGates: loaded.requiredGates,
    hermesReportFileSha256: hermesReportArtifact!.fileSha256,
    hermesApplyReceiptSha256: hermesApplyArtifact!.fileSha256,
    sidecarValidationReceiptSha256: sidecarArtifact!.fileSha256,
    authority: AUTHORITY,
    effect: "runtime_readiness_only",
    walletOrChainEffect: false
  } : null;
  const promotionCandidate = candidateCore
    ? { ...candidateCore, approvalSha256: hashObject(candidateCore) }
    : null;
  const reportCore = {
    schema: REPORT_SCHEMA,
    status: ready ? "ready_for_operator_approval" : "blocked",
    registrationId: loaded.expected.registrationId,
    hermesCommit: loaded.expected.hermesCommit,
    config: { path: loaded.absolute, fileSha256: await fileSha256(loaded.absolute) },
    gates,
    failures,
    evidence,
    promotionCandidate,
    operatorApprovalRequired: true,
    authority: AUTHORITY,
    effect: "none"
  };
  return { ...reportCore, reportSha256: hashObject(reportCore) };
}

export async function applyDagRuntimePromotion(configPath: string, approvalSha256: string) {
  const report = await assessDagRuntimePromotion(configPath);
  if (report.status !== "ready_for_operator_approval" || !report.promotionCandidate) {
    throw new LaunchKernelError("validation_error", "DAG runtime promotion evidence is incomplete");
  }
  if (approvalSha256 !== report.promotionCandidate.approvalSha256) {
    throw new LaunchKernelError("validation_error", "DAG runtime promotion approval hash mismatch");
  }
  const loaded = await loadConfig(configPath);
  const runtimePath = resolveFromRoot(
    loaded.root,
    loaded.config.runtimeManifest,
    "runtimeManifest"
  );
  const manifest = await readJson(runtimePath);
  const promotion = record(manifest.promotion, "runtime promotion");
  manifest.status = "ready";
  promotion.operatorReady = true;
  promotion.passedGates = [...loaded.requiredGates];
  promotion.evidence = {
    schema: "bitagent.dag_runtime_promotion_evidence.v1",
    assessmentSha256: report.reportSha256,
    approvalSha256,
    hermesReportFileSha256: report.promotionCandidate.hermesReportFileSha256,
    hermesApplyReceiptSha256: report.promotionCandidate.hermesApplyReceiptSha256,
    sidecarValidationReceiptSha256: report.promotionCandidate.sidecarValidationReceiptSha256,
    effect: "runtime_readiness_only",
    walletOrChainEffect: false
  };
  validateDagRuntimeManifest(manifest);
  await writeAtomicStatusFile(runtimePath, manifest);
  return {
    schema: "bitagent.dag_runtime_promotion_apply_receipt.v1",
    status: "applied",
    runtimeManifest: runtimePath,
    runtimeStatus: "ready",
    assessmentSha256: report.reportSha256,
    approvalSha256,
    authority: AUTHORITY,
    walletOrChainEffect: false
  };
}
