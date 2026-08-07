import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PreparedReserveIntakeCandidate } from "../src/broker/reserveIntakeCandidateBroker.js";
import type { ReserveIntakePlan } from "../src/launch/reserveIntake.js";
import {
  buildTradeLayerListenerPreflightEvidence,
  observeTradeLayerListener
} from "../src/launch/tradelayerListenerPreflight.js";
import { observeTradeLayerBitcoinActivation } from "../src/launch/tradelayerBitcoinActivation.js";
import { validateTx11ReleaseManifest } from "../src/launch/tradelayerRelease.js";

type BitcoinRpcConfig = {
  listenerEndpoint: string;
  rpcUrl: string;
  cookieFile: string;
};

type RpcResponse = { result?: unknown; error?: { code?: number; message?: string } | null };

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function list(value: string | undefined): string[] {
  return (value || "").split(";").map((item) => item.trim()).filter(Boolean);
}

function normalizedEndpoint(value: string, label: string, bitcoinRpc = false): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || (bitcoinRpc && url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname))
    || (bitcoinRpc && url.pathname !== "/" && url.pathname !== "")) {
    throw new Error(`${label} contains unsupported or unsafe URL components`);
  }
  return url.toString().replace(/\/$/, "");
}

function bitcoinRpcConfigs(raw: string | undefined, listenerEndpoints: string[]): BitcoinRpcConfig[] {
  if (!raw) throw new Error("TRADELAYER_PREFLIGHT_BITCOIN_RPCS_JSON is required");
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value) || value.length !== listenerEndpoints.length) {
    throw new Error("TRADELAYER_PREFLIGHT_BITCOIN_RPCS_JSON must have exactly one entry per listener");
  }
  const seenListeners = new Set<string>();
  const seenRpcs = new Set<string>();
  const configs = value.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`Bitcoin RPC entry ${index} is invalid`);
    }
    const item = candidate as Partial<BitcoinRpcConfig>;
    const listenerEndpoint = normalizedEndpoint(String(item.listenerEndpoint || ""), `Bitcoin RPC entry ${index} listenerEndpoint`);
    const rpcUrl = normalizedEndpoint(String(item.rpcUrl || ""), `Bitcoin RPC entry ${index} rpcUrl`, true);
    const cookieFile = String(item.cookieFile || "").trim();
    if (!cookieFile) throw new Error(`Bitcoin RPC entry ${index} is missing cookieFile`);
    if (seenListeners.has(listenerEndpoint) || seenRpcs.has(rpcUrl)) {
      throw new Error("Bitcoin RPC entries must have unique listener and RPC endpoints");
    }
    seenListeners.add(listenerEndpoint);
    seenRpcs.add(rpcUrl);
    return { listenerEndpoint, rpcUrl, cookieFile };
  });
  const expected = new Set(listenerEndpoints.map((endpoint, index) => normalizedEndpoint(endpoint, `listener endpoint ${index}`)));
  if (expected.size !== listenerEndpoints.length || configs.some((config) => !expected.has(config.listenerEndpoint))) {
    throw new Error("Bitcoin RPC entries do not exactly match the listener endpoints");
  }
  return configs;
}

function positiveInteger(value: string | undefined, fallback: number, label: string, maximum: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 100 || parsed > maximum) {
    throw new Error(`${label} is outside its safe bounds`);
  }
  return parsed;
}

function rpcCall(config: BitcoinRpcConfig, timeoutMs: number, maxResponseBytes: number) {
  return async (method: string, params: unknown[]): Promise<unknown> => {
    const cookie = (await fs.readFile(config.cookieFile, "utf8")).trim();
    if (!cookie.includes(":")) throw new Error("Bitcoin RPC cookie is invalid");
    const response = await fetch(config.rpcUrl, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(cookie).toString("base64")}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ jsonrpc: "1.0", id: "bitagent-tx11-proof", method, params }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxResponseBytes) throw new Error("Bitcoin RPC response exceeded size limit");
    if (!response.ok) throw new Error(`Bitcoin RPC returned HTTP ${response.status}`);
    const body = JSON.parse(text) as RpcResponse;
    if (body.error) throw new Error(`Bitcoin RPC failed: ${body.error.message || body.error.code || "unknown"}`);
    return body.result;
  };
}

