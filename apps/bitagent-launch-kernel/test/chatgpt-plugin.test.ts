import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { AddressInfo } from "node:net";

import { moneyGuardrails, pluginConfig, repoRoot } from "../src/chatgpt/config.js";
import { McpEndpoint, serveStdio, SUPPORTED_PROTOCOL_VERSIONS, WIDGET_MIME_TYPE } from "../src/chatgpt/mcp.js";
import { PracticeSandbox, type PracticeKernel } from "../src/chatgpt/practiceSandbox.js";
import { createChatGptPluginServer } from "../src/chatgpt/server.js";
import { COVENANT_BOUNDS, runStrategyStressTest, type CovenantDraft } from "../src/chatgpt/strategyResearch.js";
import { ChatGptToolRegistry } from "../src/chatgpt/tools.js";
import { LaunchKernelError } from "../src/launch/errors.js";
import { extractAmountSats, identifyIntent } from "../src/launch/intent.js";

const now = new Date("2026-10-01T12:00:00.000Z");

function fakePracticeKernel() {
  const calls: string[] = [];
  let state: Record<string, any> | undefined;
  const simulation = (action: string, amountSats: string, feeSats: string, destinationAddress?: string) => ({
    action,
    hash: "ab".repeat(32),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    effects: [{ asset: action === "withdraw_bitcoin" ? "BTC" : "tlBTC", direction: "lock", amount: amountSats, unit: "sats" }],
    fees: { networkFeeSats: feeSats, protocolFeeSats: "0", totalFeeSats: feeSats },
    balanceBeforeSats: state!.wallet.confirmedBalanceSats,
    balanceAfterSats: (BigInt(state!.wallet.confirmedBalanceSats) - BigInt(feeSats)).toString(),
    destinationAddress,
    warnings: ["scripted"]
  });
  const kernel = {
    async start(input: { workflowId: string }) {
      calls.push(`start:${input.workflowId}`);
      state = {
        id: input.workflowId,
        stage: "wallet_required",
        wallet: { status: "disconnected", network: "bitcoin-testnet4", confirmedBalanceSats: "0" },
        deposit: { status: "not_started", confirmations: 0, requiredConfirmations: 2 }
      };
      return structuredClone(state);
    },
    async connectWallet(_id: string, input: { mode: string; publicAddress?: string }) {
      calls.push(`connect:${input.mode}:${input.publicAddress ?? "none"}`);
      state!.wallet = { ...state!.wallet, status: "connected", bitcoinAddress: "tb1qpracticeaddress" };
    },
    async prepareDeposit() {
      calls.push("prepare");
    },
    async observeDeposit(_id: string, input: { amountSats: string; txid: string }) {
      calls.push(`observe:${input.txid.length}`);
      state!.deposit = { status: "confirmed", amountSats: input.amountSats, confirmations: 2, requiredConfirmations: 2 };
      state!.wallet.confirmedBalanceSats = input.amountSats;
      state!.stage = "deposit_confirmed";
    },
    async simulateStrategy(_id: string, input: { amountSats: string }) {
      calls.push("simulateStrategy");
      if (BigInt(input.amountSats) > BigInt(state!.deposit.amountSats)) {
        throw new LaunchKernelError("insufficient_funds", "Confirmed reserve cannot cover the requested strategy amount");
      }
      state!.simulation = simulation("starter_strategy", input.amountSats, "900");
      state!.stage = "strategy_simulated";
    },
    async simulateWithdrawal(_id: string, input: { amountSats: string; destinationAddress: string }) {
      calls.push("simulateWithdrawal");
      state!.simulation = simulation("withdraw_bitcoin", input.amountSats, "600", input.destinationAddress);
      state!.stage = "withdrawal_simulated";
    },
    async getPublic(id: string) {
      if (!state || state.id !== id) throw new LaunchKernelError("not_found", `Unknown workflow: ${id}`);
      return structuredClone(state);
    }
  } as unknown as PracticeKernel;
  return { kernel, calls };
}

