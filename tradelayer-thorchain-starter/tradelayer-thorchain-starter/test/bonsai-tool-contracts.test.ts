import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { launchToolSchemas } from "../src/launch/tools.js";
import { committedSignalToolSchemas } from "../src/signals/tools.js";
import { financialSurvivalToolSchemas } from "../src/survival/tools.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifact = path.join(root, "training", "artifacts", "bonsai-role-corpus-v2", "tool-contracts.json");
const examplesArtifact = path.join(root, "training", "artifacts", "bonsai-role-corpus-v2", "examples.jsonl");
const manifestArtifact = path.join(root, "training", "artifacts", "bonsai-role-corpus-v2", "manifest.json");
const legacyArtifact = path.join(root, "training", "artifacts", "bonsai-role-corpus-v1", "tool-contracts.json");
const candidate12ExamplesArtifact = path.join(root, "training", "artifacts", "bonsai-role-corpus-v3", "examples.jsonl");
const candidate12ManifestArtifact = path.join(root, "training", "artifacts", "bonsai-role-corpus-v3", "manifest.json");
const failureTraceFixture = path.join(root, "eval", "fixtures", "failure-traces.seed.jsonl");

test("Bonsai tool contract bundle mirrors production schemas and denies effectful model calls", async () => {
  const bundle = JSON.parse(await fs.readFile(artifact, "utf8"));
  assert.equal(bundle.schema, "hermes.bitagent_tool_contract_bundle.v1");
  assert.equal(bundle.authority.modelOutputIsCandidateOnly, true);
  assert.equal(bundle.authority.approvalSigningBroadcastExecutionHostOwned, true);

  const expected = {
    ...launchToolSchemas,
    ...committedSignalToolSchemas,
    ...financialSurvivalToolSchemas
  };
  assert.deepEqual(Object.keys(bundle.contracts).sort(), Object.keys(expected).sort());
  for (const [name, schema] of Object.entries(expected)) {
    assert.deepEqual(bundle.contracts[name].inputSchema, schema, name);
  }

  for (const contract of Object.values(bundle.contracts) as Array<Record<string, unknown>>) {
    if (contract.effect !== "none") assert.equal(contract.modelCallable, false);
  }
  assert.equal(bundle.contracts["bitagent.strategy.simulate"].modelCallable, true);
  assert.equal(bundle.contracts["bitagent.survival.evaluate"].modelCallable, true);
  assert.equal(bundle.contracts["bitagent.survival.evaluate"].effect, "none");
  assert.equal(bundle.contracts["bitagent.action.execute"].modelCallable, false);
  assert.equal(bundle.contracts["bitagent.wallet.request_approval"].modelCallable, false);
});

test("survival contracts use v2 without contaminating the frozen v1 lane", async () => {
  const legacy = JSON.parse(await fs.readFile(legacyArtifact, "utf8"));
  const current = JSON.parse(await fs.readFile(artifact, "utf8"));
  assert.equal("bitagent.survival.assess" in legacy.contracts, false);
  assert.equal("bitagent.survival.evaluate" in legacy.contracts, false);
  assert.equal("bitagent.survival.journal.verify" in legacy.contracts, false);
  assert.equal("bitagent.survival.assess" in current.contracts, true);
  assert.equal("bitagent.survival.evaluate" in current.contracts, true);
  assert.equal("bitagent.survival.journal.verify" in current.contracts, true);
});

test("reserve execution failures produce candidate-only specialist and recovery rows", async () => {
  const manifest = JSON.parse(await fs.readFile(manifestArtifact, "utf8"));
  const rows = (await fs.readFile(examplesArtifact, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.equal(manifest.totalExamples, 118);
  assert.deepEqual(manifest.countsByRole, {
    intent_planner: 50,
    utxo_tradelayer_specialist: 11,
    risk_approval_guard: 41,
    recovery_operator: 16
  });
  assert.equal(manifest.secretValuesDetected, false);
  assert.equal(manifest.rawTranscriptsIncluded, false);

  for (const id of [
    "recovery-reserve-preflight-plan-mismatch",
    "specialist-reserve-preflight-plan-mismatch",
    "recovery-reserve-mempool-rejected",
    "recovery-reserve-submission-unknown"
  ]) {
    const row = byId.get(id);
    assert.ok(row, id);
    assert.equal(row.authority.proposeOnly, true, id);
    assert.equal(JSON.parse(row.messages[2].content).execute, false, id);
  }
  assert.equal(
    JSON.parse(byId.get("recovery-reserve-submission-unknown").messages[2].content)
      .verifyBeforeReplacement,
    true
  );
});

test("candidate12 recovery data evolves in v3 without mutating the sealed v2 corpus", async () => {
  const manifest = JSON.parse(await fs.readFile(candidate12ManifestArtifact, "utf8"));
  const rows = (await fs.readFile(candidate12ExamplesArtifact, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const failureTraceIds = (await fs.readFile(failureTraceFixture, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => String(JSON.parse(line).id));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const actualCountsByRole = rows.reduce((counts, row) => {
    counts[row.role] = (counts[row.role] || 0) + 1;
    return counts;
  }, {} as Record<string, number>);

  assert.equal(manifest.totalExamples, rows.length);
  assert.deepEqual(manifest.countsByRole, actualCountsByRole);
  assert.equal(actualCountsByRole.intent_planner, 50);
  assert.equal(actualCountsByRole.utxo_tradelayer_specialist, 11);
  assert.equal(actualCountsByRole.risk_approval_guard, 41);
  assert.equal(manifest.secretValuesDetected, false);
  assert.equal(manifest.rawTranscriptsIncluded, false);
  for (const id of failureTraceIds) {
    const row = byId.get(`recovery-${id}`);
    assert.ok(row, id);
    assert.equal(row.authority.proposeOnly, true, id);
    assert.equal(JSON.parse(row.messages[2].content).execute, false, id);
  }
});
