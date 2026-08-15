import { canonicalHash } from "../survival/policy.js";
import { rejectSecretBearingFields } from "../multichain/planner.js";
import { IntegrationBoundaryError } from "../types.js";
import type { NearWalletTransactionSigner } from "./nearChainSignatureAdapter.js";

export type ChainsigEvmTransferPlan = {
  rail: "near_chain_signatures";
  network: "mainnet" | "sepolia";
  chainId: 1 | 11155111;
  nearAccount: string;
  derivationPath: string;
  from: string;
  to: string;
  valueWei: string;
  gasLimit: string;
  maxFeePerGasWei: string;
  maxPriorityFeePerGasWei: string;
  maximumNetworkFeeWei: string;
  serializedTransaction: string;
  payloadsHex: string[];
  expiresAt: string;
  simulationHash: string;
};

type RsvSignature = { r: string; s: string; v: number };
type EvmUnsignedTransaction = {
  chainId: number;
  to?: string;
  value?: bigint;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
};
type ChainsigContract = {
  sign(input: {
    payloads: Uint8Array[];
    path: string;
    keyType: "Ecdsa";
    signerAccount: NearWalletTransactionSigner;
  }): Promise<RsvSignature[]>;
};
type ChainsigEvm = {
  deriveAddressAndPublicKey(predecessor: string, path: string): Promise<{ address: string; publicKey: string }>;
  prepareTransactionForSigning(input: {
    from: `0x${string}`;
    to: `0x${string}`;
    value: bigint;
  }): Promise<{ transaction: EvmUnsignedTransaction; hashesToSign: Array<number[] | Uint8Array> }>;
  serializeTransaction(transaction: EvmUnsignedTransaction): string;
  deserializeTransaction(serialized: `0x${string}`): EvmUnsignedTransaction;
  finalizeTransactionSigning(input: {
    transaction: EvmUnsignedTransaction;
    rsvSignatures: RsvSignature[];
  }): string;
  broadcastTx(serialized: string): Promise<{ hash: string }>;
};
type ChainsigRuntime = {
  contracts: {
    ChainSignatureContract: new (input: {
      networkId: "mainnet" | "testnet";
      contractId?: string;
      fallbackRpcUrls?: string[];
    }) => ChainsigContract;
  };
  chainAdapters: {
    evm: {
      EVM: new (input: { publicClient: unknown; contract: ChainsigContract }) => ChainsigEvm;
    };
  };
};

const addressPattern = /^0x[a-fA-F0-9]{40}$/;

function cause(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
}

function planHash(plan: Omit<ChainsigEvmTransferPlan, "simulationHash">) {
  return canonicalHash(plan);
}

export class ChainsigEvmAdapter {
  constructor(
    private readonly options: {
      network: "mainnet" | "sepolia";
      nearNetwork: "mainnet" | "testnet";
      publicClient: unknown;
      contractId?: string;
      fallbackNearRpcUrls?: string[];
    },
    private readonly accountResolver?: (input: {
      nearAccount: string;
      derivationPath: string;
    }) => Promise<{ address: string; publicKey: string }>
  ) {}

