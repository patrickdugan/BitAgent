import { hashObject, opaqueId } from "./canonical.js";
import { validateBitcoinAddress } from "./bitcoin.js";
import { LaunchKernelError } from "./errors.js";
import { parseReferralLink } from "./referral.js";
import { assertVerifiedStrategyFunding } from "./strategyFunding.js";
import { simulateBitcoinWithdrawal, simulateStarterStrategy } from "./tradelayerTool.js";
import { observeBitcoinDeposit } from "./utxoTool.js";
import type {
  BitAgentWorkflowState,
  QuoteProvider,
  StrategyFundingReadSource,
  SupportedIntent,
  TransactionSimulation,
  WalletExecutionBroker,
  WorkflowStage,
  WorkflowStore
} from "./types.js";

type KernelOptions = {
  store: WorkflowStore;
  quoteProvider: QuoteProvider;
  strategyFundingSource: StrategyFundingReadSource;
  walletBroker: WalletExecutionBroker;
  now?: () => Date;
  requiredConfirmations?: number;
  simulationTtlMs?: number;
};

function simulationCore(simulation: TransactionSimulation) {
  const { id: _id, hash: _hash, ...core } = simulation;
  return core;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class BitAgentLaunchKernel {
  private readonly now: () => Date;
  private readonly requiredConfirmations: number;
  private readonly simulationTtlMs: number;

  constructor(private readonly options: KernelOptions) {
    this.now = options.now || (() => new Date());
    this.requiredConfirmations = options.requiredConfirmations || 2;
    this.simulationTtlMs = options.simulationTtlMs || 60_000;
  }

  async start(input: {
    workflowId?: string;
    referralLink?: string;
    intent?: SupportedIntent;
    network?: "bitcoin" | "bitcoin-testnet4";
  } = {}) {
    const now = this.now();
    const referral = input.referralLink ? parseReferralLink(input.referralLink, now) : undefined;
    const intent = referral?.intendedWorkflow || input.intent || "deposit_bitcoin";
    const id = input.workflowId || opaqueId("workflow", {
      intent,
      referral,
      createdAt: now.toISOString()
    });
    const existing = await this.options.store.get(id);
    if (existing) return existing;

    const state: BitAgentWorkflowState = {
      id,
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      stage: "wallet_required",
      currentIntent: intent,
      wallet: {
        status: "disconnected",
        network: input.network || "bitcoin-testnet4",
        confirmedBalanceSats: "0",
        capabilities: []
      },
      deposit: {
        status: "not_started",
        confirmations: 0,
        requiredConfirmations: this.requiredConfirmations
      },
      referral,
      recoveryInstructions: [
        "Reconnect the same wallet session; never enter a seed phrase or private key into BitAgent.",
        "BitAgent will resume from the last persisted simulation, approval, execution, or verification record."
      ],
      events: []
    };
    this.event(state, "workflow.started", {
      intent,
      referralStatus: referral?.status || null
    });
    await this.persist(state);
    return clone(state);
  }

  async get(workflowId: string) {
    const state = await this.options.store.get(workflowId);
    if (!state) throw new LaunchKernelError("not_found", `Unknown workflow: ${workflowId}`);
    return state;
  }

  async getPublic(workflowId: string) {
    const state = await this.get(workflowId);
    if (state.pendingApproval?.walletApprovalToken) {
      state.pendingApproval.walletApprovalToken = "[wallet-held]";
    }
    return state;
  }

  async selectIntent(workflowId: string, intent: SupportedIntent) {
    const state = await this.get(workflowId);
    state.currentIntent = intent;
    if (intent === "starter_strategy" && state.deposit.status !== "confirmed") {
      state.stage = "strategy_parameters_required";
    } else if (intent === "withdraw_bitcoin") {
      state.stage = "withdrawal_parameters_required";
    }
    this.event(state, "intent.selected", { intent });
    await this.persist(state);
    return clone(state);
  }

  async connectWallet(workflowId: string, input: {
    mode: "create" | "connect";
    publicAddress?: string;
    walletSessionId?: string;
  }) {
    const state = await this.get(workflowId);
    const wallet = await this.options.walletBroker.connect({
      ...input,
      network: state.wallet.network,
      now: this.now()
    });
    state.wallet = wallet;
    state.stage = "deposit_address_ready";
    this.event(state, "wallet.connected", {
      mode: wallet.mode,
      network: wallet.network,
      address: wallet.bitcoinAddress
    });
    await this.persist(state);
    return clone(state);
  }

  async prepareDeposit(workflowId: string) {
    const state = await this.get(workflowId);
    this.assertWallet(state);
    const target = await this.options.walletBroker.getDepositAddress({ wallet: state.wallet });
    state.deposit = {
      status: "awaiting_deposit",
      address: target.address,
      scriptPubKeyHex: target.scriptPubKeyHex,
      confirmations: 0,
      requiredConfirmations: this.requiredConfirmations
    };
    state.stage = "deposit_pending";
    this.event(state, "deposit.address_ready", {
      address: target.address,
      network: state.wallet.network,
      requiredConfirmations: this.requiredConfirmations
    });
    await this.persist(state);
    return clone(state);
  }

  async observeDeposit(workflowId: string, input: {
    txid: string;
    vout: number;
    amountSats: string;
    blockHeight: number | null;
    currentHeight: number;
  }) {
    const state = await this.get(workflowId);
    this.assertWallet(state);
    if (!state.deposit.address || !state.deposit.scriptPubKeyHex) {
      throw new LaunchKernelError("state_conflict", "Prepare a deposit address before observing a deposit");
    }
    const deposit = observeBitcoinDeposit({
      workflowId,
      wallet: state.wallet,
      address: state.deposit.address,
      scriptPubKeyHex: state.deposit.scriptPubKeyHex,
      requiredConfirmations: this.requiredConfirmations,
      now: this.now(),
      ...input
    });
    state.deposit = deposit;
    state.stage = deposit.status === "confirmed" ? "deposit_confirmed" : "deposit_pending";
    if (deposit.status === "confirmed") {
      state.wallet.confirmedBalanceSats = deposit.amountSats || "0";
    }
    this.event(state, `deposit.${deposit.status}`, {
      txid: deposit.txid,
      vout: deposit.vout,
      amountSats: deposit.amountSats,
      confirmations: deposit.confirmations,
      requiredConfirmations: deposit.requiredConfirmations,
      utxoRef: deposit.utxoRef || null
    });
    await this.persist(state);
    return clone(state);
  }

  async simulateStrategy(workflowId: string, input: { amountSats: string }) {
    const state = await this.get(workflowId);
    this.assertConfirmedDeposit(state);
    const now = this.now();
    const funding = await this.options.strategyFundingSource.observe({
      state,
      requestedAmountSats: input.amountSats,
      now
    });
    state.strategyFunding = funding;
    this.event(state, `strategy.funding_${funding.status}`, {
      source: funding.source,
      evidenceHash: funding.evidenceHash,
      reserveOutpoint: funding.reserveOutpoint || null,
      reserveLockedSats: funding.reserveLockedSats,
      tlBtcAvailableSats: funding.tlBtcAvailableSats,
      bitcoinSpendableSats: funding.bitcoinSpendableSats,
      confirmations: funding.confirmations
    });
    await this.persist(state);
    const verifiedFunding = assertVerifiedStrategyFunding(funding, state, input.amountSats);
    state.wallet.confirmedBalanceSats = verifiedFunding.bitcoinSpendableSats;
    const quote = await this.options.quoteProvider.getStarterStrategyQuote({
      amountSats: input.amountSats,
      now
    });
    const fee = await this.options.walletBroker.estimateFee({
      action: "starter_strategy",
      amountSats: input.amountSats,
      state
    });
    const simulation = simulateStarterStrategy({
      amountSats: input.amountSats,
      balanceSats: state.wallet.confirmedBalanceSats,
      tlBtcAvailableSats: verifiedFunding.tlBtcAvailableSats,
      networkFeeSats: fee.networkFeeSats,
      quote,
      now
    });
    state.currentIntent = "starter_strategy";
    state.selectedStrategy = simulation.strategy;
    state.simulation = simulation;
    state.pendingApproval = undefined;
    state.execution = undefined;
    state.verification = undefined;
    state.stage = "strategy_simulated";
    this.event(state, "strategy.simulated", {
      simulationHash: simulation.hash,
      amountSats: input.amountSats,
      quoteId: quote.quoteId,
      quoteSource: quote.source,
      feeSource: fee.source,
      fundingEvidenceHash: verifiedFunding.evidenceHash,
      reserveOutpoint: verifiedFunding.reserveOutpoint,
      totalFeeSats: simulation.fees.totalFeeSats
    });
    await this.persist(state);
    return clone(simulation);
  }

  async simulateWithdrawal(workflowId: string, input: {
    destinationAddress: string;
    amountSats: string;
  }) {
    const state = await this.get(workflowId);
    this.assertWallet(state);
    const now = this.now();
    const amountSats = String(input.amountSats || "").trim();
    if (!/^[1-9][0-9]*$/.test(amountSats)) {
      throw new LaunchKernelError("validation_error", "Withdrawal amount must be canonical positive satoshis");
    }
    if (BigInt(amountSats) >= BigInt(state.wallet.confirmedBalanceSats)) {
      throw new LaunchKernelError("insufficient_funds", "Confirmed balance cannot cover withdrawal amount and fee");
    }
    const destinationAddress = validateBitcoinAddress(
      input.destinationAddress,
      state.wallet.network
    ).address;
    const fee = await this.options.walletBroker.estimateFee({
      action: "withdraw_bitcoin",
      amountSats,
      destinationAddress,
      state
    });
    const simulation = simulateBitcoinWithdrawal({
      amountSats,
      destinationAddress,
      balanceSats: state.wallet.confirmedBalanceSats,
      networkFeeSats: fee.networkFeeSats,
      walletCandidate: fee.candidate,
      network: state.wallet.network,
      now,
      ttlMs: this.simulationTtlMs
    });
    state.currentIntent = "withdraw_bitcoin";
    state.simulation = simulation;
    state.pendingApproval = undefined;
    state.execution = undefined;
    state.verification = undefined;
    state.stage = "withdrawal_simulated";
    this.event(state, "withdrawal.simulated", {
      simulationHash: simulation.hash,
      destinationAddress: simulation.destinationAddress,
      amountSats,
      feeSource: fee.source,
      candidateId: simulation.walletCandidate?.candidateId,
      candidateHash: simulation.walletCandidate?.candidateHash,
      unsignedTxid: simulation.walletCandidate?.unsignedTxid,
      totalFeeSats: simulation.fees.totalFeeSats
    });
    await this.persist(state);
    return clone(simulation);
  }

  async requestApproval(workflowId: string) {
    const state = await this.get(workflowId);
    const simulation = this.assertFreshSimulation(state);
    if (state.pendingApproval?.simulationHash === simulation.hash
      && state.pendingApproval.status === "pending") {
      return clone(state.pendingApproval);
    }
    state.pendingApproval = {
      id: opaqueId("approval", {
        workflowId,
        simulationHash: simulation.hash,
        requestedAt: this.now().toISOString()
      }),
      action: simulation.action,
      simulationHash: simulation.hash,
      status: "pending",
      requestedAt: this.now().toISOString()
    };
    state.stage = simulation.action === "starter_strategy"
      ? "strategy_approval_pending"
      : "withdrawal_approval_pending";
    this.event(state, "wallet.approval_requested", {
      approvalId: state.pendingApproval.id,
      action: simulation.action,
      simulationHash: simulation.hash,
      exactEffects: simulation.effects,
      exactFees: simulation.fees
    });
    await this.persist(state);
    return clone(state.pendingApproval);
  }

  async resolveApproval(workflowId: string, decision: "approve" | "reject" | "cancel") {
    const state = await this.get(workflowId);
    const simulation = this.assertFreshSimulation(state);
    const approval = state.pendingApproval;
    if (!approval || approval.status !== "pending" || approval.simulationHash !== simulation.hash) {
      throw new LaunchKernelError("approval_required", "No matching pending wallet approval exists");
    }

    if (decision !== "approve") {
      approval.status = decision === "reject" ? "rejected" : "cancelled";
      approval.resolvedAt = this.now().toISOString();
      state.stage = simulation.action === "starter_strategy" ? "strategy_simulated" : "withdrawal_simulated";
      state.recoveryInstructions = [
        "No transaction was executed.",
        "Review the saved simulation, change parameters if needed, then request a new wallet approval."
      ];
      this.event(state, `wallet.approval_${approval.status}`, {
        approvalId: approval.id,
        simulationHash: approval.simulationHash
      });
      await this.persist(state);
      return clone(approval);
    }

    try {
      const authorized = await this.options.walletBroker.authorize({ approval, simulation, state });
      if (authorized.status === "pending") {
        approval.walletApprovalRequestId = authorized.walletApprovalRequestId;
        state.recoveryInstructions = [
          "The exact action is pending approval in the connected wallet; no transaction was executed.",
          "Approve or reject it in the wallet, then retry this saved approval request."
        ];
        this.event(state, "wallet.approval_pending", {
          approvalId: approval.id,
          walletApprovalRequestId: authorized.walletApprovalRequestId,
          simulationHash: approval.simulationHash
        });
        await this.persist(state);
        return clone(approval);
      }
      if (authorized.status === "rejected") {
        approval.walletApprovalRequestId = authorized.walletApprovalRequestId;
        throw new LaunchKernelError("approval_rejected", "The wallet rejected the exact action approval");
      }
      approval.status = "approved";
      approval.resolvedAt = this.now().toISOString();
      approval.walletApprovalRequestId = authorized.walletApprovalRequestId;
      approval.walletApprovalToken = authorized.walletApprovalToken;
      state.stage = simulation.action === "starter_strategy" ? "strategy_approved" : "withdrawal_approved";
      this.event(state, "wallet.approval_approved", {
        approvalId: approval.id,
        simulationHash: approval.simulationHash
      });
      await this.persist(state);
      return clone(approval);
    } catch (error) {
      if (error instanceof LaunchKernelError
        && ["provider_unavailable", "state_conflict"].includes(error.code)) {
        state.recoveryInstructions = [
          "The wallet approval outcome could not be confirmed; no transaction was executed by BitAgent.",
          "Keep the saved simulation and wallet approval request, restore the same wallet connection, then retry."
        ];
        this.event(state, "wallet.approval_unavailable", {
          approvalId: approval.id,
          walletApprovalRequestId: approval.walletApprovalRequestId || null,
          simulationHash: approval.simulationHash,
          errorCode: error.code
        });
        await this.persist(state);
        throw error;
      }
      approval.status = "rejected";
      approval.resolvedAt = this.now().toISOString();
      state.stage = simulation.action === "starter_strategy" ? "strategy_simulated" : "withdrawal_simulated";
      state.recoveryInstructions = [
        "The wallet rejected or could not complete approval; no transaction was executed.",
        "Reconnect the same wallet and request approval again from the saved simulation."
      ];
      this.event(state, "wallet.approval_rejected", {
        approvalId: approval.id,
        simulationHash: approval.simulationHash
      });
      await this.persist(state);
      throw error;
    }
  }

  async execute(workflowId: string) {
    const state = await this.get(workflowId);
    const simulation = this.assertFreshSimulation(state);
    if (state.execution?.simulationHash === simulation.hash && state.execution.status === "submitted") {
      return clone(state.execution);
    }
    const approval = state.pendingApproval;
    if (!approval || approval.status !== "approved" || approval.simulationHash !== simulation.hash) {
      throw new LaunchKernelError("approval_required", "The exact current simulation has not been approved");
    }
    const execution = await this.options.walletBroker.execute({
      approval,
      simulation,
      state,
      now: this.now()
    });
    state.execution = execution;
    state.verification = {
      action: simulation.action,
      status: "pending",
      checkedAt: this.now().toISOString(),
      txid: execution.txid,
      orderId: execution.orderId
    };
    state.stage = simulation.action === "starter_strategy" ? "strategy_submitted" : "withdrawal_submitted";
    state.recoveryInstructions = [
      "The action was submitted. Do not approve a replacement until BitAgent checks the recorded txid.",
      "Reconnect and choose Verify to resume safely."
    ];
    this.event(state, `${simulation.action}.submitted`, {
      executionId: execution.id,
      txid: execution.txid,
      orderId: execution.orderId || null,
      simulationHash: simulation.hash
    });
    await this.persist(state);
    return clone(execution);
  }

  async verify(workflowId: string) {
    const state = await this.get(workflowId);
    const simulation = state.simulation;
    const execution = state.execution;
    if (!simulation || !execution || execution.simulationHash !== simulation.hash) {
      throw new LaunchKernelError("state_conflict", "There is no submitted action to verify");
    }
    const verification = await this.options.walletBroker.verify({
      execution,
      simulation,
      state,
      now: this.now()
    });
    state.verification = verification;
    if (verification.status === "verified") {
      state.wallet.confirmedBalanceSats = simulation.balanceAfterSats;
      state.stage = simulation.action === "starter_strategy" ? "strategy_verified" : "withdrawal_verified";
      state.recoveryInstructions = simulation.action === "starter_strategy"
        ? ["The starter order is verified. Its UTXORef reserve remains separate from spendable wallet Bitcoin."]
        : ["The withdrawal is verified. Keep the txid for your records."];
      if (simulation.action === "starter_strategy" && state.referral?.status === "pending") {
        state.referral.status = "activated";
        state.referral.activatedAt = this.now().toISOString();
        this.event(state, "referral.activated", {
          referrerId: state.referral.referrerId,
          campaignId: state.referral.campaignId,
          orderId: verification.orderId || null
        });
      }
    } else if (verification.status === "failed") {
      state.stage = "error";
      state.recoveryInstructions = [
        "Verification failed. Do not sign or execute a replacement action.",
        "Use the recorded txid and simulation hash for operator recovery."
      ];
    }
    this.event(state, `${simulation.action}.verification_${verification.status}`, {
      txid: verification.txid,
      orderId: verification.orderId || null,
      confirmations: verification.confirmations || 0
    });
    await this.persist(state);
    return clone(verification);
  }

  private assertWallet(state: BitAgentWorkflowState) {
    if (state.wallet.status !== "connected") {
      throw new LaunchKernelError("wallet_not_connected", "Connect a TradeLayer wallet first");
    }
  }

  private assertConfirmedDeposit(state: BitAgentWorkflowState) {
    this.assertWallet(state);
    if (state.deposit.status !== "confirmed") {
      throw new LaunchKernelError(
        "deposit_unconfirmed",
        `Bitcoin deposit has ${state.deposit.confirmations}/${state.deposit.requiredConfirmations} confirmations`
      );
    }
  }

  private assertFreshSimulation(state: BitAgentWorkflowState) {
    const simulation = state.simulation;
    if (!simulation) throw new LaunchKernelError("state_conflict", "Simulate the action before approval");
    if (simulation.hash !== hashObject(simulationCore(simulation))) {
      throw new LaunchKernelError("state_conflict", "Persisted simulation hash does not match its exact effects");
    }
    if (this.now().getTime() >= new Date(simulation.expiresAt).getTime()) {
      throw new LaunchKernelError("simulation_stale", "The saved simulation or quote is stale; simulate again");
    }
    return simulation;
  }

  private event(state: BitAgentWorkflowState, type: string, data: Record<string, unknown>) {
    state.events.push({
      sequence: state.events.length + 1,
      at: this.now().toISOString(),
      type,
      data
    });
  }

  private async persist(state: BitAgentWorkflowState) {
    state.updatedAt = this.now().toISOString();
    await this.options.store.save(state);
  }
}

export function expectedStageForIntent(intent: SupportedIntent): WorkflowStage {
  if (intent === "deposit_bitcoin") return "deposit_pending";
  if (intent === "starter_strategy") return "strategy_parameters_required";
  return "withdrawal_parameters_required";
}
