import * as dotenv from "dotenv";
import { getInboundAddress, getSwapQuote, toThorchain1e8 } from "./thorchain.js";

dotenv.config();

async function main() {
  const sourceAsset = process.env.SOURCE_ASSET || "ETH.USDC";
  const destAsset = process.env.DEST_ASSET || "BTC.BTC";
  const destination = process.env.DEST_BTC_ADDRESS;
  const amountHuman = process.env.AMOUNT_IN_TOKEN_UNITS || "1.0";
  const affiliate = process.env.AFFILIATE || "";
  const affiliateBps = process.env.AFFILIATE_BPS || "0";
  const chain = process.env.SOURCE_CHAIN || "ETH";

  if (!destination) throw new Error("DEST_BTC_ADDRESS is required");

  const decimals = sourceAsset.includes("USDC") ? 6 : 18;
  const amount1e8 = toThorchain1e8(amountHuman, decimals).toString();
  const inbound = await getInboundAddress(chain);
  const quote = await getSwapQuote({
    fromAsset: sourceAsset,
    toAsset: destAsset,
    amount1e8,
    destination,
    affiliate,
    affiliateBps,
    streamingInterval: process.env.STREAMING_INTERVAL,
    streamingQuantity: process.env.STREAMING_QUANTITY
  });

  console.log(JSON.stringify({ inbound, quote }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
