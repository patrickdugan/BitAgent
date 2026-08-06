import { publishActivity } from "../adapters/walletAdapter.js";
import { prepareAkashBrokerOperation } from "../adapters/akashLifecycleAdapter.js";
import { createTestnetBrokerRequest } from "../broker/testnetSignerBroker.js";
import type { BrokerBroadcastReceipt, TestnetBrokerRequest } from "../broker/types.js";
import type { TradeLayerTestnetArtifact } from "../economy/types.js";
import { runTestnetEconomicAgent } from "../economy/harness.js";
import { InfrastructureLifecycle } from "../infrastructure/lifecycle.js";
import { TreasuryLedger, verifyLedger } from "../ledger/treasuryLedger.js";
import { proposeShadowMarketOrders } from "../market/agent.js";
import type { TradeLayerOrderBookSnapshot } from "../market/types.js";
import { createRecoveryManifest } from "../persistence/recoveryManifest.js";
import type { BitcoinChainSource, BitcoinTransactionEvidence } from "../settlement/types.js";
import { observeTradeLayerSettlement } from "../settlement/tradelayerSettlementObserver.js";
import {
  createTradeLayerBalanceSnapshot,
  createTradeLayerPnlEvidence,
  verifyTradeLayerPnlEvidence
} from "../settlement/tradelayerPnlObserver.js";
import type { TradeLayerPnlEvidence } from "../settlement/types.js";
import { defaultSurvivalPolicy } from "../survival/harness.js";
import { canonicalHash } from "../survival/policy.js";
import type { OnboardingActivity } from "../types.js";

type MutableTradePrint = TradeLayerTestnetArtifact["tradePrints"][number];

export function applyBroadcastReceipt(
  artifact: TradeLayerTestnetArtifact,
  receipt: BrokerBroadcastReceipt,
  request?: TestnetBrokerRequest
): TradeLayerTestnetArtifact {
  const { receiptHash, ...receiptCore } = receipt;
  if (canonicalHash(receiptCore) !== receiptHash) throw new Error("Broadcast receipt hash is invalid");
  if (request && receipt.requestHash !== request.requestHash) throw new Error("Broadcast receipt does not match the approved broker request");
  const clone = structuredClone(artifact);
  clone.dryRun = false;
  for (const transaction of receipt.transactions) {
    const step = clone.steps.find((candidate) => candidate.label === transaction.label);
    if (!step) throw new Error(`Broadcast receipt references unknown step ${transaction.label}`);
    if (typeof step.payloadHex !== "string" || step.payloadHex.toLowerCase() !== transaction.payloadHex.toLowerCase()) {
      throw new Error(`Broadcast receipt payload does not match step ${transaction.label}`);
    }
    const requestedStep = request?.steps.find((candidate) => candidate.label === transaction.label);
    if (request && (!requestedStep || requestedStep.payloadHex !== transaction.payloadHex.toLowerCase())) {
      throw new Error(`Broadcast receipt is outside approved request scope for ${transaction.label}`);
    }
    step.txid = transaction.txid;
    const print = clone.tradePrints.find((candidate) => candidate.id === transaction.tradePrintId) as MutableTradePrint | undefined;
    if (!print) throw new Error(`Broadcast receipt references unknown trade ${transaction.tradePrintId}`);
    if (transaction.side === "sell-tlbtc") print.makerTxid = transaction.txid;
    else print.takerTxid = transaction.txid;
  }
  return clone;
}

export class ReceiptBackedChainSource implements BitcoinChainSource {
  private readonly byTxid = new Map<string, string>();

  constructor(
    artifact: TradeLayerTestnetArtifact,
    private readonly state: "mempool" | "confirmed" | "reorged" = "confirmed",
    private readonly confirmations = 2
  ) {
    for (const step of artifact.steps) if (step.txid && typeof step.payloadHex === "string") this.byTxid.set(step.txid, step.payloadHex);
  }

  async observeTransaction(txid: string): Promise<BitcoinTransactionEvidence> {
    const payloadHex = this.byTxid.get(txid);
    return {
      txid,
      state: payloadHex ? this.state : "missing",
      confirmations: this.state === "reorged" ? -1 : this.state === "confirmed" ? this.confirmations : 0,
      blockHash: this.state === "confirmed" ? canonicalHash({ txid, block: "simulated-testnet4" }) : undefined,
      payloadHex,
      observedAt: new Date().toISOString(),
      source: "deterministic-receipt-fixture"
    };
  }
}

