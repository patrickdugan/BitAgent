export type TradeLayerPsbtStepRequest = {
  label: string;
  phase: "vwap-trade";
  txType: 5;
  tradePrintId: string;
  side: "sell-tlbtc" | "sell-tlusd";
  payloadHex: string;
};

export type TestnetBrokerRequest = {
  schema: "tradelayer_testnet_broker_request_v1";
  requestId: string;
  network: "testnet4";
  wallet: string;
  senderAddress: string;
  policyFingerprint: string;
  maxTotalFeeSats: string;
  expiresAt: string;
  planHash: string;
  steps: TradeLayerPsbtStepRequest[];
  requestHash: string;
};

export type PreparedPsbtStep = TradeLayerPsbtStepRequest & {
  psbt: string;
  unsignedPsbtHash: string;
  feeSats: string;
  inputUtxos: Array<{
    txid: string;
    vout: number;
    valueSats: string;
    address: string;
  }>;
  inputAddresses: string[];
  walletChangeOutputs: Array<{
    address: string;
    valueSats: string;
  }>;
  walletChangeAddresses: string[];
};

export type PreparedBrokerBatch = {
  schema: "tradelayer_testnet_prepared_batch_v1";
  request: TestnetBrokerRequest;
  preparedAt: string;
  totalFeeSats: string;
  preparedSteps: PreparedPsbtStep[];
  approvalHash: string;
};

export type BrokerBroadcastReceipt = {
  schema: "tradelayer_testnet_broadcast_receipt_v1";
  requestHash: string;
  approvalHash: string;
  broadcastAt: string;
  transactions: Array<{
    label: string;
    tradePrintId: string;
    side: "sell-tlbtc" | "sell-tlusd";
    txid: string;
    feeSats: string;
    payloadHex: string;
  }>;
  receiptHash: string;
};

export type BrokerCancellationReceipt = {
  schema: "tradelayer_testnet_cancellation_receipt_v1";
  status: "cancelled_after_local_test";
  requestHash: string;
  approvalHash: string;
  cancelledAt: string;
  inputOutpoints: Array<{
    txid: string;
    vout: number;
  }>;
  inputLockReleased: boolean;
  signingPerformed: false;
  broadcastPerformed: false;
  receiptHash: string;
};

export interface BitcoinCoreBrokerRpc {
  call<T = unknown>(method: string, ...params: unknown[]): Promise<T>;
}
