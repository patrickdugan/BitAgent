import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { fromTokenUnits, getInboundAddress, getSwapQuote, toThorchain1e8 } from "./thorchain.js";

dotenv.config();

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)"
];

const ROUTER_ABI = [
  "function depositWithExpiry(address payable vault, address asset, uint256 amount, string memo, uint256 expiry) external payable"
];

async function main() {
  const rpcUrl = process.env.BASE_RPC_URL || process.env.ETH_RPC_URL;
  const privateKey = process.env.PRIVATE_KEY;
  const token = process.env.SOURCE_TOKEN_ADDRESS;
  const sourceAsset = process.env.SOURCE_ASSET || "ETH.USDC";
  const destAsset = process.env.DEST_ASSET || "BTC.BTC";
  const destination = process.env.DEST_BTC_ADDRESS;
  const amountHuman = process.env.AMOUNT_IN_TOKEN_UNITS || "1.0";
  const chain = process.env.SOURCE_CHAIN || "ETH";
  if (!rpcUrl || !privateKey || !token || !destination) {
    throw new Error("Missing RPC/private key/token/destination env vars");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const erc20 = new ethers.Contract(token, ERC20_ABI, wallet);

  const decimals = Number(await erc20.decimals());
  const amountNative = fromTokenUnits(amountHuman, decimals);
  const amount1e8 = toThorchain1e8(amountHuman, decimals).toString();

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
  if (!quote.memo) throw new Error("Quote did not return memo");

  const allowance = await erc20.allowance(wallet.address, inbound.router);
  if (allowance < amountNative) {
    const approveTx = await erc20.approve(inbound.router, amountNative);
    console.log(`Approve tx: ${approveTx.hash}`);
    await approveTx.wait();
  }

  const router = new ethers.Contract(inbound.router, ROUTER_ABI, wallet);
  const expiry = BigInt(quote.expiry || Math.floor(Date.now() / 1000) + 3600);
  const tx = await router.depositWithExpiry(inbound.address, token, amountNative, quote.memo, expiry);
  console.log(`Deposit tx: ${tx.hash}`);
  await tx.wait();
  console.log("Done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
