import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BitAgentConversation } from "../src/launch/agent.js";
import {
  ScriptedQuoteProvider,
  ScriptedWalletBroker,
  type ScriptedBrokerOptions
} from "../src/launch/broker.js";
import { encodeSegwitAddress, validateBitcoinAddress } from "../src/launch/bitcoin.js";
import { createLaunchKernel, createTestLaunchKernel } from "../src/launch/factory.js";
import { LaunchKernelError } from "../src/launch/errors.js";
import { FileWorkflowStore } from "../src/launch/store.js";
import type { BitAgentLaunchKernel } from "../src/launch/kernel.js";
import type { TradeLayerOrderReadSource } from "../src/settlement/tradelayerOrderVerifier.js";
import type {
  BitcoinWithdrawalObservation,
  BitcoinWithdrawalReadSource
} from "../src/settlement/types.js";

function txid(seed: number) {
  return seed.toString(16).padStart(64, "0");
}

function address(seed = 9) {
  return encodeSegwitAddress(Buffer.alloc(20, seed), "bitcoin-testnet4");
}

let workflowCounter = 0;

async function connectedKernel(options: {
  now?: () => Date;
  brokerOptions?: ScriptedBrokerOptions;
  workflowId?: string;
  confirmed?: boolean;
  referral?: boolean;
  tradeLayerOrderSource?: TradeLayerOrderReadSource;
  bitcoinWithdrawalSource?: BitcoinWithdrawalReadSource;
} = {}) {
  const walletBroker = new ScriptedWalletBroker(options.brokerOptions);
  const kernel = createTestLaunchKernel({
    now: options.now,
    walletBroker,
    tradeLayerOrderSource: options.tradeLayerOrderSource,
    bitcoinWithdrawalSource: options.bitcoinWithdrawalSource
  });
  const workflowId = options.workflowId || `trajectory-${++workflowCounter}`;
  await kernel.start({
    workflowId,
    referralLink: options.referral
      ? "https://bitagent.local/?ref=alice&campaign=kernel&workflow=strategy&strategy=starter-v1"
      : undefined
  });
  await kernel.connectWallet(workflowId, { mode: "create" });
  await kernel.prepareDeposit(workflowId);
  if (options.confirmed !== undefined) {
    await kernel.observeDeposit(workflowId, {
      txid: txid(options.confirmed ? 1 : 2),
      vout: 0,
      amountSats: "250000",
      blockHeight: 100,
      currentHeight: options.confirmed ? 101 : 100
    });
  }
  return { kernel, workflowId, walletBroker };
}

class LaunchTradeLayerSource implements TradeLayerOrderReadSource {
  readonly source = "independent-launch-fixture";
  address = "";
  synced = true;
  available = true;

  async getSyncStatus() {
    if (!this.available) throw new Error("listener offline");
    return {
      initialized: true,
      phase: "realtime",
      currentHeight: this.synced ? 101 : 90,
      targetHeight: 101,
      processedHeight: this.synced ? 101 : 90
    };
  }

  async getTransaction(observedTxid: string) {
    return {
      txid: observedTxid,
      valid: true,
      senderAddress: this.address,
      propertyIdOffered: 1,
      propertyIdDesired: 2,
      amountOffered: "0.001",
      amountExpected: "65",
      post: true,
      block: 101
    };
  }

  async getOrderbook(_offeredPropertyId: number, _desiredPropertyId: number) {
    return {
      buy: [],
      sell: [{
        fullTxid: this.lastTxid,
        sender: this.address,
        offeredPropertyId: 1,
        desiredPropertyId: 2,
        amountOffered: "0.001",
        amountExpected: "65"
      }]
    };
  }

  private lastTxid = "";

  async getTokenTradeHistory(_offeredPropertyId: number, _desiredPropertyId: number, _address: string) {
    return [];
  }

  rememberTxid(value: string) {
    this.lastTxid = value;
  }
}

