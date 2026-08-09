import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { ScriptedWalletBroker } from "../src/launch/broker.js";
import { createTestLaunchKernel } from "../src/launch/factory.js";
import { createBitAgentServer } from "../src/launch/server.js";

test("HTTP launch surface exposes typed tools, referral workflow state, and the non-secret UI", async () => {
  const missingEvidenceRoot = path.join(process.cwd(), "test", "fixtures", "missing-operator-evidence");
  const server = createBitAgentServer({
    kernel: createTestLaunchKernel(),
    reserveOperatorEvidencePaths: {
      candidatePath: path.join(missingEvidenceRoot, "candidate.json"),
      preflightPath: path.join(missingEvidenceRoot, "preflight.json"),
      releasePath: path.join(missingEvidenceRoot, "release.json")
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;

    const ui = await fetch(`${origin}/`);
    assert.equal(ui.status, 200);
    const html = await ui.text();
    assert.match(html, /Put Bitcoin to work/i);
    assert.match(html, /never asks for a seed phrase/i);

    const dagRuntime = await fetch(`${origin}/api/dag-runtime`);
    assert.equal(dagRuntime.status, 200);
    const dagRuntimeResult = await dagRuntime.json() as {
      runtime: {
        status: string;
        modelAvailable: boolean;
        safetyBoundary: string;
        contracts: { candidate: string };
        authority: { execution: boolean; secretAccess: boolean };
      };
    };
    assert.equal(dagRuntimeResult.runtime.status, "adapter_packaged_gpu_screening_required");
    assert.equal(dagRuntimeResult.runtime.modelAvailable, false);
    assert.equal(dagRuntimeResult.runtime.safetyBoundary, "candidate_only_no_wallet_authority");
    assert.equal(dagRuntimeResult.runtime.contracts.candidate, "bitagent.dag_candidate.v2");
    assert.equal(dagRuntimeResult.runtime.authority.execution, false);
    assert.equal(dagRuntimeResult.runtime.authority.secretAccess, false);

    const tools = await fetch(`${origin}/api/tools`);
    assert.equal(tools.status, 200);
    const toolResult = await tools.json() as { tools: Record<string, unknown> };
    assert.equal(Object.keys(toolResult.tools).length, 11);
    assert.ok(toolResult.tools["bitagent.wallet.request_approval"]);
    assert.ok(toolResult.tools["bitagent.action.execute"]);
    assert.ok(toolResult.tools["bitagent.operator.reserve_intake"]);

    const reserveEvidence = await fetch(
      `${origin}/api/tools/${encodeURIComponent("bitagent.operator.reserve_intake")}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }
    );
    assert.equal(reserveEvidence.status, 200);
    const reserveResult = await reserveEvidence.json() as {
      result: { safetyBoundary: string; approvalAvailable: boolean };
    };
    assert.equal(reserveResult.result.safetyBoundary, "read_only_no_sign_or_broadcast");
    assert.equal(reserveResult.result.approvalAvailable, false);

    const reserveWithModelPath = await fetch(
      `${origin}/api/tools/${encodeURIComponent("bitagent.operator.reserve_intake")}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflowId: "model-must-not-select-evidence" })
      }
    );
    assert.equal(reserveWithModelPath.status, 400);

    const referralLink =
      `${origin}/?ref=alice&campaign=launch&workflow=starter_strategy&strategy=starter-v1`;
    const started = await fetch(`${origin}/api/workflows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ referralLink })
    });
    assert.equal(started.status, 201);
    const startedResult = await started.json() as {
      state: { id: string; stage: string; referral?: { status: string } };
    };
    assert.equal(startedResult.state.stage, "wallet_required");
    assert.equal(startedResult.state.referral?.status, "pending");

    const resumed = await fetch(
      `${origin}/api/workflows/${encodeURIComponent(startedResult.state.id)}`
    );
    assert.equal(resumed.status, 200);
    const resumedResult = await resumed.json() as {
      state: { id: string; approval?: { walletApprovalToken?: string } };
    };
    assert.equal(resumedResult.state.id, startedResult.state.id);
    assert.equal(resumedResult.state.approval?.walletApprovalToken, undefined);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
});

test("HTTP launch surface returns persisted rejected-authorization state for UI recovery", async () => {
  const server = createBitAgentServer({
    kernel: createTestLaunchKernel({
      walletBroker: new ScriptedWalletBroker({ rejectAuthorization: true })
    })
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    const post = async (path: string, body: Record<string, unknown>) => {
      const response = await fetch(`${origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      return { response, body: await response.json() as Record<string, any> };
    };
    const started = await post("/api/workflows", { intent: "starter_strategy" });
    const workflowId = started.body.state.id as string;
    const tool = (name: string, args: Record<string, unknown> = {}) =>
      post(`/api/tools/${encodeURIComponent(name)}`, { workflowId, ...args });

    await tool("bitagent.wallet.connect", { mode: "connect" });
    await tool("bitagent.deposit.prepare");
    await tool("bitagent.deposit.observe", {
      txid: "ab".repeat(32),
      vout: 0,
      amountSats: "250000",
      blockHeight: 100,
      currentHeight: 101
    });
    await tool("bitagent.strategy.simulate", { amountSats: "100000" });
    await tool("bitagent.wallet.request_approval");
    const rejected = await tool("bitagent.wallet.resolve_approval", { decision: "approve" });

    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.body.error.code, "approval_rejected");
    assert.equal(rejected.body.state.stage, "strategy_simulated");
    assert.equal(rejected.body.state.pendingApproval.status, "rejected");
    assert.match(rejected.body.state.recoveryInstructions.join(" "), /no transaction was executed/i);
    assert.equal(rejected.body.state.execution, undefined);

    const script = await (await fetch(`${origin}/app.js`)).text();
    assert.match(script, /Request wallet approval again/);
    assert.match(script, /Check wallet approval/);
    assert.match(script, /error\.state/);
    assert.match(script, /bitagent\.referralKey/);
    assert.match(script, /storedReferralKey !== activeReferralKey/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
});

test("HTTP DAG surface normalizes model proposals without mutating workflow state", async () => {
  const traceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-dag-trace-"));
  const tracePath = path.join(traceRoot, "failures.jsonl");
  const server = createBitAgentServer({
    kernel: createTestLaunchKernel(),
    dagFailureTracePath: tracePath
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    const post = async (requestPath: string, body: Record<string, unknown>) => {
      const response = await fetch(`${origin}${requestPath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      return { response, body: await response.json() as Record<string, any> };
    };
    const started = await post("/api/workflows", { intent: "deposit_bitcoin" });
    const workflowId = started.body.state.id as string;
    const message = "Help me deposit Bitcoin.";
    const taskResponse = await post(
      `/api/workflows/${encodeURIComponent(workflowId)}/dag-task`,
      { message }
    );

    assert.equal(taskResponse.response.status, 200);
    assert.equal(taskResponse.body.task.schema, "bitagent.dag_task_packet.v2");
    assert.equal(taskResponse.body.modelAuthority, "candidate_only");
    assert.equal(taskResponse.body.task.safety_boundary.execution, false);
    assert.equal(taskResponse.body.task.safety_boundary.secret_access, false);
    assert.equal(taskResponse.body.state.events.length, started.body.state.events.length);
    const evidenceIds = taskResponse.body.task.visible_evidence
      .filter((row: { kind: string }) => row.kind !== "structured_plan")
      .map((row: { id: string }) => row.id);
    const unsafeCandidate = {
      schema: "bitagent.dag_candidate.v2",
      task_id: taskResponse.body.task.task_id,
      decision: "advance",
      next_node: "validate",
      tool: "host.execute_approved",
      evidence_ids: evidenceIds,
      reason_code: "source_contract_required",
      risk_flags: [],
      authority: "model_candidate",
      effect: "none"
    };
    const rejected = await post(
      `/api/workflows/${encodeURIComponent(workflowId)}/dag-candidate`,
      { message, candidate: unsafeCandidate }
    );

    assert.equal(rejected.response.status, 200);
    assert.equal(rejected.body.receipt.ok, false);
    assert.equal(rejected.body.receipt.checks.authority_boundary, false);
    assert.equal(rejected.body.receipt.execution, false);
    assert.equal(rejected.body.failureTrace.schema, "bitagent.dag_failure_trace.v2");
    assert.equal(rejected.body.failureTrace.execution, false);
    assert.equal(rejected.body.state.events.length, taskResponse.body.state.events.length);
    const traces = (await fs.readFile(tracePath, "utf8")).trim().split(/\r?\n/);
    assert.equal(traces.length, 1);
    assert.equal(JSON.parse(traces[0]!).trace_id, rejected.body.failureTrace.trace_id);

    const accepted = await post(
      `/api/workflows/${encodeURIComponent(workflowId)}/dag-candidate`,
      { message, candidate: rejected.body.receipt.candidate }
    );
    assert.equal(accepted.body.receipt.ok, true);
    assert.equal(accepted.body.receipt.normalization.applied, false);
    assert.equal(accepted.body.receipt.execution, false);
    assert.equal(accepted.body.state.execution, undefined);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(traceRoot, { recursive: true, force: true });
  }
});
