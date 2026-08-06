import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLaunchPreflightReceipt,
  countScriptedTrajectories,
  sha256,
  type LaunchPreflightCommand
} from "../src/launch/preflight.js";

function command(name: LaunchPreflightCommand["name"], passed = true): LaunchPreflightCommand {
  return {
    name,
    exitCode: passed ? 0 : 1,
    durationMs: 25,
    outputSha256: sha256(name),
    passed,
    timedOut: false
  };
}

function trajectories(count: number) {
  return Array.from({ length: count }, (_, index) =>
    `# Subtest: trajectory ${String(index + 1).padStart(2, "0")}: case`).join("\n");
}

const perfectScores = {
  intentIdentification: 1,
  toolSelection: 1,
  validToolArguments: 1,
  approvalBoundaries: 1,
  truthfulWalletState: 1,
  successfulCompletion: 1,
  successfulRecovery: 1,
  noSecretRequestsOrFabrication: 1
};

test("launch preflight accepts the scripted floors but never authorizes funded execution", () => {
  const receipt = buildLaunchPreflightReceipt({
    generatedAt: "2026-08-06T00:00:00.000Z",
    launchTests: command("test:launch"),
    agentEvaluation: command("eval:launch"),
    launchTestOutput: trajectories(24),
    evaluation: {
      kind: "bitagent_agent_evaluation_v1",
      caseCount: 50,
      passed: 50,
      failed: 0,
      scores: perfectScores
    },
    failureTraceCount: 0
  });

  assert.equal(receipt.decision.scriptedLaunchReady, true);
  assert.equal(receipt.decision.fundedExecutionAllowed, false);
  assert.equal(receipt.evidence.scriptedTrajectoryCount, 24);
  assert.equal(receipt.authorityBoundary, "read_only_no_sign_or_broadcast");
});

test("launch preflight fails closed on a timeout, bad score, or failure trace", () => {
  const timedOut = { ...command("test:launch"), exitCode: null, passed: false, timedOut: true };
  const receipt = buildLaunchPreflightReceipt({
    generatedAt: "2026-08-06T00:00:00.000Z",
    launchTests: timedOut,
    agentEvaluation: command("eval:launch"),
    launchTestOutput: trajectories(24),
    evaluation: {
      kind: "bitagent_agent_evaluation_v1",
      caseCount: 50,
      passed: 49,
      failed: 1,
      scores: { ...perfectScores, approvalBoundaries: 0.98 }
    },
    failureTraceCount: 1
  });

  assert.equal(receipt.decision.scriptedLaunchReady, false);
  assert.equal(receipt.decision.fundedExecutionAllowed, false);
});

test("trajectory counting de-duplicates TAP test-name repetitions", () => {
  assert.equal(countScriptedTrajectories(`${trajectories(20)}\n${trajectories(20)}`), 20);
});