function endpointWith(kernel?: PracticeKernel) {
  const practice = kernel ? new PracticeSandbox(async () => kernel) : undefined;
  return new McpEndpoint(new ChatGptToolRegistry({ practice, now: () => now }));
}

async function rpc(endpoint: McpEndpoint, method: string, params: Record<string, unknown> = {}) {
  return await endpoint.handle({ jsonrpc: "2.0", id: 1, method, params }) as Record<string, any>;
}

async function callTool(endpoint: McpEndpoint, name: string, args: Record<string, unknown> = {}) {
  return (await rpc(endpoint, "tools/call", { name, arguments: args })).result as Record<string, any>;
}

const draft: CovenantDraft = {
  mandateId: "btc-range-maker-v1",
  capitalCapUsd: "1000.00",
  strategies: [{ strategyId: "passive_maker", weightBps: 7_000 }, { strategyId: "delta_hedge", weightBps: 3_000 }],
  absoluteMaxDriftBps: 50,
  risk: {
    maxGrossLeverageBps: 10_000,
    maxNetDeltaBps: 1_000,
    maxOrderFractionNavBps: 200,
    maxDailyLossBps: 150,
    maxDrawdownBps: 500,
    maxSlippageBps: 12,
    maxNetworkFeeSats: "5000"
  }
};
const calmMarket = { bidPriceUsd: "64990.00", askPriceUsd: "65010.00", markPriceUsd: "65000.00" };
const calm = {
  label: "calm",
  market: calmMarket,
  portfolio: { capitalUsd: "1000.00", currentNetDeltaBps: -200, grossLeverageBps: 8_000, dailyLossBps: 0, drawdownBps: 0 },
  targets: [
    { strategyId: "passive_maker", targetNetDeltaBps: 1_000, policyHint: "QUOTE_BOTH_SIDES" },
    { strategyId: "delta_hedge", targetNetDeltaBps: -800, policyHint: "REDUCE_DELTA" }
  ]
};

test("MCP handshake negotiates a version and carries the authority contract", async () => {
  const endpoint = endpointWith();
  const current = await rpc(endpoint, "initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  assert.equal(current.result.protocolVersion, "2025-06-18");
  assert.equal(current.result.serverInfo.name, "bitagent");
  assert.ok(current.result.capabilities.tools);
  assert.match(current.result.instructions, /candidate producer only/);
  assert.match(current.result.instructions, /seed phrase, private key, mnemonic, or WIF/);
  assert.match(current.result.instructions, /Recommend what to buy or how much to invest/);

  const unknown = await rpc(endpoint, "initialize", { protocolVersion: "1999-01-01" });
  assert.equal(unknown.result.protocolVersion, SUPPORTED_PROTOCOL_VERSIONS[0]);

  assert.equal(await endpoint.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), undefined);
  assert.deepEqual((await rpc(endpoint, "ping")).result, {});
  assert.equal((await rpc(endpoint, "prompts/list")).error.code, -32601);
  assert.equal((await endpoint.handle({ id: 1, method: "ping" }) as any).error.code, -32600);
  assert.equal((await rpc(endpoint, "tools/call", { name: "bitagent.action.execute" })).error.code, -32602);

  const batch = await endpoint.handle([
    { jsonrpc: "2.0", id: "a", method: "ping" },
    { jsonrpc: "2.0", method: "notifications/initialized" }
  ]) as any[];
  assert.equal(batch.length, 1);
  assert.equal(batch[0].id, "a");
});

