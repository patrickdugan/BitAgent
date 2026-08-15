import { hashObject, opaqueId } from "../launch/canonical.js";
import { SignalCodebaseVerifier } from "./codebaseVerifier.js";
import { SignalKernelError, sanitizedSignalError } from "./errors.js";
import { evaluateSignalRisk } from "./riskPolicy.js";
import { validateAlgorithmicTradeSignal } from "./signalValidator.js";
import { buildTradeLayerSignalSimulation } from "./tradelayerSignalAdapter.js";
import { selectCanonicalSignalFunding } from "./utxoFunding.js";
import type {
  SignalExecutionBroker,
  SignalRiskPolicy,
  SignalWorkflowState,
  SignalWorkflowStore,
  TradeLayerSignalSimulation
} from "./types.js";

type SignalKernelOptions = {
  store: SignalWorkflowStore;
  broker: SignalExecutionBroker;
  policy: SignalRiskPolicy;
  codebaseVerifier?: SignalCodebaseVerifier;
  now?: () => Date;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function simulationCore(simulation: TradeLayerSignalSimulation) {
  const { id: _id, hash: _hash, ...core } = simulation;
  return core;
}

export class CommittedSignalKernel {
  private readonly now: () => Date;
  private readonly codebaseVerifier: SignalCodebaseVerifier;

  constructor(private readonly options: SignalKernelOptions) {
    this.now = options.now || (() => new Date());
    this.codebaseVerifier = options.codebaseVerifier || new SignalCodebaseVerifier(options.policy.approvedCodebases);
  }

  async start(input: { workflowId?: string } = {}) {
    const now = this.now();
    const id = input.workflowId || opaqueId("signal_workflow", now.toISOString());
    const existing = await this.options.store.get(id);
    if (existing) return existing;
    const state: SignalWorkflowState = {
      id,
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      status: "empty",
      recoveryInstructions: [
        "Resume with the same workflow ID and connected wallet.",
        "Never enter a seed phrase, private key, mnemonic, WIF, or exchange API secret into a signal or BitAgent."
      ],
      events: []
    };
    this.event(state, "signal_workflow.started", { policyId: this.options.policy.policyId });
    await this.persist(state);
    return clone(state);
  }

  async get(workflowId: string) {
    const state = await this.options.store.get(workflowId);
    if (!state) throw new SignalKernelError("not_found", `Unknown signal workflow: ${workflowId}`);
    return state;
  }

  async getPublic(workflowId: string) {
    const state = await this.get(workflowId);
    if (state.approval?.walletApprovalToken) state.approval.walletApprovalToken = "[wallet-held]";
    return state;
  }

  async ingest(workflowId: string, rawSignal: unknown) {
    const state = await this.get(workflowId);
    try {
      const signal = validateAlgorithmicTradeSignal(rawSignal, this.options.policy, this.now());
      if (state.signal && state.signal.payloadHash !== signal.payloadHash) {
        throw new SignalKernelError("state_conflict", "Workflow is already bound to a different signal");
      }
      const verification = await this.codebaseVerifier.verify(signal.codebase, this.now());
      state.signal = signal;
      state.codebaseVerification = verification;
      state.status = "signal_verified";
      state.failure = undefined;
      this.event(state, "signal.verified", {
        signalId: signal.signalId,
        signalPayloadHash: signal.payloadHash,
        codebaseId: signal.codebase.codebaseId,
        codebaseDigest: signal.codebase.digest
      });
      await this.persist(state);
      return clone(state);
    } catch (error) {
      await this.fail(state, error, false);
      throw error;
    }
  }

  async simulate(workflowId: string) {
    const state = await this.get(workflowId);
    try {
      const signal = this.assertSignal(state);
      validateAlgorithmicTradeSignal(signal, this.options.policy, this.now());
      state.codebaseVerification = await this.codebaseVerifier.verify(signal.codebase, this.now());
      const portfolio = await this.options.broker.getPortfolioSnapshot({ now: this.now() });
      const fee = await this.options.broker.estimateNetworkFee({
        signal,
        senderAddress: portfolio.senderAddress
      });
      if (!/^[1-9][0-9]*$/.test(fee.networkFeeSats)) {
        throw new SignalKernelError("wallet_state_unavailable", "Wallet fee quote is not a positive integer");
      }
      const risk = evaluateSignalRisk({
        signal,
        portfolio,
        networkFeeSats: fee.networkFeeSats,
        policy: this.options.policy,
        now: this.now()
      });
      if (!risk.passed) {
        throw new SignalKernelError("risk_rejected", `Signal failed risk policy: ${risk.reasonCodes.join(", ")}`);
      }
      const funding = selectCanonicalSignalFunding({
        utxos: portfolio.confirmedUtxos,
        requiredSats: fee.networkFeeSats,
        requiredConfirmations: this.options.policy.requiredConfirmations
      });
      await this.assertFundingAvailable(workflowId, funding.outpoints.map((row) => `${row.txid}:${row.vout}`));
      const simulation = buildTradeLayerSignalSimulation({
        signal,
        funding,
        portfolioSnapshotHash: portfolio.snapshotHash,
        networkFeeSats: fee.networkFeeSats,
        risk,
        policy: this.options.policy,
        now: this.now()
      });
      state.portfolio = portfolio;
      state.riskDecision = risk;
      state.simulation = simulation;
      state.approval = undefined;
      state.execution = undefined;
      state.verification = undefined;
      state.failure = undefined;
      state.status = "simulation_ready";
      state.recoveryInstructions = [
        "Review the exact effects, TradeLayer payload, codebase digest, UTXO funding root, and fee.",
        "Request wallet approval only if every field is acceptable."
      ];
      this.event(state, "signal.simulated", {
        simulationHash: simulation.hash,
        signalPayloadHash: signal.payloadHash,
        fundingRoot: funding.fundingRoot,
        payloadHex: simulation.payloadHex,
        totalFeeSats: simulation.networkFeeSats,
        feeSource: fee.source
      });
      await this.persist(state);
      return clone(simulation);
    } catch (error) {
      await this.fail(state, error, true);
      throw error;
    }
  }

  async requestApproval(workflowId: string) {
    const state = await this.get(workflowId);
    try {
      const simulation = this.assertFreshSimulation(state);
      if (state.approval?.status === "pending" && state.approval.simulationHash === simulation.hash) {
        return clone(state.approval);
      }
      const requestedAt = this.now().toISOString();
      state.approval = {
        approvalId: opaqueId("signal_approval", { workflowId, simulationHash: simulation.hash, requestedAt }),
        simulationHash: simulation.hash,
        signalPayloadHash: simulation.signalPayloadHash,
        status: "pending",
        requestedAt
      };
      state.status = "approval_pending";
      state.failure = undefined;
      this.event(state, "signal.wallet_approval_requested", {
        approvalId: state.approval.approvalId,
        simulationHash: simulation.hash,
        effects: simulation.effects,
        feeSats: simulation.networkFeeSats,
        payloadHex: simulation.payloadHex,
        fundingRoot: simulation.funding.fundingRoot
      });
      await this.persist(state);
      return clone(state.approval);
    } catch (error) {
      await this.fail(state, error, true);
      throw error;
    }
  }

  async resolveApproval(workflowId: string, decision: "approve" | "reject" | "cancel") {
    const state = await this.get(workflowId);
    const simulation = this.assertFreshSimulation(state);
    const approval = state.approval;
    if (!approval || approval.status !== "pending" || approval.simulationHash !== simulation.hash) {
      throw new SignalKernelError("approval_required", "No matching pending signal approval exists");
    }
    if (decision !== "approve") {
      approval.status = decision === "reject" ? "rejected" : "cancelled";
      approval.resolvedAt = this.now().toISOString();
      state.status = "cancelled";
      state.recoveryInstructions = [
        "No transaction was submitted by this workflow.",
        "The saved simulation can be reviewed before requesting a new approval."
      ];
      this.event(state, `signal.wallet_approval_${approval.status}`, {
        approvalId: approval.approvalId,
        simulationHash: approval.simulationHash
      });
      await this.persist(state);
      return clone(approval);
    }

    try {
      const authorized = await this.options.broker.authorize({ approval, simulation });
      if (!authorized.walletApprovalToken) {
        throw new SignalKernelError("approval_rejected", "Wallet returned no opaque approval token");
      }
      approval.status = "approved";
      approval.resolvedAt = this.now().toISOString();
      approval.walletApprovalToken = authorized.walletApprovalToken;
      state.status = "approved";
      state.failure = undefined;
      this.event(state, "signal.wallet_approval_approved", {
        approvalId: approval.approvalId,
        simulationHash: approval.simulationHash
      });
      await this.persist(state);
      return clone(approval);
    } catch (error) {
      approval.status = "rejected";
      approval.resolvedAt = this.now().toISOString();
      state.status = "simulation_ready";
      state.recoveryInstructions = [
        "The wallet rejected or could not complete approval; BitAgent did not submit a transaction.",
        "Reconnect the same wallet and request approval again from the saved simulation."
      ];
      this.event(state, "signal.wallet_approval_rejected", {
        approvalId: approval.approvalId,
        simulationHash: approval.simulationHash
      });
      await this.persist(state);
      throw error;
    }
  }

  async execute(workflowId: string) {
    const state = await this.get(workflowId);
    if (state.execution?.status === "submitted") return clone(state.execution);
    try {
      const simulation = this.assertFreshSimulation(state);
      const approval = state.approval;
      if (!approval
        || approval.status !== "approved"
        || approval.simulationHash !== simulation.hash
        || approval.signalPayloadHash !== simulation.signalPayloadHash
        || !approval.walletApprovalToken) {
        throw new SignalKernelError("approval_required", "The exact current signal simulation is not wallet-approved");
      }
      const signal = this.assertSignal(state);
      await this.codebaseVerifier.verify(signal.codebase, this.now());
      const portfolio = await this.options.broker.getPortfolioSnapshot({ now: this.now() });
      if (portfolio.snapshotHash !== simulation.portfolioSnapshotHash) {
        throw new SignalKernelError("simulation_stale", "Wallet balances, exposure, or UTXOs changed after simulation");
      }
      const fee = await this.options.broker.estimateNetworkFee({ signal, senderAddress: portfolio.senderAddress });
      if (fee.networkFeeSats !== simulation.networkFeeSats) {
        throw new SignalKernelError("simulation_stale", "Network fee changed after approval");
      }
      const risk = evaluateSignalRisk({
        signal,
        portfolio,
        networkFeeSats: fee.networkFeeSats,
        policy: this.options.policy,
        now: this.now()
      });
      if (!risk.passed || risk.policyFingerprint !== simulation.riskPolicyFingerprint) {
        throw new SignalKernelError("simulation_stale", "Risk inputs changed after approval");
      }
      const funding = selectCanonicalSignalFunding({
        utxos: portfolio.confirmedUtxos,
        requiredSats: fee.networkFeeSats,
        requiredConfirmations: this.options.policy.requiredConfirmations
      });
      if (funding.fundingRoot !== simulation.funding.fundingRoot) {
        throw new SignalKernelError("simulation_stale", "Canonical UTXO-Ref funding changed after approval");
      }
      const execution = await this.options.broker.execute({ approval, simulation, now: this.now() });
      if (execution.simulationHash !== simulation.hash) {
        throw new SignalKernelError("execution_failed", "Broker receipt does not match the approved simulation");
      }
      state.execution = execution;
      state.verification = {
        simulationHash: simulation.hash,
        status: "pending",
        checkedAt: this.now().toISOString(),
        txid: execution.txid,
        orderId: execution.orderId
      };
      state.status = "submitted";
      state.failure = undefined;
      state.recoveryInstructions = [
        "The wallet reported submission. Do not approve a replacement until the recorded txid and order are checked.",
        "Resume this workflow and call verify."
      ];
      this.event(state, "signal.order_submitted", {
        executionId: execution.executionId,
        simulationHash: simulation.hash,
        txid: execution.txid,
        orderId: execution.orderId
      });
      await this.persist(state);
      return clone(execution);
    } catch (error) {
      await this.fail(state, error, true);
      throw error;
    }
  }

  async verify(workflowId: string) {
    const state = await this.get(workflowId);
    const simulation = state.simulation;
    const execution = state.execution;
    if (!simulation || !execution || execution.simulationHash !== simulation.hash) {
      throw new SignalKernelError("state_conflict", "There is no submitted signal order to verify");
    }
    const verification = await this.options.broker.verify({ execution, simulation, now: this.now() });
    if (verification.simulationHash !== simulation.hash
      || verification.txid !== execution.txid
      || verification.orderId !== execution.orderId) {
      throw new SignalKernelError("verification_failed", "Broker verification does not match the submitted order");
    }
    state.verification = verification;
    state.status = verification.status === "verified" ? "verified" : verification.status === "failed" ? "failed" : "submitted";
    state.recoveryInstructions = verification.status === "verified"
      ? ["The TradeLayer order or position is independently verified; keep the txid, order ID, and signal hash."]
      : verification.status === "pending"
        ? ["The transaction is still pending. Resume and verify again; do not submit a replacement."]
        : ["Verification failed. Do not submit a replacement until an operator reconciles the recorded txid."];
    this.event(state, `signal.order_verification_${verification.status}`, {
      simulationHash: simulation.hash,
      txid: verification.txid,
      orderId: verification.orderId,
      confirmations: verification.confirmations || 0,
      positionOrOrderState: verification.positionOrOrderState || null
    });
    await this.persist(state);
    return clone(verification);
  }

  private assertSignal(state: SignalWorkflowState) {
    if (!state.signal) throw new SignalKernelError("state_conflict", "Ingest and verify a signal first");
    return state.signal;
  }

  private assertFreshSimulation(state: SignalWorkflowState) {
    const simulation = state.simulation;
    if (!simulation) throw new SignalKernelError("state_conflict", "Simulate the signal first");
    if (hashObject(simulationCore(simulation)) !== simulation.hash) {
      throw new SignalKernelError("state_conflict", "Persisted simulation fingerprint is invalid");
    }
    if (Date.parse(simulation.expiresAt) <= this.now().getTime()) {
      throw new SignalKernelError("simulation_stale", "Signal simulation is expired");
    }
    return simulation;
  }

  private async assertFundingAvailable(workflowId: string, outpoints: string[]) {
    const wanted = new Set(outpoints);
    const occupiedStatuses = new Set(["simulation_ready", "approval_pending", "approved", "submitted", "verified"]);
    for (const candidate of await this.options.store.list()) {
      if (candidate.id === workflowId || !occupiedStatuses.has(candidate.status) || !candidate.simulation) continue;
      const conflict = candidate.simulation.funding.outpoints
        .map((row) => `${row.txid}:${row.vout}`)
        .find((outpoint) => wanted.has(outpoint));
      if (conflict) {
        throw new SignalKernelError("risk_rejected", `UTXO funding is already reserved by workflow ${candidate.id}: ${conflict}`);
      }
    }
  }

  private event(state: SignalWorkflowState, type: string, data: Record<string, unknown>) {
    state.events.push({ sequence: state.events.length, at: this.now().toISOString(), type, data });
  }

  private async persist(state: SignalWorkflowState) {
    state.updatedAt = this.now().toISOString();
    await this.options.store.save(state);
  }

  private async fail(state: SignalWorkflowState, error: unknown, recoverable: boolean) {
    const sanitized = sanitizedSignalError(error);
    state.failure = { ...sanitized, at: this.now().toISOString(), recoverable };
    state.status = "failed";
    state.recoveryInstructions = recoverable
      ? [
        "No new action should be approved until the signal is re-simulated from current codebase, wallet, UTXO, fee, and risk state.",
        "If submission may have occurred, reconcile the recorded wallet and TradeLayer state before retrying."
      ]
      : ["Reject this signal. An operator must approve the exact codebase and strategy commitment before retrying."];
    this.event(state, "signal.failure", { code: sanitized.code, message: sanitized.message, recoverable });
    await this.persist(state);
  }
}
