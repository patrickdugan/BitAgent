import type { ReserveIntakePlan } from "./reserveIntake.js";
import type { ComplianceDecision, ProductCategory } from "../compliance/types.js";
import type { TradeLayerProtocolPolicyReceipt } from "../compliance/tradelayerPolicy.js";

export type SupportedIntent =
  | "deposit_bitcoin"
  | "starter_strategy"
  | "withdraw_bitcoin";

export type WorkflowStage =
  | "wallet_required"
  | "deposit_address_ready"
  | "deposit_pending"
  | "deposit_confirmed"
  | "strategy_funding_simulated"
  | "strategy_funding_approval_pending"
  | "strategy_funding_approved"
  | "strategy_funding_submitted"
  | "strategy_funding_verified"
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
  | "compliance_required"
  | "simulation_stale"
  | "execution_failed"
  | "verification_failed"
  | "malformed_address"
  | "secret_material_prohibited"
  | "state_conflict"
  | "not_found"
  | "provider_unavailable";

export type ReferralAttribution = {
  invitationId: string;
  policyVersion: string;
  signature: string;
  intendedWorkflow: SupportedIntent;
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
  expectedTlUsdAtoms: string;
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

export type StarterOrderPlan = {
  schema: "bitagent_starter_order_plan_v1";
  planHash: string;
  network: "bitcoin-testnet4";
  workflowId: string;
  walletSessionId: string;
  walletAddress: string;
  quote: QuoteSnapshot;
  strategy: StarterStrategyParameters;
  tradeLayer: {
    transactionType: 5;
    payload: string;
    payloadHex: string;
    payloadBytes: number;
  };
  requiredOutputOrder: [
    { vout: 0; kind: "tradelayer_op_return"; payloadHex: string },
    { vout: 1; kind: "wallet_change" }
  ];
  preconditions: string[];
};

export type ExactEffect = {
  asset: "BTC" | "tlBTC" | "tlUSD" | "BTC_ORDER";
  direction: "debit" | "credit" | "lock" | "unlock";
  amount: string;
  unit: "sats" | "token_atoms" | "order";
  destination?: string;
  condition?: "immediate" | "on_fill";
};

export type StrategyFundingEvidence = {
  schema: "bitagent_strategy_funding_evidence_v1";
  status: "pending" | "verified" | "failed";
  network: PublicWalletConnection["network"];
  walletSessionId: string;
  bitcoinSpendableSats: string;
  reserveLockedSats: string;
  tlBtcAvailableSats: string;
  tlBtcReservedSats: string;
  reserveOutpoint?: string;
  reserveManifestHash?: string;
  intakeTxid?: string;
  confirmations: number;
  observedAt: string;
  source: string;
  reason: string;
  evidenceHash: string;
};

export type WalletWithdrawalCandidate = {
  schema: "bitagent_wallet_withdrawal_candidate_v1";
  candidateId: string;
  candidateHash: string;
  workflowId: string;
  walletSessionId: string;
  network: "bitcoin-testnet4";
  preparedAt: string;
  expiresAt: string;
  unsignedTxid: string;
  unsignedPsbtHash: string;
  inputUtxos: Array<{
    txid: string;
    vout: number;
    valueSats: string;
    address: string;
    scriptPubKeyHex: string;
  }>;
  destinationOutput: {
    vout: 0;
    address: string;
    scriptPubKeyHex: string;
    valueSats: string;
  };
  changeOutput: {
    vout: 1;
    address: string;
    scriptPubKeyHex: string;
    valueSats: string;
  };
  feeSats: string;
  feeRateSatVb: number;
  signingPerformed: false;
  broadcastPerformed: false;
};

export type WalletReserveIntakeCandidate = {
  schema: "bitagent_wallet_reserve_intake_candidate_v1";
  candidateId: string;
  candidateHash: string;
  workflowId: string;
  walletSessionId: string;
  network: "bitcoin-testnet4";
  preparedAt: string;
  expiresAt: string;
  planHash: string;
  bindingHash: string;
  unsignedTxid: string;
  unsignedPsbtHash: string;
  inputUtxos: Array<{
    txid: string;
    vout: number;
    valueSats: string;
    address: string;
    scriptPubKeyHex: string;
  }>;
  reserveOutput: {
    vout: 0;
    address: string;
    scriptPubKeyHex: string;
    valueSats: string;
  };
  dataOutput: {
    vout: 1;
    payloadHex: string;
    payloadBytes: number;
  };
  changeOutput: {
    vout: 2;
    address: string;
    scriptPubKeyHex: string;
    valueSats: string;
  };
  feeSats: string;
  feeRateSatVb: number;
  signingPerformed: false;
  broadcastPerformed: false;
};

export type WalletStarterOrderCandidate = {
  schema: "bitagent_wallet_starter_order_candidate_v1";
  candidateId: string;
  candidateHash: string;
  workflowId: string;
  walletSessionId: string;
  network: "bitcoin-testnet4";
  preparedAt: string;
  expiresAt: string;
  planHash: string;
  unsignedTxid: string;
  unsignedPsbtHash: string;
  inputUtxos: Array<{
    txid: string;
    vout: number;
    valueSats: string;
    address: string;
    scriptPubKeyHex: string;
  }>;
  dataOutput: {
    vout: 0;
    payload: string;
    payloadHex: string;
    payloadBytes: number;
  };
  changeOutput: {
    vout: 1;
    address: string;
    scriptPubKeyHex: string;
    valueSats: string;
  };
  feeSats: string;
  feeRateSatVb: number;
  signingPerformed: false;
  broadcastPerformed: false;
};

export type TransactionSimulation = {
  id: string;
  hash: string;
  action: "fund_starter_strategy" | "starter_strategy" | "withdraw_bitcoin";
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
  reservePlan?: ReserveIntakePlan;
  starterOrderPlan?: StarterOrderPlan;
  walletCandidate?: WalletReserveIntakeCandidate | WalletStarterOrderCandidate | WalletWithdrawalCandidate;
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
  complianceAuthorizationHash?: string;
  complianceDecisionHash?: string;
};

export type WalletComplianceReceipt = {
  schema: "bitagent_wallet_compliance_receipt_v1";
  effect: "authorize_wallet_action";
  action: TransactionSimulation["action"];
  product: ProductCategory;
  simulation_hash: string;
  decision: ComplianceDecision;
  decision_hash: string;
  protocol_policy: TradeLayerProtocolPolicyReceipt;
  authorization_context_hash: string;
  issued_at: string;
  expires_at: string;
  receipt_hash: string;
};

export type WalletAuthorizationResult =
  | { status: "pending"; walletApprovalRequestId: string; complianceAuthorizationHash?: string; complianceDecisionHash?: string }
  | { status: "approved"; walletApprovalToken: string; walletApprovalRequestId?: string; complianceAuthorizationHash?: string; complianceDecisionHash?: string }
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
  complianceAuthorizationHash?: string;
  complianceDecisionHash?: string;
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
  strategyFunding?: StrategyFundingEvidence;
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
    reserveLockedSats: string;
    tlBtcAvailableSats: string;
    strategyFundingSource?: string;
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

export interface StrategyFundingReadSource {
  readonly source: string;
  observe(input: {
    state: BitAgentWorkflowState;
    requestedAmountSats: string;
    now: Date;
  }): Promise<StrategyFundingEvidence>;
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
    destinationAddress?: string;
    reservePlan?: ReserveIntakePlan;
    starterOrderPlan?: StarterOrderPlan;
    state: BitAgentWorkflowState;
  }): Promise<{
    networkFeeSats: string;
    source: string;
    candidate?: WalletWithdrawalCandidate;
    reserveCandidate?: WalletReserveIntakeCandidate;
    starterOrderCandidate?: WalletStarterOrderCandidate;
  }>;
  authorize(input: {
    approval: WalletApproval;
    simulation: TransactionSimulation;
    state: BitAgentWorkflowState;
    compliance?: WalletComplianceReceipt;
  }): Promise<WalletAuthorizationResult>;
  execute(input: {
    approval: WalletApproval;
    simulation: TransactionSimulation;
    state: BitAgentWorkflowState;
    now: Date;
    compliance?: WalletComplianceReceipt;
  }): Promise<ActionExecution>;
  verify(input: {
    execution: ActionExecution;
    simulation: TransactionSimulation;
    state: BitAgentWorkflowState;
    now: Date;
  }): Promise<ActionVerification>;
}
