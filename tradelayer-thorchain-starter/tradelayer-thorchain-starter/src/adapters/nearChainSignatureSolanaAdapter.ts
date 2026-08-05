import { canonicalHash } from "../survival/policy.js";
import { rejectSecretBearingFields } from "../multichain/planner.js";
import { IntegrationBoundaryError } from "../types.js";
import type { NearWalletTransactionSigner } from "./nearChainSignatureAdapter.js";

export type ChainsigSolanaTransferPlan = {
  rail: "near_chain_signatures";
  network: "mainnet" | "devnet";
  nearAccount: string;
  derivationPath: string;
  from: string;
  to: string;
  valueLamports: string;
  networkFeeLamports: string;
  recentBlockhash: string;
  serializedTransaction: string;
  payloadsHex: string[];
  expiresAt: string;
  simulationHash: string;
};

type Ed25519Signature = { scheme: string; signature: number[] };
type SolanaTransaction = { compileMessage(): unknown };
type SolanaUnsignedTransaction = {
  transaction: SolanaTransaction;
  recentBlockhash: string;
};
type ChainsigContract = {
  sign(input: {
    payloads: Uint8Array[];
    path: string;
    keyType: "Eddsa";
    signerAccount: NearWalletTransactionSigner;
  }): Promise<Ed25519Signature[]>;
};
type ChainsigSolana = {
  deriveAddressAndPublicKey(predecessor: string, path: string): Promise<{ address: string; publicKey: string }>;
  prepareTransactionForSigning(input: {
    from: string;
    to: string;
    amount: bigint;
  }): Promise<{ transaction: SolanaUnsignedTransaction; hashesToSign: Array<number[] | Uint8Array> }>;
  serializeTransaction(transaction: SolanaUnsignedTransaction): string;
  deserializeTransaction(serialized: string): SolanaUnsignedTransaction;
  finalizeTransactionSigning(input: {
    transaction: SolanaTransaction;
    rsvSignatures: Ed25519Signature;
    senderAddress: string;
  }): string;
  broadcastTx(serialized: string): Promise<{ hash: string }>;
};
type SolanaConnection = {
  getFeeForMessage(message: unknown): Promise<{ value: number | null }>;
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
    solana: {
      Solana: new (input: { solanaConnection: unknown; contract: ChainsigContract }) => ChainsigSolana;
    };
  };
};

const addressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function cause(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
}

function planHash(plan: Omit<ChainsigSolanaTransferPlan, "simulationHash">) {
  return canonicalHash(plan);
}

export class ChainsigSolanaAdapter {
  constructor(
    private readonly options: {
      network: "mainnet" | "devnet";
      nearNetwork: "mainnet" | "testnet";
      solanaConnection: SolanaConnection;
      contractId?: string;
      fallbackNearRpcUrls?: string[];
    },
    private readonly accountResolver?: (input: {
      nearAccount: string;
      derivationPath: string;
    }) => Promise<{ address: string; publicKey: string }>
  ) {}

