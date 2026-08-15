import path from "node:path";
import { runtimeDir } from "../config.js";
import {
  ScriptedQuoteProvider,
  ScriptedWalletBroker,
  UnavailableWalletBroker,
  type ScriptedBrokerOptions
} from "./broker.js";
import { BitAgentLaunchKernel } from "./kernel.js";
import {
  ScriptedStrategyFundingSource,
  UnavailableStrategyFundingSource
} from "./strategyFunding.js";
import { FileWorkflowStore, InMemoryWorkflowStore } from "./store.js";
import type {
  QuoteProvider,
  StrategyFundingReadSource,
  WalletExecutionBroker,
  WorkflowStore
} from "./types.js";
import { IndependentlyVerifyingWalletBroker } from "./verifiedBroker.js";
import { RemoteWalletExecutionBroker } from "./remoteWalletBroker.js";
import {
  RelayerTradeLayerOrderReadSource,
  type TradeLayerOrderReadSource
} from "../settlement/tradelayerOrderVerifier.js";
import { BitcoinCliChainSource } from "../settlement/bitcoinCliChainSource.js";
import type { BitcoinWithdrawalReadSource } from "../settlement/types.js";
import { ReferralLinkService, referralSigningKeyFromEnvironment } from "../referral/links.js";
import { FileComplianceAuditLog } from "../compliance/audit.js";
import {
  ComplianceGatedWalletBroker,
  type WalletComplianceAuthority
} from "../compliance/walletGate.js";

export type ReserveIntakeConfiguration = {
  operatorXonly: string;
  guardianXonly: string;
  recoveryXonly?: string;
  recoveryCsvDelay?: number;
  propertyId?: number;
};

function configuredReserveIntake(
  provided?: ReserveIntakeConfiguration
): ReserveIntakeConfiguration | undefined {
  if (provided) return provided;
  const operatorXonly = String(process.env.BITAGENT_RESERVE_OPERATOR_XONLY || "").trim().toLowerCase();
  const guardianXonly = String(process.env.BITAGENT_RESERVE_GUARDIAN_XONLY || "").trim().toLowerCase();
  const recoveryXonly = String(process.env.BITAGENT_RESERVE_RECOVERY_XONLY || "").trim().toLowerCase();
  const delayText = String(process.env.BITAGENT_RESERVE_RECOVERY_CSV_DELAY || "").trim();
  const propertyText = String(process.env.BITAGENT_RESERVE_PROPERTY_ID || "").trim();
  const anyConfigured = Boolean(
    operatorXonly || guardianXonly || recoveryXonly || delayText || propertyText
  );
  if (!anyConfigured) return undefined;
  if (!/^[a-f0-9]{64}$/.test(operatorXonly) || !/^[a-f0-9]{64}$/.test(guardianXonly)
    || (recoveryXonly && !/^[a-f0-9]{64}$/.test(recoveryXonly))) {
    throw new Error(
      "BITAGENT_RESERVE_OPERATOR_XONLY and BITAGENT_RESERVE_GUARDIAN_XONLY must be configured together as 32-byte public x-only keys"
    );
  }
  const recoveryCsvDelay = delayText ? Number(delayText) : undefined;
  const propertyId = propertyText ? Number(propertyText) : undefined;
  if (recoveryCsvDelay !== undefined
    && (!Number.isSafeInteger(recoveryCsvDelay) || recoveryCsvDelay < 1 || recoveryCsvDelay > 65_535)) {
    throw new Error("BITAGENT_RESERVE_RECOVERY_CSV_DELAY must be an integer from 1 through 65535");
  }
  if (propertyId !== undefined && (!Number.isSafeInteger(propertyId) || propertyId < 1)) {
    throw new Error("BITAGENT_RESERVE_PROPERTY_ID must be a positive safe integer");
  }
  return {
    operatorXonly,
    guardianXonly,
    recoveryXonly: recoveryXonly || undefined,
    recoveryCsvDelay,
    propertyId
  };
}

function withdrawalConfirmationTarget(configured?: number): number {
  const value = configured ?? Number(process.env.BITAGENT_WITHDRAWAL_CONFIRMATIONS || "1");
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("BITAGENT_WITHDRAWAL_CONFIRMATIONS must be a positive safe integer");
  }
  return value;
}

export function createScriptedReferralLinkService() {
  return new ReferralLinkService(Buffer.alloc(32, 0x52), "https://bitagent.local");
}

function configuredReferralLinkService(input: {
  production: boolean;
  provided?: ReferralLinkService;
}) {
  if (input.provided) return input.provided;
  if (!process.env.BITAGENT_REFERRAL_SIGNING_KEY) {
    return input.production ? undefined : createScriptedReferralLinkService();
  }
  return new ReferralLinkService(
    referralSigningKeyFromEnvironment(),
    process.env.BITAGENT_REFERRAL_BASE_URL || "https://bitagent.local"
  );
}

function configuredWalletBroker(input: {
  production: boolean;
  provided?: WalletExecutionBroker;
  scripted?: ScriptedBrokerOptions;
}): WalletExecutionBroker {
  if (input.provided) return input.provided;
  if (!input.production) return new ScriptedWalletBroker(input.scripted);
  const endpoint = String(process.env.BITAGENT_WALLET_BROKER_URL || "").trim();
  const authToken = String(process.env.BITAGENT_WALLET_BROKER_TOKEN || "").trim();
  if (endpoint || authToken) {
    if (!endpoint || !authToken) {
      throw new Error("BITAGENT_WALLET_BROKER_URL and BITAGENT_WALLET_BROKER_TOKEN must be configured together");
    }
    return new RemoteWalletExecutionBroker({
      endpoint,
      authToken,
      timeoutMs: Number(process.env.BITAGENT_WALLET_BROKER_TIMEOUT_MS || "10000")
    });
  }
  return new UnavailableWalletBroker();
}