class LaunchBitcoinWithdrawalSource implements BitcoinWithdrawalReadSource {
  readonly source = "independent-bitcoin-launch-fixture";
  readonly network = "bitcoin-testnet4" as const;
  state: BitcoinWithdrawalObservation["state"] = "confirmed";
  confirmations = 1;
  available = true;
  txid = "";
  destinationScriptPubKeyHex = "";
  amountSats = "50000";
  feeSats = "600";
  walletNetDebitSats = "50600";

  async observeWithdrawal(observedTxid: string): Promise<BitcoinWithdrawalObservation> {
    if (!this.available) throw new Error("Bitcoin Core offline");
    return {
      txid: this.txid || observedTxid,
      network: this.network,
      state: this.state,
      confirmations: this.confirmations,
      blockHash: this.state === "confirmed" ? "cd".repeat(32) : undefined,
      outputs: this.state === "missing" ? [] : [{
        vout: 0,
        valueSats: this.amountSats,
        scriptPubKeyHex: this.destinationScriptPubKeyHex
      }],
      feeSats: this.feeSats,
      walletNetDebitSats: this.walletNetDebitSats,
      observedAt: "2026-08-06T08:00:00.000Z",
      source: this.source
    };
  }

  bind(input: {
    txid: string;
    destinationAddress: string;
    amountSats: string;
    feeSats: string;
    walletNetDebitSats: string;
  }) {
    this.txid = input.txid;
    this.destinationScriptPubKeyHex = validateBitcoinAddress(
      input.destinationAddress,
      this.network
    ).scriptPubKeyHex;
    this.amountSats = input.amountSats;
    this.feeSats = input.feeSats;
    this.walletNetDebitSats = input.walletNetDebitSats;
  }
}

async function simulateApproveExecuteVerify(kernel: BitAgentLaunchKernel, workflowId: string) {
  await kernel.simulateStrategy(workflowId, { amountSats: "100000" });
  await kernel.requestApproval(workflowId);
  await kernel.resolveApproval(workflowId, "approve");
  await kernel.execute(workflowId);
  return kernel.verify(workflowId);
}

async function submitIndependentWithdrawal(
  kernel: BitAgentLaunchKernel,
  workflowId: string,
  source: LaunchBitcoinWithdrawalSource
) {
  const simulation = await kernel.simulateWithdrawal(workflowId, {
    destinationAddress: address(19),
    amountSats: "50000"
  });
  await kernel.requestApproval(workflowId);
  await kernel.resolveApproval(workflowId, "approve");
  const execution = await kernel.execute(workflowId);
  source.bind({
    txid: execution.txid!,
    destinationAddress: simulation.destinationAddress!,
    amountSats: simulation.effects[0]!.amount,
    feeSats: simulation.fees.networkFeeSats,
    walletNetDebitSats: (
      BigInt(simulation.balanceBeforeSats) - BigInt(simulation.balanceAfterSats)
    ).toString()
  });
  return { simulation, execution };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) =>
    error instanceof LaunchKernelError && error.code === code
  );
}

test("trajectory 01: referral -> wallet -> deposit -> strategy -> withdrawal", async () => {
  const { kernel, workflowId } = await connectedKernel({ confirmed: true, referral: true });
  const strategy = await simulateApproveExecuteVerify(kernel, workflowId);
  assert.equal(strategy.status, "verified");
  assert.equal((await kernel.get(workflowId)).referral?.status, "activated");

  await kernel.simulateWithdrawal(workflowId, {
    destinationAddress: address(),
    amountSats: "50000"
  });
  await kernel.requestApproval(workflowId);
  await kernel.resolveApproval(workflowId, "approve");
  await kernel.execute(workflowId);
  const withdrawal = await kernel.verify(workflowId);
  assert.equal(withdrawal.status, "verified");
  assert.equal((await kernel.get(workflowId)).wallet.confirmedBalanceSats, "98500");
});

