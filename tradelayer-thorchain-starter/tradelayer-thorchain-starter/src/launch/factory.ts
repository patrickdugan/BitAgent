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

export function createLaunchKernel(options: {
  store?: WorkflowStore;
  quoteProvider?: QuoteProvider;
  walletBroker?: WalletExecutionBroker;
  now?: () => Date;
  production?: boolean;
  scriptedBroker?: ScriptedBrokerOptions;
} = {}) {
  const production = options.production
    ?? String(process.env.BITAGENT_PRODUCTION || "false").toLowerCase() === "true";
  return new BitAgentLaunchKernel({
    store: options.store || new FileWorkflowStore(path.join(runtimeDir, "bitagent-workflows.json")),
    quoteProvider: options.quoteProvider || new ScriptedQuoteProvider(),
    walletBroker: options.walletBroker || (
      production ? new UnavailableWalletBroker() : new ScriptedWalletBroker(options.scriptedBroker)
    ),
    now: options.now
  });
}

export function createTestLaunchKernel(options: {
  now?: () => Date;
  walletBroker?: WalletExecutionBroker;
  quoteProvider?: QuoteProvider;
  store?: WorkflowStore;
} = {}) {
  return createLaunchKernel({
    store: options.store || new InMemoryWorkflowStore(),
    walletBroker: options.walletBroker || new ScriptedWalletBroker(),
    quoteProvider: options.quoteProvider || new ScriptedQuoteProvider(),
    now: options.now
  });
}
