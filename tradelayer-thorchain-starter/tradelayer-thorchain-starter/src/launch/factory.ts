import path from "node:path";
import { runtimeDir } from "../config.js";
import {
  ScriptedQuoteProvider,
  ScriptedWalletBroker,
  UnavailableWalletBroker,
  type ScriptedBrokerOptions
} from "./broker.js";
import { BitAgentLaunchKernel } from "./kernel.js";
import { FileWorkflowStore, InMemoryWorkflowStore } from "./store.js";
import type { QuoteProvider, WalletExecutionBroker, WorkflowStore } from "./types.js";
import { IndependentlyVerifyingWalletBroker } from "./verifiedBroker.js";
import {
  RelayerTradeLayerOrderReadSource,
  type TradeLayerOrderReadSource
} from "../settlement/tradelayerOrderVerifier.js";
import { BitcoinCliChainSource } from "../settlement/bitcoinCliChainSource.js";
import type { BitcoinWithdrawalReadSource } from "../settlement/types.js";

function withdrawalConfirmationTarget(configured?: number): number {
  const value = configured ?? Number(process.env.BITAGENT_WITHDRAWAL_CONFIRMATIONS || "1");
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("BITAGENT_WITHDRAWAL_CONFIRMATIONS must be a positive safe integer");
  }
  return value;
}

export function createLaunchKernel(options: {
  store?: WorkflowStore;
  quoteProvider?: QuoteProvider;
  walletBroker?: WalletExecutionBroker;
  now?: () => Date;
  production?: boolean;
  scriptedBroker?: ScriptedBrokerOptions;
  tradeLayerOrderSource?: TradeLayerOrderReadSource;
  bitcoinWithdrawalSource?: BitcoinWithdrawalReadSource;
  withdrawalConfirmations?: number;
} = {}) {
  const production = options.production
    ?? String(process.env.BITAGENT_PRODUCTION || "false").toLowerCase() === "true";
  const walletBroker = options.walletBroker || (
    production ? new UnavailableWalletBroker() : new ScriptedWalletBroker(options.scriptedBroker)
  );
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
  return new BitAgentLaunchKernel({
    store: options.store || new FileWorkflowStore(path.join(runtimeDir, "bitagent-workflows.json")),
    quoteProvider: options.quoteProvider || new ScriptedQuoteProvider(),
    walletBroker: tradeLayerOrderSource || bitcoinWithdrawalSource
      ? new IndependentlyVerifyingWalletBroker(
        walletBroker,
        tradeLayerOrderSource,
        bitcoinWithdrawalSource,
        withdrawalConfirmationTarget(options.withdrawalConfirmations)
      )
      : walletBroker,
    now: options.now
  });
}

export function createTestLaunchKernel(options: {
  now?: () => Date;
  walletBroker?: WalletExecutionBroker;
  quoteProvider?: QuoteProvider;
  store?: WorkflowStore;
  tradeLayerOrderSource?: TradeLayerOrderReadSource;
  bitcoinWithdrawalSource?: BitcoinWithdrawalReadSource;
  withdrawalConfirmations?: number;
} = {}) {
  return createLaunchKernel({
    store: options.store || new InMemoryWorkflowStore(),
    walletBroker: options.walletBroker || new ScriptedWalletBroker(),
    quoteProvider: options.quoteProvider || new ScriptedQuoteProvider(),
    tradeLayerOrderSource: options.tradeLayerOrderSource,
    bitcoinWithdrawalSource: options.bitcoinWithdrawalSource,
    withdrawalConfirmations: options.withdrawalConfirmations,
    now: options.now
  });
}