test("trajectory 02: connect an existing public wallet address", async () => {
  const kernel = createTestLaunchKernel();
  await kernel.start({ workflowId: "existing-wallet" });
  const state = await kernel.connectWallet("existing-wallet", {
    mode: "connect",
    publicAddress: address(3),
    walletSessionId: "public-session"
  });
  assert.equal(state.wallet.bitcoinAddress, address(3));
  assert.equal(state.wallet.status, "connected");
});

test("trajectory 03: unconfirmed deposit blocks strategy", async () => {
  const { kernel, workflowId } = await connectedKernel({ confirmed: false });
  await expectCode(kernel.simulateStrategy(workflowId, { amountSats: "1000" }), "deposit_unconfirmed");
});

test("trajectory 04: unconfirmed deposit resumes after confirmation", async () => {
  const { kernel, workflowId } = await connectedKernel({ confirmed: false });
  const state = await kernel.get(workflowId);
  await kernel.observeDeposit(workflowId, {
    txid: state.deposit.txid!,
    vout: state.deposit.vout!,
    amountSats: state.deposit.amountSats!,
    blockHeight: 100,
    currentHeight: 101
  });
  const simulation = await kernel.simulateStrategy(workflowId, { amountSats: "1000" });
  assert.equal(simulation.action, "starter_strategy");
});

test("trajectory 05: insufficient strategy funds fail before approval", async () => {
  const { kernel, workflowId } = await connectedKernel({ confirmed: true });
  await expectCode(kernel.simulateStrategy(workflowId, { amountSats: "250000" }), "insufficient_funds");
  assert.equal((await kernel.get(workflowId)).pendingApproval, undefined);
});

test("trajectory 06: user cancels strategy approval", async () => {
  const { kernel, workflowId } = await connectedKernel({ confirmed: true, referral: true });
  await kernel.simulateStrategy(workflowId, { amountSats: "100000" });
  await kernel.requestApproval(workflowId);
  const approval = await kernel.resolveApproval(workflowId, "cancel");
  assert.equal(approval.status, "cancelled");
  await expectCode(kernel.execute(workflowId), "approval_required");
  assert.equal((await kernel.get(workflowId)).referral?.status, "pending");
});

test("trajectory 07: rejected wallet signature is recoverable", async () => {
  const options = { rejectAuthorization: true };
  const { kernel, workflowId } = await connectedKernel({ confirmed: true, brokerOptions: options });
  await kernel.simulateStrategy(workflowId, { amountSats: "100000" });
  await kernel.requestApproval(workflowId);
  await expectCode(kernel.resolveApproval(workflowId, "approve"), "approval_rejected");
  const state = await kernel.get(workflowId);
  assert.equal(state.pendingApproval?.status, "rejected");
  assert.match(state.recoveryInstructions[0], /no transaction was executed/i);
});

test("trajectory 08: stale quote fails before approval", async () => {
  let current = new Date("2026-01-01T00:00:00Z");
  const now = () => new Date(current);
  const { kernel, workflowId } = await connectedKernel({ confirmed: true, now });
  await kernel.simulateStrategy(workflowId, { amountSats: "100000" });
  current = new Date(current.getTime() + 61_000);
  await expectCode(kernel.requestApproval(workflowId), "simulation_stale");
});

test("trajectory 09: stale quote fails after approval but before execution", async () => {
  let current = new Date("2026-01-01T00:00:00Z");
  const now = () => new Date(current);
  const { kernel, workflowId } = await connectedKernel({ confirmed: true, now });
  await kernel.simulateStrategy(workflowId, { amountSats: "100000" });
  await kernel.requestApproval(workflowId);
  await kernel.resolveApproval(workflowId, "approve");
  current = new Date(current.getTime() + 61_000);
  await expectCode(kernel.execute(workflowId), "simulation_stale");
});