test("tool surface is closed, effect-free, and has no approval or execution tool", async () => {
  const endpoint = endpointWith();
  const { tools } = (await rpc(endpoint, "tools/list")).result as { tools: Array<Record<string, any>> };
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    "bitagent_money_plan",
    "bitagent_overview",
    "bitagent_practice_simulate",
    "bitagent_practice_start",
    "bitagent_practice_status",
    "bitagent_research_brief",
    "bitagent_research_stress_test",
    "bitagent_self_host_plan"
  ]);
  for (const tool of tools) {
    assert.match(tool.name, /^[a-zA-Z0-9_-]{1,64}$/);
    assert.doesNotMatch(tool.name, /approv|execut|sign|broadcast|observe|connect|verify/);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(typeof tool.annotations.readOnlyHint, "boolean");
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.openWorldHint, false);
    assert.ok(tool._meta["openai/toolInvocation/invoking"].length <= 64);
    assert.ok(tool._meta["openai/toolInvocation/invoked"].length <= 64);
  }
  const writers = tools.filter((tool) => !tool.annotations.readOnlyHint).map((tool) => tool.name).sort();
  assert.deepEqual(writers, ["bitagent_practice_simulate", "bitagent_practice_start"]);

  const overview = await callTool(endpoint, "bitagent_overview");
  assert.equal(overview.structuredContent.fundedExecutionAllowed, false);
  assert.equal(overview.structuredContent.supportedIntents.length, 3);
  assert.deepEqual(overview.structuredContent.sessionDefaults, {
    compliance_state: "UNKNOWN",
    trading_permission: "NONE",
    referral_permission: "LINK_ONLY",
    leverage_permission: "NONE"
  });
  assert.deepEqual(JSON.parse(overview.content[1].text), overview.structuredContent);

  const unexpected = await callTool(endpoint, "bitagent_overview", { workflowId: "x" });
  assert.equal(unexpected.isError, true);
  assert.equal(unexpected.structuredContent.error.code, "invalid_arguments");
});

