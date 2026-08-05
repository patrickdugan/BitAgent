export type StrategyAction =
  | "hold"
  | "place_limit"
  | "cancel"
  | "reduce_position"
  | "rebalance";

export type StrategyPolicyAction = Exclude<StrategyAction, "hold">;

export type StrategyModule = {
  strategyId: string;
  strategyVersion: string;
  weightBps: number;
  adapterHash: string;
};

export type StrategyCovenant = {
  schema: "bitagent_strategy_covenant_v1";
  mandateId: string;
  version: number;
  owner: {
    walletAccount: string;
    walletProvider: "bitcoin_wallet" | "metamask" | "phantom";
  };
  capital: {
    asset: "tlUSD";
    capAtoms: string;
  };
  channelIds: string[];
  strategies: StrategyModule[];
  allocation: {
    absoluteMaxDriftBps: number;
  };
  risk: {
    maxGrossLeverageBps: number;
    maxNetDeltaBps: number;
    maxOrderFractionNavBps: number;
    maxDailyLossBps: number;
    maxDrawdownBps: number;
    maxSlippageBps: number;
    maxNetworkFeeSats: string;
  };
  execution: {
    instruments: ["TLBTC/TLUSD"];
    permittedActions: StrategyPolicyAction[];
    orderTtlMs: number;
    maxMarketAgeMs: number;
    oraclePolicy: string;
    counterpartyPolicy: string;
  };
  runtime: {
    baseModelHash: string;
    allocatorHash: string;
    verifierHash: string;
  };
  effectiveAt: string;
  expiresAt: string;
  covenantHash: string;
};

export type StrategyCovenantApproval = {
  schema: "bitagent_strategy_covenant_approval_v1";
  approvalId: string;
  covenantHash: string;
  walletSessionId: string;
  status: "approved" | "revoked";
  approvedAt: string;
  expiresAt: string;
  walletApprovalRef: string;
};

export type StrategyPolicyHint =
  | "HOLD"
  | "QUOTE_BOTH_SIDES"
  | "SHIFT_BID"
  | "SHIFT_ASK"
  | "REDUCE_DELTA"
  | "REBALANCE_TO_TARGET"
  | "CANCEL_STALE";

export type StrategyProposal = {
  schema: "bitagent_strategy_proposal_v1";
  strategyId: string;
  strategyVersion: string;
  adapterHash: string;
  marketSnapshotHash: string;
  targetNetDeltaBps: number;
  policyHint: StrategyPolicyHint;
  generatedAt: string;
  expiresAt: string;
  proposalHash: string;
};

export type StrategyMarketSnapshot = {
  schema: "bitagent_strategy_market_snapshot_v1";
  pair: "TLBTC/TLUSD";
  bidPriceUsd: string;
  askPriceUsd: string;
  markPriceUsd: string;
  oraclePolicy: string;
  observedAt: string;
  source: string;
  snapshotHash: string;
};

export type StrategyPortfolioState = {
  schema: "bitagent_strategy_portfolio_v1";
  channelId: string;
  capitalAtoms: string;
  currentNetDeltaBps: number;
  grossLeverageBps: number;
  dailyLossBps: number;
  drawdownBps: number;
  nonce: number;
  observedAt: string;
  stateRoot: string;
};

export type StrategyTransactionManifest = {
  wallet: string;
  channelId: string;
  chain: "bitcoin-testnet4";
  asset: "tlBTC" | "tlUSD";
  verifiedContract: "TradeLayer tx5";
  exactAmount: string;
  amountUnit: "sats" | "token_atoms";
  recipientOrProtocol: "TradeLayer";
  route: "channel_limit_order";
  networkFeeSats: string;
  protocolFeeAtoms: "0";
  slippageCeilingBps: number;
  expectedResult: string;
  permission: StrategyPolicyAction | "none";
  expiresAt: string;
};

export type StrategyCandidate = {
  schema: "bitagent_strategy_candidate_v1";
  candidateId: string;
  candidateHash: string;
  covenantHash: string;
  proposalRoot: string;
  marketSnapshotHash: string;
  portfolioStateRoot: string;
  action: StrategyAction;
  channelId: string;
  instrument: "TLBTC/TLUSD";
  side?: "buy_tlbtc" | "sell_tlbtc";
  quantitySats: string;
  limitPriceUsd?: string;
  networkFeeSats: string;
  nonce: number;
  createdAt: string;
  expiresAt: string;
  weightedTargetNetDeltaBps: number;
  projectedNetDeltaBps: number;
  riskFlags: string[];
  manifest: StrategyTransactionManifest;
  authority: "deterministic_host";
  effect: "none";
  nextAuthority: "none" | "wallet_user";
  signingPerformed: false;
  broadcastPerformed: false;
};

export type StrategyCandidateVerification = {
  schema: "bitagent_strategy_candidate_verification_v1";
  candidateHash: string;
  covenantHash: string;
  verified: boolean;
  reasonCodes: string[];
  checkedAt: string;
  verifierHash: string;
  attestationHash: string;
  nextAuthority: "none" | "wallet_user";
};

export type StrategyDecisionReceipt = {
  schema: "bitagent_strategy_decision_receipt_v1";
  receiptId: string;
  receiptHash: string;
  covenantHash: string;
  baseModelHash: string;
  adapterHashes: string[];
  allocatorHash: string;
  verifierHash: string;
  marketSnapshotHash: string;
  proposalRoot: string;
  candidateHash: string;
  verifierAttestationHash: string;
  action: StrategyAction;
  weightedTargetNetDeltaBps: number;
  projectedNetDeltaBps: number;
  createdAt: string;
  authority: "deterministic_host";
  effect: "none";
  signingPerformed: false;
  broadcastPerformed: false;
};

export type StrategyCommittedSignalDraft = {
  schema: "bitagent_strategy_signal_draft_v1";
  draftHash: string;
  bindings: {
    covenantHash: string;
    candidateHash: string;
    proposalRoot: string;
    marketSnapshotHash: string;
    portfolioStateRoot: string;
    verifierAttestationHash: string;
  };
  signalInput: {
    schema: "bitagent_tradelayer_signal_v1";
    signalId: string;
    codebase: {
      codebaseId: string;
      kind: "git_commit" | "sha256_source_tree";
      digest: string;
    };
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
  };
  authority: "deterministic_host";
  effect: "none";
  nextAuthority: "approved_signal_producer";
  signingPerformed: false;
  broadcastPerformed: false;
};
