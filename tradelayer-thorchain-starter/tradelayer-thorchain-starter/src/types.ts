export type SourceChain = "ethereum" | "base" | "arbitrum" | "optimism" | "solana";
export type SourceAsset = "ETH" | "SOL" | "USDC";
export type DestinationChain = "bitcoin" | "litecoin";
export type CrossChainRail = "near_intents" | "thorchain";

export type ReceiptStatus =
  | "quote_obtained"
  | "submitted"
  | "egress_detected"
  | "utxo_confirmed"
  | "mapped"
  | "absorbed"
  | "failed";

export type ActivityPhase =
  | "deposit"
  | "near_intents_swap"
  | "thorchain_swap"
  | "utxo_detection"
  | "tradelayer_absorb"
  | "dlc_ready"
  | "financial_survival"
  | "sovereign_harness"
  | "testnet_trade"
  | "storage_market"
  | "compute_market"
  | "settlement"
  | "treasury"
  | "market_agent";

export type ActivityStatus = "pending" | "success" | "error";

export type IntegrationErrorCode =
  | "quote_error"
  | "router_submit_error"
  | "swap_timeout"
  | "egress_not_found"
  | "utxo_parse_error"
  | "utxo_ref_map_error"
  | "tradelayer_build_error"
  | "tradelayer_submit_error"
  | "wallet_sync_error"
  | "dlc_prepare_error"
  | "tradelayer_trade_error"
  | "filecoin_quote_error"
  | "filecoin_deal_error"
  | "compute_quote_error"
  | "compute_lease_error"
  | "chain_abstraction_error"
  | "near_intents_quote_error"
  | "near_intents_status_error"
  | "near_chain_signature_error"
  | "settlement_error"
  | "ledger_error"
  | "signer_broker_error"
  | "market_risk_error"
  | "recovery_error";

export type InboundUtxoReceipt = {
  sourceChain: SourceChain;
  sourceAsset: SourceAsset;
  swapRail?: CrossChainRail;
  swapQuoteId?: string;
  swapTxid?: string;
  swapDepositAddress?: string;
  swapDepositMemo?: string;
  swapStatus?: string;
  swapRouteCommitment?: string;
  /** @deprecated Compatibility field for the optional THORChain rail. */
  thorchainSwapTx?: string;
  /** @deprecated Compatibility field for the optional THORChain rail. */
  thorchainMemo?: string;
  destinationChain: DestinationChain;
  destinationTxid?: string;
  destinationVout?: number;
  destinationAddress?: string;
  destinationScriptPubKey?: string;
  valueSats?: string;
  valueAtoms?: string;
  confirmations?: number;
  status: ReceiptStatus;
  raw?: unknown;
};

export type OnboardingActivity = {
  id: string;
  phase: ActivityPhase;
  status: ActivityStatus;
  label: string;
  txid?: string;
  meta?: Record<string, unknown>;
};

export type AbsorbInboundUtxoResult = {
  tlTxHex?: string;
  tlTxid?: string;
  status: "built" | "submitted" | "confirmed";
};

export type ProceduralTemplateContext = {
  templateId: string;
  contractId: string;
  settlementState: string;
  templateHash: string;
  receiptPropertyId?: number;
  collateralPropertyId?: number;
  issuePayload?: string;
};

export type TlWebPhantomIntent = {
  provider: "phantom";
  target: "tlweb";
  network: DestinationChain;
  sourceChain: SourceChain;
  receipt: InboundUtxoReceipt;
  procedural: ProceduralTemplateContext;
  actions: Array<{
    kind: "token_issue" | "grant_managed";
    payload: string;
    payloadHex: string;
    meta?: Record<string, unknown>;
  }>;
};

export type EvmTemplateCommitment = {
  depositId: string;
  templateHash: string;
  destinationScriptCommitment: string;
  thorMemoHash: string;
  destinationChain: number;
  receiptPropertyId: number;
  collateralPropertyId: number;
  settlementState: number;
};

export interface DlcPreparationHook {
  prepareFromAbsorbedUtxo(input: {
    tlTxid: string;
    utxoRef: string;
    walletAccount?: string;
  }): Promise<{
    dlcCandidateId?: string;
    relayPayload?: unknown;
    status: "prepared" | "stub";
  }>;
}

export type CanonicalUtxoReference = {
  txid: string;
  vout: number;
  valueSats: bigint;
  address?: string;
  scriptPubKey?: string;
  utxoRef: string;
  fundingRoot?: string;
  fundingIndex?: number;
};

export class IntegrationBoundaryError extends Error {
  readonly code: IntegrationErrorCode;
  readonly causeData?: unknown;

  constructor(code: IntegrationErrorCode, message: string, causeData?: unknown) {
    super(message);
    this.name = "IntegrationBoundaryError";
    this.code = code;
    this.causeData = causeData;
  }
}