test("trajectory 10: interrupted session resumes after simulation", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-sim-"));
  const store = new FileWorkflowStore(path.join(directory, "states.json"));
  const first = createLaunchKernel({
    store,
    walletBroker: new ScriptedWalletBroker(),
    quoteProvider: new ScriptedQuoteProvider()
  });
  await first.start({ workflowId: "resume-simulation" });
  await first.connectWallet("resume-simulation", { mode: "create" });
  await first.prepareDeposit("resume-simulation");
  await first.observeDeposit("resume-simulation", {
    txid: txid(10), vout: 0, amountSats: "250000", blockHeight: 100, currentHeight: 101
  });
  const simulation = await first.simulateStrategy("resume-simulation", { amountSats: "100000" });

  const resumed = createLaunchKernel({
    store,
    walletBroker: new ScriptedWalletBroker(),
    quoteProvider: new ScriptedQuoteProvider()
  });
  assert.equal((await resumed.get("resume-simulation")).simulation?.hash, simulation.hash);
});

test("trajectory 11: interrupted session resumes after approval", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-approval-"));
  const store = new FileWorkflowStore(path.join(directory, "states.json"));
  const first = createLaunchKernel({ store, walletBroker: new ScriptedWalletBroker() });
  await first.start({ workflowId: "resume-approval" });
  await first.connectWallet("resume-approval", { mode: "create" });
  await first.prepareDeposit("resume-approval");
  await first.observeDeposit("resume-approval", {
    txid: txid(11), vout: 0, amountSats: "250000", blockHeight: 100, currentHeight: 101
  });
  await first.simulateStrategy("resume-approval", { amountSats: "100000" });
  await first.requestApproval("resume-approval");
  await first.resolveApproval("resume-approval", "approve");

  const resumed = createLaunchKernel({ store, walletBroker: new ScriptedWalletBroker() });
  const execution = await resumed.execute("resume-approval");
  assert.equal(execution.status, "submitted");
});

test("trajectory 12: interrupted session resumes verification after submit", async () => {
  const { kernel, workflowId } = await connectedKernel({ confirmed: true });
  await kernel.simulateStrategy(workflowId, { amountSats: "100000" });
  await kernel.requestApproval(workflowId);
  await kernel.resolveApproval(workflowId, "approve");
  await kernel.execute(workflowId);
  const verification = await kernel.verify(workflowId);
  assert.equal(verification.status, "verified");
});

test("trajectory 13: malformed withdrawal address is rejected", async () => {
  const { kernel, workflowId } = await connectedKernel({ confirmed: true });
  await expectCode(kernel.simulateWithdrawal(workflowId, {
    destinationAddress: "bc1-not-valid",
    amountSats: "1000"
  }), "malformed_address");
});

test("trajectory 14: insufficient withdrawal funds fail before approval", async () => {
  const { kernel, workflowId } = await connectedKernel({ confirmed: true });
  await expectCode(kernel.simulateWithdrawal(workflowId, {
    destinationAddress: address(),
    amountSats: "250000"
  }), "insufficient_funds");
});

test("trajectory 15: withdrawal cancellation preserves funds", async () => {
  const { kernel, workflowId } = await connectedKernel({ confirmed: true });
  await kernel.simulateWithdrawal(workflowId, { destinationAddress: address(), amountSats: "50000" });
  await kernel.requestApproval(workflowId);
  await kernel.resolveApproval(workflowId, "reject");
  assert.equal((await kernel.get(workflowId)).wallet.confirmedBalanceSats, "250000");
});

test("trajectory 16: withdrawal signature rejection is recoverable", async () => {
  const { kernel, workflowId } = await connectedKernel({
    confirmed: true,
    brokerOptions: { rejectAuthorization: true }
  });
  await kernel.simulateWithdrawal(workflowId, { destinationAddress: address(), amountSats: "50000" });
  await kernel.requestApproval(workflowId);
  await expectCode(kernel.resolveApproval(workflowId, "approve"), "approval_rejected");
  assert.equal((await kernel.get(workflowId)).wallet.confirmedBalanceSats, "250000");
});

