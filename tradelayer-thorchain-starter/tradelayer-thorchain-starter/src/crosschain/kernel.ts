import type { NearIntentsProvider } from "../adapters/nearIntentsAdapter.js";
import { assertExecutableNearIntentsQuote } from "../adapters/nearIntentsAdapter.js";
import { IntegrationBoundaryError } from "../types.js";
import { hashObject, opaqueId } from "../launch/canonical.js";
import type {
  NearDepositApproval,
  NearDepositStore,
  NearDepositWorkflow,
  OriginWalletBroker
} from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class NearDepositKernel {
  constructor(
    private readonly options: {
      provider: NearIntentsProvider;
      walletBroker: OriginWalletBroker;
      store: NearDepositStore;
      now?: () => Date;
    }
  ) {}

  private now() {
    return (this.options.now || (() => new Date()))();
  }

  async start(id: string, input: NearDepositWorkflow["input"]) {
    const existing = await this.options.store.get(id);
    if (existing) return existing;
    const now = this.now().toISOString();
    const state: NearDepositWorkflow = {
      id,
      version: 1,
      createdAt: now,
      updatedAt: now,
      stage: "quote_required",
      input,
      recoveryInstructions: [
        "Reconnect the same origin wallet; never enter a seed phrase or private key into BitAgent.",
        "A rejected signature keeps the quote record, but an expired quote must be replaced before approval."
      ],
      events: []
    };
    this.event(state, "near_deposit.started", { rail: "near_intents" });
    await this.persist(state);
    return clone(state);
  }

  async get(id: string) {
    const state = await this.options.store.get(id);
    if (!state) throw new IntegrationBoundaryError("near_intents_status_error", `Unknown NEAR deposit workflow: ${id}`);
    return state;
  }

  async getPublic(id: string) {
    const state = await this.get(id);
    if (state.approval?.walletApprovalToken) state.approval.walletApprovalToken = "[wallet-held]";
    return state;
  }

  async simulate(id: string) {
    const state = await this.get(id);
    const quote = await this.options.provider.quote({ ...state.input, dry: false });
    state.quote = quote;
    state.quoteHash = hashObject(quote);
    state.approval = undefined;
    state.depositTxid = undefined;
    state.execution = undefined;
    state.stage = "quote_ready";
    this.event(state, "near_deposit.simulated", {
      quoteId: quote.quoteId,
      quoteHash: state.quoteHash,
      amountIn: quote.amountIn,
      minAmountOut: quote.minAmountOut,
      withdrawFee: quote.withdrawFee || "0",
      refundFee: quote.refundFee || "0",
      depositAddress: quote.depositAddress || null,
      deadline: quote.deadline || null
    });
    await this.persist(state);
    return clone(state);
  }

  async requestApproval(id: string) {
    const state = await this.get(id);
    if (!state.quote || !state.quoteHash) {
      throw new IntegrationBoundaryError("near_intents_quote_error", "Simulate an executable quote first");
    }
    assertExecutableNearIntentsQuote(state.quote, this.now());
    const approval: NearDepositApproval = {
      id: opaqueId("near_deposit_approval", { workflowId: id, quoteHash: state.quoteHash }),
      quoteHash: state.quoteHash,
      status: "pending",
      requestedAt: this.now().toISOString()
    };
    state.approval = approval;
    state.stage = "approval_pending";
    this.event(state, "near_deposit.approval_requested", {
      approvalId: approval.id,
      quoteHash: approval.quoteHash
    });
    await this.persist(state);
    return clone(state);
  }

  async resolveApproval(id: string, decision: "approve" | "reject" | "cancel") {
    const state = await this.get(id);
    if (!state.quote || !state.approval || state.approval.status !== "pending") {
      throw new IntegrationBoundaryError("near_intents_status_error", "No pending NEAR deposit approval");
    }
    if (decision !== "approve") {
      state.approval.status = decision === "reject" ? "rejected" : "cancelled";
      state.approval.resolvedAt = this.now().toISOString();
      state.stage = "quote_ready";
      this.event(state, `near_deposit.approval_${state.approval.status}`, { approvalId: state.approval.id });
      await this.persist(state);
      return clone(state);
    }
    assertExecutableNearIntentsQuote(state.quote, this.now());
    const authorization = await this.options.walletBroker.authorize({
      approval: state.approval,
      quote: state.quote
    });
    state.approval.status = "approved";
    state.approval.resolvedAt = this.now().toISOString();
    state.approval.walletApprovalToken = authorization.walletApprovalToken;
    state.stage = "approved";
    this.event(state, "near_deposit.approval_approved", { approvalId: state.approval.id });
    await this.persist(state);
    return clone(state);
  }

  async execute(id: string) {
    const state = await this.get(id);
    if (!state.quote || !state.approval || state.approval.status !== "approved") {
      throw new IntegrationBoundaryError("near_intents_status_error", "An approved wallet action is required");
    }
    if (!state.approval.walletApprovalToken) {
      throw new IntegrationBoundaryError("near_intents_status_error", "Wallet approval token is missing");
    }
    if (state.quoteHash !== state.approval.quoteHash) {
      throw new IntegrationBoundaryError("near_intents_status_error", "Approval does not match the current quote");
    }
    assertExecutableNearIntentsQuote(state.quote, this.now());
    const executed = await this.options.walletBroker.executeDeposit({
      quote: state.quote,
      walletApprovalToken: state.approval.walletApprovalToken
    });
    state.depositTxid = executed.txHash;
    state.execution = await this.options.provider.submitDepositTx({
      txHash: executed.txHash,
      depositAddress: state.quote.depositAddress!,
      depositMemo: state.quote.depositMemo
    });
    state.stage = "deposit_submitted";
    this.event(state, "near_deposit.submitted", {
      txHash: executed.txHash,
      providerStatus: state.execution.providerStatus
    });
    await this.persist(state);
    return clone(state);
  }

  async verify(id: string) {
    const state = await this.get(id);
    if (!state.quote?.depositAddress || !state.depositTxid) {
      throw new IntegrationBoundaryError("near_intents_status_error", "No submitted NEAR Intents deposit to verify");
    }
    const execution = await this.options.provider.getStatus(state.quote.depositAddress, state.quote.depositMemo);
    state.execution = execution;
    const successWithDestinationEvidence =
      execution.status === "success" && execution.destinationTxids.length > 0;
    state.stage =
      successWithDestinationEvidence
        ? "completed"
        : execution.status === "refunded"
          ? "refunded"
          : execution.status === "failed"
            ? "failed"
            : "processing";
    this.event(state, "near_deposit.status_verified", {
      status: execution.status,
      providerStatus: execution.providerStatus,
      destinationTxids: execution.destinationTxids,
      refundedAmount: execution.refundedAmount || null,
      destinationEvidenceReady: successWithDestinationEvidence
    });
    await this.persist(state);
    return clone(state);
  }

  private event(state: NearDepositWorkflow, type: string, data: Record<string, unknown>) {
    state.events.push({
      sequence: state.events.length + 1,
      at: this.now().toISOString(),
      type,
      data
    });
  }

  private async persist(state: NearDepositWorkflow) {
    state.updatedAt = this.now().toISOString();
    await this.options.store.save(state);
  }
}
