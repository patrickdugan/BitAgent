import { canonicalHash } from "../survival/policy.js";
import type { CapabilityLease } from "../sovereign/types.js";
import { IntegrationBoundaryError } from "../types.js";

export type NearChainSignaturePreparation = {
  status: "prepared" | "stub";
  targetChain: "bitcoin" | "litecoin" | "ethereum" | "filecoin" | "akash";
  nearAccount?: string;
  derivationPath: string;
  payloadHash: string;
  authorizationProofHash: string;
  leaseId: string;
  note: string;
};

export type NearWalletTransactionSigner = {
  accountId: string;
  signAndSendTransactions(input: {
    transactions: Array<{
      signerId?: string;
      receiverId: string;
      actions: unknown[];
    }>;
  }): Promise<unknown[]>;
};

export type ChainsigBitcoinTransferPlan = {
  rail: "near_chain_signatures";
  network: "mainnet" | "testnet";
  nearAccount: string;
  derivationPath: string;
  from: string;
  to: string;
  valueSats: string;
  feeSats: string;
  outputs: Array<{ valueSats: string; scriptHex: string }>;
  serializedTransaction: string;
  payloadsHex: string[];
  expiresAt: string;
};

type RsvSignature = { r: string; s: string; v: number };
type ChainsigBitcoinTransaction = {
  psbt: {
    data: { inputs: Array<{ witnessUtxo?: { value: number | bigint } }> };
    txOutputs: Array<{ value: number | bigint; script: { toString(encoding: "hex"): string } }>;
  };
  publicKey: string;
};
type ChainsigContract = {
  sign(input: {
    payloads: Array<Uint8Array>;
    path: string;
    keyType: "Ecdsa";
    signerAccount: NearWalletTransactionSigner;
  }): Promise<RsvSignature[]>;
};
type ChainsigBitcoin = {
  deriveAddressAndPublicKey(predecessor: string, path: string): Promise<{ address: string; publicKey: string }>;
  prepareTransactionForSigning(input: {
    from: string;
    to: string;
    value: string;
    publicKey: string;
  }): Promise<{ transaction: ChainsigBitcoinTransaction; hashesToSign: Array<number[] | Uint8Array> }>;
  serializeTransaction(transaction: ChainsigBitcoinTransaction): string;
  deserializeTransaction(serialized: string): ChainsigBitcoinTransaction;
  finalizeTransactionSigning(input: {
    transaction: ChainsigBitcoinTransaction;
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
    btc: {
      Bitcoin: new (input: {
        network: "mainnet" | "testnet";
        contract: ChainsigContract;
        btcRpcAdapter: unknown;
      }) => ChainsigBitcoin;
      BTCRpcAdapters: { Mempool: new (url: string) => unknown };
    };
  };
};

const secretField = /(?:private.?key|seed|mnemonic|secret)/i;

function rejectSecrets(value: unknown, path = "input") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (secretField.test(key)) {
      throw new IntegrationBoundaryError(
        "near_chain_signature_error",
        `Secret-bearing field ${path}.${key} is prohibited; connect a wallet callback instead`
      );
    }
    rejectSecrets(child, `${path}.${key}`);
  }
}

function safeError(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
}

export class ChainsigBitcoinAdapter {
  constructor(
    private readonly options: {
      network: "mainnet" | "testnet";
      nearNetwork: "mainnet" | "testnet";
      mempoolApiUrl?: string;
      contractId?: string;
      fallbackNearRpcUrls?: string[];
    }
  ) {}

  private async createAdapter() {
    // A variable import keeps the SDK's broken declarations for unrelated chains
    // behind this narrow runtime boundary while retaining the official package.
    const moduleName: string = "chainsig.js";
    const { chainAdapters, contracts } = (await import(moduleName)) as unknown as ChainsigRuntime;
    const contract = new contracts.ChainSignatureContract({
      networkId: this.options.nearNetwork,
      contractId: this.options.contractId,
      fallbackRpcUrls: this.options.fallbackNearRpcUrls
    });
    const api =
      this.options.mempoolApiUrl ||
      (this.options.network === "mainnet" ? "https://mempool.space/api" : "https://mempool.space/testnet/api");
    const bitcoin = new chainAdapters.btc.Bitcoin({
      network: this.options.network,
      contract,
      btcRpcAdapter: new chainAdapters.btc.BTCRpcAdapters.Mempool(api)
    });
    return { bitcoin, contract };
  }

