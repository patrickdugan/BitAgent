import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { BitcoinCliBrokerRpc } from "../src/broker/bitcoinCliBrokerRpc.js";
import {
  TradeLayerActivationCandidateBroker,
  type TradeLayerActivationBrokerRequest
} from "../src/broker/tradelayerActivationCandidateBroker.js";
import { FileTradeLayerActivationCandidateStore } from "../src/broker/tradelayerActivationCandidateStore.js";
import { TradeLayerActivationExecutionBroker } from "../src/broker/tradelayerActivationExecutionBroker.js";
import { TradeLayerActivationOperator } from "../src/broker/tradelayerActivationOperator.js";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function required(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function emit(value: unknown): void {
  const encoded = JSON.stringify(value, null, 2);
  if (encoded.includes("rawPsbt") || encoded.includes("private-activation-psbt")) {
    throw new Error("Host-private activation material reached the public operator surface");
  }
  console.log(encoded);
}

async function main(): Promise<void> {
  const action = arg("action") || "status";
  const policyFingerprint = required(
    process.env.TL_ACTIVATION_POLICY_FINGERPRINT,
    "TL_ACTIVATION_POLICY_FINGERPRINT is required"
  );
  const wallet = process.env.BTCTEST_WALLET || "utxoref-testnet";
  const storePath = path.resolve(
    arg("store") || ".runtime/testnet-agent/tradelayer-activation/private-candidates.json"
  );
  const rpc = new BitcoinCliBrokerRpc({
    bitcoinBin: process.env.BITCOIN_BIN,
    datadir: process.env.BTCTEST_DATADIR,
    wallet,
    rpcConnect: process.env.BTCTEST_RPC_CONNECT,
    rpcPort: process.env.BTCTEST_RPC_PORT
  });
  const store = new FileTradeLayerActivationCandidateStore(storePath, policyFingerprint);
  const operator = new TradeLayerActivationOperator(
    new TradeLayerActivationCandidateBroker(rpc, policyFingerprint),
    new TradeLayerActivationExecutionBroker(rpc, policyFingerprint),
    store
  );

  if (action === "prepare") {
    if (process.env.TL_TESTNET_ACTIVATION_PREPARE !== "true") {
      throw new Error("TL_TESTNET_ACTIVATION_PREPARE=true is required because preparation reserves a wallet input");
    }
    const input = required(arg("input"), "--input=<activation-request.json> is required for prepare");
    const request = JSON.parse(await fs.readFile(input, "utf8")) as TradeLayerActivationBrokerRequest;
    emit(await operator.prepare(request));
    return;
  }

  if (action === "status") {
    emit(await operator.status(required(arg("approval-hash"), "--approval-hash is required for status")));
    return;
  }

  if (action === "cancel") {
    const approvalHash = required(arg("cancel"), "--cancel=<exact-approval-hash> is required for cancellation");
    emit(await operator.cancel(approvalHash));
    return;
  }

  if (action === "approve-execute") {
    if (process.env.TL_TESTNET_ACTIVATION_SUBMIT !== "true") {
      throw new Error("TL_TESTNET_ACTIVATION_SUBMIT=true is required for wallet signing and broadcast");
    }
    const approvalHash = required(arg("approve"), "--approve=<exact-approval-hash> is required for execution");
    emit(await operator.approveAndExecute(approvalHash));
    return;
  }

  if (action === "reconcile") {
    emit(await operator.reconcile(required(arg("approval-hash"), "--approval-hash is required for reconciliation")));
    return;
  }

  throw new Error(`Unsupported activation operator action: ${action}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Activation operator failed");
  process.exitCode = 1;
});
