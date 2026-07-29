import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { BitcoinCliBrokerRpc } from "../src/broker/bitcoinCliBrokerRpc.js";
import { TestnetSignerBroker } from "../src/broker/testnetSignerBroker.js";
import type { PreparedBrokerBatch, TestnetBrokerRequest } from "../src/broker/types.js";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const action = arg("action") || "prepare";
  const inputPath = arg("input");
  const outputPath = arg("output");
  const policyFingerprint = process.env.TESTNET_BROKER_POLICY_FINGERPRINT;
  if (!inputPath || !outputPath || !policyFingerprint) {
    throw new Error("--input, --output, and TESTNET_BROKER_POLICY_FINGERPRINT are required");
  }
  const wallet = process.env.BTCTEST_WALLET || "utxoref-testnet";
  const rpc = new BitcoinCliBrokerRpc({
    bitcoinBin: process.env.BITCOIN_BIN,
    datadir: process.env.BTCTEST_DATADIR,
    wallet,
    rpcConnect: process.env.BTCTEST_RPC_CONNECT,
    rpcPort: process.env.BTCTEST_RPC_PORT
  });
  const broker = new TestnetSignerBroker(rpc, policyFingerprint);

  if (action === "prepare") {
    const request = JSON.parse(await fs.readFile(inputPath, "utf8")) as TestnetBrokerRequest;
    const prepared = await broker.prepare(request);
    await writeJson(outputPath, prepared);
    console.log(JSON.stringify({ ok: true, action, output: path.resolve(outputPath), approvalHash: prepared.approvalHash }));
    return;
  }
  if (action === "broadcast") {
    if (process.env.TL_TESTNET_SUBMIT !== "true") throw new Error("TL_TESTNET_SUBMIT=true is required for broadcast");
    const approvalHash = process.env.TESTNET_BROKER_APPROVAL_HASH;
    if (!approvalHash) throw new Error("TESTNET_BROKER_APPROVAL_HASH is required for broadcast");
    const prepared = JSON.parse(await fs.readFile(inputPath, "utf8")) as PreparedBrokerBatch;
    const receipt = await broker.signAndBroadcast({ prepared, approvalHash });
    await writeJson(outputPath, receipt);
    console.log(JSON.stringify({ ok: true, action, output: path.resolve(outputPath), txids: receipt.transactions.map((row) => row.txid) }));
    return;
  }
  throw new Error(`Unsupported broker action: ${action}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
