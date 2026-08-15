import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { BitcoinCliBrokerRpc } from "../src/broker/bitcoinCliBrokerRpc.js";
import {
  createReserveIntakeBrokerRequest,
  ReserveIntakeCandidateBroker,
  type PreparedReserveIntakeCandidate,
  type ReserveIntakeCancellationReceipt
} from "../src/broker/reserveIntakeCandidateBroker.js";
import { buildReserveIntakePlan } from "../src/launch/reserveIntake.js";
import { canonicalHash } from "../src/survival/policy.js";

type ChainInfo = {
  chain?: string;
  blocks?: number;
  headers?: number;
  initialblockdownload?: boolean;
  bestblockhash?: string;
};

type WalletUtxo = {
  txid?: string;
  vout?: number;
  address?: string;
  amount?: number;
  spendable?: boolean;
  solvable?: boolean;
  safe?: boolean;
};

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function freshXonlyPublicKey(rpc: BitcoinCliBrokerRpc, label: string): Promise<{
  address: string;
  xonly: string;
}> {
  const address = await rpc.call<string>("getnewaddress", label, "bech32");
  const info = await rpc.call<{ pubkey?: string; ismine?: boolean; iswatchonly?: boolean }>("getaddressinfo", address);
  const publicKey = String(info.pubkey || "").toLowerCase();
  if (!info.ismine || info.iswatchonly || !/^(02|03)[a-f0-9]{64}$/.test(publicKey)) {
    throw new Error(`Bitcoin Core did not expose a spendable compressed public key for ${label}`);
  }
  return { address, xonly: publicKey.slice(2) };
}

async function main() {
  const wallet = process.env.BTCTEST_WALLET || "utxoref-testnet";
  const amountSats = BigInt(process.env.RESERVE_INTAKE_AMOUNT_SATS || "100000");
  const maxFeeSats = BigInt(process.env.RESERVE_INTAKE_MAX_FEE_SATS || "3000");
  const propertyId = Number(process.env.TESTNET_TLBTC_PROPERTY_ID || "1");
  if (amountSats <= 0n || maxFeeSats <= 0n || !Number.isSafeInteger(propertyId) || propertyId <= 0) {
    throw new Error("Reserve amount, fee cap, and candidate tlBTC property id must be positive integers");
  }
  const runtimeDirectory = path.resolve(".runtime", "testnet-agent", "reserve-intake-candidate");
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

  const minimumInputBtc = Number(amountSats + maxFeeSats + 546n) / 100_000_000;
  const selected = (await rpc.call<WalletUtxo[]>("listunspent", 1, 9_999_999, [], false))
    .filter((utxo) =>
      typeof utxo.txid === "string" && Number.isInteger(utxo.vout) && typeof utxo.address === "string" &&
      Number.isFinite(utxo.amount) && Number(utxo.amount) >= minimumInputBtc &&
      utxo.spendable !== false && utxo.solvable !== false && utxo.safe !== false
    )
    .sort((left, right) => Number(left.amount) - Number(right.amount) || String(left.txid).localeCompare(String(right.txid)))[0];
  if (!selected?.address) throw new Error("The configured testnet4 wallet has no confirmed input large enough for this reserve candidate");

  const keyNamespace = `bitagent-reserve-${Date.now()}`;
  const operator = await freshXonlyPublicKey(rpc, `${keyNamespace}-operator`);
  const guardian = await freshXonlyPublicKey(rpc, `${keyNamespace}-guardian-local-drill`);
  const recovery = await freshXonlyPublicKey(rpc, `${keyNamespace}-recovery`);
  const workflowId = `local-reserve-${new Date().toISOString()}`;
  const plan = buildReserveIntakePlan({
    workflowId,
    walletSessionId: `bitcoin-core:${wallet}`,
    walletAddress: selected.address,
    amountSats: amountSats.toString(),
    operatorXonly: operator.xonly,
    guardianXonly: guardian.xonly,
    recoveryXonly: recovery.xonly,
    propertyId
  });
  const unresolvedPreconditions = {
    tx11ActiveAtCandidateHeight: false,
    tx11CodeHashAccepted: false,
    synchronizedProceduralRegistryVerified: false,
    dynamicContractCreationVerified: false,
    dataCarrierPolicyMempoolVerified: false,
    independentGuardianAvailable: false
  };
  const policyFingerprint = canonicalHash({
    policy: "candidate-only-reserve-intake-v1",
    network: "testnet4",
    wallet,
    senderAddress: selected.address,
    planHash: plan.planHash,
    unresolvedPreconditions
  });
  const request = createReserveIntakeBrokerRequest({
    requestId: workflowId,
    wallet,
    senderAddress: selected.address,
    policyFingerprint,
    maxFeeSats: maxFeeSats.toString(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    plan
  });
  const broker = new ReserveIntakeCandidateBroker(rpc, policyFingerprint);
  let candidate: PreparedReserveIntakeCandidate | undefined;
  let cancellation: ReserveIntakeCancellationReceipt | undefined;
  try {
    candidate = await broker.prepare(request);
    await writeJson(path.join(runtimeDirectory, "broker-request.json"), request);
    await writeJson(path.join(runtimeDirectory, "prepared-candidate.json"), candidate);
  } finally {
    if (candidate) {
      cancellation = await broker.cancelPrepared(candidate);
      await writeJson(path.join(runtimeDirectory, "cancellation-receipt.json"), cancellation);
    }
  }
  if (!candidate || !cancellation) throw new Error("Reserve candidate preparation did not reach verified cancellation");

  const exactEffects = {
    inputUtxos: candidate.inputUtxos,
    reserveOutput: candidate.reserveOutput,
    tradeLayerDataOutput: candidate.dataOutput,
    walletChangeOutput: candidate.changeOutput,
    feeRateSatVb: 2,
    feeSats: candidate.feeSats,
    unsignedTxid: candidate.unsignedTxid,
    unsignedPsbtHash: candidate.unsignedPsbtHash,
    approvalHash: candidate.approvalHash
  };
  const summary = {
    schema: "bitagent_local_testnet4_reserve_candidate_v1",
    state: "cancelled_after_candidate_test",
    chain,
    exactEffects,
    publicKeyDerivation: {
      operatorAddress: operator.address,
      guardianAddress: guardian.address,
      recoveryAddress: recovery.address,
      privateKeyMaterialRead: false
    },
    unresolvedPreconditions,
    launchReady: false,
    cancellation,
    signingPerformed: false,
    broadcastPerformed: false
  };
  await writeJson(path.join(runtimeDirectory, "summary.json"), summary);
  console.log(JSON.stringify({
    ok: true,
    state: summary.state,
    summary: path.join(runtimeDirectory, "summary.json"),
    exactEffects,
    unresolvedPreconditions,
    signingPerformed: false,
    broadcastPerformed: false,
    inputLockReleased: cancellation.inputLockReleased
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
