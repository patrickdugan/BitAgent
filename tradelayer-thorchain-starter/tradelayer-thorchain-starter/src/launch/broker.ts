import crypto from "node:crypto";
import { encodeSegwitAddress, validateBitcoinAddress } from "./bitcoin.js";
import { hashObject, opaqueId } from "./canonical.js";
import { LaunchKernelError } from "./errors.js";
import type {
  ActionExecution,
  ActionVerification,
  PublicWalletConnection,
  QuoteProvider,
  QuoteSnapshot,
  WalletExecutionBroker
} from "./types.js";

export class ScriptedQuoteProvider implements QuoteProvider {
  constructor(
    private readonly priceUsd = "65000.00",
    private readonly ttlMs = 60_000
  ) {}

  async getStarterStrategyQuote(input: { amountSats: string; now: Date }): Promise<QuoteSnapshot> {
    const core = {
      amountSats: input.amountSats,
      priceUsd: this.priceUsd,
      quotedAt: input.now.toISOString()
    };
    return {
      quoteId: opaqueId("quote", core),
      source: "scripted-evaluation",
      priceUsd: this.priceUsd,
      quotedAt: input.now.toISOString(),
      expiresAt: new Date(input.now.getTime() + this.ttlMs).toISOString()
    };
  }
}

export type ScriptedBrokerOptions = {
  strategyFeeSats?: string;
  withdrawalFeeSats?: string;
  rejectAuthorization?: boolean;
  pendingAuthorization?: boolean;
  unavailableAuthorization?: boolean;
  failExecution?: boolean;
  failVerification?: boolean;
  pendingVerification?: boolean;
};

export class ScriptedWalletBroker implements WalletExecutionBroker {
  private readonly executions = new Map<string, ActionExecution>();

  constructor(private readonly options: ScriptedBrokerOptions = {}) {}

  async connect(input: {
    mode: "create" | "connect";
    network: PublicWalletConnection["network"];
    publicAddress?: string;
    walletSessionId?: string;
    now: Date;
  }): Promise<PublicWalletConnection> {
    const walletSessionId = input.walletSessionId
      || opaqueId("wallet", { mode: input.mode, network: input.network, at: input.now.toISOString() });
    const program = crypto.createHash("sha256").update(walletSessionId).digest().subarray(0, 20);
    const bitcoinAddress = input.publicAddress
      ? validateBitcoinAddress(input.publicAddress, input.network).address
      : encodeSegwitAddress(program, input.network);
    return {
      status: "connected",
      mode: input.mode,
      walletSessionId,
      bitcoinAddress,
      network: input.network,
      confirmedBalanceSats: "0",
      capabilities: ["deposit", "strategy", "withdraw", "psbt_approval"],
      connectedAt: input.now.toISOString()
    };
  }

  async getDepositAddress(input: { wallet: PublicWalletConnection }) {
    if (!input.wallet.bitcoinAddress) {
      throw new LaunchKernelError("wallet_not_connected", "Wallet has no public Bitcoin address");
    }
    const validated = validateBitcoinAddress(input.wallet.bitcoinAddress, input.wallet.network);
    return { address: validated.address, scriptPubKeyHex: validated.scriptPubKeyHex };
  }

  async estimateFee(input: { action: "starter_strategy" | "withdraw_bitcoin"; amountSats: string }) {
    return {
      networkFeeSats: input.action === "starter_strategy"
        ? this.options.strategyFeeSats || "900"
        : this.options.withdrawalFeeSats || "600",
      source: "scripted-evaluation"
    };
  }

  async authorize(input: { approval: { status: string }; simulation: { hash: string } }) {
    if (this.options.unavailableAuthorization) {
      throw new LaunchKernelError("provider_unavailable", "The wallet approval service is temporarily unavailable");
    }
    if (this.options.rejectAuthorization) {
      throw new LaunchKernelError("approval_rejected", "The wallet rejected the signature request");
    }
    const walletApprovalRequestId = opaqueId("wallet_approval_request", input.simulation.hash);
    if (this.options.pendingAuthorization) {
      return { status: "pending" as const, walletApprovalRequestId };
    }
    return {
      status: "approved" as const,
      walletApprovalRequestId,
      walletApprovalToken: opaqueId("approval_token", {
        hash: input.simulation.hash,
        status: input.approval.status
      })
    };
  }

  async execute(input: Parameters<WalletExecutionBroker["execute"]>[0]) {
    const existing = this.executions.get(input.simulation.hash);
    if (existing) return structuredClone(existing);
    if (this.options.failExecution) {
      throw new LaunchKernelError("execution_failed", "The wallet broker failed before broadcast");
    }
    if (!input.approval.walletApprovalToken || input.approval.status !== "approved") {
      throw new LaunchKernelError("approval_required", "An approved wallet token is required");
    }

    const execution: ActionExecution = {
      id: opaqueId("execution", input.simulation.hash),
      action: input.simulation.action,
      status: "submitted",
      simulationHash: input.simulation.hash,
      txid: hashObject({ kind: "scripted-tx", hash: input.simulation.hash }),
      orderId: input.simulation.action === "starter_strategy"
        ? opaqueId("order", input.simulation.hash)
        : undefined,
      submittedAt: input.now.toISOString()
    };
    this.executions.set(input.simulation.hash, execution);
    return structuredClone(execution);
  }

  async verify(input: Parameters<WalletExecutionBroker["verify"]>[0]): Promise<ActionVerification> {
    if (this.options.failVerification) {
      return {
        action: input.simulation.action,
        status: "failed",
        checkedAt: input.now.toISOString(),
        txid: input.execution.txid,
        orderId: input.execution.orderId,
        evidence: { source: "scripted-evaluation", reason: "forced verification failure" }
      };
    }
    if (this.options.pendingVerification) {
      return {
        action: input.simulation.action,
        status: "pending",
        checkedAt: input.now.toISOString(),
        txid: input.execution.txid,
        orderId: input.execution.orderId,
        confirmations: 0,
        evidence: { source: "scripted-evaluation" }
      };
    }
    return {
      action: input.simulation.action,
      status: "verified",
      checkedAt: input.now.toISOString(),
      txid: input.execution.txid,
      orderId: input.execution.orderId,
      confirmations: 1,
      evidence: {
        source: "scripted-evaluation",
        simulationHash: input.simulation.hash,
        exactEffectsMatched: true
      }
    };
  }
}

export class UnavailableWalletBroker extends ScriptedWalletBroker {
  private unavailable(): never {
    throw new LaunchKernelError(
      "provider_unavailable",
      "Production wallet broker is not configured; execution is disabled"
    );
  }

  override async authorize(): Promise<never> {
    return this.unavailable();
  }

  override async execute(): Promise<never> {
    return this.unavailable();
  }

  override async verify(): Promise<never> {
    return this.unavailable();
  }
}