export function simulatedBroadcastReceipt(artifact: TradeLayerTestnetArtifact, requestHash: string, now: Date): BrokerBroadcastReceipt {
  const transactions = artifact.steps.flatMap<BrokerBroadcastReceipt["transactions"][number]>((candidate) => {
    const step = candidate as typeof candidate & { tradePrintId?: string; side?: string; payloadHex?: string };
    if (step.phase !== "vwap-trade" || !step.tradePrintId || !step.payloadHex) return [];
    if (step.side !== "sell-tlbtc" && step.side !== "sell-tlusd") return [];
    return [{
      label: step.label,
      tradePrintId: step.tradePrintId,
      side: step.side,
      txid: canonicalHash({ label: step.label, mode: "simulated-broadcast" }),
      feeSats: "100",
      payloadHex: step.payloadHex
    }];
  });
  const receiptCore = {
    schema: "tradelayer_testnet_broadcast_receipt_v1" as const,
    requestHash,
    approvalHash: canonicalHash({ mode: "simulated-approval" }),
    broadcastAt: now.toISOString(),
    transactions
  };
  return { ...receiptCore, receiptHash: canonicalHash(receiptCore) };
}

function orderBook(artifact: TradeLayerTestnetArtifact, now: Date): TradeLayerOrderBookSnapshot {
  const prices = artifact.tradePrints.map((trade) => Number(trade.price)).sort((left, right) => left - right);
  const material = {
    pair: "BTCUSD" as const,
    sequence: 1,
    observedAt: now.toISOString(),
    bids: [{ price: prices[0]!, sizeSats: "2000000" }],
    asks: [{ price: prices.at(-1)!, sizeSats: "2000000" }]
  };
  return { ...material, sourceHash: canonicalHash(material) };
}

