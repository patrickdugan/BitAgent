export type SupportedIntent =
  | "deposit_bitcoin"
  | "starter_strategy"
  | "withdraw_bitcoin";

export type WorkflowStage =
  | "wallet_required"
  | "deposit_address_ready"
  | "deposit_pending"
  | "deposit_confirmed"
  | "strategy_parameters_required"
  | "strategy_simulated"
  | "strategy_approval_pending"
  | "strategy_approved"
  | "strategy_submitted"
  | "strategy_verified"
  | "withdrawal_parameters_required"
  | "withdrawal_simulated"
  | "withdrawal_approval_pending"
  | "withdrawal_approved"
  | "withdrawal_submitted"
  | "withdrawal_verified"
  | "error";

export type LaunchErrorCode =
  | "intent_unsupported"
  | "validation_error"
  | "wallet_not_connected"
  | "deposit_unconfirmed"
  | "insufficient_funds"
  | "approval_required"
  | "approval_rejected"
  | "simulation_stale"
  | "execution_failed"
  | "verification_failed"
  | "malformed_address"
  | "secret_material_prohibited"
  | "state_conflict"
  | "not_found"
  | "provider_unavailable";

export type ReferralAttribution = {
  referrerId: string;
  campaignId: string;
  intendedWorkflow: SupportedIntent;
  strategyTemplateId?: string;
  status: "pending" | "activated";
  capturedAt: string;
  activatedAt?: string;
};

export type PublicWalletConnection = {
  status: "disconnected" | "connected";
  mode?: "create" | "connect";
  walletSessionId?: string;
  bitcoinAddress?: string;
  network: "bitcoin" | "bitcoin-testnet4";
  confirmedBalanceSats: string;
  capabilities: Array<"deposit" | "strategy" | "withdraw" | "psbt_approval">;
  connectedAt?: string;
};

export type BitcoinDepositState = {
  status: "not_started" | "awaiting_deposit" | "unconfirmed" | "confirmed";
  address?: string;
  scriptPubKeyHex?: string;
  txid?: string;
  vout?: number;
  amountSats?: string;
  blockHeight?: number | null;
  confirmations: number;
  requiredConfirmations: number;
  utxoRef?: string;
  observedAt?: string;
};

export type StarterStrategyParameters = {
  strategyId: "starter-tlbtc-tlusd-limit-v1";
  amountSats: string;
  limitPriceUsd: string;
  postOnly: true;
  offeredPropertyId: number;
  desiredPropertyId: number;
};

export type QuoteSnapshot = {
  quoteId: string;
  source: string;
  priceUsd: string;
  quotedAt: string;
  expiresAt: string;
};

export type ExactEffect = {
  asset: "BTC" | "tlBTC" | "tlUSD" | "BTC_ORDER";
  direction: "debit" | "credit" | "lock" | "unlock";
  amount: string;
  unit: "sats" | "token_atoms" | "order";
  destination?: string;
};

export type TransactionSimulation = {
  id: string;
  hash: string;
  action: "starter_strategy" | "withdraw_bitcoin";
  createdAt: string;
  expiresAt: string;
  effects: ExactEffect[];
  fees: {
    networkFeeSats: string;
    protocolFeeSats: string;
    totalFeeSats: string;
  };
  balanceBeforeSats: string;
  balanceAfterSats: string;
  payload?: string;
  payloadHex?: string;
  destinationAddress?: string;
  quote?: QuoteSnapshot;
  strategy?: StarterStrategyParameters;
  warnings: string[];
};

export type WalletApproval = {
  id: string;
  action: TransactionSimulation["action"];
  simulationHash: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedAt: string;
  resolvedAt?: string;
  walletApprovalRequestId?: string;
  walletApprovalToken?: string;
};

export type WalletAuthorizationResult =
  | { status: "pending"; walletApprovalRequestId: string }
  | { status: "approved"; walletApprovalToken: string; walletApprovalRequestId?: string }
  | { status: "rejected"; walletApprovalRequestId?: string };

export type ActionExecution = {
  id: string;
  action: TransactionSimulation["action"];
  status: "submitted" | "failed";
  simulationHash: string;
  txid?: string;
  orderId?: string;
  submittedAt: string;
  errorCode?: LaunchErrorCode;
};

export type ActionVerification = {
  action: TransactionSimulation["action"];
  status: "pending" | "verified" | "failed";
  checkedAt: string;
  txid?: string;
  orderId?: string;
  confirmations?: number;
  evidence?: Record<string, unknown>;
};

export type WorkflowEvent = {
  sequence: number;
  at: string;
  type: string;
  data: Record<string, unknown>;
};

export type BitAgentWorkflowState = {
  id: string;
  version: 1;
  createdAt: string;
  updatedAt: string;
  stage: WorkflowStage;
  currentIntent: SupportedIntent;
  wallet: PublicWalletConnection;
  deposit: BitcoinDepositState;
  selectedStrategy?: StarterStrategyParameters;
  simulation?: TransactionSimulation;
  pendingApproval?: WalletApproval;
  execution?: ActionExecution;
  verification?: ActionVerification;
  referral?: ReferralAttribution;
  recoveryInstructions: string[];
  events: WorkflowEvent[];
};

export type StructuredPlan = {
  intent: SupportedIntent | "unsupported";
  summary: string;
  steps: Array<{
    sequence: number;
    label: string;
    status: "complete" | "current" | "pending" | "blocked";
  }>;
  missingParameters: string[];
  suggestedTool?: {
    name: string;
    arguments: Record<string, unknown>;
  };
  walletTruth: {
    connected: boolean;
    confirmedBalanceSats: string;
    depositConfirmations: number;
    depositRequiredConfirmations: number;
  };
  prohibitedRequestDetected: boolean;
};

export interface WorkflowStore {
  get(id: string): Promise<BitAgentWorkflowState | null>;
  save(state: BitAgentWorkflowState): Promise<void>;
  list(): Promise<BitAgentWorkflowState[]>;
}

export interface QuoteProvider {
  getStarterStrategyQuote(input: {
    amountSats: string;
    now: Date;
  }): Promise<QuoteSnapshot>;
}

export interface WalletExecutionBroker {
  connect(input: {
    mode: "create" | "connect";
    network: PublicWalletConnection["network"];
    publicAddress?: string;
    walletSessionId?: string;
    now: Date;
  }): Promise<PublicWalletConnection>;
  getDepositAddress(input: {
    wallet: PublicWalletConnection;
  }): Promise<{ address: string; scriptPubKeyHex: string }>;
  estimateFee(input: {
    action: TransactionSimulation["action"];
    amountSats: string;
    state: BitAgentWorkflowState;
  }): Promise<{ networkFeeSats: string; source: string }>;
  authorize(input: {
    approval: WalletApproval;
    simulation: TransactionSimulation;
    state: BitAgentWorkflowState;
  }): Promise<WalletAuthorizationResult>;
  execute(input: {
    approval: WalletApproval;
    simulation: TransactionSimulation;
    state: BitAgentWorkflowState;
    now: Date;
  }): Promise<ActionExecution>;
  verify(input: {
    execution: ActionExecution;
    simulation: TransactionSimulation;
    state: BitAgentWorkflowState;
    now: Date;
  }): Promise<ActionVerification>;
}
