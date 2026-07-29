import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { BitcoinCliChainSource } from "../src/settlement/bitcoinCliChainSource.js";
import type { BrokerBroadcastReceipt, TestnetBrokerRequest } from "../src/broker/types.js";
import type { TradeLayerPnlEvidence } from "../src/settlement/types.js";
import { testnetAgentRuntimeDir } from "../src/config.js";
import { runLiveTestnetAgent } from "../src/live/harness.js";

async function main() {
  const simulateSettlement = process.argv.includes("--simulate-settlement");
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDirectory = path.join(testnetAgentRuntimeDir, "live-runs", runId);
  const latestDirectory = path.join(testnetAgentRuntimeDir, "live-latest");
  const receiptPath = process.env.BROKER_RECEIPT_PATH;
  const requestPath = process.env.BROKER_REQUEST_PATH;
  const pnlEvidencePath = process.env.TRADELAYER_PNL_EVIDENCE_PATH;
  const broadcastReceipt = receiptPath
    ? (JSON.parse(await fs.readFile(receiptPath, "utf8")) as BrokerBroadcastReceipt)
    : undefined;
  const brokerRequest = requestPath
    ? (JSON.parse(await fs.readFile(requestPath, "utf8")) as TestnetBrokerRequest)
    : undefined;
  const pnlEvidence = pnlEvidencePath
    ? (JSON.parse(await fs.readFile(pnlEvidencePath, "utf8")) as TradeLayerPnlEvidence)
    : undefined;
  const chainSource = broadcastReceipt && !simulateSettlement
    ? new BitcoinCliChainSource({
      bitcoinBin: process.env.BITCOIN_BIN,
      datadir: process.env.BTCTEST_DATADIR,
      wallet: process.env.BTCTEST_WALLET || "utxoref-testnet",
      rpcConnect: process.env.BTCTEST_RPC_CONNECT,
      rpcPort: process.env.BTCTEST_RPC_PORT
    })
    : undefined;
  const result = await runLiveTestnetAgent({
    runtimeDirectory: runDirectory,
    broadcastReceipt,
    brokerRequest,
    pnlEvidence,
    chainSource,
    simulatedSettlement: simulateSettlement
  });

  await fs.mkdir(latestDirectory, { recursive: true });
  await fs.writeFile(path.join(runDirectory, "summary.json"), `${JSON.stringify(result, null, 2)}\n`);
  await fs.writeFile(path.join(runDirectory, "broker-request.json"), `${JSON.stringify(result.brokerRequest, null, 2)}\n`);
  await fs.writeFile(path.join(runDirectory, "evidence.jsonl"), `${result.activities.map((row) => JSON.stringify(row)).join("\n")}\n`);
  await fs.copyFile(path.join(runDirectory, "summary.json"), path.join(latestDirectory, "summary.json"));
  await fs.copyFile(path.join(runDirectory, "broker-request.json"), path.join(latestDirectory, "broker-request.json"));
  await fs.copyFile(path.join(runDirectory, "evidence.jsonl"), path.join(latestDirectory, "evidence.jsonl"));

  console.log(JSON.stringify({
    ok: true,
    executionMode: result.executionMode,
    summary: path.join(latestDirectory, "summary.json"),
    brokerRequest: path.join(latestDirectory, "broker-request.json"),
    policyFingerprint: result.policyFingerprint,
    acceptance: result.acceptance,
    settlement: { allSettled: result.settlement.allSettled, settledPairs: result.settlement.settledPairCount },
    balances: result.ledger.balances
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
