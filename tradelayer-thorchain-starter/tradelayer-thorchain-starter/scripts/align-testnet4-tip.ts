import { promises as fs } from "node:fs";
import path from "node:path";
import {
  planTestnet4TipAlignment,
  validateTestnet4TipAlignmentConfig,
  type BitcoinTipAlignmentObservation,
  type Testnet4TipAlignmentConfig
} from "../src/launch/testnet4TipAlignment.js";

type RpcBody<T> = { result?: T; error?: { message?: string } | null };
type Side = "source" | "target";

async function rpc<T>(config: Testnet4TipAlignmentConfig, side: Side, method: string, params: unknown[] = []): Promise<T> {
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
    body: JSON.stringify({ jsonrpc: "1.0", id: "bitagent-tip-alignment", method, params }),
    signal: AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  if (!response.ok || Buffer.byteLength(text, "utf8") > 10_000_000) throw new Error(`${side} Bitcoin RPC ${method} failed`);
  const body = JSON.parse(text) as RpcBody<T>;
  if (body.error) throw new Error(`${side} Bitcoin RPC ${method} failed: ${body.error.message || "unknown"}`);
  return body.result as T;
}

async function observe(config: Testnet4TipAlignmentConfig, side: Side): Promise<BitcoinTipAlignmentObservation> {
  const [chain, network] = await Promise.all([
    rpc<{ chain: string; blocks: number; bestblockhash: string }>(config, side, "getblockchaininfo"),
    rpc<{ networkactive: boolean; connections: number }>(config, side, "getnetworkinfo")
  ]);
  return {
    chain: chain.chain,
    blocks: chain.blocks,
    bestblockhash: chain.bestblockhash,
    networkactive: network.networkactive,
    connections: Number(network.connections || 0)
  };
}

async function writeReceipt(outputPath: string, value: unknown) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, outputPath);
}

async function main() {
  const config = validateTestnet4TipAlignmentConfig(JSON.parse(process.env.BITAGENT_TESTNET4_TIP_ALIGNMENT_JSON || "null"));
  const outputPath = path.resolve(process.env.BITAGENT_TESTNET4_TIP_ALIGNMENT_RECEIPT
    || path.join(".runtime", "testnet-agent", "tip-alignments", "latest.json"));
  const [sourceBefore, targetBefore] = await Promise.all([observe(config, "source"), observe(config, "target")]);
  const sourceHashAtTargetHeight = await rpc<string>(config, "source", "getblockhash", [targetBefore.blocks]);
  const plan = planTestnet4TipAlignment({
    source: sourceBefore,
    target: targetBefore,
    sourceHashAtTargetHeight,
    maxBlocks: config.maxBlocks
  });
  const blockHashes: string[] = [];
  for (let height = plan.fromHeight; height <= plan.toHeight; height += 1) {
    const blockHash = await rpc<string>(config, "source", "getblockhash", [height]);
    const rawBlock = await rpc<string>(config, "source", "getblock", [blockHash, 0]);
    if (!/^[0-9a-f]+$/.test(rawBlock) || rawBlock.length % 2 !== 0) throw new Error(`source returned invalid raw block at ${height}`);
    const result = await rpc<null | string>(config, "target", "submitblock", [rawBlock]);
    if (result !== null) throw new Error(`target rejected block ${height}: ${String(result)}`);
    blockHashes.push(blockHash);
  }
  const [sourceAfter, targetAfter] = await Promise.all([observe(config, "source"), observe(config, "target")]);
  if (JSON.stringify(sourceAfter) !== JSON.stringify(sourceBefore)) throw new Error("source tip or network state changed during alignment");
  if (targetAfter.blocks !== sourceAfter.blocks || targetAfter.bestblockhash !== sourceAfter.bestblockhash
    || targetAfter.networkactive || targetAfter.connections !== 0) {
    throw new Error("target did not independently validate the exact paused source tip");
  }
  const receipt = {
    schema: "bitagent_testnet4_tip_alignment_receipt_v1",
    status: "completed",
    authority: "operator_host",
    effect: "validated_raw_block_relay_no_wallet_effect",
    createdAt: new Date().toISOString(),
    sourceRpcUrl: config.sourceRpcUrl,
    targetRpcUrl: config.targetRpcUrl,
    sourceBefore,
    targetBefore,
    plan,
    blockHashes,
    blockRelayPerformed: blockHashes.length > 0,
    sourceAfter,
    targetAfter,
    walletEffects: false,
    approvalRequested: false,
    signingPerformed: false,
    broadcastPerformed: false
  };
  await writeReceipt(outputPath, receipt);
  console.log(JSON.stringify({ output: outputPath, ...receipt }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
