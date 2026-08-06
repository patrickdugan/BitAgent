import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { BrokerBroadcastReceipt } from "../src/broker/types.js";
import { canonicalHash } from "../src/survival/policy.js";
import {
  createTradeLayerBalanceSnapshot,
  createTradeLayerPnlEvidence,
  fetchTradeLayerBalances,
  verifyTradeLayerBalanceSnapshot
} from "../src/settlement/tradelayerPnlObserver.js";
import type { TradeLayerBalanceSnapshot } from "../src/settlement/types.js";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const action = arg("action") || "snapshot";
  const outputPath = arg("output");
  if (!outputPath) throw new Error("--output is required");

  if (action === "snapshot") {
    const endpoint = process.env.TRADELAYER_API_URL || "http://127.0.0.1:3000";
    const address = process.env.TRADELAYER_AGENT_ADDRESS;
    if (!address) throw new Error("TRADELAYER_AGENT_ADDRESS is required");
    const rows = await fetchTradeLayerBalances({ endpoint, address });
    const snapshot = createTradeLayerBalanceSnapshot({
      address,
      observedAt: new Date().toISOString(),
      source: endpoint,
      rows
    });
    await writeJson(outputPath, snapshot);
    console.log(JSON.stringify({ ok: true, action, output: path.resolve(outputPath), snapshotHash: snapshot.snapshotHash }));
    return;
  }

  if (action === "evidence") {
    const beforePath = arg("before");
    const afterPath = arg("after");
    const receiptPath = arg("receipt");
    const valuationPriceUsd = arg("price");
    const valuationSource = arg("price-source");
    if (!beforePath || !afterPath || !receiptPath || !valuationPriceUsd || !valuationSource) {
      throw new Error("--before, --after, --receipt, --price, and --price-source are required for evidence");
    }
    const before = JSON.parse(await fs.readFile(beforePath, "utf8")) as TradeLayerBalanceSnapshot;
    const after = JSON.parse(await fs.readFile(afterPath, "utf8")) as TradeLayerBalanceSnapshot;
    const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8")) as BrokerBroadcastReceipt;
    if (!verifyTradeLayerBalanceSnapshot(before) || !verifyTradeLayerBalanceSnapshot(after)) {
      throw new Error("Balance snapshot hash or schema is invalid");
    }
    const { receiptHash, ...receiptMaterial } = receipt;
    if (
      receipt.schema !== "tradelayer_testnet_broadcast_receipt_v1" ||
      canonicalHash(receiptMaterial) !== receiptHash
    ) {
      throw new Error("Broker broadcast receipt hash or schema is invalid");
    }
    const feesSats = receipt.transactions.reduce((sum, transaction) => sum + BigInt(transaction.feeSats), 0n).toString();
    const evidence = createTradeLayerPnlEvidence({
      beforeSnapshot: before,
      afterSnapshot: after,
      valuationPriceUsd,
      valuationSource,
      feesSats,
      transactionIds: receipt.transactions.map((transaction) => transaction.txid),
    });
    await writeJson(outputPath, evidence);
    console.log(JSON.stringify({ ok: true, action, output: path.resolve(outputPath), settledPnlSats: evidence.settledPnlSats }));
    return;
  }
  throw new Error(`Unsupported PnL observer action: ${action}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
