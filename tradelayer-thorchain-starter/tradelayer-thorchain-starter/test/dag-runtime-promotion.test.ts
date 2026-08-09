import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyDagRuntimePromotion,
  assessDagRuntimePromotion
} from "../src/launch/dagRuntimePromotion.js";
import runtimeManifest from "../config/bitagent-bonsai-dag-runtime.json" with { type: "json" };

const REGISTRATION = "ee2fa077968e6313aa4ddc96751a38eb0cd43e0e5b32a25e3f191ad16ab81f8c";
const HERMES_COMMIT = "395d634c9505dc435221eee1223aa32cb1c19cc9";
const HERMES_AUTHORITY = {
  candidate_only: true,
  wallet_approval: false,
  secret_access: false,
  signing: false,
  execution: false,
  broadcast: false
};
const AUTHORITY = {
  candidateOnly: true,
  approval: false,
  secretAccess: false,
  signing: false,
  execution: false,
  broadcast: false
};

async function write(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function sha256(filePath: string) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function fixture(options: { complete?: boolean; secretRequests?: number } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-dag-promotion-"));
  const configPath = path.join(root, "config", "promotion.json");
  const runtimePath = path.join(root, "config", "runtime.json");
  const reportPath = path.join(root, "evidence", "hermes-report.json");
  const applyPath = path.join(root, "evidence", "hermes-apply.json");
  const sidecarPath = path.join(root, "evidence", "sidecar.json");
  await write(runtimePath, JSON.parse(JSON.stringify(runtimeManifest)));
  const requiredGates = [...runtimeManifest.promotion.requiredGates];
  await write(configPath, {
    schema: "bitagent.dag_runtime_promotion_config.v1",
    runtimeManifest: "config/runtime.json",
    hermesRuntimeReport: "evidence/hermes-report.json",
    hermesApplyReceipt: "evidence/hermes-apply.json",
    sidecarValidationReceipt: "evidence/sidecar.json",
    expected: {
      runtimeFromStatus: "adapter_packaged_gpu_screening_required",
      registrationId: REGISTRATION,
      hermesCommit: HERMES_COMMIT,
      allowedHermesTrackedChanges: ["configs/bitagent_bonsai_runtime_v2.json"],
      supportedIntents: ["deposit_bitcoin", "starter_strategy", "withdraw_bitcoin"],
      requiredGates
    },
    authority: AUTHORITY
  });
  if (options.complete) {
    const reportSha256 = "a".repeat(64);
    const approvalSha256 = "b".repeat(64);
    await write(reportPath, {
      schema: "hermes.bitagent_dag_runtime_promotion_report.v1",
      status: "ready_for_operator_approval",
      registration_id: REGISTRATION,
      gates: { exclusive_gpu_smoke: true, exclusive_gpu_screening: true },
      promotion_candidate: { approval_sha256: approvalSha256 },
      report_sha256: reportSha256,
      authority: HERMES_AUTHORITY,
      effect: "none"
    });
    await write(applyPath, {
      schema: "hermes.bitagent_dag_runtime_promotion_apply_receipt.v1",
      status: "applied",
      registration_id: REGISTRATION,
      runtime_status: "ready",
      report_sha256: reportSha256,
      approval_sha256: approvalSha256,
      authority: HERMES_AUTHORITY,
      wallet_or_chain_effect: false
    });
    await write(sidecarPath, {
      schema: "bitagent.dag_sidecar_validation_receipt.v1",
      status: "passed",
      hermesCommit: HERMES_COMMIT,
      hermesTrackedChanges: ["configs/bitagent_bonsai_runtime_v2.json"],
      registrationId: REGISTRATION,
      hermesRuntimeReportSha256: reportSha256,
      hermesApplyReceiptFileSha256: await sha256(applyPath),
      supportedIntents: ["deposit_bitcoin", "starter_strategy", "withdraw_bitcoin"],
      completedCases: 3,
      candidateValidationPassed: true,
      candidateOnly: true,
      unauthorizedEffects: 0,
      secretRequests: options.secretRequests || 0,
      fabricatedStates: 0,
      walletOrChainEffect: false
    });
  }
  return { root, configPath, runtimePath };
}

test("missing Hermes and sidecar evidence blocks without changing runtime", async () => {
  const files = await fixture();
  try {
    const before = await fs.readFile(files.runtimePath, "utf8");
    const report = await assessDagRuntimePromotion(files.configPath);
    assert.equal(report.status, "blocked");
    assert.equal(report.promotionCandidate, null);
    assert.deepEqual(report.failures, [
      "hermes_runtime_promotion_applied",
      "sidecar_candidate_validation_passed",
      "three_supported_intents_passed",
      "zero_unauthorized_effects",
      "zero_secret_requests",
      "zero_fabricated_state"
    ]);
    assert.equal(await fs.readFile(files.runtimePath, "utf8"), before);
  } finally {
    await fs.rm(files.root, { recursive: true, force: true });
  }
});

test("complete evidence requires the exact approval hash and atomically enables only runtime", async () => {
  const files = await fixture({ complete: true });
  try {
    const report = await assessDagRuntimePromotion(files.configPath);
    assert.equal(report.status, "ready_for_operator_approval");
    assert.ok(report.promotionCandidate);
    assert.deepEqual(report.failures, []);
    const approval = report.promotionCandidate!.approvalSha256;
    await assert.rejects(
      applyDagRuntimePromotion(files.configPath, "0".repeat(64)),
      /approval hash mismatch/i
    );
    assert.notEqual(JSON.parse(await fs.readFile(files.runtimePath, "utf8")).status, "ready");
    const receipt = await applyDagRuntimePromotion(files.configPath, approval);
    const runtime = JSON.parse(await fs.readFile(files.runtimePath, "utf8"));
    assert.equal(receipt.walletOrChainEffect, false);
    assert.equal(runtime.status, "ready");
    assert.equal(runtime.promotion.operatorReady, true);
    assert.deepEqual(runtime.promotion.passedGates, runtime.promotion.requiredGates);
    assert.equal(runtime.promotion.evidence.approvalSha256, approval);
  } finally {
    await fs.rm(files.root, { recursive: true, force: true });
  }
});

test("a secret-request sidecar result fails closed", async () => {
  const files = await fixture({ complete: true, secretRequests: 1 });
  try {
    const report = await assessDagRuntimePromotion(files.configPath);
    assert.equal(report.status, "blocked");
    assert.equal(report.gates.zero_secret_requests, false);
    assert.equal(report.promotionCandidate, null);
  } finally {
    await fs.rm(files.root, { recursive: true, force: true });
  }
});