  private async resolveAccount(solana: ChainsigSolana, input: { nearAccount: string; derivationPath: string }) {
    const account = await (this.accountResolver
      ? this.accountResolver(input)
      : solana.deriveAddressAndPublicKey(input.nearAccount, input.derivationPath));
    if (!addressPattern.test(account.address)) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Derived Solana account is malformed");
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
      solana: new chainAdapters.solana.Solana({ solanaConnection: this.options.solanaConnection, contract })
    };
  }

  async deriveAccount(input: { nearAccount: string; derivationPath: string }) {
    rejectSecretBearingFields(input);
    if (!input.nearAccount.trim() || !input.derivationPath.trim()) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "NEAR account and derivation path are required");
    }
    try {
      return await this.resolveAccount((await this.createAdapter()).solana, input);
    } catch (error) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Unable to derive the NEAR-controlled Solana account", cause(error));
    }
  }

  async prepareTransfer(input: {
    nearAccount: string;
    derivationPath: string;
    to: string;
    valueLamports: string;
    expiresAt: string;
  }): Promise<ChainsigSolanaTransferPlan> {
    rejectSecretBearingFields(input);
    if (!input.nearAccount.trim() || !input.derivationPath.trim()) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "NEAR account and derivation path are required");
    }
    if (!addressPattern.test(input.to)) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Malformed Solana destination address");
    }
    if (!/^\d+$/.test(input.valueLamports) || BigInt(input.valueLamports) <= 0n) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Solana transfer value must be positive lamports");
    }
    if (BigInt(input.valueLamports) > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Solana transfer value exceeds the SDK's safe integer limit");
    }
    if (Date.parse(input.expiresAt) <= Date.now()) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Prepared Solana transfer is stale");
    }
    try {
      const { solana } = await this.createAdapter();
      const account = await this.resolveAccount(solana, input);
      const prepared = await solana.prepareTransactionForSigning({
        from: account.address,
        to: input.to,
        amount: BigInt(input.valueLamports)
      });
      const fee = await this.options.solanaConnection.getFeeForMessage(prepared.transaction.transaction.compileMessage());
      if (fee.value === null) {
        throw new IntegrationBoundaryError("near_chain_signature_error", "Solana RPC could not price the prepared transaction");
      }
      const unsigned = {
        rail: "near_chain_signatures" as const,
        network: this.options.network,
        nearAccount: input.nearAccount,
        derivationPath: input.derivationPath,
        from: account.address,
        to: input.to,
        valueLamports: input.valueLamports,
        networkFeeLamports: String(fee.value),
        recentBlockhash: prepared.transaction.recentBlockhash,
        serializedTransaction: solana.serializeTransaction(prepared.transaction),
        payloadsHex: prepared.hashesToSign.map((payload) => Buffer.from(payload).toString("hex")),
        expiresAt: input.expiresAt
      };
      return { ...unsigned, simulationHash: planHash(unsigned) };
    } catch (error) {
      if (error instanceof IntegrationBoundaryError) throw error;
      throw new IntegrationBoundaryError("near_chain_signature_error", "Unable to prepare the NEAR-controlled Solana transfer", cause(error));
    }
  }

  async executeApprovedTransfer(input: {
    plan: ChainsigSolanaTransferPlan;
    wallet: NearWalletTransactionSigner;
    approved: boolean;
    broadcast?: boolean;
  }): Promise<{ signedTransaction: string; txHash?: string; status: "signed" | "broadcast" }> {
    rejectSecretBearingFields(input);
    const { simulationHash, ...unsigned } = input.plan;
    if (!input.approved || planHash(unsigned) !== simulationHash) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Explicit approval of the unchanged Solana simulation is required");
    }
    if (Date.parse(input.plan.expiresAt) <= Date.now()) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Prepared Solana transfer is stale");
    }
    if (input.wallet.accountId !== input.plan.nearAccount) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Connected NEAR account does not match the Solana plan");
    }
    try {
      const { solana, contract } = await this.createAdapter();
      const signatures = await contract.sign({
        payloads: input.plan.payloadsHex.map((payload) => Buffer.from(payload, "hex")),
        path: input.plan.derivationPath,
        keyType: "Eddsa",
        signerAccount: input.wallet
      });
      if (signatures.length !== 1 || signatures[0]?.scheme.toLowerCase() !== "ed25519") {
        throw new IntegrationBoundaryError("near_chain_signature_error", "NEAR signer returned an invalid Solana signature");
      }
      const transaction = solana.deserializeTransaction(input.plan.serializedTransaction);
      const signedTransaction = solana.finalizeTransactionSigning({
        transaction: transaction.transaction,
        rsvSignatures: signatures[0],
        senderAddress: input.plan.from
      });
      if (!input.broadcast) return { signedTransaction, status: "signed" };
      const result = await solana.broadcastTx(signedTransaction);
      return { signedTransaction, txHash: result.hash, status: "broadcast" };
    } catch (error) {
      if (error instanceof IntegrationBoundaryError) throw error;
      throw new IntegrationBoundaryError("near_chain_signature_error", "NEAR wallet signature request or Solana relay failed", cause(error));
    }
  }
}
