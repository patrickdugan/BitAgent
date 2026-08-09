import "dotenv/config";
import { BitcoinCliBrokerRpc } from "../src/broker/bitcoinCliBrokerRpc.js";
import { inspectTestnet4Wallet } from "../src/broker/testnet4WalletSnapshot.js";
import { TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS } from "../src/broker/tradelayerActivationCandidateBroker.js";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function trackedOutpoint(): { txid: string; vout: number } | undefined {
  const value = arg("tracked-outpoint");
  if (!value) return undefined;
  const match = /^([a-f0-9]{64}):(\d+)$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[2]))) {
    throw new Error("--tracked-outpoint must be an exact lowercase txid:vout");
  }
  return { txid: match[1]!, vout: Number(match[2]) };
}

async function main(): Promise<void> {
  const wallet = process.env.BTCTEST_WALLET || "utxoref-testnet";
  const rpc = new BitcoinCliBrokerRpc({
    bitcoinBin: process.env.BITCOIN_BIN,
    datadir: process.env.BTCTEST_DATADIR,
    wallet,
    rpcConnect: process.env.BTCTEST_RPC_CONNECT,
    rpcPort: process.env.BTCTEST_RPC_PORT,
  });
  const snapshot = await inspectTestnet4Wallet({
    rpc,
    wallet,
    protocolAdminAddress: TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS,
    trackedOutpoint: trackedOutpoint(),
  });
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Wallet inspection failed");
  process.exitCode = 1;
});
