export type WalletProviderId = "phantom" | "metamask";
export type ChainEnvironment = "ethereum" | "solana";
export type EthereumNetwork = "mainnet" | "sepolia";
export type SolanaNetwork = "mainnet" | "devnet";

export type WalletAccount = {
  environment: ChainEnvironment;
  network: EthereumNetwork | SolanaNetwork;
  address: string;
  caip2: string;
  caip10: string;
};

/** Public session metadata only. Wallet capabilities never include generic RPC access. */
export type PublicMultichainWalletSession = {
  provider: WalletProviderId;
  status: "connected" | "disconnected";
  accounts: WalletAccount[];
  connectedAt: string;
  sessionHash: string;
};

type WalletPlanBase = {
  version: 1;
  rail: "direct_wallet";
  provider: WalletProviderId;
  from: string;
  effects: Array<{ label: string; amount: string }>;
  expiresAt: string;
  simulationHash: string;
  status: "simulated";
};

export type EvmWalletActionPlan = WalletPlanBase & {
  environment: "ethereum";
  network: EthereumNetwork;
  chainId: 1 | 11155111;
  caip2: "eip155:1" | "eip155:11155111";
  action: "native_transfer" | "contract_call";
  to: string;
  valueWei: string;
  data: `0x${string}`;
  gasLimit: string;
  maxFeePerGasWei: string;
  maxPriorityFeePerGasWei: string;
  maximumNetworkFeeWei: string;
};

export type SolanaWalletActionPlan = WalletPlanBase & {
  environment: "solana";
  network: SolanaNetwork;
  caip2:
    | "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
    | "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
  action: "native_transfer";
  to: string;
  valueLamports: string;
  networkFeeLamports: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  serializedTransactionBase64: string;
};

export type DirectWalletActionPlan = EvmWalletActionPlan | SolanaWalletActionPlan;

export type WalletExecutionEvidence = {
  provider: WalletProviderId;
  environment: ChainEnvironment;
  network: EthereumNetwork | SolanaNetwork;
  simulationHash: string;
  transactionHash: string;
  status: "submitted" | "verified";
};

export interface TypedWalletAuthority {
  connect(): Promise<PublicMultichainWalletSession>;
  executeApproved(plan: DirectWalletActionPlan): Promise<WalletExecutionEvidence>;
  disconnect(): Promise<void>;
}
