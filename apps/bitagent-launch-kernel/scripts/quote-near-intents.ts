import { OneClickNearIntentsProvider } from "../src/adapters/nearIntentsAdapter.js";

async function main() {
  const recipient = process.env.DEST_BTC_ADDRESS || process.env.DEST_LTC_ADDRESS;
  const refundTo = process.env.NEAR_INTENTS_REFUND_ADDRESS;
  if (!recipient || !refundTo) {
    throw new Error("DEST_BTC_ADDRESS/DEST_LTC_ADDRESS and NEAR_INTENTS_REFUND_ADDRESS are required");
  }
  const executable = process.argv.includes("--executable");
  const provider = new OneClickNearIntentsProvider({
    jwt: process.env.NEAR_INTENTS_JWT,
    baseUrl: process.env.NEAR_INTENTS_BASE_URL
  });
  const quote = await provider.quote({
    sourceChain: (process.env.SOURCE_CHAIN_NAME || "base") as "ethereum" | "base" | "arbitrum" | "optimism",
    sourceAsset: (process.env.SOURCE_ASSET_SYMBOL || "USDC") as "ETH" | "USDC",
    destinationChain: (process.env.DESTINATION_CHAIN_NAME || "bitcoin") as "bitcoin" | "litecoin",
    amount: process.env.AMOUNT_IN_TOKEN_UNITS || "10",
    recipient,
    refundTo,
    deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    dry: !executable,
    slippageBps: Number(process.env.NEAR_INTENTS_SLIPPAGE_BPS || 100),
    originAssetId: process.env.NEAR_INTENTS_ORIGIN_ASSET,
    destinationAssetId: process.env.NEAR_INTENTS_DESTINATION_ASSET,
    referral: process.env.NEAR_INTENTS_REFERRAL
  });
  console.log(JSON.stringify(quote, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