export function createLaunchKernel(options: {
  store?: WorkflowStore;
  quoteProvider?: QuoteProvider;
  walletBroker?: WalletExecutionBroker;
  now?: () => Date;
  production?: boolean;
  scriptedBroker?: ScriptedBrokerOptions;
  strategyFundingSource?: StrategyFundingReadSource;
  tradeLayerOrderSource?: TradeLayerOrderReadSource;
  bitcoinWithdrawalSource?: BitcoinWithdrawalReadSource;
  withdrawalConfirmations?: number;
  reserveIntake?: ReserveIntakeConfiguration;
  referralLinkService?: ReferralLinkService;
  walletComplianceAuthority?: WalletComplianceAuthority;
} = {}) {
  const production = options.production
    ?? String(process.env.BITAGENT_PRODUCTION || "false").toLowerCase() === "true";
  const rawWalletBroker = configuredWalletBroker({
    production,
    provided: options.walletBroker,
    scripted: options.scriptedBroker
  });
  const strategyFundingSource = options.strategyFundingSource || (
    production ? new UnavailableStrategyFundingSource() : new ScriptedStrategyFundingSource()
  );
  const reserveIntake = configuredReserveIntake(options.reserveIntake);
  const tradeLayerOrderSource = options.tradeLayerOrderSource || (
    production && process.env.TRADELAYER_RELAYER_URL
      ? new RelayerTradeLayerOrderReadSource(process.env.TRADELAYER_RELAYER_URL)
      : undefined
  );
  const bitcoinWithdrawalSource = options.bitcoinWithdrawalSource || (
    production && String(process.env.BITAGENT_BITCOIN_WITHDRAWAL_VERIFY || "false").toLowerCase() === "true"
      ? new BitcoinCliChainSource({
        bitcoinBin: process.env.BITCOIN_BIN,
        datadir: process.env.BTCTEST_DATADIR,
        wallet: process.env.BTCTEST_WALLET || "utxoref-testnet",
        rpcConnect: process.env.BTCTEST_RPC_CONNECT,
        rpcPort: process.env.BTCTEST_RPC_PORT,
        sourceId: "bitcoin-core-testnet4-withdrawal"
      })
      : undefined
  );
  if (production && rawWalletBroker instanceof RemoteWalletExecutionBroker
    && (!tradeLayerOrderSource || !bitcoinWithdrawalSource || !options.strategyFundingSource)) {
    throw new Error(
      "Remote production wallet execution requires independent strategy funding, TradeLayer order, and Bitcoin withdrawal sources"
    );
  }
  if (production && rawWalletBroker instanceof RemoteWalletExecutionBroker
    && !options.walletComplianceAuthority) {
    throw new Error("Remote production wallet execution requires a fresh compliance authority");
  }
  const walletBroker = options.walletComplianceAuthority
    ? new ComplianceGatedWalletBroker(
      rawWalletBroker,
      options.walletComplianceAuthority,
      new FileComplianceAuditLog(),
      options.now
    )
    : rawWalletBroker;
  return new BitAgentLaunchKernel({
    store: options.store || new FileWorkflowStore(path.join(runtimeDir, "bitagent-workflows.json")),
    quoteProvider: options.quoteProvider || new ScriptedQuoteProvider(),
    strategyFundingSource,
    walletBroker: tradeLayerOrderSource || bitcoinWithdrawalSource || reserveIntake
      ? new IndependentlyVerifyingWalletBroker(
        walletBroker,
        strategyFundingSource,
        tradeLayerOrderSource,
        bitcoinWithdrawalSource,
        withdrawalConfirmationTarget(options.withdrawalConfirmations)
      )
      : walletBroker,
    now: options.now,
    reserveIntake,
    referralLinkService: configuredReferralLinkService({
      production,
      provided: options.referralLinkService
    })
  });
}

export function createTestLaunchKernel(options: {
  now?: () => Date;
  walletBroker?: WalletExecutionBroker;
  quoteProvider?: QuoteProvider;
  strategyFundingSource?: StrategyFundingReadSource;
  store?: WorkflowStore;
  tradeLayerOrderSource?: TradeLayerOrderReadSource;
  bitcoinWithdrawalSource?: BitcoinWithdrawalReadSource;
  withdrawalConfirmations?: number;
  reserveIntake?: ReserveIntakeConfiguration;
  referralLinkService?: ReferralLinkService;
  walletComplianceAuthority?: WalletComplianceAuthority;
} = {}) {
  return createLaunchKernel({
    store: options.store || new InMemoryWorkflowStore(),
    walletBroker: options.walletBroker || new ScriptedWalletBroker(),
    quoteProvider: options.quoteProvider || new ScriptedQuoteProvider(),
    strategyFundingSource: options.strategyFundingSource || new ScriptedStrategyFundingSource(),
    tradeLayerOrderSource: options.tradeLayerOrderSource,
    bitcoinWithdrawalSource: options.bitcoinWithdrawalSource,
    withdrawalConfirmations: options.withdrawalConfirmations,
    reserveIntake: options.reserveIntake,
    referralLinkService: options.referralLinkService || createScriptedReferralLinkService(),
    walletComplianceAuthority: options.walletComplianceAuthority,
    now: options.now
  });
}