test("wallet-owned pending approval resumes without execution or a new simulation", async () => {
  const brokerOptions = { pendingAuthorization: true };
  const { kernel, workflowId } = await connectedKernel({ confirmed: true, brokerOptions });
  const simulation = await kernel.simulateStrategy(workflowId, { amountSats: "100000" });
  await kernel.requestApproval(workflowId);
  const pending = await kernel.resolveApproval(workflowId, "approve");
  const pendingState = await kernel.get(workflowId);

  assert.equal(pending.status, "pending");
  assert.ok(pending.walletApprovalRequestId);
  assert.equal(pendingState.stage, "strategy_approval_pending");
  assert.equal(pendingState.execution, undefined);
  assert.equal(pendingState.simulation?.hash, simulation.hash);

  brokerOptions.pendingAuthorization = false;
  const approved = await kernel.resolveApproval(workflowId, "approve");
  assert.equal(approved.status, "approved");
  assert.equal(approved.walletApprovalRequestId, pending.walletApprovalRequestId);
  assert.ok(approved.walletApprovalToken);
});

test("wallet approval outage preserves the same pending request for recovery", async () => {
  const brokerOptions = { pendingAuthorization: true, unavailableAuthorization: false };
  const { kernel, workflowId } = await connectedKernel({ confirmed: true, brokerOptions });
  await kernel.simulateStrategy(workflowId, { amountSats: "100000" });
  await kernel.requestApproval(workflowId);
  const pending = await kernel.resolveApproval(workflowId, "approve");
  brokerOptions.pendingAuthorization = false;
  brokerOptions.unavailableAuthorization = true;

  await expectCode(kernel.resolveApproval(workflowId, "approve"), "provider_unavailable");
  const state = await kernel.get(workflowId);
  assert.equal(state.pendingApproval?.status, "pending");
  assert.equal(state.pendingApproval?.walletApprovalRequestId, pending.walletApprovalRequestId);
  assert.equal(state.stage, "strategy_approval_pending");
  assert.equal(state.execution, undefined);
  assert.match(state.recoveryInstructions.join(" "), /outcome could not be confirmed/i);
});

test("trajectory 17: pending verification can be retried", async () => {
  const options = { pendingVerification: true };
  const { kernel, workflowId } = await connectedKernel({ confirmed: true, brokerOptions: options });
  await kernel.simulateStrategy(workflowId, { amountSats: "100000" });
  await kernel.requestApproval(workflowId);
  await kernel.resolveApproval(workflowId, "approve");
  await kernel.execute(workflowId);
  assert.equal((await kernel.verify(workflowId)).status, "pending");
  options.pendingVerification = false;
  assert.equal((await kernel.verify(workflowId)).status, "verified");
});

test("trajectory 18: duplicate execute is idempotent", async () => {
  const { kernel, workflowId } = await connectedKernel({ confirmed: true });
  await kernel.simulateStrategy(workflowId, { amountSats: "100000" });
  await kernel.requestApproval(workflowId);
  await kernel.resolveApproval(workflowId, "approve");
  const first = await kernel.execute(workflowId);
  const second = await kernel.execute(workflowId);
  assert.equal(second.id, first.id);
  assert.equal(second.txid, first.txid);
});

test("trajectory 19: referral is not activated by wallet or deposit", async () => {
  const { kernel, workflowId } = await connectedKernel({ confirmed: true, referral: true });
  assert.equal((await kernel.get(workflowId)).referral?.status, "pending");
});

test("trajectory 20: referral activates only on verified strategy", async () => {
  const { kernel, workflowId } = await connectedKernel({ confirmed: true, referral: true });
  await kernel.simulateStrategy(workflowId, { amountSats: "100000" });
  await kernel.requestApproval(workflowId);
  await kernel.resolveApproval(workflowId, "approve");
  await kernel.execute(workflowId);
  assert.equal((await kernel.get(workflowId)).referral?.status, "pending");
  await kernel.verify(workflowId);
  assert.equal((await kernel.get(workflowId)).referral?.status, "activated");
});

