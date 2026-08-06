import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { ScriptedWalletBroker } from "../src/launch/broker.js";
import { createTestLaunchKernel } from "../src/launch/factory.js";
import { createBitAgentServer } from "../src/launch/server.js";

test("HTTP launch surface exposes typed tools, referral workflow state, and the non-secret UI", async () => {
  const server = createBitAgentServer({ kernel: createTestLaunchKernel() });
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

    const tools = await fetch(`${origin}/api/tools`);
    assert.equal(tools.status, 200);
    const toolResult = await tools.json() as { tools: Record<string, unknown> };
    assert.equal(Object.keys(toolResult.tools).length, 10);
    assert.ok(toolResult.tools["bitagent.wallet.request_approval"]);
    assert.ok(toolResult.tools["bitagent.action.execute"]);

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