test("widget resource is a self-contained MCP Apps template linked from the tools", async () => {
  const endpoint = endpointWith();
  const { resources } = (await rpc(endpoint, "resources/list")).result;
  assert.equal(resources.length, 1);
  assert.equal(resources[0].uri, pluginConfig.widgetUri);
  assert.equal(resources[0].mimeType, WIDGET_MIME_TYPE);

  const { tools } = (await rpc(endpoint, "tools/list")).result as { tools: Array<Record<string, any>> };
  const linked = tools.filter((tool) => tool._meta.ui);
  assert.ok(linked.length >= 6);
  for (const tool of linked) {
    assert.equal(tool._meta.ui.resourceUri, pluginConfig.widgetUri);
    assert.equal(tool._meta["openai/outputTemplate"], pluginConfig.widgetUri);
  }

  const read = (await rpc(endpoint, "resources/read", { uri: pluginConfig.widgetUri })).result.contents[0];
  assert.equal(read.mimeType, WIDGET_MIME_TYPE);
  assert.deepEqual(read._meta.ui.csp, { connectDomains: [], resourceDomains: [] });
  assert.match(read.text, /ui\/notifications\/tool-result/);
  assert.match(read.text, /ui\/initialize/);
  assert.doesNotMatch(read.text, /<script[^>]+src=|<link\b|\bfetch\(|XMLHttpRequest|innerHTML|https?:\/\//);
  assert.equal((await rpc(endpoint, "resources/read", { uri: "ui://bitagent/other.html" })).error.code, -32002);
});

test("self-host plan gives real commands and states what is not self-serve", async () => {
  const endpoint = endpointWith();
  const windows = (await callTool(endpoint, "bitagent_self_host_plan", { platform: "windows" })).structuredContent;
  const commands = windows.steps.flatMap((step: { commands?: string[] }) => step.commands || []);
  assert.ok(commands.includes(`git clone --recurse-submodules ${pluginConfig.repos.bitagent}`));
  assert.ok(commands.includes("cd BitAgent\\apps\\bitagent-launch-kernel"));
  assert.ok(commands.includes("npm run launch"));
  assert.ok(commands.includes('$env:UTXO_REF_REPO = "$PWD\\UTXO-Ref"'));
  assert.ok(commands.indexOf("npm run test:skills") < commands.indexOf("npm run launch"));
  assert.equal(windows.localUrl, "http://127.0.0.1:8790/");
  assert.equal(windows.fundedExecutionAllowed, false);
  assert.equal(windows.localModel, undefined);
  // Until an operator records a tradelayer.js clone URL, the plan must say so rather than invent one.
  const clonesTradeLayer = commands.some((command: string) => /clone .*tradelayer\.js/.test(command));
  assert.equal(clonesTradeLayer, pluginConfig.repos.tradelayerJs !== "");
  assert.deepEqual(
    windows.stubs.map((stub: { step: string }) => stub.step),
    pluginConfig.repos.tradelayerJs ? [] : ["protocol_libraries"]
  );

  const linux = (await callTool(endpoint, "bitagent_self_host_plan", { platform: "linux" })).structuredContent;
  assert.ok(linux.steps.some((step: { commands?: string[] }) => step.commands?.includes('export UTXO_REF_REPO="$PWD/UTXO-Ref"')));

  const android = (await callTool(endpoint, "bitagent_self_host_plan", { platform: "android", includeLocalModel: true })).structuredContent;
  const lock = JSON.parse(await fs.readFile(path.join(repoRoot, "android", "model-package.lock.json"), "utf8"));
  assert.equal(android.localUrl, "http://127.0.0.1:8787/");
  assert.equal(android.localModel.totalArtifactBytes, lock.storage.totalArtifactBytes);
  assert.deepEqual(
    android.localModel.artifacts.map((artifact: { sha256: string }) => artifact.sha256),
    lock.artifacts.map((artifact: { sha256: string }) => artifact.sha256)
  );
  assert.equal(android.localModel.runtimeOperatorReady, false);
  assert.ok(android.stubs.some((stub: { step: string }) => stub.step === "mobile_app"));

  const invalid = await callTool(endpoint, "bitagent_self_host_plan", { platform: "ios" });
  assert.equal(invalid.isError, true);
  assert.equal(invalid.structuredContent.error.code, "invalid_arguments");
});

test("money plan asks before it computes, holds on pressure, and never sets funded limits", async () => {
  const endpoint = endpointWith();
  const empty = (await callTool(endpoint, "bitagent_money_plan")).structuredContent;
  assert.equal(empty.status, "needs_answers");
  assert.deepEqual(empty.questions.map((question: { field: string }) => question.field), [
    "fundsBorrowedOrNeededSoon", "emergencyFundMonths", "highInterestDebt", "budgetSats"
  ]);

  const answers = { fundsBorrowedOrNeededSoon: false, emergencyFundMonths: 6, highInterestDebt: false, budgetSats: "250000" };
  const borrowed = (await callTool(endpoint, "bitagent_money_plan", { ...answers, fundsBorrowedOrNeededSoon: true })).structuredContent;
  assert.equal(borrowed.status, "hold_view_only");
  assert.deepEqual(borrowed.reasonCodes, ["funds_borrowed_or_needed_soon"]);
  assert.equal(borrowed.limits, undefined);

  const pressured = await callTool(endpoint, "bitagent_money_plan", { ...answers, userStatements: ["honestly this is my rent money"] });
  assert.equal(pressured.structuredContent.status, "hold_view_only");
  assert.deepEqual(pressured.structuredContent.reasonCodes, ["financial_vulnerability_signal"]);
  assert.equal(pressured.structuredContent.session.high_risk_product_promotion, "BLOCKED");
  assert.doesNotMatch(JSON.stringify(pressured), /rent money/);

  const secret = await callTool(endpoint, "bitagent_money_plan", { ...answers, userStatements: ["my seed phrase is safe"] });
  assert.equal(secret.isError, true);
  assert.equal(secret.structuredContent.error.code, "secret_material_prohibited");

  const unprepared = (await callTool(endpoint, "bitagent_money_plan", { ...answers, emergencyFundMonths: 1, highInterestDebt: true })).structuredContent;
  assert.equal(unprepared.status, "practice_only");
  assert.deepEqual(unprepared.reasonCodes, ["emergency_fund_below_minimum", "high_interest_debt_declared"]);
  const tiny = (await callTool(endpoint, "bitagent_money_plan", { ...answers, budgetSats: "3001" })).structuredContent;
  assert.deepEqual(tiny.reasonCodes, ["budget_below_fee_buffer"]);

  const plan = (await callTool(endpoint, "bitagent_money_plan", { ...answers, userDeclaredBtcPriceUsd: "65000" })).structuredContent;
  assert.equal(plan.status, "limits_recorded");
  assert.equal(plan.fundedExecutionAllowed, false);
  assert.equal(plan.network, "bitcoin-testnet4");
  assert.deepEqual(plan.limits, {
    budgetSats: "250000",
    feeBufferSats: "3000",
    strategyCapSats: "24700",
    keepSpendableSats: "222300",
    strategyShareBps: moneyGuardrails.defaultStrategyShareBps,
    strategyShareSource: "guardrail_default",
    maxStrategyShareBps: moneyGuardrails.maxStrategyShareBps
  });
  assert.equal(
    BigInt(plan.limits.feeBufferSats) + BigInt(plan.limits.strategyCapSats) + BigInt(plan.limits.keepSpendableSats),
    BigInt(plan.limits.budgetSats)
  );
  assert.deepEqual(plan.approxUsd, {
    source: "user_declared_price_not_a_quote",
    budget: "162.50",
    strategyCap: "16.05",
    keepSpendable: "144.49"
  });
  assert.match(plan.planHash, /^[0-9a-f]{64}$/);
  // The handoff sentence must be one the self-hosted kernel's own parser accepts.
  assert.equal(identifyIntent(plan.handoff.sayThis), "starter_strategy");
  assert.equal(extractAmountSats(plan.handoff.sayThis), plan.limits.strategyCapSats);

  const chosen = (await callTool(endpoint, "bitagent_money_plan", { ...answers, strategyShareBps: 2_500 })).structuredContent;
  assert.equal(chosen.limits.strategyCapSats, "61750");
  assert.equal(chosen.limits.strategyShareSource, "user_declared");
  const overCap = await callTool(endpoint, "bitagent_money_plan", { ...answers, strategyShareBps: moneyGuardrails.maxStrategyShareBps + 1 });
  assert.equal(overCap.structuredContent.error.code, "invalid_arguments");
});

test("practice sandbox scripts the deposit itself, stops before approval, and classifies failures", async () => {
  const { kernel, calls } = fakePracticeKernel();
  const endpoint = endpointWith(kernel);
  const started = (await callTool(endpoint, "bitagent_practice_start", { practiceDepositSats: "250000" })).structuredContent;
  assert.match(started.workflowId, /^practice_[0-9a-f-]{36}$/);
  assert.deepEqual(calls.slice(1), ["connect:create:none", "prepare", "observe:64"]);
  assert.equal(started.simulated, true);
  assert.equal(started.deposit.amountSats, "250000");
  assert.equal(started.nextAuthority, "none");
  assert.equal(started.handoff, undefined);

  const simulated = (await callTool(endpoint, "bitagent_practice_simulate", {
    workflowId: started.workflowId, action: "starter_strategy", amountSats: "100000"
  })).structuredContent;
  assert.equal(simulated.stage, "strategy_simulated");
  assert.equal(simulated.simulation.fees.totalFeeSats, "900");
  assert.equal(simulated.nextAuthority, "wallet_user_on_self_hosted_bitagent");
  assert.equal(simulated.signingPerformed, false);
  assert.equal(simulated.broadcastPerformed, false);
  assert.equal(simulated.fundedExecutionAllowed, false);
  assert.equal(identifyIntent(simulated.handoff.sayThis), "starter_strategy");
  assert.equal(extractAmountSats(simulated.handoff.sayThis), "100000");

  const withdrawal = (await callTool(endpoint, "bitagent_practice_simulate", {
    workflowId: started.workflowId, action: "withdraw_bitcoin", amountSats: "50000", destinationAddress: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"
  })).structuredContent;
  assert.equal(identifyIntent(withdrawal.handoff.sayThis), "withdraw_bitcoin");
  assert.equal((await callTool(endpoint, "bitagent_practice_status", { workflowId: started.workflowId })).structuredContent.stage, "withdrawal_simulated");

  const tooMuch = await callTool(endpoint, "bitagent_practice_simulate", {
    workflowId: started.workflowId, action: "starter_strategy", amountSats: "900000"
  });
  assert.equal(tooMuch.isError, true);
  assert.deepEqual(
    [tooMuch.structuredContent.error.code, tooMuch.structuredContent.error.detailCode],
    ["practice_rejected", "insufficient_funds"]
  );
  const missingAddress = await callTool(endpoint, "bitagent_practice_simulate", {
    workflowId: started.workflowId, action: "withdraw_bitcoin", amountSats: "50000"
  });
  assert.equal(missingAddress.structuredContent.error.code, "invalid_arguments");
  const unknown = await callTool(endpoint, "bitagent_practice_status", { workflowId: "practice_unknown" });
  assert.equal(unknown.structuredContent.error.detailCode, "not_found");
  const oversized = await callTool(endpoint, "bitagent_practice_start", { practiceDepositSats: "100000001" });
  assert.equal(oversized.structuredContent.error.code, "invalid_arguments");
  assert.ok(!calls.some((call) => /approv|execut|verify/i.test(call)));
});

test("default practice kernel either runs scripted or fails closed without leaking host details", async () => {
  const result = await callTool(endpointWith(), "bitagent_practice_start", { practiceDepositSats: "250000" });
  if (result.isError) {
    // This host lacks the sibling UTXO-Ref / tradelayer.js checkouts.
    assert.equal(result.structuredContent.error.code, "practice_unavailable");
    assert.doesNotMatch(JSON.stringify(result), /[A-Za-z]:\\\\|node_modules|MODULE_NOT_FOUND/);
    assert.match((await callTool(endpointWith(), "bitagent_overview")).structuredContent.kind, /overview/);
  } else {
    assert.equal(result.structuredContent.simulated, true);
    assert.equal(result.structuredContent.deposit.status, "confirmed");
    const endpoint = endpointWith();
    const started = (await callTool(endpoint, "bitagent_practice_start", { practiceDepositSats: "250000" })).structuredContent;
    const simulated = (await callTool(endpoint, "bitagent_practice_simulate", {
      workflowId: started.workflowId, action: "starter_strategy", amountSats: "100000"
    })).structuredContent;
    assert.equal(simulated.simulation.effects[0].amount, "100000");
    assert.equal(simulated.broadcastPerformed, false);
  }
});

test("research stress test runs the real allocator and returns hypothetical outcomes only", async () => {
  const endpoint = endpointWith();
  const brief = (await callTool(endpoint, "bitagent_research_brief")).structuredContent;
  assert.equal(brief.hardLimits.bounds.maxGrossLeverageBps.maximum, 10_000);
  assert.equal(brief.effect, "none");

  const lossLimit = {
    label: "loss-limit-hit",
    market: { bidPriceUsd: "58490.00", askPriceUsd: "58510.00", markPriceUsd: "58500.00" },
    portfolio: { capitalUsd: "940.00", currentNetDeltaBps: 900, grossLeverageBps: 9_000, dailyLossBps: 200, drawdownBps: 600 },
    targets: [
      { strategyId: "passive_maker", targetNetDeltaBps: 1_000, policyHint: "QUOTE_BOTH_SIDES" },
      { strategyId: "delta_hedge", targetNetDeltaBps: 0, policyHint: "HOLD" }
    ]
  };
  const inCorridor = { ...calm, label: "in-corridor", portfolio: { ...calm.portfolio, currentNetDeltaBps: 450 } };
  const missingTarget = { ...calm, label: "missing-target", targets: [calm.targets[0]] };
  const crossed = { ...calm, label: "crossed", market: { ...calmMarket, bidPriceUsd: "65005.00" } };
  const response = await callTool(endpoint, "bitagent_research_stress_test", {
    covenantDraft: draft,
    scenarios: [calm, lossLimit, inCorridor, missingTarget, crossed]
  });
  const result = response.structuredContent;
  assert.equal(result.draftStatus, "valid");
  const [first, second, third, fourth, fifth] = result.scenarios;

  // (7000*1000 + 3000*-800)/10000 = 460 bps target; order capped at 2% of $1000 = $20 = 30769 sats at $65000.
  assert.equal(first.action, "place_limit");
  assert.equal(first.side, "buy_tlbtc");
  assert.equal(first.weightedTargetNetDeltaBps, 460);
  assert.equal(first.quantitySats, "30769");
  assert.equal(first.limitPriceUsd, "64990.00");
  assert.deepEqual(first.riskFlags, ["order_scoped_to_nav_fraction"]);
  assert.equal(first.verifierAgreed, true);
  assert.equal(first.wouldRequire, "wallet_approval_of_the_exact_transaction");

  assert.equal(second.action, "reduce_position");
  assert.equal(second.side, "sell_tlbtc");
  assert.equal(second.weightedTargetNetDeltaBps, 0);
  assert.ok(second.riskFlags.includes("daily_loss_circuit_breaker"));
  assert.ok(second.riskFlags.includes("drawdown_circuit_breaker"));

  assert.equal(third.action, "hold");
  assert.equal(third.wouldRequire, "nothing");
  assert.deepEqual([fourth.status, fourth.reasonCode], ["rejected", "proposal_invalid"]);
  assert.deepEqual([fifth.status, fifth.reasonCode], ["rejected", "market_state_invalid"]);
  assert.deepEqual(result.summary.actions, { place_limit: 1, reduce_position: 1, hold: 1 });
  assert.deepEqual(result.summary.circuitBreakers, ["daily_loss_circuit_breaker", "drawdown_circuit_breaker"]);

  assert.equal(result.scenarioSource, "model_hypothetical_not_market_data");
  assert.equal(result.covenantApproval, "not_requested");
  assert.equal(result.signingPerformed, false);
  assert.equal(result.broadcastPerformed, false);
  assert.doesNotMatch(JSON.stringify(response), /walletApprovalRef|approvalId|candidateHash|covenantHash|"approved"/);

  const badWeights = (await callTool(endpoint, "bitagent_research_stress_test", {
    covenantDraft: { ...draft, strategies: [{ strategyId: "passive_maker", weightBps: 9_000 }] }
  })).structuredContent;
  assert.deepEqual([badWeights.draftStatus, badWeights.reasonCode], ["rejected", "covenant_invalid"]);

  const leveraged = await callTool(endpoint, "bitagent_research_stress_test", {
    covenantDraft: { ...draft, risk: { ...draft.risk, maxGrossLeverageBps: 12_000 } }
  });
  assert.equal(leveraged.structuredContent.error.code, "invalid_arguments");
  const secretField = await callTool(endpoint, "bitagent_research_stress_test", {
    covenantDraft: { ...draft, privateKey: "x" }
  });
  assert.equal(secretField.structuredContent.error.code, "invalid_arguments");
});

test("research guardrails hold below the tool schema and agree with the covenant validator", () => {
  const leveraged = runStrategyStressTest({
    covenantDraft: { ...draft, risk: { ...draft.risk, maxGrossLeverageBps: 12_000 } }
  }, now);
  assert.ok(leveraged.draftStatus === "rejected");
  assert.equal(leveraged.reasonCode, "leverage_permission_none");

  const withSlippage = (maxSlippageBps: number) =>
    runStrategyStressTest({ covenantDraft: { ...draft, risk: { ...draft.risk, maxSlippageBps } } }, now);
  assert.equal(withSlippage(COVENANT_BOUNDS.maxSlippageBps.maximum).draftStatus, "valid");
  assert.equal(withSlippage(COVENANT_BOUNDS.maxSlippageBps.maximum + 1).draftStatus, "rejected");
  const withDrift = (absoluteMaxDriftBps: number) =>
    runStrategyStressTest({ covenantDraft: { ...draft, absoluteMaxDriftBps } }, now);
  assert.equal(withDrift(COVENANT_BOUNDS.absoluteMaxDriftBps.maximum).draftStatus, "valid");
  assert.equal(withDrift(COVENANT_BOUNDS.absoluteMaxDriftBps.maximum + 1).draftStatus, "rejected");

  const first = runStrategyStressTest({ covenantDraft: draft, scenarios: [calm as never] }, now);
  const second = runStrategyStressTest({ covenantDraft: draft, scenarios: [calm as never] }, now);
  assert.ok(first.draftStatus === "valid" && second.draftStatus === "valid");
  assert.equal(first.replayHash, second.replayHash);
});

test("HTTP transport is stateless JSON at /mcp with an origin allowlist", async () => {
  const server = createChatGptPluginServer({ endpoint: endpointWith(), preview: false });
  const withPreview = createChatGptPluginServer({ endpoint: endpointWith(), preview: true });
  for (const item of [server, withPreview]) {
    await new Promise<void>((resolve, reject) => {
      item.once("error", reject);
      item.listen(0, "127.0.0.1", resolve);
    });
  }
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (body: string, headers: Record<string, string> = {}) => fetch(`${origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body
    });
    const initialize = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });

    const initialized = await post(initialize);
    assert.equal(initialized.status, 200);
    assert.match(String(initialized.headers.get("content-type")), /application\/json/);
    assert.equal(initialized.headers.get("mcp-session-id"), null);
    assert.equal((await initialized.json() as any).result.serverInfo.name, "bitagent");

    assert.equal((await post(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }))).status, 202);
    const malformed = await post("{not json");
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json() as any).error.code, -32700);
    assert.equal((await post("x".repeat(1_000_001))).status, 413);

    const stream = await fetch(`${origin}/mcp`);
    assert.equal(stream.status, 405);
    assert.equal(stream.headers.get("allow"), "POST, OPTIONS");

    const hostile = await post(initialize, { origin: "https://evil.example" });
    assert.equal(hostile.status, 403);
    const chatgpt = await post(initialize, { origin: "https://chatgpt.com" });
    assert.equal(chatgpt.status, 200);
    assert.equal(chatgpt.headers.get("access-control-allow-origin"), "https://chatgpt.com");

    const health = await (await fetch(`${origin}/healthz`)).json() as Record<string, unknown>;
    assert.deepEqual([health.status, health.fundedExecutionAllowed], ["ok", false]);
    assert.equal((await fetch(`${origin}/preview`)).status, 404);

    const previewOrigin = `http://127.0.0.1:${(withPreview.address() as AddressInfo).port}`;
    assert.match(await (await fetch(`${previewOrigin}/preview`)).text(), /plugin preview/);
  } finally {
    for (const item of [server, withPreview]) {
      await new Promise<void>((resolve, reject) => item.close((error) => error ? reject(error) : resolve()));
    }
  }
});

test("stdio transport answers newline-delimited JSON-RPC", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = serveStdio(endpointWith(), input, output);
  const next = () => new Promise<Record<string, any>>((resolve) => output.once("data", (chunk) => resolve(JSON.parse(String(chunk)))));
  try {
    let pending = next();
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" })}\n`);
    const listed = await pending;
    assert.equal(listed.id, 7);
    assert.equal(listed.result.tools.length, 8);

    pending = next();
    input.write("not json\n");
    assert.equal((await pending).error.code, -32700);
  } finally {
    lines.close();
  }
});
