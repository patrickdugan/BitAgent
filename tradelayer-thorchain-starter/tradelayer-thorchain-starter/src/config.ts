import path from "node:path";

const projectRoot = process.cwd();

export const runtimeDir = path.join(projectRoot, ".runtime");
export const activityFeedPath = path.join(runtimeDir, "onboarding-activity.json");
export const survivalJournalPath = path.join(runtimeDir, "financial-survival.jsonl");
export const complianceAuditPath = path.join(runtimeDir, "compliance-audit.jsonl");
export const testnetAgentRuntimeDir = path.join(runtimeDir, "testnet-agent");
export const committedSignalRuntimeDir = path.join(runtimeDir, "committed-signals");

export const externalRepos = {
  utxoRef: process.env.UTXO_REF_REPO || "C:\\projects\\UTXORef\\UTXO-Ref",
  tradelayer: process.env.TRADELAYER_JS_REPO || "C:\\projects\\tradelayer.js",
  wallet: process.env.TRADELAYER_WALLET_REPO || "C:\\projects\\TLWallet\\tradelayer-wallet",
  ark: process.env.ARK_TRADELAYER_REPO || "C:\\projects\\Ark-TradeLayer"
} as const;

export const infrastructureConfig = {
  filecoinCalibrationRpc: process.env.FILECOIN_CALIBRATION_RPC || "https://api.calibration.node.glif.io/rpc/v1",
  akashMode: process.env.AKASH_MODE || "mock",
  nearAccountId: process.env.NEAR_ACCOUNT_ID,
  nearNetwork: (process.env.NEAR_NETWORK || "mainnet") as "mainnet" | "testnet",
  nearIntentsMode: (process.env.NEAR_INTENTS_MODE || "scripted") as "scripted" | "live",
  nearIntentsJwt: process.env.NEAR_INTENTS_JWT,
  nearIntentsBaseUrl: process.env.NEAR_INTENTS_BASE_URL || "https://1click.chaindefuser.com"
} as const;

export const demoDefaults = {
  crossChainRail: (process.env.CROSS_CHAIN_RAIL || "near_intents") as "near_intents" | "thorchain",
  sourceChain: (process.env.SOURCE_CHAIN_NAME || "ethereum") as
    | "ethereum"
    | "base"
    | "arbitrum"
    | "optimism",
  sourceAsset: (process.env.SOURCE_ASSET_SYMBOL || "ETH") as "ETH" | "USDC",
  destinationChain: (process.env.DESTINATION_CHAIN_NAME || "bitcoin") as "bitcoin" | "litecoin",
  destinationAsset: process.env.DEST_ASSET || "BTC.BTC",
  walletFeedPort: Number(process.env.ONBOARDING_FEED_PORT || 8787)
};
