import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readReserveOperatorEvidence } from "../src/launch/operatorEvidence.js";
import {
  ReserveOperatorToolRegistry,
  reserveOperatorToolSchemas
} from "../src/launch/operatorTools.js";

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-evidence-"));
  const paths = {
    candidatePath: path.join(dir, "candidate.json"),
    preflightPath: path.join(dir, "preflight.json"),
    releasePath: path.join(dir, "release.json")
  };
  await fs.writeFile(paths.candidatePath, JSON.stringify({
    schema: "bitagent_local_testnet4_reserve_candidate_v1",
    state: "cancelled_after_candidate_test",
    chain: { chain: "testnet4", blocks: 10, initialblockdownload: false },
    exactEffects: {
      inputUtxos: [{ txid: "a".repeat(64), vout: 1, valueSats: "2000", address: "tb1input", privateKey: "must-not-leak" }],
      reserveOutput: { vout: 0, address: "tb1reserve", valueSats: "1000" },
      tradeLayerDataOutput: { vout: 1, payloadBytes: 221, payloadHex: "must-not-leak" },
      walletChangeOutput: { vout: 2, address: "tb1change", valueSats: "900" },
      feeRateSatVb: 2,
      feeSats: "100",
      unsignedTxid: "b".repeat(64),
      unsignedPsbtHash: "c".repeat(64),
      approvalHash: "d".repeat(64),
      rawPsbt: "must-not-leak"
    },
    unresolvedPreconditions: {},
    launchReady: false,
    cancellation: { status: "cancelled_after_candidate_test", inputLockReleased: true },
    signingPerformed: false,
    broadcastPerformed: false,
    seedPhrase: "must-not-leak"
  }));
  await fs.writeFile(paths.preflightPath, JSON.stringify({
    schema: "bitagent_tradelayer_reserve_preflight_v1",
    status: "verified",
    planHash: "d".repeat(64),
    assessedAt: "2026-08-06T00:00:00.000Z",
    maxAgeMs: 60000,
    minimumIndependentNodes: 2,
    nodes: [{}, {}],
    gates: { tx11Active: true, tx11ChainDerived: true, tx11CodeHash: true },
    reasons: [],
    evidenceHash: "e".repeat(64)
  }));
  await fs.writeFile(paths.releasePath, JSON.stringify({
    schema: "bitagent.tradelayer.tx11-release.v1",
    releaseId: "candidate-1",
    status: "candidate_not_deployed",
    codeHash: "f".repeat(64),
    deploymentCommit: "commit",
    tradelayerCommits: ["commit"],
    promotionRequirements: ["deploy exact code"]
  }));
  return { dir, paths };
}

test("operator evidence is read-only and strips signing material", async () => {
  const { dir, paths } = await fixture();
  try {
    const evidence = await readReserveOperatorEvidence(paths, () => new Date("2026-08-06T01:00:00.000Z"));
    assert.equal(evidence.approvalAvailable, false);
    assert.equal(evidence.safetyBoundary, "read_only_no_sign_or_broadcast");
    assert.equal(evidence.preflight?.status, "verified");
    assert.equal(evidence.preflight?.planHash, "d".repeat(64));
    assert.equal(evidence.preflight?.maxAgeMs, 60000);
    assert.equal(evidence.release?.status, "candidate_not_deployed");
    const serialized = JSON.stringify(evidence);
    assert.doesNotMatch(serialized, /must-not-leak|rawPsbt|privateKey|seedPhrase|payloadHex/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("live listener evidence is normalized into the wallet preflight gate contract", async () => {
  const { dir, paths } = await fixture();
  try {
    await fs.writeFile(paths.preflightPath, JSON.stringify({
      schema: "bitagent_tradelayer_listener_preflight_v1",
      status: "verified",
      planHash: "d".repeat(64),
      assessedAt: "2026-08-06T00:00:00.000Z",
      maxAgeMs: 60000,
      minimumIndependentNodes: 2,
      observations: [{}, {}],
      gates: {
        independentLiveListeners: true,
        freshObservations: true,
        tx11Active: true,
        tx11ChainDerived: true,
        tx11CodeHash: true,
        intendedTlBtcProperty: true,
        templateParity: true,
        contractParity: true,
        reserveRedeemAddress: true
      },
      reasons: [],
      evidenceHash: "e".repeat(64)
    }));
    const evidence = await readReserveOperatorEvidence(paths, () => new Date("2026-08-06T01:00:00.000Z"));
    assert.equal(evidence.preflight?.schema, "bitagent_tradelayer_reserve_preflight_v1");
    assert.equal(evidence.preflight?.sourceSchema, "bitagent_tradelayer_listener_preflight_v1");
    assert.equal((evidence.preflight?.gates as Record<string, unknown>).tx11ChainDerived, true);
    assert.equal(evidence.preflight?.observedNodeCount, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("missing evidence remains unavailable without enabling approval", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-evidence-missing-"));
  try {
    const evidence = await readReserveOperatorEvidence({
      candidatePath: path.join(dir, "candidate.json"),
      preflightPath: path.join(dir, "preflight.json"),
      releasePath: path.join(dir, "release.json")
    });
    assert.equal(evidence.approvalAvailable, false);
    assert.equal(evidence.candidate, null);
    assert.deepEqual(evidence.errors, ["candidate:missing", "preflight:missing", "release:missing"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("reserve operator tool exposes only sanitized read-only evidence with no model arguments", async () => {
  const { dir, paths } = await fixture();
  try {
    assert.deepEqual(Object.keys(reserveOperatorToolSchemas), ["bitagent.operator.reserve_intake"]);
    const registry = new ReserveOperatorToolRegistry(paths, () => new Date("2026-08-06T01:00:00.000Z"));
    const evidence = await registry.call("bitagent.operator.reserve_intake", {});
    assert.equal(evidence.approvalAvailable, false);
    assert.equal(evidence.safetyBoundary, "read_only_no_sign_or_broadcast");
    await assert.rejects(
      registry.call("bitagent.operator.reserve_intake", { workflowId: "model-must-not-select-paths" }),
      /accepts no model arguments/
    );
    await assert.rejects(registry.call("bitagent.operator.execute", {}), /Unknown operator tool/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
