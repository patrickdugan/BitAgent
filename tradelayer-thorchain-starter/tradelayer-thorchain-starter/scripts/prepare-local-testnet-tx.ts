import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getUtxoRefExports } from "../src/adapters/utxoRefAdapter.js";
import { runTradeLayerTestnetMock } from "../src/adapters/tradelayerTestnetAdapter.js";
import { BitcoinCliBrokerRpc } from "../src/broker/bitcoinCliBrokerRpc.js";
import { createTestnetBrokerRequest, TestnetSignerBroker } from "../src/broker/testnetSignerBroker.js";
import type { PreparedBrokerBatch } from "../src/broker/types.js";
import type { TradeLayerTestnetArtifact } from "../src/economy/types.js";
import { defaultSurvivalPolicy } from "../src/survival/harness.js";
import { canonicalHash } from "../src/survival/policy.js";

type ChainInfo = {
  chain?: string;
  blocks?: number;
  headers?: number;
  initialblockdownload?: boolean;
  verificationprogress?: number;
  bestblockhash?: string;
};

type WalletUtxo = {
  txid?: string;
  vout?: number;
  address?: string;
  scriptPubKey?: string;
  amount?: number;
  confirmations?: number;
  spendable?: boolean;
  solvable?: boolean;
  safe?: boolean;
};

function sats(value: number): string {
  return BigInt(Math.round(value * 100_000_000)).toString();
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const wallet = process.env.BTCTEST_WALLET || "utxoref-testnet";
  const runtimeDirectory = path.resolve(".runtime", "testnet-agent", "local-testnet4");
  const rpc = new BitcoinCliBrokerRpc({
    bitcoinBin: process.env.BITCOIN_BIN,
    datadir: process.env.BTCTEST_DATADIR,
    wallet,
    rpcConnect: process.env.BTCTEST_RPC_CONNECT,
    rpcPort: process.env.BTCTEST_RPC_PORT
  });
  const chain = await rpc.call<ChainInfo>("getblockchaininfo");
  if (chain.chain !== "testnet4") throw new Error(`Expected Bitcoin testnet4, observed ${chain.chain || "unknown"}`);
  if (chain.initialblockdownload || Number(chain.blocks) < Number(chain.headers)) {
    throw new Error(`Bitcoin testnet4 node is still synchronizing (${chain.blocks}/${chain.headers})`);
  }

  const candidates = await rpc.call<WalletUtxo[]>("listunspent", 1, 9_999_999, [], false);
  const selected = [...candidates]
    .filter((utxo) =>
      typeof utxo.txid === "string" &&
      Number.isInteger(utxo.vout) &&
      typeof utxo.address === "string" &&
      typeof utxo.scriptPubKey === "string" &&
      Number.isFinite(utxo.amount) &&
      utxo.spendable !== false &&
      utxo.solvable !== false &&
      utxo.safe !== false
    )
    .sort((left, right) =>
      Number(right.amount) - Number(left.amount) ||
      String(left.txid).localeCompare(String(right.txid)) ||
      Number(left.vout) - Number(right.vout)
    )[0];
  if (!selected?.txid || !Number.isInteger(selected.vout) || !selected.address || !selected.scriptPubKey || !selected.amount) {
    throw new Error("The configured testnet4 wallet has no confirmed safe spendable UTXO");
  }

  process.env.TL_ADMIN_ADDRESS = selected.address;
  const run = await runTradeLayerTestnetMock({ runtimeDirectory });
  const firstTrade = run.artifact.steps.find((step) => step.phase === "vwap-trade" && step.txType === 5);
  if (!firstTrade?.tradePrintId || !firstTrade.side || !firstTrade.payloadHex) {
    throw new Error("TradeLayer dry-run did not produce a usable tx5 step");
  }
  const singleArtifact: TradeLayerTestnetArtifact = {
    ...run.artifact,
    adminAddress: selected.address,
    steps: [firstTrade],
    tradePrints: run.artifact.tradePrints.filter((trade) => trade.id === firstTrade.tradePrintId)
  };
  const policyFingerprint = canonicalHash({
    policy: defaultSurvivalPolicy,
    scope: {
      network: "testnet4",
      action: "tradelayer_tx5_single",
      wallet,
      senderAddress: selected.address,
      payloadHex: firstTrade.payloadHex
    }
  });
  const request = createTestnetBrokerRequest({
    artifact: singleArtifact,
    requestId: `local-testnet4-${new Date().toISOString()}`,
    wallet,
    senderAddress: selected.address,
    policyFingerprint,
    maxTotalFeeSats: process.env.TESTNET_BROKER_MAX_TOTAL_FEE_SATS || "1000",
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
  });
  const prepared = await new TestnetSignerBroker(rpc, policyFingerprint).prepare(request);
  const actualInput = prepared.preparedSteps[0]?.inputUtxos[0];
  if (actualInput?.txid !== selected.txid || actualInput.vout !== selected.vout) {
    throw new Error("Broker selected an input that differs from the deterministic preflight selection");
  }

  const fundingSet = getUtxoRefExports().v2.settlement.buildFundingSetV2([{
    txid: selected.txid,
    vout: selected.vout,
    amountSats: sats(selected.amount),
    scriptPubKeyHex: selected.scriptPubKey
  }]);
  const step = prepared.preparedSteps[0]!;
  const exactEffects = {
    network: "testnet4",
    wallet,
    senderAddress: selected.address,
    utxoRef: fundingSet.fundingRoot,
    inputUtxos: step.inputUtxos,
    opReturn: {
      txType: step.txType,
      payloadHex: step.payloadHex,
      payloadUtf8: Buffer.from(step.payloadHex, "hex").toString("utf8")
    },
    walletChangeOutputs: step.walletChangeOutputs,
    feeRateSatVb: 2,
    feeSats: step.feeSats,
    totalFeeSats: prepared.totalFeeSats,
    unsignedPsbtHash: step.unsignedPsbtHash,
    approvalHash: prepared.approvalHash,
    expiresAt: request.expiresAt
  };
  const summary = {
    schema: "bitagent_local_testnet4_simulation_v1",
    state: "awaiting_wallet_approval",
    chain,
    exactEffects,
    nextAuthority: "wallet_user",
    signingPerformed: false,
    broadcastPerformed: false
  };
  await writeJson(path.join(runtimeDirectory, "broker-request.json"), request);
  await writeJson(path.join(runtimeDirectory, "prepared-batch.json"), prepared satisfies PreparedBrokerBatch);
  await writeJson(path.join(runtimeDirectory, "simulation.json"), summary);
  console.log(JSON.stringify({
    ok: true,
    state: summary.state,
    simulation: path.join(runtimeDirectory, "simulation.json"),
    preparedBatch: path.join(runtimeDirectory, "prepared-batch.json"),
    policyFingerprint,
    exactEffects
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
