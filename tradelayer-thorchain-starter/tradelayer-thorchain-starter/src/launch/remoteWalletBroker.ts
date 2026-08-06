import { hashObject } from "./canonical.js";
import { validateBitcoinAddress } from "./bitcoin.js";
import { LaunchKernelError } from "./errors.js";
import type {
  ActionExecution,
  ActionVerification,
  BitAgentWorkflowState,
  PublicWalletConnection,
  TransactionSimulation,
  WalletApproval,
  WalletAuthorizationResult,
  WalletExecutionBroker
} from "./types.js";
import {
  OPAQUE_TOKEN_PATTERN,
  REQUIRED_WALLET_CAPABILITIES,
  RemoteWalletHttpClient,
  TXID_PATTERN,
  boundedWalletText,
  canonicalWalletSats,
  validatedReserveIntakeCandidate,
  validatedProviderBitcoinAddress,
  validatedWithdrawalCandidate,
  walletIsoTime,
  walletRequestContext
} from "./remoteWalletProtocol.js";

export class RemoteWalletExecutionBroker implements WalletExecutionBroker {
  private readonly http: RemoteWalletHttpClient;

  constructor(config: { endpoint: string; authToken: string; timeoutMs?: number }) {
    this.http = new RemoteWalletHttpClient(config);
  }

  get source(): string {
    return this.http.source;
  }

  async connect(input: Parameters<WalletExecutionBroker["connect"]>[0]): Promise<PublicWalletConnection> {
    const requestedAddress = input.publicAddress
      ? validateBitcoinAddress(input.publicAddress, input.network).address
      : undefined;
    const data = await this.http.call("/v1/wallet/connect", {
      schema: "bitagent_wallet_connect_v1",
      mode: input.mode,
      network: input.network,
      publicAddress: requestedAddress,
      requestedWalletSessionId: input.walletSessionId,
      requestedAt: input.now.toISOString()
    });
    if (data.status !== "connected" || data.network !== input.network) {
      throw new LaunchKernelError("provider_unavailable", "Wallet broker did not return the requested connected network");
    }
    const walletSessionId = boundedWalletText(data.walletSessionId, "walletSessionId");
    if (input.walletSessionId && input.walletSessionId !== walletSessionId) {
      throw new LaunchKernelError("state_conflict", "Wallet broker resumed a different public session");
    }
    const bitcoinAddress = validatedProviderBitcoinAddress(data.bitcoinAddress, input.network).address;
    if (requestedAddress) {
      if (requestedAddress !== bitcoinAddress) {
        throw new LaunchKernelError("state_conflict", "Wallet broker connected a different public address");
      }
    }
    const capabilities = Array.isArray(data.capabilities)
      ? [...new Set(data.capabilities.map(String))]
      : [];
    if (!REQUIRED_WALLET_CAPABILITIES.every((capability) => capabilities.includes(capability))) {
      throw new LaunchKernelError("provider_unavailable", "Wallet broker lacks a required BitAgent capability");
    }
    return {
      status: "connected",
      mode: input.mode,
      walletSessionId,
      bitcoinAddress,
      network: input.network,
      confirmedBalanceSats: canonicalWalletSats(data.confirmedBalanceSats, "confirmedBalanceSats"),
      capabilities: [...REQUIRED_WALLET_CAPABILITIES],
      connectedAt: walletIsoTime(data.connectedAt, "connectedAt")
    };
  }

  async getDepositAddress(input: Parameters<WalletExecutionBroker["getDepositAddress"]>[0]) {
    if (!input.wallet.walletSessionId || !input.wallet.bitcoinAddress) {
      throw new LaunchKernelError("wallet_not_connected", "A connected public wallet session is required");
    }
    const data = await this.http.call("/v1/wallet/deposit-address", {
      schema: "bitagent_wallet_deposit_address_v1",
      walletSessionId: input.wallet.walletSessionId,
      network: input.wallet.network,
      bitcoinAddress: input.wallet.bitcoinAddress
    });
    const validated = validatedProviderBitcoinAddress(data.address, input.wallet.network);
    const scriptPubKeyHex = String(data.scriptPubKeyHex || "").toLowerCase();
    if (scriptPubKeyHex !== validated.scriptPubKeyHex) {
      throw new LaunchKernelError("provider_unavailable", "Wallet broker deposit script does not match its address");
    }
    return { address: validated.address, scriptPubKeyHex };
  }

