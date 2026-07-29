import path from "node:path";
import { OneClickNearIntentsProvider } from "../src/adapters/nearIntentsAdapter.js";
import { ScriptedNearIntentsProvider } from "../src/adapters/scriptedNearIntentsProvider.js";
import { FailClosedOriginWalletBroker, ScriptedOriginWalletBroker } from "../src/crosschain/broker.js";
import { NearDepositKernel } from "../src/crosschain/kernel.js";
import { FileNearDepositStore } from "../src/crosschain/store.js";

async function main() {
  const live = process.env.NEAR_INTENTS_MODE === "live";
  const now = new Date();
  const provider = live
    ? new OneClickNearIntentsProvider({
        jwt: process.env.NEAR_INTENTS_JWT,
        baseUrl: process.env.NEAR_INTENTS_BASE_URL
      })
    : new ScriptedNearIntentsProvider("success", true);
  const kernel = new NearDepositKernel({
    provider,
    walletBroker: live ? new FailClosedOriginWalletBroker() : new ScriptedOriginWalletBroker(),
    store: new FileNearDepositStore(path.join(process.cwd(), ".runtime", "near-intents-workflows.json")),
    now: () => now
  });
  const id = process.env.NEAR_INTENTS_WORKFLOW_ID || `near-demo-${now.getTime()}`;
  await kernel.start(id, {
    sourceChain: (process.env.SOURCE_CHAIN_NAME || "base") as "ethereum" | "base" | "arbitrum" | "optimism",
    sourceAsset: (process.env.SOURCE_ASSET_SYMBOL || "USDC") as "ETH" | "USDC",
    destinationChain: (process.env.DESTINATION_CHAIN_NAME || "bitcoin") as "bitcoin" | "litecoin",
    amount: process.env.AMOUNT_IN_TOKEN_UNITS || "10",
    recipient: process.env.DEST_BTC_ADDRESS || "bc1qscriptedrecipient",
    refundTo: process.env.NEAR_INTENTS_REFUND_ADDRESS || "0x0000000000000000000000000000000000000001",
    deadline: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    slippageBps: Number(process.env.NEAR_INTENTS_SLIPPAGE_BPS || 100),
    originAssetId: process.env.NEAR_INTENTS_ORIGIN_ASSET,
    destinationAssetId: process.env.NEAR_INTENTS_DESTINATION_ASSET,
    referral: process.env.NEAR_INTENTS_REFERRAL,
    dry: false
  });
  await kernel.simulate(id);
  if (!live) {
    await kernel.requestApproval(id);
    await kernel.resolveApproval(id, "approve");
    await kernel.execute(id);
    await kernel.verify(id);
  }
  console.log(JSON.stringify(await kernel.getPublic(id), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
