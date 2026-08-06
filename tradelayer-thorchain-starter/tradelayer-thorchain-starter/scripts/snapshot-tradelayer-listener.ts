import { promises as fs } from "node:fs";
import path from "node:path";
import { hashTradeLayerListenerSnapshot } from "../src/launch/tradelayerListenerDeployment.js";

type Config = {
  schema: "bitagent_tradelayer_listener_snapshot_config_v1";
  runtimeRoot: string;
  listenerUrl: string;
  rpcUrl: string;
  rpcCookieFile: string;
  sourceDir: string;
  snapshotDir: string;
};

type RpcBody<T> = { result?: T; error?: { message?: string } | null };

const allowedKeys = new Set([
  "schema", "runtimeRoot", "listenerUrl", "rpcUrl", "rpcCookieFile", "sourceDir", "snapshotDir"
]);

function childPath(value: unknown, runtimeRoot: string, label: string) {
  const resolved = path.resolve(String(value || ""));
  const relative = path.relative(runtimeRoot, resolved);
  if (!path.isAbsolute(String(value || "")) || relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must be an absolute child of runtimeRoot`);
  }
  return resolved;
}

function loopbackUrl(value: unknown, label: string) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error(`${label} must be an unauthenticated loopback HTTP URL`);
  }
  if (url.username || url.password) throw new Error(`${label} must not contain credentials`);
  return url.toString().replace(/\/$/, "");
}

function parseConfig(value: unknown): Config {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("snapshot config must be an object");
  const input = value as Record<string, unknown>;
  const extra = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (extra.length) throw new Error(`snapshot config contains unsupported fields: ${extra.join(", ")}`);
  if (input.schema !== "bitagent_tradelayer_listener_snapshot_config_v1") throw new Error("snapshot config schema is invalid");
  const runtimeRoot = path.resolve(String(input.runtimeRoot || ""));
  if (!path.isAbsolute(String(input.runtimeRoot || ""))) throw new Error("runtimeRoot must be absolute");
  const sourceDir = childPath(input.sourceDir, runtimeRoot, "sourceDir");
  const snapshotDir = childPath(input.snapshotDir, runtimeRoot, "snapshotDir");
  const sourceToSnapshot = path.relative(sourceDir, snapshotDir);
  const snapshotToSource = path.relative(snapshotDir, sourceDir);
  if (sourceToSnapshot === "" || (!sourceToSnapshot.startsWith("..") && !path.isAbsolute(sourceToSnapshot))
    || (!snapshotToSource.startsWith("..") && !path.isAbsolute(snapshotToSource))) {
    throw new Error("sourceDir and snapshotDir must not overlap");
  }
  return {
    schema: input.schema,
    runtimeRoot,
    listenerUrl: loopbackUrl(input.listenerUrl, "listenerUrl"),
    rpcUrl: loopbackUrl(input.rpcUrl, "rpcUrl"),
    rpcCookieFile: childPath(input.rpcCookieFile, runtimeRoot, "rpcCookieFile"),
    sourceDir,
    snapshotDir
  };
}

async function bitcoinRpc<T>(config: Config, method: string): Promise<T> {
  const cookie = (await fs.readFile(config.rpcCookieFile, "utf8")).trim();
  if (!cookie.includes(":")) throw new Error("Bitcoin RPC cookie is invalid");
  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(cookie).toString("base64")}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ jsonrpc: "1.0", id: "bitagent-listener-snapshot", method, params: [] }),
    signal: AbortSignal.timeout(15_000)
  });
  const text = await response.text();
  if (!response.ok || Buffer.byteLength(text, "utf8") > 1_000_000) throw new Error(`Bitcoin RPC ${method} failed`);
  const body = JSON.parse(text) as RpcBody<T>;
  if (body.error) throw new Error(`Bitcoin RPC ${method} failed: ${body.error.message || "unknown"}`);
  return body.result as T;
}

async function observe(config: Config) {
  const [chain, network, response] = await Promise.all([
    bitcoinRpc<{ chain: string; blocks: number; pruned: boolean; pruneheight?: number }>(config, "getblockchaininfo"),
    bitcoinRpc<{ networkactive: boolean; connections: number }>(config, "getnetworkinfo"),
    fetch(`${config.listenerUrl}/tl_getSyncStatus`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(15_000)
    })
  ]);
  const text = await response.text();
  if (!response.ok || Buffer.byteLength(text, "utf8") > 1_000_000) throw new Error("listener sync observation failed");
  const listener = JSON.parse(text) as { phase?: unknown; error?: unknown; trackHeight?: unknown };
  const trackHeight = Number(listener.trackHeight);
  const pruneHeight = chain.pruned ? Number(chain.pruneheight || 0) : 0;
  if (chain.chain !== "testnet4" || !Number.isSafeInteger(chain.blocks) || !Number.isSafeInteger(trackHeight)) {
    throw new Error("listener snapshot requires valid testnet4 heights");
  }
  if (network.networkactive || Number(network.connections || 0) !== 0) throw new Error("Bitcoin peer networking must be paused");
  if (listener.phase !== "realtime" || listener.error) throw new Error("listener must be realtime and error-free");
  if (trackHeight !== chain.blocks) throw new Error("listener must exactly match the paused Bitcoin height");
  if (pruneHeight > trackHeight + 1) throw new Error("Bitcoin prune horizon overtook the listener");
  return { bitcoinHeight: chain.blocks, pruneHeight, trackHeight, phase: listener.phase, error: null };
}

async function exists(target: string) {
  try { await fs.access(target); return true; } catch { return false; }
}

async function writeReceipt(outputPath: string, value: unknown) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, outputPath);
}

async function main() {
  const config = parseConfig(JSON.parse(process.env.BITAGENT_TRADELAYER_SNAPSHOT_JSON || "null"));
  const outputPath = path.resolve(process.env.BITAGENT_TRADELAYER_SNAPSHOT_RECEIPT
    || path.join(".runtime", "testnet-agent", "listener-snapshots", "latest.json"));
  if (await exists(config.snapshotDir)) throw new Error("snapshotDir already exists");
  const beforeObservation = await observe(config);
  const before = await hashTradeLayerListenerSnapshot(config.sourceDir);
  await fs.cp(config.sourceDir, config.snapshotDir, { recursive: true, force: false, errorOnExist: true });
  const [afterObservation, after, snapshot] = await Promise.all([
    observe(config),
    hashTradeLayerListenerSnapshot(config.sourceDir),
    hashTradeLayerListenerSnapshot(config.snapshotDir)
  ]);
  if (JSON.stringify(beforeObservation) !== JSON.stringify(afterObservation)) throw new Error("listener state changed during snapshot copy");
  if (before.inventoryHash !== after.inventoryHash || before.inventoryHash !== snapshot.inventoryHash) {
    throw new Error("listener snapshot inventory changed or copy parity failed");
  }
  const receipt = {
    schema: "bitagent_tradelayer_listener_snapshot_receipt_v1",
    status: "sealed",
    authority: "operator_host",
    effect: "quiescent_listener_state_copy_no_wallet_effect",
    createdAt: new Date().toISOString(),
    sourceDir: config.sourceDir,
    snapshotDir: config.snapshotDir,
    observation: afterObservation,
    sourceInventoryHash: after.inventoryHash,
    snapshotInventoryHash: snapshot.inventoryHash,
    files: snapshot.files,
    bytes: snapshot.bytes,
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
