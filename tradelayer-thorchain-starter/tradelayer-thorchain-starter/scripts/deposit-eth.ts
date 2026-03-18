import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { getInboundAddress, getSwapQuote, fromTokenUnits, toThorchain1e8 } from "./thorchain.js";

dotenv.config();

const ROUTER_ABI = [
  "function depositWithExpiry(address payable vault, address asset, uint256 amount, string memo, uint256 expiry) external payable"
];

async function main() {
  const rpcUrl = process.env.ETH_RPC_URL || process.env.BASE_RPC_URL;
  const privateKey = process.env.PRIVATE_KEY;
  const destination = process.env.DEST_BTC_ADDRESS;
  const amountHuman = process.env.AMOUNT_IN_TOKEN_UNITS || "0.01";
  const chain = process.env.SOURCE_CHAIN || "ETH";
  const sourceAsset = process.env.SOURCE_ASSET || "ETH.ETH";
  const destAsset = process.env.DEST_ASSET || "BTC.BTC";

  if (!rpcUrl || !privateKey || !destination) throw new Error("Missing RPC/private key/destination env vars");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const amountNative = fromTokenUnits(amountHuman, 18);
  const amount1e8 = toThorchain1e8(amountHuman, 18).toString();

  const inbound = await getInboundAddress(chain);
  const quote = await getSwapQuote({
    fromAsset: sourceAsset,
    toAsset: destAsset,
    amount1e8,
    destination,
    affiliate: process.env.AFFILIATE,
    affiliateBps: process.env.AFFILIATE_BPS,
    streamingInterval: process.env.STREAMING_INTERVAL,
    streamingQuantity: process.env.STREAMING_QUANTITY
  });

  if (!inbound.router) throw new Error(`No router returned for ${chain}`);
  const router = new ethers.Contract(inbound.router, ROUTER_ABI, wallet);
  const expiry = BigInt(quote.expiry || Math.floor(Date.now() / 1000) + 3600);
  const tx = await router.depositWithExpiry(inbound.address, ethers.ZeroAddress, amountNative, quote.memo, expiry, {
    value: amountNative
  });
  console.log(`Deposit tx: ${tx.hash}`);
  await tx.wait();
  console.log("Done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
