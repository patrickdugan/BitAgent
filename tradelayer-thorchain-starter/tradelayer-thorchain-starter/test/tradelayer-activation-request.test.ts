import assert from "node:assert/strict";
import test from "node:test";
import manifestJson from "../config/tradelayer-tx11-release.json" with { type: "json" };
import {
  createReleaseBoundActivationRequest,
  tx11ActivationPolicyFingerprint,
  tx11SourceVerificationHash,
  validateTx11LaunchSourceReceipt
} from "../src/launch/tradelayerActivationRequest.js";
import { encodeSegwitAddress } from "../src/launch/bitcoin.js";
import { validateTx11ReleaseManifest } from "../src/launch/tradelayerRelease.js";

const NOW = new Date("2026-08-07T14:10:00.000Z");
const manifest = validateTx11ReleaseManifest(manifestJson);
const senderAddress = encodeSegwitAddress(Buffer.alloc(32, 23), "bitcoin-testnet4", 1);
const receipt = {
  schema: "bitagent.tradelayer.tx11-launch-source.v1",
  verifiedAt: "2026-08-07T14:02:12.165Z",
  authority: "read_only_observer",
  effect: "none",
  releaseId: manifest.releaseId,
  releaseStatus: manifest.status,
  selectedSource: {
    path: "D:/bitagent-testnet4/tradelayer-candidate10",
    commit: manifest.deploymentCommit,
    codeHash: manifest.codeHash,
    trackedClean: true,
    sourceVerified: true
  },
  deploymentVerified: false,
  executable: false
};

test("builds a candidate-only activation request from fresh exact release evidence", () => {
  const validated = validateTx11LaunchSourceReceipt({ receipt, manifest, now: NOW });
  const request = createReleaseBoundActivationRequest({
    receipt,
    manifest,
    requestId: "candidate10-live-1",
    wallet: "utxoref-testnet",
    senderAddress,
    maxFeeSats: "2000",
    expiresAt: "2026-08-07T14:25:00.000Z",
    now: NOW
  });
  assert.equal(request.releaseId, manifest.releaseId);
  assert.equal(request.deploymentCommit, manifest.deploymentCommit);
  assert.equal(request.releaseStatus, "candidate_not_deployed");
  assert.equal(request.activation.codeHash, manifest.codeHash);
  assert.equal(request.sourceVerificationHash, tx11SourceVerificationHash(validated, manifest));
  assert.equal(request.policyFingerprint, tx11ActivationPolicyFingerprint({
    manifest,
    wallet: "utxoref-testnet",
    senderAddress,
    maxFeeSats: "2000"
  }));
  assert.match(request.requestHash, /^[a-f0-9]{64}$/);
});

test("rejects a malformed sender before producing a public activation request", () => {
  assert.throws(() => createReleaseBoundActivationRequest({
    receipt,
    manifest,
    requestId: "candidate10-live-malformed",
    wallet: "utxoref-testnet",
    senderAddress: "tb1-not-a-valid-address",
    maxFeeSats: "2000",
    expiresAt: "2026-08-07T14:25:00.000Z",
    now: NOW
  }), /Invalid Bitcoin testnet4 address/);
});

test("rejects a manually supplied policy fingerprint that differs from the deterministic policy", () => {
  assert.throws(() => createReleaseBoundActivationRequest({
    receipt,
    manifest,
    requestId: "candidate10-live-wrong-policy",
    wallet: "utxoref-testnet",
    senderAddress,
    policyFingerprint: "71".repeat(32),
    maxFeeSats: "2000",
    expiresAt: "2026-08-07T14:25:00.000Z",
    now: NOW
  }), /differs from the deterministic release policy/);
});

test("rejects a source receipt whose commit does not match the release", () => {
  const mismatched = {
    ...receipt,
    selectedSource: { ...receipt.selectedSource, commit: "00".repeat(20) }
  };
  assert.throws(
    () => validateTx11LaunchSourceReceipt({ receipt: mismatched, manifest, now: NOW }),
    /does not match the pinned release manifest/
  );
});

test("rejects stale source verification evidence", () => {
  assert.throws(
    () => validateTx11LaunchSourceReceipt({
      receipt,
      manifest,
      now: new Date("2026-08-07T14:30:00.000Z")
    }),
    /stale/
  );
});
