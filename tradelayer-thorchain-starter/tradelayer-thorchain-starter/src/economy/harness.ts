import { publishActivity } from "../adapters/walletAdapter.js";
import { buildChainAbstractionEnvelope } from "../adapters/chainAbstractionAdapter.js";
import { AkashComputeAdapter, GenericComputeAdapter } from "../adapters/computeMarketAdapter.js";
import { prepareFilecoinStoragePlan, probeFilecoinCalibration } from "../adapters/filecoinAdapter.js";
import { prepareTradeLayerTestnetSubmission, runTradeLayerTestnetMock } from "../adapters/tradelayerTestnetAdapter.js";
import { infrastructureConfig, testnetAgentRuntimeDir } from "../config.js";
import { buildDemoSnapshot, defaultSurvivalPolicy } from "../survival/harness.js";
import { canonicalHash, evaluateSpendIntent } from "../survival/policy.js";
import type { SpendIntent, SurvivalRail } from "../survival/types.js";
import type { OnboardingActivity } from "../types.js";
import type {
  EconomicProjection,
  InfrastructureAuthorization,
  InfrastructurePlan,
  InfrastructureProvider,
  InfrastructureQuote,
  TradeLayerTestnetRun
} from "./types.js";

function quote(input: {
  id: string;
  provider: InfrastructureProvider;
  service: "storage" | "compute";
  mode: InfrastructureQuote["mode"];
  policyCostSats: string;
  amount: string;
  denomination: string;
  expiresAt: string;
}): InfrastructureQuote {
  const material = {
    quoteId: input.id,
    provider: input.provider,
    service: input.service,
    mode: input.mode,
    policyCostSats: input.policyCostSats,
    providerPrice: { amount: input.amount, denomination: input.denomination },
    expiresAt: input.expiresAt
  };
  return { ...material, quoteHash: canonicalHash(material) };
}

function infrastructureIntent(input: {
  quote: InfrastructureQuote;
  rail: SurvivalRail;
  asset: SpendIntent["asset"];
  now: Date;
}): SpendIntent {
  return {
    id: `infra-${input.quote.quoteId}`,
    idempotencyKey: input.quote.quoteId,
    purpose: input.quote.service,
    budget: "operations",
    rail: input.rail,
    asset: input.asset,
    amountAtoms: input.quote.providerPrice.amount,
    policyValueSats: input.quote.policyCostSats,
    destination: `market://${input.quote.provider}/${input.quote.service}`,
    maxFeeSats: "0",
    expiresAt: input.quote.expiresAt,
    policyId: defaultSurvivalPolicy.id,
    quoteHash: input.quote.quoteHash,
    sourceReceipts: []
  };
}

export function calculateEconomicProjection(input: {
  tradeRun: TradeLayerTestnetRun;
  positionSats: bigint;
  tradingFeeBps: number;
  infrastructureCostSats: bigint;
}): EconomicProjection {
  const prices = input.tradeRun.artifact.tradePrints.map((trade) => Number(trade.price));
  if (prices.some((price) => !Number.isFinite(price) || price <= 0)) {
    throw new Error("Trade artifact contains an invalid price");
  }
  const entryPrice = Math.min(...prices);
  const exitPrice = Math.max(...prices);
  const projectedGross = (input.positionSats * BigInt(exitPrice - entryPrice)) / BigInt(entryPrice);
  const projectedFees = (input.positionSats * BigInt(input.tradingFeeBps)) / 10_000n;
  const projectedRevenueAfterFees = projectedGross > projectedFees ? projectedGross - projectedFees : 0n;
  const projectedMargin = projectedRevenueAfterFees - input.infrastructureCostSats;
  const coverageBps = input.infrastructureCostSats === 0n
    ? 0
    : Number((projectedRevenueAfterFees * 10_000n) / input.infrastructureCostSats);
  const settled = input.tradeRun.settlementStatus === "settled";

  return {
    scenario: "mock_spread_capture",
    positionSats: input.positionSats.toString(),
    entryPrice,
    exitPrice,
    projectedGrossRevenueSats: projectedGross.toString(),
    projectedTradingFeesSats: projectedFees.toString(),
    projectedInfrastructureCostSats: input.infrastructureCostSats.toString(),
    projectedOperatingMarginSats: projectedMargin.toString(),
    projectedCoverageBps: coverageBps,
    projectedSelfSustaining: projectedRevenueAfterFees >= input.infrastructureCostSats,
    settledRevenueSats: settled ? projectedRevenueAfterFees.toString() : "0",
    spendableProfitSats: settled && projectedMargin > 0n ? projectedMargin.toString() : "0",
    note: "Scenario projection only. Dry-run plans, expected fills, and provider quotes are not spendable treasury evidence."
  };
}

function authorization(intent: SpendIntent, now: Date): InfrastructureAuthorization {
  return {
    intent,
    decision: evaluateSpendIntent(intent, defaultSurvivalPolicy, buildDemoSnapshot(now), now)
  };
}

