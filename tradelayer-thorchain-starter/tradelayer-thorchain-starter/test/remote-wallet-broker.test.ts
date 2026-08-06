import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { encodeSegwitAddress, validateBitcoinAddress } from "../src/launch/bitcoin.js";
import { createLaunchKernel } from "../src/launch/factory.js";
import { RemoteWalletExecutionBroker } from "../src/launch/remoteWalletBroker.js";
import { simulateBitcoinWithdrawal } from "../src/launch/tradelayerTool.js";
import type {
  BitAgentWorkflowState,
  WalletApproval
} from "../src/launch/types.js";

const AUTH_TOKEN = "test-wallet-broker-token-12345";
const ADDRESS = encodeSegwitAddress(Buffer.alloc(20, 29), "bitcoin-testnet4");
const SCRIPT = validateBitcoinAddress(ADDRESS, "bitcoin-testnet4").scriptPubKeyHex;
const TXID = "ef".repeat(32);

async function listen(handler: (input: {
  path: string;
  authorization: string;
  body: Record<string, unknown>;
}) => { status?: number; body: unknown }) {
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
      : {};
    const result = handler({
      path: request.url || "",
      authorization: String(request.headers.authorization || ""),
      body
    });
    const encoded = JSON.stringify(result.body);
    response.writeHead(result.status || 200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(encoded)
    });
    response.end(encoded);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()))
  };
}

function workflow(wallet: BitAgentWorkflowState["wallet"]): BitAgentWorkflowState {
  const now = "2026-08-06T09:00:00.000Z";
  return {
    id: "remote-wallet-workflow",
    version: 1,
    createdAt: now,
    updatedAt: now,
    stage: "deposit_confirmed",
    currentIntent: "withdraw_bitcoin",
    wallet,
    deposit: {
      status: "confirmed",
      address: wallet.bitcoinAddress,
      txid: "ab".repeat(32),
      vout: 0,
      amountSats: "250000",
      confirmations: 2,
      requiredConfirmations: 1
    },
    recoveryInstructions: [],
    events: []
  };
}

