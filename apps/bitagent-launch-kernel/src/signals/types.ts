export type CodebaseCommitmentKind = "git_commit" | "sha256_source_tree";

export type SignalCodebaseCommitment = {
  codebaseId: string;
  kind: CodebaseCommitmentKind;
  digest: string;
};

export type ApprovedSignalCodebase = SignalCodebaseCommitment & {
  rootPath: string;
};

export type AlgorithmicTradeSignal = {
  schema: "bitagent_tradelayer_signal_v1";
  signalId: string;
  codebase: SignalCodebaseCommitment;
  producerKeyId: string;
  strategyId: string;
  strategyVersion: string;
  market: "TLBTC/TLUSD";
  side: "buy_tlbtc" | "sell_tlbtc";
  amountSats: string;
  limitPriceUsd: string;
  postOnly: true;
  generatedAt: string;
  expiresAt: string;
  inputSnapshotHash: string;
  payloadHash: string;
  signature: string;
};

export type CodebaseFileCommitment = {
  path: string;
  sha256: string;
  sizeBytes: number;
};

export type CodebaseVerification = {
  codebaseId: string;
  kind: CodebaseCommitmentKind;
  expectedDigest: string;
  observedDigest: string;
  clean: boolean;
  verifiedAt: string;
  fileCount?: number;
};

export type ConfirmedWalletUtxo = {
  txid: string;
  vout: number;
  amountSats: string;
  scriptPubKeyHex: string;
  confirmations: number;
};

export type SignalPortfolioSnapshot = {
  source: string;
  observedAt: string;
  network: "testnet4";
  senderAddress: string;
  confirmedUtxos: ConfirmedWalletUtxo[];
  tlbtcAvailableSats: string;
  tlusdAvailableAtoms: string;
  openExposureSats: string;
  dailyDrawdownSats: string;
  snapshotHash: string;
};

export type CanonicalSignalFunding = {
  fundingRoot: string;
  totalSats: string;
  outpoints: Array<{
    txid: string;
    vout: number;
    amountSats: string;
    scriptPubKeyHex: string;
  }>;
};

export type SignalRiskPolicy = {
  policyId: string;
  network: "testnet4";
  approvedCodebases: ApprovedSignalCodebase[];
  approvedProducers: Array<{
    producerKeyId: string;
    codebaseId: string;
    publicKeyPem: string;
  }>;
  approvedStrategies: Array<{ strategyId: string; strategyVersion: string }>;
  offeredPropertyId: number;
  desiredPropertyId: number;
  requiredConfirmations: number;
  maxSignalTtlSeconds: number;
  maxSignalAgeSeconds: number;
  maxOrderSats: string;
  maxNotionalTlusdAtoms: string;
  maxOpenExposureSats: string;
  maxDailyDrawdownSats: string;
  maxNetworkFeeSats: string;
};

export type SignalRiskDecision = {
  passed: boolean;
  reasonCodes: string[];
  policyFingerprint: string;
  notionalTlusdAtoms: string;
  evaluatedAt: string;
};

export type SignalSimulationEffect = {
  asset: "BTC" | "tlBTC" | "tlUSD" | "TLBTC/TLUSD_ORDER";
  direction: "debit" | "credit" | "lock";
  amount: string;
  unit: "sats" | "token_atoms" | "order";
};

export type TradeLayerSignalSimulation = {
  id: string;
  hash: string;
  action: "place_tradelayer_signal_order";
  signalId: string;
  signalPayloadHash: string;
  codebaseDigest: string;
  strategyId: string;
  strategyVersion: string;
  market: "TLBTC/TLUSD";
  side: AlgorithmicTradeSignal["side"];
  createdAt: string;
  expiresAt: string;
  effects: SignalSimulationEffect[];
  networkFeeSats: string;
  notionalTlusdAtoms: string;
  payload: string;
  payloadHex: string;
  funding: CanonicalSignalFunding;
  portfolioSnapshotHash: string;
  riskPolicyFingerprint: string;
  warnings: string[];
};

export type SignalWalletApproval = {
  approvalId: string;
  simulationHash: string;
  signalPayloadHash: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedAt: string;
  resolvedAt?: string;
  walletApprovalToken?: string;
};

export type SignalExecution = {
  executionId: string;
  simulationHash: string;
  status: "submitted";
  txid: string;
  orderId: string;
  submittedAt: string;
};

export type SignalVerification = {
  simulationHash: string;
  status: "pending" | "verified" | "failed";
  checkedAt: string;
  txid: string;
  orderId: string;
  confirmations?: number;
  positionOrOrderState?: "open" | "filled" | "cancelled";
  evidence?: Record<string, unknown>;
};

export type SignalFailure = {
  code: SignalErrorCode;
  message: string;
  at: string;
  recoverable: boolean;
};

export type SignalWorkflowStatus =
  | "empty"
  | "signal_verified"
  | "simulation_ready"
  | "approval_pending"
  | "approved"
  | "submitted"
  | "verified"
  | "cancelled"
  | "failed";

export type SignalWorkflowEvent = {
  sequence: number;
  at: string;
  type: string;
  data: Record<string, unknown>;
};

export type SignalWorkflowState = {
  id: string;
  version: 1;
  createdAt: string;
  updatedAt: string;
  status: SignalWorkflowStatus;
  signal?: AlgorithmicTradeSignal;
  codebaseVerification?: CodebaseVerification;
  portfolio?: SignalPortfolioSnapshot;
  riskDecision?: SignalRiskDecision;
  simulation?: TradeLayerSignalSimulation;
  approval?: SignalWalletApproval;
  execution?: SignalExecution;
  verification?: SignalVerification;
  failure?: SignalFailure;
  recoveryInstructions: string[];
  events: SignalWorkflowEvent[];
};

export type SignalErrorCode =
  | "signal_schema_error"
  | "signal_signature_invalid"
  | "secret_material_prohibited"
  | "codebase_unapproved"
  | "codebase_mismatch"
  | "codebase_dirty"
  | "signal_expired"
  | "strategy_unapproved"
  | "wallet_state_unavailable"
  | "utxo_unconfirmed"
  | "utxo_ref_error"
  | "risk_rejected"
  | "simulation_stale"
  | "approval_required"
  | "approval_rejected"
  | "execution_failed"
  | "verification_failed"
  | "state_conflict"
  | "not_found";

export interface SignalWorkflowStore {
  get(id: string): Promise<SignalWorkflowState | null>;
  save(state: SignalWorkflowState): Promise<void>;
  list(): Promise<SignalWorkflowState[]>;
}

export interface SignalExecutionBroker {
  getPortfolioSnapshot(input: { now: Date }): Promise<SignalPortfolioSnapshot>;
  estimateNetworkFee(input: {
    signal: AlgorithmicTradeSignal;
    senderAddress: string;
  }): Promise<{ networkFeeSats: string; source: string }>;
  authorize(input: {
    approval: SignalWalletApproval;
    simulation: TradeLayerSignalSimulation;
  }): Promise<{ walletApprovalToken: string }>;
  execute(input: {
    approval: SignalWalletApproval;
    simulation: TradeLayerSignalSimulation;
    now: Date;
  }): Promise<SignalExecution>;
  verify(input: {
    execution: SignalExecution;
    simulation: TradeLayerSignalSimulation;
    now: Date;
  }): Promise<SignalVerification>;
}
