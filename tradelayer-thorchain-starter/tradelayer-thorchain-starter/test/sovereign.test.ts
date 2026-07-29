import test from "node:test";
import assert from "node:assert/strict";
import { prepareNearChainSignature } from "../src/adapters/nearChainSignatureAdapter.js";
import { evaluateSpendIntent } from "../src/survival/policy.js";
import { authorizeCapabilityRequest, capabilityRequestFingerprint, InMemoryCapabilityLeaseStore } from "../src/sovereign/capabilities.js";
import { buildHarnessCandidates, buildSovereignBenchmarks, evolveHarness } from "../src/sovereign/evolution.js";
import { runSovereignHarnessDemo, verifyDasAtomEvents } from "../src/sovereign/harness.js";
import { createInitialSelfModel, updateSelfModelFromEvolution } from "../src/sovereign/selfModel.js";
import type { CapabilityRequest } from "../src/sovereign/types.js";

const now = new Date("2026-07-12T20:00:00.000Z");

test("bounded harness evolution promotes the calibrated configuration", () => {
  const candidates = buildHarnessCandidates();
  const evolution = evolveHarness(candidates, buildSovereignBenchmarks(now), now);
  const reckless = evolution.evaluations.find((item) => item.configId === "sovereign-reckless-v2")!;
  const calibrated = evolution.evaluations.find((item) => item.configId === "sovereign-calibrated-v2")!;

  assert.equal(evolution.promoted, true);
  assert.equal(evolution.selectedConfigId, "sovereign-calibrated-v2");
  assert.equal(calibrated.correctCount, calibrated.totalCount);
  assert.equal(calibrated.unsafeAuthorizationCount, 0);
  assert.ok(reckless.unsafeAuthorizationCount > 0);
  assert.equal(reckless.promotable, false);
});

test("self-model changes only after a benchmark-safe promotion", () => {
  const selfModel = createInitialSelfModel(now);
  const evolution = evolveHarness(buildHarnessCandidates(), buildSovereignBenchmarks(now), now);
  const updated = updateSelfModelFromEvolution(selfModel, evolution, now);

  assert.equal(updated.version, 2);
  assert.equal(updated.activeHarnessConfigId, "sovereign-calibrated-v2");
  assert.deepEqual(updated.immutableConstraints, selfModel.immutableConstraints);
  assert.notEqual(updated.memoryHead, selfModel.memoryHead);
});

test("capability leases are exact-fingerprint and one-shot", () => {
  const candidates = buildHarnessCandidates();
  const calibrated = candidates.find((item) => item.id === "sovereign-calibrated-v2")!;
  const scenario = buildSovereignBenchmarks(now).find((item) => item.id === "safe-compute-35k")!;
  const decision = evaluateSpendIntent(scenario.intent, calibrated.policy, scenario.snapshot, now);
  const selfModel = updateSelfModelFromEvolution(
    createInitialSelfModel(now),
    evolveHarness(candidates, buildSovereignBenchmarks(now), now),
    now
  );
  const material: Omit<CapabilityRequest, "invocationFingerprint"> = {
    requestId: "lease-test",
    agentId: selfModel.agentId,
    capability: "pay_invoice_capped",
    effects: ["reserve_capital", "request_signature"],
    scope: { amountSats: "35000", destination: scenario.intent.destination },
    expiresAt: scenario.intent.expiresAt,
    intent: scenario.intent
  };
  const request = { ...material, invocationFingerprint: capabilityRequestFingerprint(material) };
  const authorization = authorizeCapabilityRequest(request, selfModel, decision, now);
  const store = new InMemoryCapabilityLeaseStore();
  const lease = store.issue(request, authorization, now);

  assert.equal(authorization.decision, "authorized");
  assert.throws(() => store.consume(lease.leaseId, "wrong-fingerprint", now), /fingerprint mismatch/);
  assert.equal(store.consume(lease.leaseId, request.invocationFingerprint, now).status, "consumed");
  assert.throws(() => store.consume(lease.leaseId, request.invocationFingerprint, now), /not active/);
});

test("NEAR chain signature adapter only prepares an authorized request", () => {
  const demo = runSovereignHarnessDemo(now);
  assert.equal(demo.signaturePreparation.status, "stub");
  assert.match(demo.signaturePreparation.note, /Prepared only/);
  assert.equal(demo.signaturePreparation.leaseId, demo.activeLease.leaseId);
  assert.doesNotMatch(JSON.stringify(demo.signaturePreparation), /privateKey|seedPhrase|secretKey/i);
  assert.throws(
    () => prepareNearChainSignature({
      lease: { ...demo.activeLease, effects: ["read_state"] },
      targetChain: "bitcoin",
      derivationPath: "bitcoin,0",
      payloadHash: "a".repeat(64)
    }),
    /does not cover signature/
  );
});

test("sovereign demo emits valid causal events and MeTTa inspection facts", () => {
  const demo = runSovereignHarnessDemo(now);
  assert.equal(demo.authorization.decision, "authorized");
  assert.equal(demo.consumedLease.status, "consumed");
  assert.equal(demo.eventsValid, true);
  assert.equal(verifyDasAtomEvents(demo.events), true);
  assert.match(demo.mettaSnapshot, /runtime-commit-authority external-host/);
  assert.match(demo.mettaSnapshot, /sovereign-calibrated-v2/);
  assert.ok(demo.evolution.evaluations.flatMap((item) => item.surprises).length > 0);
});