test("remote wallet broker binds authenticated pending approval and execution to one simulation", async () => {
  const requests: Array<{ path: string; authorization: string; body: Record<string, unknown> }> = [];
  let approvalCalls = 0;
  const service = await listen((request) => {
    requests.push(request);
    if (request.path === "/v1/wallet/connect") return { body: { data: {
      status: "connected",
      network: "bitcoin-testnet4",
      walletSessionId: "wallet_session_remote_001",
      bitcoinAddress: ADDRESS,
      confirmedBalanceSats: "250000",
      capabilities: ["deposit", "strategy", "withdraw", "psbt_approval"],
      connectedAt: "2026-08-06T09:00:00.000Z"
    } } };
    if (request.path === "/v1/wallet/deposit-address") return { body: { data: {
      address: ADDRESS,
      scriptPubKeyHex: SCRIPT
    } } };
    if (request.path === "/v1/wallet/fee-estimate") return { body: { data: {
      networkFeeSats: "600",
      source: "wallet-fee-source"
    } } };
    if (request.path === "/v1/wallet/approvals") {
      approvalCalls++;
      return { status: approvalCalls === 1 ? 202 : 200, body: { data: approvalCalls === 1 ? {
        status: "pending",
        walletApprovalRequestId: "wallet_approval_remote_001"
      } : {
        status: "approved",
        walletApprovalRequestId: "wallet_approval_remote_001",
        walletApprovalToken: "opaque-wallet-approval-token-001"
      } } };
    }
    if (request.path === "/v1/wallet/executions") return { body: { data: {
      id: "execution_remote_0001",
      action: "withdraw_bitcoin",
      status: "submitted",
      simulationHash: request.body.simulationHash,
      idempotencyKey: request.body.idempotencyKey,
      approvalId: request.body.approvalId,
      walletApprovalRequestId: request.body.walletApprovalRequestId,
      txid: TXID,
      submittedAt: "2026-08-06T09:01:00.000Z"
    } } };
    return { status: 404, body: { error: "not found" } };
  });

  try {
    const broker = new RemoteWalletExecutionBroker({ endpoint: service.origin, authToken: AUTH_TOKEN });
    const wallet = await broker.connect({
      mode: "connect",
      network: "bitcoin-testnet4",
      publicAddress: ADDRESS,
      now: new Date("2026-08-06T09:00:00.000Z")
    });
    const state = workflow(wallet);
    assert.deepEqual(await broker.getDepositAddress({ wallet }), { address: ADDRESS, scriptPubKeyHex: SCRIPT });
    const fee = await broker.estimateFee({ action: "withdraw_bitcoin", amountSats: "50000", state });
    const simulation = simulateBitcoinWithdrawal({
      destinationAddress: ADDRESS,
      network: "bitcoin-testnet4",
      amountSats: "50000",
      balanceSats: "250000",
      networkFeeSats: fee.networkFeeSats,
      now: new Date("2026-08-06T09:00:00.000Z"),
      ttlMs: 60_000
    });
    const approval: WalletApproval = {
      id: "approval_remote_0001",
      action: "withdraw_bitcoin",
      simulationHash: simulation.hash,
      status: "pending",
      requestedAt: "2026-08-06T09:00:00.000Z"
    };
    const pending = await broker.authorize({ approval, simulation, state });
    assert.equal(pending.status, "pending");
    approval.walletApprovalRequestId = pending.walletApprovalRequestId;
    const approved = await broker.authorize({ approval, simulation, state });
    assert.equal(approved.status, "approved");
    if (approved.status !== "approved") throw new Error("expected approved fixture");
    approval.status = "approved";
    approval.walletApprovalToken = approved.walletApprovalToken;
    const execution = await broker.execute({
      approval,
      simulation,
      state,
      now: new Date("2026-08-06T09:01:00.000Z")
    });

    assert.equal(execution.txid, TXID);
    assert.ok(requests.every((request) => request.authorization === `Bearer ${AUTH_TOKEN}`));
    const approvalRequests = requests.filter((request) => request.path.endsWith("/approvals"));
    assert.equal(approvalRequests[0]!.body.simulationHash, simulation.hash);
    assert.equal(approvalRequests[1]!.body.walletApprovalRequestId, "wallet_approval_remote_001");
    const executionRequest = requests.find((request) => request.path.endsWith("/executions"))!;
    assert.match(String(executionRequest.body.idempotencyKey), /^[a-f0-9]{64}$/);
    assert.equal(executionRequest.body.walletApprovalToken, approval.walletApprovalToken);
    assert.doesNotMatch(JSON.stringify(requests), /mnemonic|privateKey|\bwif\b|seedPhrase/i);
    await assert.rejects(broker.verify(), /independent TradeLayer and Bitcoin sources/i);
  } finally {
    await service.close();
  }
});

test("remote wallet broker rejects secret-bearing responses", async () => {
  const service = await listen(() => ({ body: { data: {
    status: "connected",
    network: "bitcoin-testnet4",
    walletSessionId: "wallet_session_remote_002",
    bitcoinAddress: ADDRESS,
    confirmedBalanceSats: "0",
    capabilities: ["deposit", "strategy", "withdraw", "psbt_approval"],
    connectedAt: "2026-08-06T09:00:00.000Z",
    wif: "prohibited"
  } } }));
  try {
    const broker = new RemoteWalletExecutionBroker({ endpoint: service.origin, authToken: AUTH_TOKEN });
    await assert.rejects(
      broker.connect({ mode: "create", network: "bitcoin-testnet4", now: new Date() }),
      /prohibited secret/i
    );
  } finally {
    await service.close();
  }
});

