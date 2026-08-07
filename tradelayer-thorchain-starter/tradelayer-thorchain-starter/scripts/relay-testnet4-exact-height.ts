import { promises as fs } from "node:fs";
import path from "node:path";
import { classifyTestnet4BlockSubmission } from "../src/launch/testnet4TipAlignment.js";
import {
  hasExactHeightRelayDiskReserve,
  planTestnet4ExactHeightRelay,
  validateTestnet4ExactHeightRelayConfig,
  type ExactHeightRelayObservation,
  type Testnet4ExactHeightRelayConfig
} from "../src/launch/testnet4ExactHeightRelay.js";
import { writeAtomicStatusFile } from "../src/launch/atomicStatusFile.js";

type RpcBody<T> = { result?: T; error?: { message?: string } | null };
type Side = "source" | "target";

async function rpc<T>(config: Testnet4ExactHeightRelayConfig, side: Side, method: string, params: unknown[] = []): Promise<T> {
  const cookieFile = side === "source" ? config.sourceCookieFile : config.targetCookieFile;
  const rpcUrl = side === "source" ? config.sourceRpcUrl : config.targetRpcUrl;
  const cookie = (await fs.readFile(cookieFile, "utf8")).trim();
  if (!cookie.includes(":")) throw new Error(`${side} Bitcoin RPC cookie is invalid`);
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(cookie).toString("base64")}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ jsonrpc: "1.0", id: "bitagent-exact-height-relay", method, params }),
    signal: AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  if (!response.ok || Buffer.byteLength(text, "utf8") > 10_000_000) {
    throw new Error(`${side} Bitcoin RPC ${method} failed`);
  }
  const body = JSON.parse(text) as RpcBody<T>;
  if (body.error) throw new Error(`${side} Bitcoin RPC ${method} failed: ${body.error.message || "unknown"}`);
  return body.result as T;
}

async function observe(config: Testnet4ExactHeightRelayConfig, side: Side): Promise<ExactHeightRelayObservation> {
  const [chain, network] = await Promise.all([
    rpc<{ chain: string; blocks: number; bestblockhash: string; initialblockdownload: boolean }>(
      config, side, "getblockchaininfo"
    ),
    rpc<{ networkactive: boolean; connections: number }>(config, side, "getnetworkinfo")
  ]);
  return {
    chain: chain.chain,
    blocks: chain.blocks,
    bestblockhash: chain.bestblockhash,
    initialblockdownload: chain.initialblockdownload,
    networkactive: network.networkactive,
    connections: Number(network.connections || 0)
  };
}

async function targetFreeBytes(config: Testnet4ExactHeightRelayConfig): Promise<number> {
  const stats = await fs.statfs(config.targetCookieFile);
  return Number(stats.bavail) * Number(stats.bsize);
}

async function main() {
  const config = validateTestnet4ExactHeightRelayConfig(JSON.parse(
    process.env.BITAGENT_TESTNET4_EXACT_HEIGHT_RELAY_JSON || "null"
  ));
  const outputPath = path.resolve(process.env.BITAGENT_TESTNET4_EXACT_HEIGHT_RELAY_RECEIPT
    || path.join(".runtime", "testnet-agent", "exact-height-relays", "latest.json"));
  const [sourceBefore, targetBefore] = await Promise.all([observe(config, "source"), observe(config, "target")]);
  const [sourceHashAtTargetTip, sourceHashAtExactHeight] = await Promise.all([
    rpc<string>(config, "source", "getblockhash", [targetBefore.blocks]),
    rpc<string>(config, "source", "getblockhash", [config.targetHeight])
  ]);
  const plan = planTestnet4ExactHeightRelay({
    source: sourceBefore,
    target: targetBefore,
    sourceHashAtTargetTip,
    sourceHashAtExactHeight,
    config
  });
  const blockSubmissions: Array<{ height: number; blockHash: string; result: "accepted" | "known_valid_candidate" }> = [];
  for (let height = plan.fromHeight; height <= plan.toHeight; height += 1) {
    const freeBytesBefore = await targetFreeBytes(config);
    if (!hasExactHeightRelayDiskReserve({ freeBytes: freeBytesBefore, minFreeBytes: config.minFreeBytes })) {
      throw new Error("target_disk_reserve_below_floor");
    }
    const blockHash = await rpc<string>(config, "source", "getblockhash", [height]);
    const rawBlock = await rpc<string>(config, "source", "getblock", [blockHash, 0]);
    if (!/^[0-9a-f]+$/.test(rawBlock) || rawBlock.length % 2 !== 0) {
      throw new Error(`source returned invalid raw block at ${height}`);
    }
    if (!hasExactHeightRelayDiskReserve({
      freeBytes: freeBytesBefore,
      minFreeBytes: config.minFreeBytes,
      pendingBlockBytes: rawBlock.length / 2
    })) {
      throw new Error("target_disk_reserve_insufficient_for_next_block");
    }
    const result = await rpc<null | string>(config, "target", "submitblock", [rawBlock]);
    const observed = result === "inconclusive" || result === "duplicate"
      ? await rpc<{ hash: string; height: number; confirmations: number }>(config, "target", "getblock", [blockHash, 1])
      : undefined;
    const classification = classifyTestnet4BlockSubmission({
      result,
      expectedHash: blockHash,
      expectedHeight: height,
      observed
    });
    const targetTip = await observe(config, "target");
    if (targetTip.blocks !== height || targetTip.bestblockhash !== blockHash
      || targetTip.networkactive || targetTip.connections !== 0) {
      throw new Error(`target failed exact validation at ${height}`);
    }
    const freeBytesAfter = await targetFreeBytes(config);
    if (!hasExactHeightRelayDiskReserve({ freeBytes: freeBytesAfter, minFreeBytes: config.minFreeBytes })) {
      throw new Error("target_disk_reserve_below_floor");
    }
    blockSubmissions.push({ height, blockHash, result: classification });
  }
  const [sourceAfter, targetAfter, sourceHashAfter] = await Promise.all([
    observe(config, "source"),
    observe(config, "target"),
    rpc<string>(config, "source", "getblockhash", [config.targetHeight])
  ]);
  if (sourceHashAfter !== sourceHashAtExactHeight) throw new Error("source exact-height hash changed during relay");
  if (targetAfter.blocks !== config.targetHeight || targetAfter.bestblockhash !== sourceHashAtExactHeight
    || targetAfter.networkactive || targetAfter.connections !== 0) {
    throw new Error("target did not reach the exact paused height");
  }
  const receipt = {
    schema: "bitagent_testnet4_exact_height_relay_receipt_v1",
    status: "completed",
    authority: "operator_host",
    effect: "validated_raw_block_relay_no_wallet_effect",
    createdAt: new Date().toISOString(),
    sourceRpcUrl: config.sourceRpcUrl,
    targetRpcUrl: config.targetRpcUrl,
    sourceBefore,
    targetBefore,
    plan,
    blockSubmissions,
    sourceAfter,
    targetAfter,
    minFreeBytes: config.minFreeBytes,
    targetFreeBytesAfter: await targetFreeBytes(config),
    walletEffects: false,
    approvalRequested: false,
    signingPerformed: false,
    broadcastPerformed: false
  };
  await writeAtomicStatusFile(outputPath, receipt);
  console.log(JSON.stringify({ output: outputPath, ...receipt }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
