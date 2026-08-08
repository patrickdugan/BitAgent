import "dotenv/config";
import path from "node:path";
import { BitcoinCliBrokerRpc } from "../src/broker/bitcoinCliBrokerRpc.js";
import {
  createTradeLayerAdminFundingRequest,
  FileTradeLayerAdminFundingStore,
  TradeLayerAdminFundingCandidateBroker,
  TradeLayerAdminFundingExecutionBroker,
  TradeLayerAdminFundingOperator
} from "../src/broker/tradelayerAdminFundingOperator.js";
import { TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS } from "../src/broker/tradelayerActivationCandidateBroker.js";
import type { BitcoinCoreBrokerRpc } from "../src/broker/types.js";
import { canonicalHash } from "../src/survival/policy.js";

type WalletUtxo = {
  txid?: string;
  vout?: number;
  address?: string;
  amount?: number;
  confirmations?: number;
  spendable?: boolean;
  solvable?: boolean;
  safe?: boolean;
};

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function required(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function sats(value: number): string {
  return BigInt(Math.round(value * 100_000_000)).toString();
}

function emit(value: unknown): void {
  const encoded = JSON.stringify(value, null, 2);
  if (/rawPsbt|cHNidP/i.test(encoded)) throw new Error("Host-private PSBT reached the public admin-funding surface");
  console.log(encoded);
}

function operator(
  rpc: BitcoinCoreBrokerRpc,
  policyFingerprint: string,
  storePath: string
): TradeLayerAdminFundingOperator {
  return new TradeLayerAdminFundingOperator(
    new TradeLayerAdminFundingCandidateBroker(rpc, policyFingerprint),
    new TradeLayerAdminFundingExecutionBroker(rpc, policyFingerprint),
    new FileTradeLayerAdminFundingStore(storePath, policyFingerprint)
  );
}

async function main(): Promise<void> {
  const action = arg("action") || "status";
  const wallet = process.env.BTCTEST_WALLET || "utxoref-testnet";
  const storePath = path.resolve(
    arg("store") || ".runtime/testnet-agent/tradelayer-admin-funding/private-candidates.json"
  );
  const rpc = new BitcoinCliBrokerRpc({
    bitcoinBin: process.env.BITCOIN_BIN,
    datadir: process.env.BTCTEST_DATADIR,
    wallet,
    rpcConnect: process.env.BTCTEST_RPC_CONNECT,
    rpcPort: process.env.BTCTEST_RPC_PORT
  });

  if (action === "prepare") {
    if (process.env.TL_TESTNET_ADMIN_FUNDING_PREPARE !== "true") {
      throw new Error("TL_TESTNET_ADMIN_FUNDING_PREPARE=true is required because preparation reserves one wallet input");
    }
    const feeRateSatVb = Number(arg("fee-rate-sat-vb") || "2");
    const maxFeeSats = arg("max-fee-sats") || "1000";
    const utxos = await rpc.call<WalletUtxo[]>("listunspent", 1, 9_999_999, [], false);
    const selected = [...utxos]
      .filter((item) =>
        typeof item.txid === "string" &&
        Number.isSafeInteger(item.vout) &&
        typeof item.address === "string" &&
        item.address !== TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS &&
        Number.isFinite(item.amount) &&
        BigInt(sats(Number(item.amount))) > BigInt(maxFeeSats) + 546n &&
        Number(item.confirmations) >= 1 &&
        item.spendable !== false &&
        item.solvable !== false &&
        item.safe !== false
      )
      .sort((left, right) => Number(right.amount) - Number(left.amount) || String(left.txid).localeCompare(String(right.txid)))[0];
    if (!selected?.txid || !Number.isSafeInteger(selected.vout) || !selected.address || !Number.isFinite(selected.amount)) {
      throw new Error("No confirmed safe non-admin UTXO is available to fund the protocol-admin address");
    }
    const source = {
      txid: selected.txid,
      vout: Number(selected.vout),
      address: selected.address,
      valueSats: sats(Number(selected.amount))
    };
    const policyFingerprint = canonicalHash({
      policy: "tradelayer-testnet4-admin-funding-v1",
      wallet,
      source,
      destinationAddress: TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS,
      feeRateSatVb,
      maxFeeSats,
      oneInput: true,
      oneOutput: true,
      feeSubtractedFromDestination: true,
      modelExecutionDenied: true
    });
    const request = createTradeLayerAdminFundingRequest({
      requestId: `admin-funding-${new Date().toISOString()}`,
      wallet,
      source,
      feeRateSatVb,
      maxFeeSats,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      policyFingerprint
    });
    const view = await operator(rpc, policyFingerprint, storePath).prepare(request);
    emit({ ...view, policyFingerprint, privateStore: storePath });
    return;
  }

  const policyFingerprint = required(
    process.env.TL_ADMIN_FUNDING_POLICY_FINGERPRINT,
    "TL_ADMIN_FUNDING_POLICY_FINGERPRINT is required"
  );
  const fundingOperator = operator(rpc, policyFingerprint, storePath);

  if (action === "status") {
    emit(await fundingOperator.status(required(arg("approval-hash"), "--approval-hash is required")));
    return;
  }
  if (action === "cancel") {
    emit(await fundingOperator.cancel(required(arg("cancel"), "--cancel=<exact-approval-hash> is required")));
    return;
  }
  if (action === "approve-execute") {
    if (process.env.TL_TESTNET_ADMIN_FUNDING_SUBMIT !== "true") {
      throw new Error("TL_TESTNET_ADMIN_FUNDING_SUBMIT=true is required for signing and broadcast");
    }
    emit(await fundingOperator.approveAndExecute(required(arg("approve"), "--approve=<exact-approval-hash> is required")));
    return;
  }
  if (action === "reconcile") {
    emit(await fundingOperator.reconcile(required(arg("approval-hash"), "--approval-hash is required")));
    return;
  }
  throw new Error(`Unsupported admin funding action: ${action}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "TradeLayer admin funding operator failed");
  process.exitCode = 1;
});
