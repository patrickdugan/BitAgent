import type { NearIntentsExecutionState, NearIntentsQuoteInput, NearIntentsQuotePlan } from "../adapters/nearIntentsAdapter.js";

export type NearDepositStage =
  | "quote_required"
  | "quote_ready"
  | "approval_pending"
  | "approved"
  | "deposit_submitted"
  | "processing"
  | "completed"
  | "refunded"
  | "failed";

export type NearDepositApproval = {
  id: string;
  quoteHash: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedAt: string;
  resolvedAt?: string;
  walletApprovalToken?: string;
};

export type NearDepositWorkflow = {
  id: string;
  version: 1;
  createdAt: string;
  updatedAt: string;
  stage: NearDepositStage;
  input: NearIntentsQuoteInput;
  quote?: NearIntentsQuotePlan;
  quoteHash?: string;
  approval?: NearDepositApproval;
  depositTxid?: string;
  execution?: NearIntentsExecutionState;
  recoveryInstructions: string[];
  events: Array<{ sequence: number; at: string; type: string; data: Record<string, unknown> }>;
};

export interface NearDepositStore {
  get(id: string): Promise<NearDepositWorkflow | null>;
  save(state: NearDepositWorkflow): Promise<void>;
}

export interface OriginWalletBroker {
  authorize(input: {
    approval: NearDepositApproval;
    quote: NearIntentsQuotePlan;
  }): Promise<{ walletApprovalToken: string }>;
  executeDeposit(input: {
    quote: NearIntentsQuotePlan;
    walletApprovalToken: string;
  }): Promise<{ txHash: string }>;
}
