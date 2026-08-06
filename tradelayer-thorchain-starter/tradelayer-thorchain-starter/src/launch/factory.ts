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

export function createLaunchKernel(options: {
  store?: WorkflowStore;
  quoteProvider?: QuoteProvider;
  walletBroker?: WalletExecutionBroker;
  now?: () => Date;
  production?: boolean;
  scriptedBroker?: ScriptedBrokerOptions;
  tradeLayerOrderSource?: TradeLayerOrderReadSource;
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
  return new BitAgentLaunchKernel({
    store: options.store || new FileWorkflowStore(path.join(runtimeDir, "bitagent-workflows.json")),
    quoteProvider: options.quoteProvider || new ScriptedQuoteProvider(),
    walletBroker: tradeLayerOrderSource
      ? new IndependentlyVerifyingWalletBroker(walletBroker, tradeLayerOrderSource)
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
} = {}) {
  return createLaunchKernel({
    store: options.store || new InMemoryWorkflowStore(),
    walletBroker: options.walletBroker || new ScriptedWalletBroker(),
    quoteProvider: options.quoteProvider || new ScriptedQuoteProvider(),
    tradeLayerOrderSource: options.tradeLayerOrderSource,
    now: options.now
  });
}
