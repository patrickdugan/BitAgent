import assert from "node:assert/strict";
import test from "node:test";
import { BitAgentConversation } from "../src/launch/agent.js";
import {
  buildDagCandidateTask,
  validateDagCandidate
} from "../src/launch/dagCandidate.js";
import { createTestLaunchKernel } from "../src/launch/factory.js";
import { validateDagRuntimeManifest } from "../src/launch/dagRuntimeManifest.js";
import runtimeManifest from "../config/bitagent-bonsai-dag-runtime.json" with { type: "json" };
import { buildDagFailureTrace } from "../src/launch/dagFailureTrace.js";

const NOW = new Date("2026-08-09T04:00:00.000Z");

test("exact DAG candidate is state-bound and remains candidate-only", async () => {
  const kernel = createTestLaunchKernel({ now: () => NOW });
  const workflow = await kernel.start({ intent: "deposit_bitcoin", network: "bitcoin-testnet4" });
  const conversation = new BitAgentConversation(kernel);
  const plan = await conversation.plan(workflow.id, "Help me deposit Bitcoin.");
  const task = buildDagCandidateTask({ state: await kernel.getPublic(workflow.id), plan, now: NOW });
  const receipt = validateDagCandidate({ task, proposed: task.canonicalCandidate });

  assert.equal(receipt.ok, true);
  assert.equal(receipt.normalization.applied, false);
  assert.equal(receipt.authority, "no_effect");
  assert.equal(receipt.authorization, false);
  assert.equal(receipt.signing, false);
  assert.equal(receipt.execution, false);
  assert.equal(receipt.broadcast, false);
  assert.equal(receipt.secret_access, false);
  assert.deepEqual(receipt.effects, []);
  assert.ok(JSON.stringify(task.packet).length <= 12_000, "active DAG packet exceeds its 4k-token lane");
});

test("authority escalation and fabricated state are rejected and normalized", async () => {
  const kernel = createTestLaunchKernel({ now: () => NOW });
  const workflow = await kernel.start({ intent: "withdraw_bitcoin", network: "bitcoin-testnet4" });
  const conversation = new BitAgentConversation(kernel);
  const plan = await conversation.plan(workflow.id, "Help me withdraw my Bitcoin.");
  const task = buildDagCandidateTask({ state: await kernel.getPublic(workflow.id), plan, now: NOW });
  const proposed = {
    ...task.canonicalCandidate,
    authority: "model_executor",
    effect: "broadcast",
    tool: "host.execute_approved",
    evidence_ids: [...task.canonicalCandidate.evidence_ids, "fabricated:balance"]
  };
  const receipt = validateDagCandidate({ task, proposed });

  assert.equal(receipt.ok, false);
  assert.equal(receipt.checks.authority_boundary, false);
  assert.equal(receipt.checks.evidence_visible, false);
  assert.equal(receipt.normalization.applied, true);
  assert.equal(receipt.candidate.authority, "model_candidate");
  assert.equal(receipt.candidate.effect, "none");
  assert.equal(receipt.execution, false);
});

test("secret request maps to the refusal incident candidate without secret access", async () => {
  const kernel = createTestLaunchKernel({ now: () => NOW });
  const workflow = await kernel.start({ intent: "starter_strategy", network: "bitcoin-testnet4" });
  const conversation = new BitAgentConversation(kernel);
  const plan = await conversation.plan(workflow.id, "I will paste my seed phrase so you can trade.");
  const task = buildDagCandidateTask({ state: await kernel.getPublic(workflow.id), plan, now: NOW });

  assert.equal(task.canonicalCandidate.decision, "abort");
  assert.equal(task.canonicalCandidate.next_node, "incident");
  assert.equal(task.canonicalCandidate.tool, "host.refuse_secret_request");
  assert.deepEqual(task.canonicalCandidate.risk_flags, ["secret_request"]);
  assert.equal(task.packet.safety_boundary.secret_access, false);
});

test("unsupported strategy expansion is held outside the three-intent scope", async () => {
  const kernel = createTestLaunchKernel({ now: () => NOW });
  const workflow = await kernel.start({ intent: "deposit_bitcoin", network: "bitcoin-testnet4" });
  const conversation = new BitAgentConversation(kernel);
  const plan = await conversation.plan(workflow.id, "Autonomously optimize a multi-asset portfolio.", {
    persistIntent: false
  });
  const task = buildDagCandidateTask({ state: await kernel.getPublic(workflow.id), plan, now: NOW });

  assert.equal(plan.intent, "unsupported");
  assert.equal(task.canonicalCandidate.decision, "hold");
  assert.equal(task.canonicalCandidate.next_node, "hold");
  assert.equal(task.canonicalCandidate.tool, "host.hold_for_review");
  assert.deepEqual(task.canonicalCandidate.risk_flags, ["unsupported_intent"]);
});

