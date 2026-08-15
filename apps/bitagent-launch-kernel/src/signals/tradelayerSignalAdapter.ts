import { createRequire } from "node:module";
import path from "node:path";
import { externalRepos } from "../config.js";
import { formatUnits, hashObject, opaqueId } from "../launch/canonical.js";
import { SignalKernelError } from "./errors.js";
import type {
  AlgorithmicTradeSignal,
  CanonicalSignalFunding,
  SignalRiskDecision,
  SignalRiskPolicy,
  TradeLayerSignalSimulation
} from "./types.js";

const require = createRequire(import.meta.url);
const encoder = require(path.join(externalRepos.tradelayer, "src", "txEncoder.js"));

export function buildTradeLayerSignalSimulation(input: {
  signal: AlgorithmicTradeSignal;
  funding: CanonicalSignalFunding;
  portfolioSnapshotHash: string;
  networkFeeSats: string;
  risk: SignalRiskDecision;
  policy: SignalRiskPolicy;
  now: Date;
}): TradeLayerSignalSimulation {
  if (!input.risk.passed) {
    throw new SignalKernelError("risk_rejected", `Signal failed risk policy: ${input.risk.reasonCodes.join(", ")}`);
  }
  const amountSats = BigInt(input.signal.amountSats);
  const notionalAtoms = BigInt(input.risk.notionalTlusdAtoms);
  const sell = input.signal.side === "sell_tlbtc";
  const propertyIdOffered = sell ? input.policy.offeredPropertyId : input.policy.desiredPropertyId;
  const propertyIdDesired = sell ? input.policy.desiredPropertyId : input.policy.offeredPropertyId;
  const offeredAtoms = sell ? amountSats : notionalAtoms;
  const desiredAtoms = sell ? notionalAtoms : amountSats;

  try {
    const payload = String(encoder.encodeOnChainTokenForToken({
      propertyIdOffered,
      propertyIdDesired,
      amountOffered: formatUnits(offeredAtoms, 8),
      amountExpected: formatUnits(desiredAtoms, 8),
      stop: false,
      post: true
    }));
    if (!payload.startsWith("tl5")) throw new Error("TradeLayer encoder did not return a tx5 payload");
    const effects = sell
      ? [
        { asset: "tlBTC" as const, direction: "lock" as const, amount: amountSats.toString(), unit: "sats" as const },
        { asset: "tlUSD" as const, direction: "credit" as const, amount: notionalAtoms.toString(), unit: "token_atoms" as const }
      ]
      : [
        { asset: "tlUSD" as const, direction: "lock" as const, amount: notionalAtoms.toString(), unit: "token_atoms" as const },
        { asset: "tlBTC" as const, direction: "credit" as const, amount: amountSats.toString(), unit: "sats" as const }
      ];
    const core = {
      action: "place_tradelayer_signal_order" as const,
      signalId: input.signal.signalId,
      signalPayloadHash: input.signal.payloadHash,
      codebaseDigest: input.signal.codebase.digest,
      strategyId: input.signal.strategyId,
      strategyVersion: input.signal.strategyVersion,
      market: input.signal.market,
      side: input.signal.side,
      createdAt: input.now.toISOString(),
      expiresAt: input.signal.expiresAt,
      effects: [
        ...effects,
        { asset: "BTC" as const, direction: "debit" as const, amount: input.networkFeeSats, unit: "sats" as const },
        { asset: "TLBTC/TLUSD_ORDER" as const, direction: "credit" as const, amount: "1", unit: "order" as const }
      ],
      networkFeeSats: input.networkFeeSats,
      notionalTlusdAtoms: notionalAtoms.toString(),
      payload,
      payloadHex: Buffer.from(payload, "utf8").toString("hex"),
      funding: input.funding,
      portfolioSnapshotHash: input.portfolioSnapshotHash,
      riskPolicyFingerprint: input.risk.policyFingerprint,
      warnings: [
        "This post-only limit order may remain open and does not guarantee a fill.",
        "Approval covers only this signal hash, codebase digest, UTXO funding root, payload, and fee.",
        "The algorithm proposes; the connected wallet remains the only signing authority."
      ]
    };
    return {
      id: opaqueId("signal_sim", core),
      hash: hashObject(core),
      ...core
    };
  } catch (error) {
    if (error instanceof SignalKernelError) throw error;
    throw new SignalKernelError("state_conflict", "Unable to encode the TradeLayer tx5 signal order", error);
  }
}