async function main() {
  const candidatePath = path.resolve(process.env.RESERVE_INTAKE_CANDIDATE_PATH
    || path.join(".runtime", "testnet-agent", "reserve-intake-candidate", "prepared-candidate.json"));
  const outputPath = path.resolve(process.env.LISTENER_PREFLIGHT_OUTPUT
    || path.join(".runtime", "testnet-agent", "reserve-intake-candidate", "listener-preflight.json"));
  const manifestPath = path.resolve("config", "tradelayer-tx11-release.json");
  const [rawCandidate, rawManifest] = await Promise.all([
    fs.readFile(candidatePath, "utf8"),
    fs.readFile(manifestPath, "utf8")
  ]);
  const candidate = JSON.parse(rawCandidate) as PreparedReserveIntakeCandidate | ReserveIntakePlan;
  const plan = (candidate as PreparedReserveIntakeCandidate).request?.plan || candidate as ReserveIntakePlan;
  const manifest = validateTx11ReleaseManifest(JSON.parse(rawManifest));
  const endpoints = list(process.env.TRADELAYER_PREFLIGHT_ENDPOINTS);
  if (endpoints.length < 2) throw new Error("At least two TRADELAYER_PREFLIGHT_ENDPOINTS are required");
  const rpcConfigs = bitcoinRpcConfigs(process.env.TRADELAYER_PREFLIGHT_BITCOIN_RPCS_JSON, endpoints);
  const bitcoinRpcTimeoutMs = positiveInteger(
    process.env.TRADELAYER_PREFLIGHT_BITCOIN_RPC_TIMEOUT_MS,
    5_000,
    "TRADELAYER_PREFLIGHT_BITCOIN_RPC_TIMEOUT_MS",
    30_000
  );
  const bitcoinRpcMaxResponseBytes = positiveInteger(
    process.env.TRADELAYER_PREFLIGHT_BITCOIN_RPC_MAX_RESPONSE_BYTES,
    1_000_000,
    "TRADELAYER_PREFLIGHT_BITCOIN_RPC_MAX_RESPONSE_BYTES",
    5_000_000
  );
  const observations = await Promise.all(endpoints.map((endpoint) => observeTradeLayerListener({
    plan,
    endpoint,
    timeoutMs: Number(process.env.TRADELAYER_PREFLIGHT_TIMEOUT_MS || 5_000),
    maxResponseBytes: Number(process.env.TRADELAYER_PREFLIGHT_MAX_RESPONSE_BYTES || 1_000_000)
  })));
  const proofAttempts = await Promise.allSettled(observations.map((observation) => {
    const config = rpcConfigs.find((item) => item.listenerEndpoint === observation.sourceEndpoint);
    if (!config) throw new Error(`No Bitcoin RPC is bound to listener ${observation.listener.nodeId}`);
    return observeTradeLayerBitcoinActivation({
      observation,
      expectedCodeHash: manifest.codeHash,
      sourceRpcEndpoint: config.rpcUrl,
      rpcCall: rpcCall(config, bitcoinRpcTimeoutMs, bitcoinRpcMaxResponseBytes)
    });
  }));
  const bitcoinActivationProofs = proofAttempts.flatMap((attempt) => attempt.status === "fulfilled" ? [attempt.value] : []);
  for (const [index, attempt] of proofAttempts.entries()) {
    if (attempt.status === "rejected") {
      const message = attempt.reason instanceof Error ? attempt.reason.message : "unknown read-only proof failure";
      console.error(`Bitcoin activation proof failed for listener ${observations[index]?.listener.nodeId}: ${message}`);
    }
  }
  const evidence = buildTradeLayerListenerPreflightEvidence({
    plan,
    observations,
    bitcoinActivationProofs,
    now: new Date(),
    maxAgeMs: Number(process.env.TRADELAYER_PREFLIGHT_MAX_AGE_MS || 120_000),
    maxSyncLagBlocks: Number(process.env.TRADELAYER_PREFLIGHT_MAX_LAG_BLOCKS || 2),
    minimumIndependentNodes: Number(process.env.TRADELAYER_PREFLIGHT_MIN_NODES || 2),
    acceptedTx11CodeHashes: [manifest.codeHash],
    acceptedReleaseCommits: [manifest.deploymentCommit]
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: evidence.status === "verified",
    status: evidence.status,
    planHash: evidence.planHash,
    listenerCount: evidence.observations.length,
    independenceClaim: evidence.independenceClaim,
    gates: evidence.gates,
    reasons: evidence.reasons,
    output: outputPath
  }, null, 2));
  if (evidence.status !== "verified") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