function activityRows(input: {
  trade: TradeLayerTestnetRun;
  plans: InfrastructurePlan[];
  projection: EconomicProjection;
}): OnboardingActivity[] {
  return [
    {
      id: "testnet-agent:tradelayer-plan",
      phase: "testnet_trade",
      status: "success",
      label: "TradeLayer BTC testnet4 mock trade plan validated",
      meta: {
        dryRun: true,
        tradePrints: input.trade.artifact.tradePrints.length,
        settled: false,
        projectedOperatingMarginSats: input.projection.projectedOperatingMarginSats
      }
    },
    ...input.plans.map<OnboardingActivity>((plan) => ({
      id: `testnet-agent:${plan.provider}-plan`,
      phase: plan.provider === "filecoin" ? "storage_market" : "compute_market",
      status: "pending",
      label: `${plan.provider} ${plan.quote.service} order prepared for external approval`,
      meta: {
        status: plan.status,
        quoteHash: plan.quote.quoteHash,
        payloadHash: plan.payloadHash,
        submitAuthority: plan.submitAuthority
      }
    }))
  ];
}

export async function runTestnetEconomicAgent(input: {
  runtimeDirectory?: string;
  now?: Date;
  probeFilecoin?: boolean;
} = {}) {
  const now = input.now || new Date();
  const runtimeDirectory = input.runtimeDirectory || testnetAgentRuntimeDir;
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  const trade = await runTradeLayerTestnetMock({ runtimeDirectory });

  const filecoinQuote = quote({
    id: "filecoin-calibration-1gib-30d",
    provider: "filecoin",
    service: "storage",
    mode: "calibration",
    policyCostSats: "20",
    amount: "1000000000000000",
    denomination: "attoFIL",
    expiresAt
  });
  const akashQuote = quote({
    id: "akash-mock-agent-1h",
    provider: "akash",
    service: "compute",
    mode: "mock",
    policyCostSats: "80",
    amount: "100",
    denomination: "uact",
    expiresAt
  });
  const genericQuote = quote({
    id: "generic-compute-fallback-1h",
    provider: "generic",
    service: "compute",
    mode: "mock",
    policyCostSats: "90",
    amount: "90",
    denomination: "policy-sats",
    expiresAt
  });

  const filecoinPlan = prepareFilecoinStoragePlan({
    quote: filecoinQuote,
    payloadCid: "bafybeigdyrztmockagentstate",
    sizeBytes: "1073741824",
    durationEpochs: 86_400,
    clientAddress: process.env.FILECOIN_CLIENT_ADDRESS,
    providerAddress: process.env.FILECOIN_PROVIDER_ADDRESS
  });
  const workload = {
    workloadId: "bitagent-testnet",
    image: "ghcr.io/tradelayer/bitagent-testnet:0.1.0",
    command: ["npm", "run", "demo:testnet-agent"],
    resources: { cpuMillicores: 500, memoryMiB: 512, storageMiB: 1024, replicas: 1 }
  };
  const akashPlan = new AkashComputeAdapter().prepare({ quote: akashQuote, ...workload });
  const genericComputePlan = new GenericComputeAdapter().prepare({ quote: genericQuote, ...workload });
  const activePlans = [filecoinPlan, akashPlan];
  const projection = calculateEconomicProjection({
    tradeRun: trade,
    positionSats: 100_000n,
    tradingFeeBps: 5,
    infrastructureCostSats: activePlans.reduce((sum, plan) => sum + BigInt(plan.quote.policyCostSats), 0n)
  });

  const authorizations = [
    authorization(infrastructureIntent({ quote: filecoinQuote, rail: "filecoin", asset: "FIL", now }), now),
    authorization(infrastructureIntent({ quote: akashQuote, rail: "akash", asset: "ACT", now }), now),
    authorization(infrastructureIntent({ quote: genericQuote, rail: "compute_market", asset: "BTC", now }), now)
  ];
  const chainAbstraction = [
    buildChainAbstractionEnvelope({ targetChain: "filecoin", actionType: "filecoin_direct_deal", payload: filecoinPlan.payload }),
    buildChainAbstractionEnvelope({ targetChain: "akash", actionType: "akash_create_deployment", payload: akashPlan.payload })
  ];
  const activities = activityRows({ trade, plans: [filecoinPlan, akashPlan, genericComputePlan], projection });
  for (const activity of activities) await publishActivity(activity);

  return {
    schema: "testnet_economic_agent_demo_v1",
    generatedAt: now.toISOString(),
    mode: "mock_testnet",
    trade,
    projection,
    infrastructure: {
      activePlans,
      computeFallbackPlan: genericComputePlan,
      authorizations,
      filecoinProbe: input.probeFilecoin ? await probeFilecoinCalibration(infrastructureConfig.filecoinCalibrationRpc) : { skipped: true }
    },
    chainAbstraction,
    liveSubmission: prepareTradeLayerTestnetSubmission({ artifactPath: trade.artifactPath }),
    activities,
    invariants: {
      noPrivateKeysInAgent: true,
      dryRunProfitIsNotTreasury: projection.spendableProfitSats === "0",
      providerSubmissionRequiresExternalBroker: true,
      chainEnvelopesAreNonRelayable: chainAbstraction.every((envelope) => !envelope.relayable)
    },
    liveBlockers: [
      "TradeLayer fills and confirmations are not observed in dry-run mode",
      "Bitcoin testnet4 signing and broadcast require an external capability broker",
      "Filecoin requires valid CAR/CommP data, client funds, provider selection, and deal publication",
      "Akash requires account custody, bid selection, lease creation, and provider manifest delivery",
      "NEAR Chain Signature requests require exact approved transaction payloads and a configured signer account"
    ]
  };
}
