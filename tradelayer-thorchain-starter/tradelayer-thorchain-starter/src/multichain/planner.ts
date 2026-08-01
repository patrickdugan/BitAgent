import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";
import type {
  DirectWalletActionPlan,
  EthereumNetwork,
  EvmWalletActionPlan,
  PublicMultichainWalletSession,
  SolanaNetwork,
  SolanaWalletActionPlan,
  WalletAccount,
  WalletProviderId
} from "./types.js";

const secretField = /(?:private.?key|seed|mnemonic|secret|wif)/i;
const ethereumAddress = /^0x[a-fA-F0-9]{40}$/;
const solanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const CHAIN_SCOPES = {
  ethereum: {
    mainnet: { chainId: 1 as const, caip2: "eip155:1" as const },
    sepolia: { chainId: 11155111 as const, caip2: "eip155:11155111" as const }
  },
  solana: {
    mainnet: { caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const },
    devnet: { caip2: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const }
  }
};

export function rejectSecretBearingFields(value: unknown, path = "input") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (secretField.test(key)) {
      throw new IntegrationBoundaryError(
        "chain_abstraction_error",
        `Secret-bearing field ${path}.${key} is prohibited; connect the wallet instead`
      );
    }
    rejectSecretBearingFields(child, `${path}.${key}`);
  }
}

