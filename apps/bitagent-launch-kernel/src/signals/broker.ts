import { hashObject, opaqueId } from "../launch/canonical.js";
import { SignalKernelError } from "./errors.js";
import { computePortfolioSnapshotHash } from "./riskPolicy.js";
import type {
  AlgorithmicTradeSignal,
  SignalExecution,
  SignalExecutionBroker,
  SignalPortfolioSnapshot,
  SignalVerification,
  TradeLayerSignalSimulation
} from "./types.js";

export type ScriptedSignalBrokerOptions = {
  portfolio?: Omit<SignalPortfolioSnapshot, "snapshotHash">;
  networkFeeSats?: string;
  rejectAuthorization?: boolean;
  failExecution?: boolean;
  failVerification?: boolean;
  pendingVerification?: boolean;
};

function defaultPortfolio(): Omit<SignalPortfolioSnapshot, "snapshotHash"> {
  return {
    source: "scripted-signal-evaluation",
    observedAt: "2026-07-26T00:00:00.000Z",
    network: "testnet4",
    senderAddress: "tb1qscriptedsignalsender000000000000000000000",
    confirmedUtxos: [{
      txid: "ab".repeat(32),
      vout: 0,
      amountSats: "250000",
      scriptPubKeyHex: `0014${"11".repeat(20)}`,
      confirmations: 3
    }],
    tlbtcAvailableSats: "250000",
    tlusdAvailableAtoms: "20000000000",
    openExposureSats: "0",
    dailyDrawdownSats: "0"
  };
}

export function withPortfolioHash(
  snapshot: Omit<SignalPortfolioSnapshot, "snapshotHash">
): SignalPortfolioSnapshot {
  return { ...structuredClone(snapshot), snapshotHash: computePortfolioSnapshotHash(snapshot) };
}

export class ScriptedSignalExecutionBroker implements SignalExecutionBroker {
  private readonly executions = new Map<string, SignalExecution>();
  private portfolio: SignalPortfolioSnapshot;

  constructor(private readonly options: ScriptedSignalBrokerOptions = {}) {
    this.portfolio = withPortfolioHash(options.portfolio || defaultPortfolio());
  }

  setPortfolio(snapshot: Omit<SignalPortfolioSnapshot, "snapshotHash">) {
    this.portfolio = withPortfolioHash(snapshot);
  }

  async getPortfolioSnapshot() {
    return structuredClone(this.portfolio);
  }

  async estimateNetworkFee(_input: { signal: AlgorithmicTradeSignal; senderAddress: string }) {
    return {
      networkFeeSats: this.options.networkFeeSats || "900",
      source: "scripted-signal-evaluation"
    };
  }

  async authorize(input: {
    approval: { status: string };
    simulation: TradeLayerSignalSimulation;
  }) {
    if (this.options.rejectAuthorization) {
      throw new SignalKernelError("approval_rejected", "The wallet rejected the exact signal-order approval");
    }
    return {
      walletApprovalToken: opaqueId("signal_wallet_approval", {
        simulationHash: input.simulation.hash,
        status: input.approval.status
      })
    };
  }

  async execute(input: Parameters<SignalExecutionBroker["execute"]>[0]) {
    const existing = this.executions.get(input.simulation.hash);
    if (existing) return structuredClone(existing);
    if (this.options.failExecution) {
      throw new SignalKernelError("execution_failed", "The wallet broker did not return a submission receipt");
    }
    if (input.approval.status !== "approved"
      || !input.approval.walletApprovalToken
      || input.approval.simulationHash !== input.simulation.hash) {
      throw new SignalKernelError("approval_required", "An exact wallet approval token is required");
    }
    const execution: SignalExecution = {
      executionId: opaqueId("signal_execution", input.simulation.hash),
      simulationHash: input.simulation.hash,
      status: "submitted",
      txid: hashObject({ kind: "scripted-tradelayer-tx5", simulationHash: input.simulation.hash }),
      orderId: opaqueId("tradelayer_order", input.simulation.hash),
      submittedAt: input.now.toISOString()
    };
    this.executions.set(input.simulation.hash, execution);
    return structuredClone(execution);
  }

  async verify(input: Parameters<SignalExecutionBroker["verify"]>[0]): Promise<SignalVerification> {
    const base = {
      simulationHash: input.simulation.hash,
      checkedAt: input.now.toISOString(),
      txid: input.execution.txid,
      orderId: input.execution.orderId
    };
    if (this.options.failVerification) {
      return {
        ...base,
        status: "failed",
        evidence: { source: "scripted-signal-evaluation", reason: "forced verification failure" }
      };
    }
    if (this.options.pendingVerification) {
      return {
        ...base,
        status: "pending",
        confirmations: 0,
        evidence: { source: "scripted-signal-evaluation" }
      };
    }
    return {
      ...base,
      status: "verified",
      confirmations: 2,
      positionOrOrderState: "open",
      evidence: {
        source: "scripted-signal-evaluation",
        payloadHex: input.simulation.payloadHex,
        exactSimulationMatched: true
      }
    };
  }
}

export class UnavailableSignalExecutionBroker extends ScriptedSignalExecutionBroker {
  private unavailable(): never {
    throw new SignalKernelError(
      "wallet_state_unavailable",
      "Production committed-signal broker is not configured; wallet observation, approval, signing, and broadcast are disabled"
    );
  }

  override async getPortfolioSnapshot(): Promise<never> {
    return this.unavailable();
  }

  override async estimateNetworkFee(): Promise<never> {
    return this.unavailable();
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