  async deriveAccount(input: { nearAccount: string; derivationPath: string }) {
    rejectSecrets(input);
    if (!input.nearAccount.trim() || !input.derivationPath.trim()) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "NEAR account and derivation path are required");
    }
    try {
      const { bitcoin } = await this.createAdapter();
      return await bitcoin.deriveAddressAndPublicKey(input.nearAccount, input.derivationPath);
    } catch (error) {
      throw new IntegrationBoundaryError(
        "near_chain_signature_error",
        "Unable to derive the NEAR-controlled Bitcoin account",
        safeError(error)
      );
    }
  }

  async prepareTransfer(input: {
    nearAccount: string;
    derivationPath: string;
    to: string;
    valueSats: string;
    expiresAt: string;
  }): Promise<ChainsigBitcoinTransferPlan> {
    rejectSecrets(input);
    if (!/^\d+$/.test(input.valueSats) || BigInt(input.valueSats) <= 0n) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Bitcoin transfer value must be positive satoshis");
    }
    try {
      const { bitcoin } = await this.createAdapter();
      const account = await bitcoin.deriveAddressAndPublicKey(input.nearAccount, input.derivationPath);
      const prepared = await bitcoin.prepareTransactionForSigning({
        from: account.address,
        to: input.to,
        value: input.valueSats,
        publicKey: account.publicKey
      });
      const inputSats = prepared.transaction.psbt.data.inputs.reduce(
        (sum, item) => sum + BigInt(item.witnessUtxo?.value || 0),
        0n
      );
      const outputs = prepared.transaction.psbt.txOutputs.map((item) => ({
        valueSats: String(item.value),
        scriptHex: item.script.toString("hex")
      }));
      const outputSats = outputs.reduce((sum, item) => sum + BigInt(item.valueSats), 0n);
      return {
        rail: "near_chain_signatures",
        network: this.options.network,
        nearAccount: input.nearAccount,
        derivationPath: input.derivationPath,
        from: account.address,
        to: input.to,
        valueSats: input.valueSats,
        feeSats: (inputSats - outputSats).toString(),
        outputs,
        serializedTransaction: bitcoin.serializeTransaction(prepared.transaction),
        payloadsHex: prepared.hashesToSign.map((payload) => Buffer.from(payload).toString("hex")),
        expiresAt: input.expiresAt
      };
    } catch (error) {
      if (error instanceof IntegrationBoundaryError) throw error;
      throw new IntegrationBoundaryError(
        "near_chain_signature_error",
        "Unable to prepare the NEAR-controlled Bitcoin transfer",
        safeError(error)
      );
    }
  }

  async executeApprovedTransfer(input: {
    plan: ChainsigBitcoinTransferPlan;
    wallet: NearWalletTransactionSigner;
    approved: boolean;
    broadcast?: boolean;
  }): Promise<{ signedTransaction: string; txid?: string; status: "signed" | "broadcast" }> {
    rejectSecrets(input);
    if (!input.approved) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Explicit wallet approval is required");
    }
    if (Date.parse(input.plan.expiresAt) <= Date.now()) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Prepared Bitcoin transfer is stale");
    }
    if (input.wallet.accountId !== input.plan.nearAccount) {
      throw new IntegrationBoundaryError("near_chain_signature_error", "Connected NEAR account does not match the plan");
    }
    try {
      const { bitcoin, contract } = await this.createAdapter();
      const signatures = await contract.sign({
        payloads: input.plan.payloadsHex.map((payload) => Buffer.from(payload, "hex")),
        path: input.plan.derivationPath,
        keyType: "Ecdsa",
        signerAccount: input.wallet
      });
      const signedTransaction = bitcoin.finalizeTransactionSigning({
        transaction: bitcoin.deserializeTransaction(input.plan.serializedTransaction),
        rsvSignatures: signatures
      });
      if (!input.broadcast) return { signedTransaction, status: "signed" };
      const result = await bitcoin.broadcastTx(signedTransaction);
      return { signedTransaction, txid: result.hash, status: "broadcast" };
    } catch (error) {
      if (error instanceof IntegrationBoundaryError) throw error;
      throw new IntegrationBoundaryError(
        "near_chain_signature_error",
        "Wallet signature request or Bitcoin relay failed",
        safeError(error)
      );
    }
  }
}

export function prepareNearChainSignature(input: {
  lease: CapabilityLease;
  targetChain: "bitcoin" | "litecoin" | "ethereum" | "filecoin" | "akash";
  derivationPath: string;
  payloadHash: string;
  nearAccount?: string;
}): NearChainSignaturePreparation {
  if (input.lease.status !== "active") throw new Error("An active capability lease is required");
  if (!input.lease.effects.includes("request_signature")) throw new Error("Capability lease does not cover signature requests");
  if (!/^[a-f0-9]{64}$/i.test(input.payloadHash)) throw new Error("payloadHash must be a 32-byte hex digest");
  if (!input.derivationPath.trim()) throw new Error("NEAR chain-signature derivation path is required");

  return {
    status: input.nearAccount ? "prepared" : "stub",
    targetChain: input.targetChain,
    nearAccount: input.nearAccount,
    derivationPath: input.derivationPath,
    payloadHash: input.payloadHash.toLowerCase(),
    authorizationProofHash: canonicalHash({
      leaseId: input.lease.leaseId,
      fingerprint: input.lease.invocationFingerprint,
      targetChain: input.targetChain,
      derivationPath: input.derivationPath,
      payloadHash: input.payloadHash.toLowerCase()
    }),
    leaseId: input.lease.leaseId,
    note: "Prepared only: the host must call NEAR v1.signer and relay the result after independent verification."
  };
}
