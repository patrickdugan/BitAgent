import path from "node:path";
import { runtimeDir } from "../config.js";
import {
  ScriptedSignalExecutionBroker,
  UnavailableSignalExecutionBroker,
  type ScriptedSignalBrokerOptions
} from "./broker.js";
import { CommittedSignalKernel } from "./kernel.js";
import { FileSignalWorkflowStore, InMemorySignalWorkflowStore } from "./store.js";
import type {
  ApprovedSignalCodebase,
  SignalExecutionBroker,
  SignalRiskPolicy,
  SignalWorkflowStore
} from "./types.js";

export function buildSignalRiskPolicy(
  approvedCodebases: ApprovedSignalCodebase[],
  overrides: Partial<Omit<SignalRiskPolicy, "approvedCodebases">> = {}
): SignalRiskPolicy {
  return {
    policyId: "bitagent-committed-signal-testnet4-v1",
    network: "testnet4",
    approvedCodebases,
    approvedProducers: [],
    approvedStrategies: [{ strategyId: "committed-limit-signal-v1", strategyVersion: "1" }],
    offeredPropertyId: 1,
    desiredPropertyId: 2,
    requiredConfirmations: 2,
    maxSignalTtlSeconds: 300,
    maxSignalAgeSeconds: 120,
    maxOrderSats: "100000",
    maxNotionalTlusdAtoms: "10000000000",
    maxOpenExposureSats: "250000",
    maxDailyDrawdownSats: "50000",
    maxNetworkFeeSats: "2000",
    ...overrides
  };
}

export function signalPolicyFromEnvironment(): SignalRiskPolicy {
  const digest = String(process.env.SIGNAL_CODEBASE_DIGEST || "").toLowerCase();
  const kind = (process.env.SIGNAL_CODEBASE_KIND || "sha256_source_tree") as ApprovedSignalCodebase["kind"];
  const approvedCodebases: ApprovedSignalCodebase[] = digest ? [{
    codebaseId: process.env.SIGNAL_CODEBASE_ID || "operator-trading-algorithms",
    kind,
    digest,
    rootPath: process.env.SIGNAL_CODEBASE_REPO || "C:\\projects\\Trading Algos"
  }] : [];
  return buildSignalRiskPolicy(approvedCodebases, {
    approvedProducers: process.env.SIGNAL_PRODUCER_PUBLIC_KEY_PEM_BASE64 ? [{
      producerKeyId: process.env.SIGNAL_PRODUCER_KEY_ID || "operator-signal-producer",
      codebaseId: process.env.SIGNAL_CODEBASE_ID || "operator-trading-algorithms",
      publicKeyPem: Buffer.from(process.env.SIGNAL_PRODUCER_PUBLIC_KEY_PEM_BASE64, "base64").toString("utf8")
    }] : [],
    approvedStrategies: [{
      strategyId: process.env.SIGNAL_STRATEGY_ID || "committed-limit-signal-v1",
      strategyVersion: process.env.SIGNAL_STRATEGY_VERSION || "1"
    }],
    maxOrderSats: process.env.SIGNAL_MAX_ORDER_SATS || "100000",
    maxOpenExposureSats: process.env.SIGNAL_MAX_EXPOSURE_SATS || "250000",
    maxDailyDrawdownSats: process.env.SIGNAL_MAX_DRAWDOWN_SATS || "50000",
    maxNetworkFeeSats: process.env.SIGNAL_MAX_NETWORK_FEE_SATS || "2000"
  });
}

export function createCommittedSignalKernel(options: {
  store?: SignalWorkflowStore;
  broker?: SignalExecutionBroker;
  policy?: SignalRiskPolicy;
  now?: () => Date;
  production?: boolean;
  scriptedBroker?: ScriptedSignalBrokerOptions;
} = {}) {
  const production = options.production
    ?? String(process.env.BITAGENT_PRODUCTION || "false").toLowerCase() === "true";
  return new CommittedSignalKernel({
    store: options.store || new FileSignalWorkflowStore(path.join(runtimeDir, "committed-signal-workflows.json")),
    broker: options.broker || (
      production ? new UnavailableSignalExecutionBroker() : new ScriptedSignalExecutionBroker(options.scriptedBroker)
    ),
    policy: options.policy || signalPolicyFromEnvironment(),
    now: options.now
  });
}

export function createTestCommittedSignalKernel(options: {
  policy: SignalRiskPolicy;
  broker?: SignalExecutionBroker;
  store?: SignalWorkflowStore;
  now?: () => Date;
}) {
  return createCommittedSignalKernel({
    policy: options.policy,
    broker: options.broker || new ScriptedSignalExecutionBroker(),
    store: options.store || new InMemorySignalWorkflowStore(),
    now: options.now,
    production: false
  });
}