export async function runLiveTestnetAgent(input: {
  runtimeDirectory: string;
  now?: Date;
  broadcastReceipt?: BrokerBroadcastReceipt;
  brokerRequest?: TestnetBrokerRequest;
  pnlEvidence?: TradeLayerPnlEvidence;
  chainSource?: BitcoinChainSource;
  simulatedSettlement?: boolean;
}) {
  const now = input.now || new Date();
  const economic = await runTestnetEconomicAgent({ runtimeDirectory: input.runtimeDirectory, now });
  const policyFingerprint = canonicalHash({
    policy: defaultSurvivalPolicy,
    scope: {
      network: "testnet4",
      action: "tradelayer_tx5_vwap_pair",
      wallet: process.env.BTCTEST_WALLET || "utxoref-testnet",
      senderAddress: economic.trade.artifact.adminAddress
    }
  });
  const brokerRequest: TestnetBrokerRequest = input.brokerRequest || createTestnetBrokerRequest({
    artifact: economic.trade.artifact,
    requestId: `live-testnet-${now.toISOString()}`,
    wallet: process.env.BTCTEST_WALLET || "utxoref-testnet",
    policyFingerprint,
    maxTotalFeeSats: process.env.TESTNET_BROKER_MAX_TOTAL_FEE_SATS || "10000",
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString()
  });
  const receipt = input.broadcastReceipt || (input.simulatedSettlement ? simulatedBroadcastReceipt(economic.trade.artifact, brokerRequest.requestHash, now) : undefined);
  const observedArtifact = receipt ? applyBroadcastReceipt(economic.trade.artifact, receipt, brokerRequest) : economic.trade.artifact;
  const chainSource = input.chainSource || (receipt ? new ReceiptBackedChainSource(observedArtifact) : new ReceiptBackedChainSource(observedArtifact, "mempool", 0));
  const settlement = await observeTradeLayerSettlement({ artifact: observedArtifact, chainSource, minimumConfirmations: 2, now });

  const ledger = new TreasuryLedger();
  const projectedTradingRevenue = (
    BigInt(economic.projection.projectedGrossRevenueSats) - BigInt(economic.projection.projectedTradingFeesSats)
  ).toString();
  const simulatedPnlEvidence = receipt && input.simulatedSettlement
    ? createTradeLayerPnlEvidence({
      beforeSnapshot: createTradeLayerBalanceSnapshot({
        address: "simulated-testnet-agent",
        observedAt: new Date(now.getTime() - 1_000).toISOString(),
        source: "deterministic-pnl-fixture",
        rows: [{ propertyId: 1, available: "1" }, { propertyId: 2, available: "0" }]
      }),
      afterSnapshot: createTradeLayerBalanceSnapshot({
        address: "simulated-testnet-agent",
        observedAt: now.toISOString(),
        source: "deterministic-pnl-fixture",
        rows: [{ propertyId: 1, available: "1.00000227" }, { propertyId: 2, available: "0" }]
      }),
      valuationPriceUsd: "65000",
      valuationSource: "deterministic-test-fixture",
      feesSats: "0",
      transactionIds: receipt.transactions.map((row) => row.txid),
    })
    : undefined;
  const pnlEvidence = input.pnlEvidence || simulatedPnlEvidence;
  const requiredTxids = receipt?.transactions.map((row) => row.txid) || [];
  const pnlVerified = Boolean(pnlEvidence && verifyTradeLayerPnlEvidence(pnlEvidence, requiredTxids));
  const recognizedRevenue = pnlVerified && pnlEvidence && BigInt(pnlEvidence.settledPnlSats) > BigInt(projectedTradingRevenue)
    ? pnlEvidence.settledPnlSats
    : projectedTradingRevenue;
  await ledger.recognizeUnrealized(recognizedRevenue, canonicalHash(economic.projection), now.toISOString());
  if (settlement.allSettled && pnlVerified && pnlEvidence) {
    const settledPnlSats = pnlEvidence.settledPnlSats;
    await ledger.settleRevenue(settledPnlSats, [
      ...settlement.pairs.map((pair) => pair.settlementEvidenceHash!).filter(Boolean),
      pnlEvidence.evidenceHash
    ], now.toISOString());
    await ledger.releaseSettled(settledPnlSats, settlement.reportHash, now.toISOString());
  }

  const book = orderBook(observedArtifact, now);
  const marketDecision = proposeShadowMarketOrders({
    book,
    risk: { inventorySats: "0", realizedPnlSats: "0", dailyDrawdownSats: "0", openExposureSats: "0" },
    config: {
      strategy: "bounded_market_making",
      quoteSizeSats: "100000",
      spreadBps: 20,
      maxInventorySats: "500000",
      maxExposureSats: "1000000",
      maxDailyDrawdownSats: "50000",
      maxSlippageBps: 50,
      repriceThresholdBps: 5
    },
    now
  });
  const akashLifecycle = new InfrastructureLifecycle("akash", "bitagent-live-testnet");
  const akashQuoteEvent = akashLifecycle.transition("quoted", economic.infrastructure.activePlans[1].quote, now.toISOString());
  const akashOperation = prepareAkashBrokerOperation({
    action: "validate_sdl",
    payload: economic.infrastructure.activePlans[1].payload,
    authorizationHash: economic.infrastructure.authorizations[1].decision.constraintsHash
  });
  const recoveryManifest = createRecoveryManifest({
    agentId: "bitagent-sovereign-01",
    version: 1,
    previousManifestHash: "0".repeat(64),
    createdAt: now.toISOString(),
    artifacts: [
      { role: "ledger", cid: "pending-filecoin-pin", sha256: canonicalHash(ledger.list()), sizeBytes: String(JSON.stringify(ledger.list()).length) },
      { role: "settlement_receipt", cid: "pending-filecoin-pin", sha256: settlement.reportHash, sizeBytes: String(JSON.stringify(settlement).length) }
    ],
    storage: { network: "filecoin-calibration", mode: "filecoin_pin_alpha", proofStatus: "pending" }
  });
  const activities: OnboardingActivity[] = [
    {
      id: "live-testnet:settlement",
      phase: "settlement",
      status: settlement.allSettled ? "success" : "pending",
      label: settlement.allSettled ? "TradeLayer maker/taker pairs settled" : "TradeLayer settlement awaiting broker and chain evidence",
      meta: { reportHash: settlement.reportHash, settledPairs: settlement.settledPairCount, totalPairs: settlement.pairs.length }
    },
    {
      id: "live-testnet:treasury",
      phase: "treasury",
      status: settlement.allSettled ? "success" : "pending",
      label: settlement.allSettled && pnlVerified ? "Settled PnL released to available treasury" : "Revenue remains unrealized pending settlement and balance-delta evidence",
      meta: { balances: ledger.balances(), ledgerValid: verifyLedger(ledger.list()), pnlVerified }
    },
    {
      id: "live-testnet:market-agent",
      phase: "market_agent",
      status: "pending",
      label: "Bounded market strategy evaluated in shadow mode",
      meta: { decision: marketDecision.decision, orderCount: marketDecision.proposedOrders.length, riskFingerprint: marketDecision.riskFingerprint }
    }
  ];
  for (const activity of activities) await publishActivity(activity);

  return {
    schema: "live_testnet_agent_demo_v1",
    generatedAt: now.toISOString(),
    executionMode: input.simulatedSettlement ? "simulated_settlement" : receipt ? "observed_receipt" : "prepare_only",
    policyFingerprint,
    brokerRequest,
    broadcastReceipt: receipt,
    settlement,
    pnlEvidence,
    pnlVerified,
    ledger: { postings: ledger.list(), balances: ledger.balances(), valid: verifyLedger(ledger.list()) },
    market: { book, decision: marketDecision },
    infrastructure: {
      intents: economic.infrastructure.authorizations,
      akashLifecycle: akashLifecycle.list(),
      akashQuoteEvent,
      akashOperation,
      filecoinPlan: economic.infrastructure.activePlans[0]
    },
    recoveryManifest,
    activities,
    acceptance: {
      fundedTestnetWallet: Boolean(receipt && !input.simulatedSettlement),
      signedTradeLayerTransactions: Boolean(receipt && !input.simulatedSettlement),
      observedConfirmationAndMatch: settlement.allSettled,
      settledPnlLedgerEntry: ledger.list().some((posting) => posting.description.includes("chain-verified revenue")),
      cappedInfrastructureIntent: economic.infrastructure.authorizations.every((row) => BigInt(row.intent.policyValueSats) <= 25_000n),
      walletVisibleEvidenceTrace: activities.length === 3
    }
  };
}
