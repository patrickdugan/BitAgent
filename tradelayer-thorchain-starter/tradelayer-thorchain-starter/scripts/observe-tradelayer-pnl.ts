import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { BrokerBroadcastReceipt } from "../src/broker/types.js";
import { canonicalHash } from "../src/survival/policy.js";
import { createTradeLayerPnlEvidence, fetchTradeLayerBalances } from "../src/settlement/tradelayerPnlObserver.js";
import type { TradeLayerBalanceRow } from "../src/settlement/types.js";

type BalanceSnapshot = {
  address: string;
  observedAt: string;
  source: string;
  rows: TradeLayerBalanceRow[];
  snapshotHash: string;
};

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
    const material = { address, observedAt: new Date().toISOString(), source: endpoint, rows };
    const snapshot: BalanceSnapshot = { ...material, snapshotHash: canonicalHash(material) };
    await writeJson(outputPath, snapshot);
    console.log(JSON.stringify({ ok: true, action, output: path.resolve(outputPath), snapshotHash: snapshot.snapshotHash }));
    return;
  }

  if (action === "evidence") {
    const beforePath = arg("before");
    const afterPath = arg("after");
    const receiptPath = arg("receipt");
    const valuationPriceUsd = Number(arg("price"));
    if (!beforePath || !afterPath || !receiptPath || !Number.isFinite(valuationPriceUsd)) {
      throw new Error("--before, --after, --receipt, and --price are required for evidence");
    }
    const before = JSON.parse(await fs.readFile(beforePath, "utf8")) as BalanceSnapshot;
    const after = JSON.parse(await fs.readFile(afterPath, "utf8")) as BalanceSnapshot;
    const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8")) as BrokerBroadcastReceipt;
    if (before.address !== after.address) throw new Error("Balance snapshots use different TradeLayer addresses");
    const feesSats = receipt.transactions.reduce((sum, transaction) => sum + BigInt(transaction.feeSats), 0n).toString();
    const evidence = createTradeLayerPnlEvidence({
      agentAddress: before.address,
      before: before.rows,
      after: after.rows,
      valuationPriceUsd,
      feesSats,
      transactionIds: receipt.transactions.map((transaction) => transaction.txid),
      observedAt: after.observedAt,
      source: after.source
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

