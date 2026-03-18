export type SourceChain = "ethereum" | "base" | "arbitrum" | "optimism";
export type SourceAsset = "ETH" | "USDC";
export type DestinationChain = "bitcoin" | "litecoin";

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
  | "thorchain_swap"
  | "utxo_detection"
  | "tradelayer_absorb"
  | "dlc_ready";

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
  | "dlc_prepare_error";

export type InboundUtxoReceipt = {
  sourceChain: SourceChain;
  sourceAsset: SourceAsset;
  thorchainSwapTx?: string;
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
