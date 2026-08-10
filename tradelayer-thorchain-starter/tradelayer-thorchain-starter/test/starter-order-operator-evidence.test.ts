import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readStarterOrderOperatorEvidence } from "../src/launch/starterOrderOperatorEvidence.js";

test("starter-order operator evidence exposes only sanitized read-only fields", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bitagent-starter-order-evidence-"));
  const preflightPath = path.join(root, "preflight.json");
  const releasePath = path.join(root, "release.json");
  try {
    await writeFile(preflightPath, JSON.stringify({
      schema: "bitagent_tradelayer_starter_order_preflight_v1",
      status: "verified",
      planHash: "a1".repeat(32),
      assessedAt: "2026-08-09T18:00:00.000Z",
      maxAgeMs: 60000,
      minimumIndependentNodes: 2,
      observedNodeCount: 2,
      gates: {
        independentNodeCount: true,
        freshSnapshots: true,
        tx5Active: true,
        tx5ChainDerived: true,
        tx5CodeHash: true,
        intendedProperties: true,
        walletTlBtcBalance: true,
        quoteFresh: true,
        postOnlyExact: true
      },
      reasons: [],
      evidenceHash: "a2".repeat(32),
      rawPsbt: "must-never-leak"
    }));
    await writeFile(releasePath, JSON.stringify({
      schema: "bitagent.tradelayer.tx5-release.v1",
      releaseId: "tx5-release-test-0001",
      status: "deployed",
      codeHash: "a3".repeat(32),
      deploymentCommit: "a4".repeat(20),
      tradelayerCommits: ["a4".repeat(20)],
      promotionRequirements: ["exact wallet approval"],
      walletApprovalToken: "must-never-leak"
    }));
    const evidence = await readStarterOrderOperatorEvidence(
      { preflightPath, releasePath },
      () => new Date("2026-08-09T18:00:10.000Z")
    );
    assert.equal(evidence.schema, "bitagent_starter_order_operator_evidence_v1");
    assert.equal(evidence.safetyBoundary, "read_only_no_sign_or_broadcast");
    assert.equal(evidence.approvalAvailable, false);
    assert.deepEqual(evidence.errors, []);
    assert.equal(evidence.preflight?.planHash, "a1".repeat(32));
    assert.equal(evidence.release?.status, "deployed");
    assert.doesNotMatch(JSON.stringify(evidence), /rawPsbt|walletApprovalToken|must-never-leak/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("starter-order operator evidence reports missing inputs without enabling approval", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bitagent-starter-order-evidence-missing-"));
  try {
    const evidence = await readStarterOrderOperatorEvidence({
      preflightPath: path.join(root, "missing-preflight.json"),
      releasePath: path.join(root, "missing-release.json")
    });
    assert.equal(evidence.approvalAvailable, false);
    assert.equal(evidence.preflight, null);
    assert.equal(evidence.release, null);
    assert.deepEqual(evidence.errors, ["preflight:missing", "release:missing"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