  private async resolveAccount(evm: ChainsigEvm, input: { nearAccount: string; derivationPath: string }) {
    const account = await (this.accountResolver
      ? this.accountResolver(input)
      : evm.deriveAddressAndPublicKey(input.nearAccount, input.derivationPath));
    if (!addressPattern.test(account.address)) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Derived EVM account is malformed");
    }
    return account;
  }

  private async createAdapter() {
    const moduleName: string = "chainsig.js";
    const { chainAdapters, contracts } = (await import(moduleName)) as unknown as ChainsigRuntime;
    const contract = new contracts.ChainSignatureContract({
      networkId: this.options.nearNetwork,
      contractId: this.options.contractId,
      fallbackRpcUrls: this.options.fallbackNearRpcUrls
    });
    return {
      contract,
      evm: new chainAdapters.evm.EVM({ publicClient: this.options.publicClient, contract })
    };
  }

  async deriveAccount(input: { nearAccount: string; derivationPath: string }) {
    rejectSecretBearingFields(input);
    if (!input.nearAccount.trim() || !input.derivationPath.trim()) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "NEAR account and derivation path are required");
    }
    try {
      return await this.resolveAccount((await this.createAdapter()).evm, input);
    } catch (error) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Unable to derive the NEAR-controlled EVM account", cause(error));
    }
  }

  async prepareTransfer(input: {
    nearAccount: string;
    derivationPath: string;
    to: string;
    valueWei: string;
    expiresAt: string;
  }): Promise<ChainsigEvmTransferPlan> {
    rejectSecretBearingFields(input);
    if (!input.nearAccount.trim() || !input.derivationPath.trim()) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "NEAR account and derivation path are required");
    }
    if (!addressPattern.test(input.to)) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Malformed EVM destination address");
    }
    if (!/^\d+$/.test(input.valueWei) || BigInt(input.valueWei) <= 0n) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "EVM transfer value must be positive wei");
    }
    if (Date.parse(input.expiresAt) <= Date.now()) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Prepared EVM transfer is stale");
    }
    try {
      const { evm } = await this.createAdapter();
      const account = await this.resolveAccount(evm, input);
      const prepared = await evm.prepareTransactionForSigning({
        from: account.address as `0x${string}`,
        to: input.to as `0x${string}`,
        value: BigInt(input.valueWei)
      });
      const transaction = prepared.transaction;
      if (!transaction.gas || !transaction.maxFeePerGas || transaction.chainId !== (this.options.network === "mainnet" ? 1 : 11155111)) {
        throw new IntegrationBoundaryError("near_chain_signature_error", "EVM RPC returned incomplete or wrong-network fee data");
      }
      if (transaction.to?.toLowerCase() !== input.to.toLowerCase() || transaction.value !== BigInt(input.valueWei)) {
        throw new IntegrationBoundaryError("near_chain_signature_error", "Prepared EVM effects do not match the requested transfer");
      }
      const unsigned = {
        rail: "near_chain_signatures" as const,
        network: this.options.network,
        chainId: transaction.chainId as 1 | 11155111,
        nearAccount: input.nearAccount,
        derivationPath: input.derivationPath,
        from: account.address,
        to: input.to.toLowerCase(),
        valueWei: input.valueWei,
        gasLimit: transaction.gas.toString(),
        maxFeePerGasWei: transaction.maxFeePerGas.toString(),
        maxPriorityFeePerGasWei: (transaction.maxPriorityFeePerGas || 0n).toString(),
        maximumNetworkFeeWei: (transaction.gas * transaction.maxFeePerGas).toString(),
        serializedTransaction: evm.serializeTransaction(transaction),
        payloadsHex: prepared.hashesToSign.map((payload) => Buffer.from(payload).toString("hex")),
        expiresAt: input.expiresAt
      };
      return { ...unsigned, simulationHash: planHash(unsigned) };
    } catch (error) {
      if (error instanceof IntegrationBoundaryError) throw error;
      throw new IntegrationBoundaryError("near_chain_signature_error", "Unable to prepare the NEAR-controlled EVM transfer", cause(error));
    }
  }

  async executeApprovedTransfer(input: {
    plan: ChainsigEvmTransferPlan;
    wallet: NearWalletTransactionSigner;
    approved: boolean;
    broadcast?: boolean;
  }): Promise<{ signedTransaction: string; txHash?: string; status: "signed" | "broadcast" }> {
    rejectSecretBearingFields(input);
    const { simulationHash, ...unsigned } = input.plan;
    if (!input.approved || planHash(unsigned) !== simulationHash) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Explicit approval of the unchanged EVM simulation is required");
    }
    if (Date.parse(input.plan.expiresAt) <= Date.now()) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Prepared EVM transfer is stale");
    }
    if (input.wallet.accountId !== input.plan.nearAccount) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Connected NEAR account does not match the EVM plan");
    }
    try {
      const { evm, contract } = await this.createAdapter();
      const signatures = await contract.sign({
        payloads: input.plan.payloadsHex.map((payload) => Buffer.from(payload, "hex")),
        path: input.plan.derivationPath,
        keyType: "Ecdsa",
        signerAccount: input.wallet
      });
      const signedTransaction = evm.finalizeTransactionSigning({
        transaction: evm.deserializeTransaction(input.plan.serializedTransaction as `0x${string}`),
        rsvSignatures: signatures
      });
      if (!input.broadcast) return { signedTransaction, status: "signed" };
      const result = await evm.broadcastTx(signedTransaction);
      return { signedTransaction, txHash: result.hash, status: "broadcast" };
    } catch (error) {
      if (error instanceof IntegrationBoundaryError) throw error;
      throw new IntegrationBoundaryError("near_chain_signature_error", "NEAR wallet signature request or EVM relay failed", cause(error));
    }
  }
}
