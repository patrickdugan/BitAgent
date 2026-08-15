import { hashObject } from "./canonical.js";
import { LaunchKernelError } from "./errors.js";
import type {
  BitAgentWorkflowState,
  StrategyFundingEvidence,
  StrategyFundingReadSource
} from "./types.js";

const TXID = /^[a-f0-9]{64}$/;
const OUTPOINT = /^[a-f0-9]{64}:(0|[1-9][0-9]*)$/;

function sats(value: unknown, field: string): bigint {
  const text = String(value ?? "").trim();
  if (!/^(0|[1-9][0-9]*)$/.test(text)) {
    throw new LaunchKernelError("verification_failed", `${field} must be a canonical satoshi amount`);
  }
  return BigInt(text);
}

export function strategyFundingCore(evidence: StrategyFundingEvidence) {
  const { evidenceHash: _evidenceHash, ...core } = evidence;
  return core;
}

export function verifyStrategyFundingEvidence(
  evidence: StrategyFundingEvidence,
  state: BitAgentWorkflowState,
  requestedAmountSats: string
): boolean {
  try {
    const requested = sats(requestedAmountSats, "requestedAmountSats");
    const spendable = sats(evidence.bitcoinSpendableSats, "bitcoinSpendableSats");
    const reserve = sats(evidence.reserveLockedSats, "reserveLockedSats");
    const available = sats(evidence.tlBtcAvailableSats, "tlBtcAvailableSats");
    sats(evidence.tlBtcReservedSats, "tlBtcReservedSats");
    return evidence.schema === "bitagent_strategy_funding_evidence_v1"
      && evidence.status === "verified"
      && evidence.network === state.wallet.network
      && evidence.walletSessionId === state.wallet.walletSessionId
      && evidence.source.length >= 3
      && Number.isFinite(Date.parse(evidence.observedAt))
      && Number.isSafeInteger(evidence.confirmations)
      && evidence.confirmations >= state.deposit.requiredConfirmations
      && !!evidence.reserveOutpoint && OUTPOINT.test(evidence.reserveOutpoint)
      && !!evidence.reserveManifestHash && TXID.test(evidence.reserveManifestHash)
      && !!evidence.intakeTxid && TXID.test(evidence.intakeTxid)
      && spendable >= 0n
      && reserve >= requested
      && available >= requested
      && hashObject(strategyFundingCore(evidence)) === evidence.evidenceHash;
  } catch {
    return false;
  }
}

export function assertVerifiedStrategyFunding(
  evidence: StrategyFundingEvidence,
  state: BitAgentWorkflowState,
  requestedAmountSats: string
) {
  if (!verifyStrategyFundingEvidence(evidence, state, requestedAmountSats)) {
    throw new LaunchKernelError(
      evidence.status === "pending" ? "provider_unavailable" : "verification_failed",
      evidence.reason || "Independent reserve and TradeLayer funding evidence is not verified"
    );
  }
  return evidence;
}

export class ScriptedStrategyFundingSource implements StrategyFundingReadSource {
  readonly source = "scripted-strategy-funding-evaluation";

  async observe(input: {
    state: BitAgentWorkflowState;
    requestedAmountSats: string;
    now: Date;
  }): Promise<StrategyFundingEvidence> {
    const depositAmount = sats(input.state.deposit.amountSats, "deposit.amountSats");
    const requested = sats(input.requestedAmountSats, "requestedAmountSats");
    const session = String(input.state.wallet.walletSessionId || "");
    const depositTxid = String(input.state.deposit.txid || "").toLowerCase();
    const depositVout = Number(input.state.deposit.vout);
    if (!session || !TXID.test(depositTxid) || !Number.isSafeInteger(depositVout) || depositVout < 0) {
      throw new LaunchKernelError("provider_unavailable", "Scripted funding fixture lacks a confirmed public deposit");
    }
    if (requested <= 0n || requested > depositAmount) {
      throw new LaunchKernelError("insufficient_funds", "Confirmed reserve cannot cover the requested strategy amount");
    }
    const core = {
      schema: "bitagent_strategy_funding_evidence_v1" as const,
      status: "verified" as const,
      network: input.state.wallet.network,
      walletSessionId: session,
      bitcoinSpendableSats: (depositAmount - requested).toString(),
      reserveLockedSats: requested.toString(),
      tlBtcAvailableSats: requested.toString(),
      tlBtcReservedSats: "0",
      reserveOutpoint: `${depositTxid}:${depositVout}`,
      reserveManifestHash: hashObject({ kind: "scripted-reserve-manifest", depositTxid, depositVout, requested: requested.toString() }),
      intakeTxid: hashObject({ kind: "scripted-tx11-intake", depositTxid, depositVout, requested: requested.toString() }),
      confirmations: input.state.deposit.confirmations,
      observedAt: input.now.toISOString(),
      source: this.source,
      reason: "Scripted evaluation fixture reports matching reserve and tlBTC intake"
    };
    return { ...core, evidenceHash: hashObject(core) };
  }
}

export class UnavailableStrategyFundingSource implements StrategyFundingReadSource {
  readonly source = "unavailable-strategy-funding-source";

  async observe(): Promise<StrategyFundingEvidence> {
    throw new LaunchKernelError(
      "provider_unavailable",
      "No independent UTXORef reserve and TradeLayer tlBTC funding source is configured"
    );
  }
}
