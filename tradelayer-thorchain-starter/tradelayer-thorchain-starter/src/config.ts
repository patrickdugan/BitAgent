import path from "node:path";

const projectRoot = process.cwd();

export const runtimeDir = path.join(projectRoot, ".runtime");
export const activityFeedPath = path.join(runtimeDir, "onboarding-activity.json");

export const externalRepos = {
  utxoRef: process.env.UTXO_REF_REPO || "C:\\projects\\UTXORef\\UTXO-Ref",
  tradelayer: process.env.TRADELAYER_JS_REPO || "C:\\projects\\tradelayer.js",
  wallet: process.env.TRADELAYER_WALLET_REPO || "C:\\projects\\TLWallet\\tradelayer-wallet",
  ark: process.env.ARK_TRADELAYER_REPO || "C:\\projects\\Ark-TradeLayer"
} as const;

export const demoDefaults = {
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
