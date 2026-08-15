import { hashObject, parseDecimal } from "../launch/canonical.js";
import { SignalKernelError } from "./errors.js";
import type {
  AlgorithmicTradeSignal,
  SignalPortfolioSnapshot,
  SignalRiskDecision,
  SignalRiskPolicy
} from "./types.js";

export function portfolioSnapshotMaterial(
  snapshot: Omit<SignalPortfolioSnapshot, "snapshotHash"> | SignalPortfolioSnapshot
) {
  const {
    observedAt: _observedAt,
    source: _source,
    snapshotHash: _snapshotHash,
    ...material
  } = snapshot as SignalPortfolioSnapshot;
  return material;
}

export function computePortfolioSnapshotHash(snapshot: Omit<SignalPortfolioSnapshot, "snapshotHash">) {
  return hashObject(portfolioSnapshotMaterial(snapshot));
}

export function notionalTlusdAtoms(signal: AlgorithmicTradeSignal) {
  const priceCents = parseDecimal(signal.limitPriceUsd, 2, "limitPriceUsd");
  return BigInt(signal.amountSats) * priceCents / 100n;
}

function atoms(value: string, field: string, errorCode: "wallet_state_unavailable" | "risk_rejected") {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value))) {
    throw new SignalKernelError(errorCode, `${field} must be an unsigned integer string`);
  }
  return BigInt(value);
}

export function evaluateSignalRisk(input: {
  signal: AlgorithmicTradeSignal;
  portfolio: SignalPortfolioSnapshot;
  networkFeeSats: string;
  policy: SignalRiskPolicy;
  now: Date;
}): SignalRiskDecision {
  if (computePortfolioSnapshotHash(input.portfolio) !== input.portfolio.snapshotHash) {
    throw new SignalKernelError("wallet_state_unavailable", "Wallet portfolio snapshot fingerprint is invalid");
  }
  const amount = atoms(input.signal.amountSats, "signal.amountSats", "risk_rejected");
  const notional = notionalTlusdAtoms(input.signal);
  const fee = atoms(input.networkFeeSats, "networkFeeSats", "wallet_state_unavailable");
  const openExposure = atoms(input.portfolio.openExposureSats, "portfolio.openExposureSats", "wallet_state_unavailable");
  const dailyDrawdown = atoms(input.portfolio.dailyDrawdownSats, "portfolio.dailyDrawdownSats", "wallet_state_unavailable");
  const tlbtcAvailable = atoms(input.portfolio.tlbtcAvailableSats, "portfolio.tlbtcAvailableSats", "wallet_state_unavailable");
  const tlusdAvailable = atoms(input.portfolio.tlusdAvailableAtoms, "portfolio.tlusdAvailableAtoms", "wallet_state_unavailable");
  const maxOrder = atoms(input.policy.maxOrderSats, "policy.maxOrderSats", "risk_rejected");
  const maxNotional = atoms(input.policy.maxNotionalTlusdAtoms, "policy.maxNotionalTlusdAtoms", "risk_rejected");
  const maxExposure = atoms(input.policy.maxOpenExposureSats, "policy.maxOpenExposureSats", "risk_rejected");
  const maxDrawdown = atoms(input.policy.maxDailyDrawdownSats, "policy.maxDailyDrawdownSats", "risk_rejected");
  const maxFee = atoms(input.policy.maxNetworkFeeSats, "policy.maxNetworkFeeSats", "risk_rejected");
  const reasons: string[] = [];
  if (input.portfolio.network !== input.policy.network) reasons.push("network_not_allowed");
  if (amount > maxOrder) reasons.push("order_size_limit");
  if (notional > maxNotional) reasons.push("notional_limit");
  if (openExposure + amount > maxExposure) {
    reasons.push("exposure_limit");
  }
  if (dailyDrawdown >= maxDrawdown) {
    reasons.push("daily_drawdown_limit");
  }
  if (fee > maxFee) reasons.push("network_fee_limit");
  if (input.signal.side === "sell_tlbtc" && tlbtcAvailable < amount) {
    reasons.push("insufficient_tlbtc");
  }
  if (input.signal.side === "buy_tlbtc" && tlusdAvailable < notional) {
    reasons.push("insufficient_tlusd");
  }

  const policyFingerprint = hashObject({
    policy: input.policy,
    portfolioSnapshotHash: input.portfolio.snapshotHash,
    signalPayloadHash: input.signal.payloadHash,
    networkFeeSats: input.networkFeeSats
  });
  return {
    passed: reasons.length === 0,
    reasonCodes: reasons,
    policyFingerprint,
    notionalTlusdAtoms: notional.toString(),
    evaluatedAt: input.now.toISOString()
  };
}