test("remote wallet broker rejects wallet-session and approval-request substitution", async () => {
  const service = await listen((request) => {
    if (request.path.endsWith("/connect")) return { body: { data: {
      status: "connected",
      network: "bitcoin-testnet4",
      walletSessionId: "wallet_session_replacement",
      bitcoinAddress: ADDRESS,
      confirmedBalanceSats: "250000",
      capabilities: ["deposit", "strategy", "withdraw", "psbt_approval"],
      connectedAt: "2026-08-06T09:00:00.000Z"
    } } };
    return { body: { data: {
      status: "approved",
      walletApprovalRequestId: "wallet_approval_replacement",
      walletApprovalToken: "opaque-wallet-approval-token-replacement"
    } } };
  });
  try {
    const broker = new RemoteWalletExecutionBroker({ endpoint: service.origin, authToken: AUTH_TOKEN });
    await assert.rejects(
      broker.connect({
        mode: "connect",
        network: "bitcoin-testnet4",
        publicAddress: ADDRESS,
        walletSessionId: "wallet_session_original",
        now: new Date()
      }),
      /different public session/i
    );

    const wallet = {
      status: "connected" as const,
      mode: "connect" as const,
      walletSessionId: "wallet_session_original",
      bitcoinAddress: ADDRESS,
      network: "bitcoin-testnet4" as const,
      confirmedBalanceSats: "250000",
      capabilities: ["deposit", "strategy", "withdraw", "psbt_approval"] as const,
      connectedAt: "2026-08-06T09:00:00.000Z"
    };
    const state = workflow({ ...wallet, capabilities: [...wallet.capabilities] });
    const simulation = simulateBitcoinWithdrawal({
      destinationAddress: ADDRESS,
      network: "bitcoin-testnet4",
      amountSats: "50000",
      balanceSats: "250000",
      networkFeeSats: "600",
      now: new Date("2026-08-06T09:00:00.000Z"),
      ttlMs: 60_000
    });
    const approval: WalletApproval = {
      id: "approval_remote_original",
      action: "withdraw_bitcoin",
      simulationHash: simulation.hash,
      status: "pending",
      requestedAt: "2026-08-06T09:00:00.000Z",
      walletApprovalRequestId: "wallet_approval_original"
    };
    await assert.rejects(
      broker.authorize({ approval, simulation, state }),
      /substituted a different approval request/i
    );
  } finally {
    await service.close();
  }
});

test("remote wallet broker rejects insecure configuration and production without independent sources", () => {
  assert.throws(
    () => new RemoteWalletExecutionBroker({ endpoint: "http://wallet.example", authToken: AUTH_TOKEN }),
    /HTTPS or loopback/i
  );
  assert.throws(
    () => new RemoteWalletExecutionBroker({ endpoint: "http://127.0.0.1:9000", authToken: "short" }),
    /opaque 16-2048/i
  );
  const broker = new RemoteWalletExecutionBroker({ endpoint: "http://127.0.0.1:9000", authToken: AUTH_TOKEN });
  assert.throws(
    () => createLaunchKernel({ production: true, walletBroker: broker }),
    /independent strategy funding, TradeLayer order, and Bitcoin withdrawal sources/i
  );
});

test("remote wallet broker rejects a mismatched execution receipt", async () => {
  const service = await listen((request) => ({ body: { data: {
    id: "execution_remote_0002",
    action: "withdraw_bitcoin",
    status: "submitted",
    simulationHash: "00".repeat(32),
    idempotencyKey: request.body.idempotencyKey,
    approvalId: request.body.approvalId,
    walletApprovalRequestId: request.body.walletApprovalRequestId,
    txid: TXID,
    submittedAt: "2026-08-06T09:01:00.000Z",
    requestEcho: request.body.idempotencyKey
  } } }));
  try {
    const broker = new RemoteWalletExecutionBroker({ endpoint: service.origin, authToken: AUTH_TOKEN });
    const wallet = {
      status: "connected" as const,
      mode: "connect" as const,
      walletSessionId: "wallet_session_remote_003",
      bitcoinAddress: ADDRESS,
      network: "bitcoin-testnet4" as const,
      confirmedBalanceSats: "250000",
      capabilities: ["deposit", "strategy", "withdraw", "psbt_approval"] as const,
      connectedAt: "2026-08-06T09:00:00.000Z"
    };
    const state = workflow({ ...wallet, capabilities: [...wallet.capabilities] });
    const simulation = simulateBitcoinWithdrawal({
      destinationAddress: ADDRESS,
      network: "bitcoin-testnet4",
      amountSats: "50000",
      balanceSats: "250000",
      networkFeeSats: "600",
      now: new Date("2026-08-06T09:00:00.000Z"),
      ttlMs: 60_000
    });
    const approval: WalletApproval = {
      id: "approval_remote_0002",
      action: "withdraw_bitcoin",
      simulationHash: simulation.hash,
      status: "approved",
      requestedAt: "2026-08-06T09:00:00.000Z",
      walletApprovalToken: "opaque-wallet-approval-token-002"
    };
    await assert.rejects(
      broker.execute({ approval, simulation, state, now: new Date("2026-08-06T09:01:00.000Z") }),
      /mismatched execution receipt/i
    );
  } finally {
    await service.close();
  }
});
