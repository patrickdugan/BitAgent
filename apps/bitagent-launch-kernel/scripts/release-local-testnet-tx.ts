import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { BitcoinCliBrokerRpc } from "../src/broker/bitcoinCliBrokerRpc.js";
import { TestnetSignerBroker } from "../src/broker/testnetSignerBroker.js";
import type { BrokerCancellationReceipt, PreparedBrokerBatch } from "../src/broker/types.js";
import { defaultSurvivalPolicy } from "../src/survival/harness.js";
import { canonicalHash } from "../src/survival/policy.js";

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const runtimeDirectory = path.resolve(".runtime", "testnet-agent", "local-testnet4");
  const preparedPath = path.join(runtimeDirectory, "prepared-batch.json");
  const simulationPath = path.join(runtimeDirectory, "simulation.json");
  const receiptPath = path.join(runtimeDirectory, "cancellation-receipt.json");
  const prepared = JSON.parse(await fs.readFile(preparedPath, "utf8")) as PreparedBrokerBatch;
  const simulation = JSON.parse(await fs.readFile(simulationPath, "utf8")) as Record<string, unknown>;
  const effects = simulation.exactEffects as Record<string, unknown> | undefined;
  const wallet = process.env.BTCTEST_WALLET || "utxoref-testnet";
  if (prepared.request.wallet !== wallet) {
    throw new Error(`Prepared batch wallet ${prepared.request.wallet} does not match configured wallet ${wallet}`);
  }
  if (prepared.request.steps.length !== 1) {
    throw new Error("Local testnet cancellation requires exactly one prepared TradeLayer step");
  }
  const expectedPolicyFingerprint = canonicalHash({
    policy: defaultSurvivalPolicy,
    scope: {
      network: "testnet4",
      action: "tradelayer_tx5_single",
      wallet,
      senderAddress: prepared.request.senderAddress,
      payloadHex: prepared.request.steps[0]!.payloadHex
    }
  });
  if (prepared.request.policyFingerprint !== expectedPolicyFingerprint) {
    throw new Error("Prepared batch does not match the local testnet policy fingerprint");
  }
  const preparedInputs = prepared.preparedSteps.flatMap((step) => step.inputUtxos);
  if (
    effects?.network !== "testnet4" ||
    effects.wallet !== wallet ||
    effects.approvalHash !== prepared.approvalHash ||
    canonicalHash(effects.inputUtxos) !== canonicalHash(preparedInputs) ||
    simulation.signingPerformed !== false ||
    simulation.broadcastPerformed !== false
  ) {
    throw new Error("Simulation does not match the unsigned prepared batch; refusing to release inputs");
  }
  const rpc = new BitcoinCliBrokerRpc({
    bitcoinBin: process.env.BITCOIN_BIN,
    datadir: process.env.BTCTEST_DATADIR,
    wallet,
    rpcConnect: process.env.BTCTEST_RPC_CONNECT,
    rpcPort: process.env.BTCTEST_RPC_PORT
  });
  const broker = new TestnetSignerBroker(rpc, expectedPolicyFingerprint);
  const receipt = await broker.cancelPrepared(prepared);
  await writeJson(receiptPath, receipt satisfies BrokerCancellationReceipt);
  await writeJson(simulationPath, {
    ...simulation,
    state: receipt.status,
    signingPerformed: false,
    broadcastPerformed: false,
    inputLockReleased: receipt.inputLockReleased,
    cancellationReceiptHash: receipt.receiptHash
  });
  console.log(JSON.stringify({
    ok: true,
    state: receipt.status,
    receipt: receiptPath,
    inputOutpoints: receipt.inputOutpoints,
    inputLockReleased: receipt.inputLockReleased,
    signingPerformed: receipt.signingPerformed,
    broadcastPerformed: receipt.broadcastPerformed
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
