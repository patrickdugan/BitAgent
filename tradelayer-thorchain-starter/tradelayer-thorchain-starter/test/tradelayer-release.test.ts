import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { externalRepos } from "../src/config.js";
import {
  validateTx11ReleaseManifest,
  verifyLocalTx11Release,
  type Tx11ReleaseManifest
} from "../src/launch/tradelayerRelease.js";

const execFileAsync = promisify(execFile);
const manifestPath = new URL("../config/tradelayer-tx11-release.json", import.meta.url);

async function fixture() {
  const manifest = validateTx11ReleaseManifest(JSON.parse(await fs.readFile(manifestPath, "utf8")));
  const { stdout } = await execFileAsync("git", ["-C", externalRepos.tradelayer, "rev-parse", "HEAD"], {
    windowsHide: true
  });
  return { manifest, currentCommit: stdout.trim() };
}

test("current tx11 release binds the exact local TradeLayer consensus source", async () => {
  const { manifest, currentCommit } = await fixture();
  const receipt = verifyLocalTx11Release({
    manifest,
    tradelayerRepo: externalRepos.tradelayer,
    currentCommit,
    now: new Date("2026-08-06T00:00:00.000Z")
  });
  assert.equal(receipt.sourceVerified, true);
  assert.equal(receipt.releaseStatus, "candidate_not_deployed");
  assert.equal(receipt.deploymentVerified, false);
  assert.equal(receipt.executable, false);
  assert.deepEqual(receipt.reasons, []);
});

test("tx11 release verification fails closed on code, source-list, or commit drift", async () => {
  const { manifest, currentCommit } = await fixture();
  const mutations: Tx11ReleaseManifest[] = [
    { ...manifest, codeHash: "00".repeat(32) },
    { ...manifest, consensusSourceFiles: manifest.consensusSourceFiles.slice(1) },
    { ...manifest, tradelayerCommits: ["11".repeat(20)] }
  ];
  const expectedReasons = [
    "consensus_source_hash_mismatch",
    "consensus_source_file_order_mismatch",
    "current_tradelayer_commit_not_in_release"
  ];
  mutations.forEach((changed, index) => {
    const receipt = verifyLocalTx11Release({
      manifest: changed,
      tradelayerRepo: externalRepos.tradelayer,
      currentCommit
    });
    assert.equal(receipt.sourceVerified, false);
    assert.equal(receipt.executable, false);
    assert.ok(receipt.reasons.includes(expectedReasons[index]!));
  });
});