function positiveInteger(value: string, label: string, allowZero = false) {
  if (!/^\d+$/.test(value) || (allowZero ? BigInt(value) < 0n : BigInt(value) <= 0n)) {
    throw new IntegrationBoundaryError("chain_abstraction_error", `${label} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
}

function assertFuture(expiresAt: string, now = new Date()) {
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) {
    throw new IntegrationBoundaryError("chain_abstraction_error", "Transaction simulation is stale");
  }
}

function withHash<T extends { simulationHash: string }>(plan: T): T {
  const { simulationHash: _ignored, ...hashable } = plan;
  return { ...plan, simulationHash: canonicalHash(hashable) };
}

export function createPublicWalletSession(input: {
  provider: WalletProviderId;
  accounts: Omit<WalletAccount, "caip10">[];
  connectedAt?: string;
}): PublicMultichainWalletSession {
  rejectSecretBearingFields(input);
  if (input.accounts.length === 0) {
    throw new IntegrationBoundaryError("chain_abstraction_error", "The wallet returned no supported accounts");
  }
  const connectedAt = input.connectedAt || new Date().toISOString();
  const accounts = input.accounts.map((account) => {
    const expected = account.environment === "ethereum"
      ? CHAIN_SCOPES.ethereum[account.network as EthereumNetwork]?.caip2
      : CHAIN_SCOPES.solana[account.network as SolanaNetwork]?.caip2;
    if (!expected || expected !== account.caip2) {
      throw new IntegrationBoundaryError("chain_abstraction_error", "Wallet account network and CAIP-2 scope do not match");
    }
    if (account.environment === "ethereum" ? !ethereumAddress.test(account.address) : !solanaAddress.test(account.address)) {
      throw new IntegrationBoundaryError("chain_abstraction_error", `Malformed ${account.environment} wallet address`);
    }
    return { ...account, caip10: `${account.caip2}:${account.address}` };
  });
  return {
    provider: input.provider,
    status: "connected",
    accounts,
    connectedAt,
    sessionHash: canonicalHash({ provider: input.provider, accounts, connectedAt })
  };
}

export function buildEvmWalletPlan(input: {
  provider: WalletProviderId;
  network: EthereumNetwork;
  action: "native_transfer" | "contract_call";
  from: string;
  to: string;
  valueWei: string;
  data?: `0x${string}`;
  gasLimit: string;
  maxFeePerGasWei: string;
  maxPriorityFeePerGasWei: string;
  effects: Array<{ label: string; amount: string }>;
  expiresAt: string;
}): EvmWalletActionPlan {
  rejectSecretBearingFields(input);
  if (!ethereumAddress.test(input.from) || !ethereumAddress.test(input.to)) {
    throw new IntegrationBoundaryError("chain_abstraction_error", "Malformed Ethereum address");
  }
  positiveInteger(input.valueWei, "EVM value", input.action === "contract_call");
  positiveInteger(input.gasLimit, "EVM gas limit");
  positiveInteger(input.maxFeePerGasWei, "EVM maximum fee per gas");
  positiveInteger(input.maxPriorityFeePerGasWei, "EVM priority fee per gas", true);
  if (BigInt(input.maxPriorityFeePerGasWei) > BigInt(input.maxFeePerGasWei)) {
    throw new IntegrationBoundaryError("chain_abstraction_error", "EVM priority fee exceeds the maximum fee per gas");
  }
  const data = input.data || "0x";
  if (!/^0x(?:[a-fA-F0-9]{2})*$/.test(data)) {
    throw new IntegrationBoundaryError("chain_abstraction_error", "EVM calldata must be even-length hexadecimal bytes");
  }
  assertFuture(input.expiresAt);
  const scope = CHAIN_SCOPES.ethereum[input.network];
  return withHash({
    version: 1,
    rail: "direct_wallet",
    provider: input.provider,
    environment: "ethereum",
    network: input.network,
    chainId: scope.chainId,
    caip2: scope.caip2,
    action: input.action,
    from: input.from.toLowerCase(),
    to: input.to.toLowerCase(),
    valueWei: input.valueWei,
    data,
    gasLimit: input.gasLimit,
    maxFeePerGasWei: input.maxFeePerGasWei,
    maxPriorityFeePerGasWei: input.maxPriorityFeePerGasWei,
    maximumNetworkFeeWei: (BigInt(input.gasLimit) * BigInt(input.maxFeePerGasWei)).toString(),
    effects: input.effects,
    expiresAt: input.expiresAt,
    simulationHash: "",
    status: "simulated"
  });
}

export function buildSolanaWalletPlan(input: {
  provider: WalletProviderId;
  network: SolanaNetwork;
  from: string;
  to: string;
  valueLamports: string;
  networkFeeLamports: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  serializedTransactionBase64: string;
  effects: Array<{ label: string; amount: string }>;
  expiresAt: string;
}): SolanaWalletActionPlan {
  rejectSecretBearingFields(input);
  if (!solanaAddress.test(input.from) || !solanaAddress.test(input.to)) {
    throw new IntegrationBoundaryError("chain_abstraction_error", "Malformed Solana address");
  }
  positiveInteger(input.valueLamports, "Solana value");
  positiveInteger(input.networkFeeLamports, "Solana network fee", true);
  if (!Number.isSafeInteger(input.lastValidBlockHeight) || input.lastValidBlockHeight <= 0) {
    throw new IntegrationBoundaryError("chain_abstraction_error", "Solana last-valid block height is invalid");
  }
  if (!solanaAddress.test(input.recentBlockhash)) {
    throw new IntegrationBoundaryError("chain_abstraction_error", "Solana recent blockhash is malformed");
  }
  const bytes = Buffer.from(input.serializedTransactionBase64, "base64");
  if (bytes.length === 0 || bytes.toString("base64").replace(/=+$/, "") !== input.serializedTransactionBase64.replace(/=+$/, "")) {
    throw new IntegrationBoundaryError("chain_abstraction_error", "Solana transaction is not canonical base64");
  }
  assertFuture(input.expiresAt);
  return withHash({
    version: 1,
    rail: "direct_wallet",
    provider: input.provider,
    environment: "solana",
    network: input.network,
    caip2: CHAIN_SCOPES.solana[input.network].caip2,
    action: "native_transfer",
    from: input.from,
    to: input.to,
    valueLamports: input.valueLamports,
    networkFeeLamports: input.networkFeeLamports,
    recentBlockhash: input.recentBlockhash,
    lastValidBlockHeight: input.lastValidBlockHeight,
    serializedTransactionBase64: input.serializedTransactionBase64,
    effects: input.effects,
    expiresAt: input.expiresAt,
    simulationHash: "",
    status: "simulated"
  });
}

export function assertExecutableWalletPlan(
  plan: DirectWalletActionPlan,
  session: PublicMultichainWalletSession,
  now = new Date()
) {
  rejectSecretBearingFields({ plan, session });
  assertFuture(plan.expiresAt, now);
  if (session.status !== "connected" || session.provider !== plan.provider) {
    throw new IntegrationBoundaryError("chain_abstraction_error", "The approved wallet provider does not match the simulation");
  }
  const expected = withHash({ ...plan, simulationHash: "" }).simulationHash;
  if (expected !== plan.simulationHash) {
    throw new IntegrationBoundaryError("chain_abstraction_error", "Transaction plan changed after simulation");
  }
  const account = session.accounts.find(
    (candidate) => candidate.environment === plan.environment && candidate.caip2 === plan.caip2
  );
  const equalAddress = plan.environment === "ethereum"
    ? account?.address.toLowerCase() === plan.from.toLowerCase()
    : account?.address === plan.from;
  if (!account || !equalAddress) {
    throw new IntegrationBoundaryError("chain_abstraction_error", "The connected wallet account does not match the simulation");
  }
}