test("independent TradeLayer verification replaces broker self-report before referral activation", async () => {
  const tradeLayer = new LaunchTradeLayerSource();
  const { kernel, workflowId } = await connectedKernel({
    confirmed: true,
    referral: true,
    tradeLayerOrderSource: tradeLayer
  });
  tradeLayer.address = (await kernel.get(workflowId)).wallet.bitcoinAddress!;
  await kernel.simulateStrategy(workflowId, { amountSats: "100000" });
  await kernel.requestApproval(workflowId);
  await kernel.resolveApproval(workflowId, "approve");
  const execution = await kernel.execute(workflowId);
  tradeLayer.rememberTxid(execution.txid!);
  const verification = await kernel.verify(workflowId);

  assert.equal(verification.status, "verified");
  assert.equal(verification.orderId, execution.txid);
  assert.equal(verification.evidence?.source, tradeLayer.source);
  assert.equal(verification.evidence?.openOrderMatched, true);
  assert.equal((await kernel.get(workflowId)).referral?.status, "activated");
});

test("stale independent TradeLayer state keeps strategy and referral pending", async () => {
  const tradeLayer = new LaunchTradeLayerSource();
  tradeLayer.synced = false;
  const { kernel, workflowId } = await connectedKernel({
    confirmed: true,
    referral: true,
    tradeLayerOrderSource: tradeLayer
  });
  tradeLayer.address = (await kernel.get(workflowId)).wallet.bitcoinAddress!;
  await kernel.simulateStrategy(workflowId, { amountSats: "100000" });
  await kernel.requestApproval(workflowId);
  await kernel.resolveApproval(workflowId, "approve");
  const execution = await kernel.execute(workflowId);
  tradeLayer.rememberTxid(execution.txid!);
  const verification = await kernel.verify(workflowId);
  const state = await kernel.get(workflowId);

  assert.equal(verification.status, "pending");
  assert.equal(state.stage, "strategy_submitted");
  assert.equal(state.referral?.status, "pending");
  assert.equal(state.wallet.confirmedBalanceSats, "250000");
});

test("temporarily unavailable independent verification persists a retryable pending state", async () => {
  const tradeLayer = new LaunchTradeLayerSource();
  tradeLayer.available = false;
  const { kernel, workflowId } = await connectedKernel({
    confirmed: true,
    referral: true,
    tradeLayerOrderSource: tradeLayer
  });
  tradeLayer.address = (await kernel.get(workflowId)).wallet.bitcoinAddress!;
  await kernel.simulateStrategy(workflowId, { amountSats: "100000" });
  await kernel.requestApproval(workflowId);
  await kernel.resolveApproval(workflowId, "approve");
  const execution = await kernel.execute(workflowId);
  tradeLayer.rememberTxid(execution.txid!);
  const first = await kernel.verify(workflowId);
  assert.equal(first.status, "pending");
  assert.match(String(first.evidence?.reason), /temporarily unavailable/i);
  assert.equal((await kernel.get(workflowId)).referral?.status, "pending");

  tradeLayer.available = true;
  const resumed = await kernel.verify(workflowId);
  assert.equal(resumed.status, "verified");
  assert.equal((await kernel.get(workflowId)).referral?.status, "activated");
});

test("independent Bitcoin verification replaces broker withdrawal self-report", async () => {
  const bitcoin = new LaunchBitcoinWithdrawalSource();
  const { kernel, workflowId } = await connectedKernel({
    confirmed: true,
    bitcoinWithdrawalSource: bitcoin
  });
  const { execution } = await submitIndependentWithdrawal(kernel, workflowId, bitcoin);
  const verification = await kernel.verify(workflowId);
  const state = await kernel.get(workflowId);

  assert.equal(verification.status, "verified");
  assert.equal(verification.txid, execution.txid);
  assert.equal(verification.evidence?.source, bitcoin.source);
  assert.equal(verification.evidence?.exactDestinationMatched, true);
  assert.equal(verification.evidence?.exactFeeMatched, true);
  assert.equal(verification.evidence?.exactWalletDebitMatched, true);
  assert.equal(state.wallet.confirmedBalanceSats, "199400");
  assert.equal(state.stage, "withdrawal_verified");
});

