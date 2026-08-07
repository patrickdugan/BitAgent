import { IntegrationBoundaryError } from "../types.js";
import {
  TradeLayerActivationCandidateBroker,
  type TradeLayerActivationBrokerRequest
} from "./tradelayerActivationCandidateBroker.js";
import {
  FileTradeLayerActivationCandidateStore,
  type TradeLayerActivationApprovalView,
  type TradeLayerActivationFailure
} from "./tradelayerActivationCandidateStore.js";
import {
  isTradeLayerActivationExecutionError,
  TradeLayerActivationExecutionBroker
} from "./tradelayerActivationExecutionBroker.js";

export class TradeLayerActivationOperator {
  constructor(
    private readonly candidateBroker: TradeLayerActivationCandidateBroker,
    private readonly executionBroker: TradeLayerActivationExecutionBroker,
    private readonly store: FileTradeLayerActivationCandidateStore
  ) {}

  async prepare(
    request: TradeLayerActivationBrokerRequest,
    now = new Date()
  ): Promise<TradeLayerActivationApprovalView> {
    const candidate = await this.candidateBroker.prepareForWalletExecution(request, now);
    try {
      return await this.store.create(candidate, now);
    } catch (error) {
      try {
        await this.candidateBroker.cancelPrepared(candidate.publicCandidate, now);
      } catch (cleanupError) {
        throw new IntegrationBoundaryError(
          "signer_broker_error",
          "Activation candidate persistence failed and its input lock could not be released",
          {
            persistenceError: error instanceof Error ? error.message : String(error),
            cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          }
        );
      }
      throw error;
    }
  }

  async status(approvalHash: string): Promise<TradeLayerActivationApprovalView> {
    return this.store.getPublic(approvalHash);
  }

  async cancel(approvalHash: string, now = new Date()): Promise<TradeLayerActivationApprovalView> {
    if ((await this.store.getPublic(approvalHash)).status !== "pending_approval") {
      throw new IntegrationBoundaryError("signer_broker_error", "Only a pending activation candidate can be cancelled");
    }
    const candidate = await this.store.loadPrivate(approvalHash);
    if (candidate.publicCandidate.approvalHash !== approvalHash) {
      throw new IntegrationBoundaryError("signer_broker_error", "Activation cancellation hash mismatch");
    }
    const result = await this.candidateBroker.cancelPrepared(candidate.publicCandidate, now);
    return this.store.markResult(approvalHash, "cancelled", result, now);
  }

  async approveAndExecute(
    approvalHash: string,
    now = new Date()
  ): Promise<TradeLayerActivationApprovalView> {
    if ((await this.store.getPublic(approvalHash)).status !== "pending_approval") {
      throw new IntegrationBoundaryError("signer_broker_error", "Only a pending activation candidate can be approved");
    }
    const candidate = await this.store.loadPrivate(approvalHash);
    if (candidate.publicCandidate.approvalHash !== approvalHash) {
      throw new IntegrationBoundaryError("signer_broker_error", "Activation approval hash mismatch");
    }
    await this.store.markExecutionRequested(approvalHash, now);
    try {
      const result = await this.executionBroker.execute({ candidate, approvalHash, now });
      return this.store.markResult(approvalHash, "submitted", result, now);
    } catch (error) {
      const failure: TradeLayerActivationFailure = isTradeLayerActivationExecutionError(error)
        ? {
            code: error.code,
            message: error.message,
            inputLockDisposition: error.inputLockDisposition,
            broadcastMayHaveOccurred: error.broadcastMayHaveOccurred,
            observedAt: now.toISOString()
          }
        : {
            code: "unclassified_execution_error",
            message: "Activation execution failed without a safe input-lock classification",
            inputLockDisposition: "unknown",
            broadcastMayHaveOccurred: false,
            observedAt: now.toISOString()
          };
      if (failure.broadcastMayHaveOccurred) {
        await this.store.markFailure(approvalHash, "submission_unknown", failure, now);
      } else if (failure.inputLockDisposition === "released") {
        await this.store.markFailure(approvalHash, "failed_released", failure, now);
      } else if (failure.inputLockDisposition === "unknown") {
        await this.store.markFailure(approvalHash, "manual_recovery", failure, now);
      }
      throw error;
    }
  }

  async reconcile(approvalHash: string, now = new Date()): Promise<TradeLayerActivationApprovalView> {
    const status = (await this.store.getPublic(approvalHash)).status;
    if (status !== "execution_requested" && status !== "submission_unknown" && status !== "submitted") {
      throw new IntegrationBoundaryError("signer_broker_error", "Only a submitted activation can be reconciled");
    }
    const candidate = await this.store.loadPrivate(approvalHash);
    const result = await this.executionBroker.reconcile(candidate.publicCandidate, now);
    return this.store.markResult(approvalHash, result.status, result, now);
  }
}