  async estimateFee(input: Parameters<WalletExecutionBroker["estimateFee"]>[0]) {
    const context = walletRequestContext(input.state);
    const amountSats = canonicalWalletSats(input.amountSats, "amountSats", "validation_error");
    const destinationAddress = input.action === "withdraw_bitcoin"
      ? validateBitcoinAddress(String(input.destinationAddress || ""), input.state.wallet.network).address
      : undefined;
    if (input.action === "fund_starter_strategy" && !input.reservePlan) {
      throw new LaunchKernelError("validation_error", "Reserve intake requires an exact deterministic plan");
    }
    const data = await this.http.call("/v1/wallet/fee-estimate", {
      schema: "bitagent_wallet_fee_estimate_v1",
      ...context,
      action: input.action,
      amountSats,
      destinationAddress,
      reservePlan: input.reservePlan
    });
    const networkFeeSats = canonicalWalletSats(data.networkFeeSats, "networkFeeSats");
    const reserveCandidate = input.action === "fund_starter_strategy"
      ? validatedReserveIntakeCandidate({
        value: data.candidate,
        plan: input.reservePlan!,
        ...context,
        walletAddress: context.bitcoinAddress,
        amountSats,
        networkFeeSats
      })
      : undefined;
    const candidate = input.action === "withdraw_bitcoin"
      ? validatedWithdrawalCandidate({
        value: data.candidate,
        ...context,
        walletAddress: context.bitcoinAddress,
        destinationAddress: destinationAddress!,
        amountSats,
        networkFeeSats
      })
      : undefined;
    if (input.action === "starter_strategy" && data.candidate !== undefined) {
      throw new LaunchKernelError("state_conflict", "Strategy order fee response cannot contain a Bitcoin candidate");
    }
    return {
      networkFeeSats,
      source: boundedWalletText(data.source, "fee source"),
      candidate,
      reserveCandidate
    };
  }

  async authorize(input: {
    approval: WalletApproval;
    simulation: TransactionSimulation;
    state: BitAgentWorkflowState;
  }): Promise<WalletAuthorizationResult> {
    const data = await this.http.call("/v1/wallet/approvals", {
      schema: "bitagent_wallet_approval_v1",
      ...walletRequestContext(input.state),
      approvalId: input.approval.id,
      walletApprovalRequestId: input.approval.walletApprovalRequestId,
      action: input.simulation.action,
      simulationHash: input.simulation.hash,
      simulation: input.simulation
    });
    const status = String(data.status || "");
    const walletApprovalRequestId = data.walletApprovalRequestId === undefined
      ? undefined
      : boundedWalletText(data.walletApprovalRequestId, "walletApprovalRequestId");
    if (input.approval.walletApprovalRequestId
      && walletApprovalRequestId !== input.approval.walletApprovalRequestId) {
      throw new LaunchKernelError("state_conflict", "Wallet broker substituted a different approval request");
    }
    if (status === "pending") {
      if (!walletApprovalRequestId) {
        throw new LaunchKernelError("provider_unavailable", "Pending wallet approval lacks a request id");
      }
      return { status, walletApprovalRequestId };
    }
    if (status === "rejected") return { status, walletApprovalRequestId };
    if (status !== "approved") {
      throw new LaunchKernelError("provider_unavailable", "Wallet broker returned an invalid approval status");
    }
    return {
      status,
      walletApprovalRequestId,
      walletApprovalToken: boundedWalletText(data.walletApprovalToken, "walletApprovalToken", OPAQUE_TOKEN_PATTERN)
    };
  }

  async execute(input: Parameters<WalletExecutionBroker["execute"]>[0]): Promise<ActionExecution> {
    if (!input.approval.walletApprovalToken || input.approval.simulationHash !== input.simulation.hash) {
      throw new LaunchKernelError("approval_required", "Exact wallet approval is required for execution");
    }
    const idempotencyKey = hashObject({
      workflowId: input.state.id,
      walletSessionId: input.state.wallet.walletSessionId,
      approvalId: input.approval.id,
      simulationHash: input.simulation.hash
    });
    const data = await this.http.call("/v1/wallet/executions", {
      schema: "bitagent_wallet_execution_v1",
      ...walletRequestContext(input.state),
      idempotencyKey,
      approvalId: input.approval.id,
      walletApprovalRequestId: input.approval.walletApprovalRequestId,
      walletApprovalToken: input.approval.walletApprovalToken,
      action: input.simulation.action,
      simulationHash: input.simulation.hash,
      simulation: input.simulation,
      requestedAt: input.now.toISOString()
    });
    const txid = String(data.txid || "").toLowerCase();
    if (data.status !== "submitted" || data.action !== input.simulation.action
      || data.simulationHash !== input.simulation.hash
      || data.idempotencyKey !== idempotencyKey
      || data.approvalId !== input.approval.id
      || data.walletApprovalRequestId !== input.approval.walletApprovalRequestId
      || !TXID_PATTERN.test(txid)) {
      throw new LaunchKernelError("execution_failed", "Wallet broker returned a mismatched execution receipt");
    }
    return {
      id: boundedWalletText(data.id, "execution id"),
      action: input.simulation.action,
      status: "submitted",
      simulationHash: input.simulation.hash,
      txid,
      orderId: data.orderId === undefined ? undefined : boundedWalletText(data.orderId, "orderId"),
      submittedAt: walletIsoTime(data.submittedAt, "submittedAt")
    };
  }

  async verify(): Promise<ActionVerification> {
    throw new LaunchKernelError(
      "provider_unavailable",
      "Remote wallet self-report cannot verify execution; configure independent TradeLayer and Bitcoin sources"
    );
  }
}