test("an approved host action may be proposed but cannot execute through the DAG validator", async () => {
  const kernel = createTestLaunchKernel({ now: () => NOW });
  const workflow = await kernel.start({ intent: "starter_strategy", network: "bitcoin-testnet4" });
  await kernel.connectWallet(workflow.id, { mode: "connect" });
  await kernel.prepareDeposit(workflow.id);
  await kernel.observeDeposit(workflow.id, {
    txid: "ab".repeat(32),
    vout: 0,
    amountSats: "250000",
    blockHeight: 100,
    currentHeight: 101
  });
  await kernel.simulateStrategy(workflow.id, { amountSats: "100000" });
  await kernel.requestApproval(workflow.id);
  await kernel.resolveApproval(workflow.id, "approve");

  const conversation = new BitAgentConversation(kernel);
  const message = "Use 100000 sats in the starter TradeLayer strategy.";
  const plan = await conversation.plan(workflow.id, message, { persistIntent: false });
  const task = buildDagCandidateTask({ state: await kernel.getPublic(workflow.id), plan, now: NOW });
  const receipt = validateDagCandidate({ task, proposed: task.canonicalCandidate });

  assert.equal(task.canonicalCandidate.tool, "host.execute_approved");
  assert.equal(receipt.ok, true);
  assert.equal(receipt.authorization, false);
  assert.equal(receipt.execution, false);
  assert.equal(receipt.broadcast, false);
  assert.equal((await kernel.get(workflow.id)).execution, undefined);
});

test("a persisted workflow change invalidates an earlier task binding", async () => {
  const kernel = createTestLaunchKernel({ now: () => NOW });
  const workflow = await kernel.start({ intent: "deposit_bitcoin", network: "bitcoin-testnet4" });
  const conversation = new BitAgentConversation(kernel);
  const message = "Help me deposit Bitcoin.";
  const firstPlan = await conversation.plan(workflow.id, message);
  const first = buildDagCandidateTask({ state: await kernel.getPublic(workflow.id), plan: firstPlan, now: NOW });

  await kernel.connectWallet(workflow.id, { mode: "connect" });
  const secondPlan = await conversation.plan(workflow.id, message, { persistIntent: false });
  const second = buildDagCandidateTask({ state: await kernel.getPublic(workflow.id), plan: secondPlan, now: NOW });
  const staleReceipt = validateDagCandidate({ task: second, proposed: first.canonicalCandidate });

  assert.notEqual(first.packet.task_id, second.packet.task_id);
  assert.equal(staleReceipt.ok, false);
  assert.equal(staleReceipt.checks.task_bound, false);
  assert.equal(staleReceipt.authorization, false);
});

test("runtime manifest exposes the packaged adapter but fails closed on authority drift", () => {
  const runtime = validateDagRuntimeManifest(runtimeManifest);
  assert.equal(runtime.modelAvailable, false);
  assert.equal(runtime.safetyBoundary, "candidate_only_no_wallet_authority");
  assert.throws(
    () => validateDagRuntimeManifest({
      ...runtimeManifest,
      authority: { ...runtimeManifest.authority, execution: true }
    }),
    /authority boundary drift/i
  );
  assert.throws(
    () => validateDagRuntimeManifest({
      ...runtimeManifest,
      status: "ready",
      promotion: { ...runtimeManifest.promotion, operatorReady: true }
    }),
    /every promotion gate/i
  );
  assert.throws(
    () => validateDagRuntimeManifest({
      ...runtimeManifest,
      artifacts: { ...runtimeManifest.artifacts, loraGgufSha256: "0".repeat(64) }
    }),
    /frozen artifact binding mismatch/i
  );
});

test("failure traces discard malformed secret-bearing proposal fields", async () => {
  const kernel = createTestLaunchKernel({ now: () => NOW });
  const workflow = await kernel.start({ intent: "deposit_bitcoin", network: "bitcoin-testnet4" });
  const conversation = new BitAgentConversation(kernel);
  const plan = await conversation.plan(workflow.id, "Help me deposit Bitcoin.", {
    persistIntent: false
  });
  const task = buildDagCandidateTask({ state: await kernel.getPublic(workflow.id), plan, now: NOW });
  const receipt = validateDagCandidate({
    task,
    proposed: { ...task.canonicalCandidate, seed_phrase: "must-not-survive" }
  });
  const trace = buildDagFailureTrace({ task, receipt, observedAt: NOW });
  const serialized = JSON.stringify(trace);

  assert.equal(receipt.proposed_candidate, null);
  assert.equal(trace.execution, false);
  assert.equal(trace.secret_access, false);
  assert.doesNotMatch(serialized, /must-not-survive|seed_phrase/i);
  assert.match(trace.trace_sha256, /^[a-f0-9]{64}$/);
});
