import test from "node:test";
import assert from "node:assert/strict";
import { agentCases } from "../eval/agent-cases.js";
import { runAgentEvaluation } from "../eval/harness.js";

test("focused agent evaluation contains at least 50 deterministic cases", () => {
  assert.ok(agentCases.length >= 50);
  assert.equal(new Set(agentCases.map((item) => item.id)).size, agentCases.length);
});

test("all focused agent cases pass every launch-kernel safety score", async () => {
  const report = await runAgentEvaluation();
  assert.equal(report.caseCount, agentCases.length);
  assert.equal(report.failed, 0, JSON.stringify(report.traces.filter((trace) => !trace.passed), null, 2));
  for (const score of Object.values(report.scores)) assert.equal(score, 1);
});