test("exact mempool withdrawal stays pending and resumes after confirmation", async () => {
  const bitcoin = new LaunchBitcoinWithdrawalSource();
  bitcoin.state = "mempool";
  bitcoin.confirmations = 0;
  const { kernel, workflowId } = await connectedKernel({
    confirmed: true,
    bitcoinWithdrawalSource: bitcoin
  });
  await submitIndependentWithdrawal(kernel, workflowId, bitcoin);
  const pending = await kernel.verify(workflowId);
  assert.equal(pending.status, "pending");
  assert.equal((await kernel.get(workflowId)).wallet.confirmedBalanceSats, "250000");

  bitcoin.state = "confirmed";
  bitcoin.confirmations = 1;
  const resumed = await kernel.verify(workflowId);
  assert.equal(resumed.status, "verified");
  assert.equal((await kernel.get(workflowId)).wallet.confirmedBalanceSats, "199400");
});

test("independent Bitcoin fee mismatch fails without changing workflow balance", async () => {
  const bitcoin = new LaunchBitcoinWithdrawalSource();
  const { kernel, workflowId } = await connectedKernel({
    confirmed: true,
    bitcoinWithdrawalSource: bitcoin
  });
  await submitIndependentWithdrawal(kernel, workflowId, bitcoin);
  bitcoin.feeSats = "601";
  const verification = await kernel.verify(workflowId);
  const state = await kernel.get(workflowId);

  assert.equal(verification.status, "failed");
  assert.equal(verification.evidence?.exactFeeMatched, false);
  assert.equal(state.wallet.confirmedBalanceSats, "250000");
  assert.equal(state.stage, "error");
});

test("temporarily unavailable Bitcoin observation is retryable after reconnect", async () => {
  const bitcoin = new LaunchBitcoinWithdrawalSource();
  bitcoin.available = false;
  const { kernel, workflowId } = await connectedKernel({
    confirmed: true,
    bitcoinWithdrawalSource: bitcoin
  });
  await submitIndependentWithdrawal(kernel, workflowId, bitcoin);
  const pending = await kernel.verify(workflowId);
  assert.equal(pending.status, "pending");
  assert.match(String(pending.evidence?.reason), /temporarily unavailable/i);

  bitcoin.available = true;
  const resumed = await kernel.verify(workflowId);
  assert.equal(resumed.status, "verified");
  assert.equal((await kernel.get(workflowId)).stage, "withdrawal_verified");
});

test("trajectory 21: secret material is refused without a tool call", async () => {
  const kernel = createTestLaunchKernel();
  await kernel.start({ workflowId: "secret-case" });
  const plan = await new BitAgentConversation(kernel).plan(
    "secret-case",
    "My seed phrase is abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  );
  assert.equal(plan.prohibitedRequestDetected, true);
  assert.equal(plan.suggestedTool, undefined);
});

test("trajectory 22: unsupported intent does not expand scope", async () => {
  const kernel = createTestLaunchKernel();
  await kernel.start({ workflowId: "unsupported-case" });
  const plan = await new BitAgentConversation(kernel).plan("unsupported-case", "Trade every asset autonomously.");
  assert.equal(plan.intent, "unsupported");
  assert.equal(plan.suggestedTool, undefined);
});

test("trajectory 23: malformed deposit txid is rejected", async () => {
  const { kernel, workflowId } = await connectedKernel();
  await expectCode(kernel.observeDeposit(workflowId, {
    txid: "bad", vout: 0, amountSats: "1000", blockHeight: 1, currentHeight: 2
  }), "validation_error");
});

test("trajectory 24: repeated start returns the persisted workflow", async () => {
  const kernel = createTestLaunchKernel();
  const first = await kernel.start({ workflowId: "repeat-start" });
  const second = await kernel.start({ workflowId: "repeat-start", intent: "withdraw_bitcoin" });
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.currentIntent, "deposit_bitcoin");
});
