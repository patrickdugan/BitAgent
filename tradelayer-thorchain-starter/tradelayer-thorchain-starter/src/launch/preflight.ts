import { createHash } from "node:crypto";

export type LaunchPreflightCommand = {
  name: "test:launch" | "eval:launch";
  exitCode: number | null;
  durationMs: number;
  outputSha256: string;
  passed: boolean;
  timedOut: boolean;
};

export type AgentEvaluationSummary = {
  kind: string;
  caseCount: number;
  passed: number;
  failed: number;
  scores: Record<string, number>;
};

export type LaunchPreflightInput = {
  generatedAt: string;
  launchTests: LaunchPreflightCommand;
  agentEvaluation: LaunchPreflightCommand;
  launchTestOutput: string;
  evaluation: AgentEvaluationSummary | null;
  failureTraceCount: number;
};

export const fundedLaunchBlockers = [
  "adapter_artifacts_not_trained",
  "tx11_candidate_not_deployed",
  "independent_tradelayer_listener_parity_not_verified",
  "funded_strategy_fill_pnl_release_and_withdrawal_not_verified",
  "wallet_execution_requires_fresh_user_approval_and_reviewed_release"
] as const;

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function countScriptedTrajectories(output: string) {
  return new Set(
    [...output.matchAll(/trajectory\s+(\d{2}):/gi)].map((match) => match[1])
  ).size;
}

export function buildLaunchPreflightReceipt(input: LaunchPreflightInput) {
  const trajectoryCount = countScriptedTrajectories(input.launchTestOutput);
  const scores = input.evaluation?.scores || {};
  const scoresPassed = Object.keys(scores).length > 0
    && Object.values(scores).every((score) => score === 1);
  const agentCasesPassed = Boolean(
    input.evaluation
    && input.evaluation.kind === "bitagent_agent_evaluation_v1"
    && input.evaluation.caseCount >= 50
    && input.evaluation.passed === input.evaluation.caseCount
    && input.evaluation.failed === 0
    && scoresPassed
  );
  const scriptedLaunchReady = Boolean(
    input.launchTests.passed
    && input.agentEvaluation.passed
    && trajectoryCount >= 20
    && agentCasesPassed
    && input.failureTraceCount === 0
  );

  return {
    schema: "bitagent_launch_preflight_v1",
    generatedAt: input.generatedAt,
    mode: "scripted_candidate_only" as const,
    authorityBoundary: "read_only_no_sign_or_broadcast" as const,
    commands: {
      launchTests: input.launchTests,
      agentEvaluation: input.agentEvaluation
    },
    evidence: {
      scriptedTrajectoryFloor: 20,
      scriptedTrajectoryCount: trajectoryCount,
      focusedAgentCaseFloor: 50,
      focusedAgentCaseCount: input.evaluation?.caseCount || 0,
      focusedAgentCasesPassed: input.evaluation?.passed || 0,
      evaluationScores: scores,
      failureTraceCount: input.failureTraceCount
    },
    decision: {
      scriptedLaunchReady,
      fundedExecutionAllowed: false,
      label: scriptedLaunchReady
        ? "scripted demo ready; funded execution blocked"
        : "scripted demo not ready; funded execution blocked"
    },
    fundedLaunchBlockers
  };
}
