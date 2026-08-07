import path from "node:path";
import { LaunchKernelError } from "./errors.js";

export type TradeLayerListenerReplayConfig = {
  schema: "bitagent_tradelayer_listener_replay_config_v1";
  runtimeRoot: string;
  sourceRepo: string;
  sourceCommit: string;
  rpcPort: number;
  rpcCookieFile: string;
  listenerPort: number;
  nodeId: string;
  instanceId: string;
  nedbRoot: string;
  logDir: string;
  startupTimeoutMs: number;
  replayTimeoutMs: number;
};

export type ReplayBitcoinObservation = {
  chain: string;
  blocks: number;
  headers: number;
  initialblockdownload: boolean;
  pruned: boolean;
  bestblockhash: string;
  networkactive: boolean;
  connections: number;
};

export type ReplayListenerStatus = {
  initialized?: boolean;
  phase?: string;
  error?: unknown;
  errorCode?: unknown;
  recovery?: unknown;
  trackHeight?: unknown;
  processedHeight?: unknown;
  currentHeight?: unknown;
  targetHeight?: unknown;
};

const KEYS = new Set([
  "schema", "runtimeRoot", "sourceRepo", "sourceCommit", "rpcPort", "rpcCookieFile",
  "listenerPort", "nodeId", "instanceId", "nedbRoot", "logDir", "startupTimeoutMs",
  "replayTimeoutMs"
]);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LaunchKernelError("validation_error", "listener replay config must be an object");
  }
  return value as Record<string, unknown>;
}

function port(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1024 || parsed > 65535) {
    throw new LaunchKernelError("validation_error", `${label} must be an unprivileged TCP port`);
  }
  return parsed;
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new LaunchKernelError("validation_error", `${label} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function safeText(value: unknown, label: string, pattern: RegExp): string {
  const parsed = String(value || "").trim();
  if (!pattern.test(parsed)) throw new LaunchKernelError("validation_error", `${label} is invalid`);
  return parsed;
}

function childPath(value: unknown, runtimeRoot: string, label: string): string {
  const parsed = String(value || "").trim();
  if (!path.isAbsolute(parsed)) throw new LaunchKernelError("validation_error", `${label} must be absolute`);
  const resolved = path.resolve(parsed);
  const relative = path.relative(runtimeRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new LaunchKernelError("validation_error", `${label} must be a child of runtimeRoot`);
  }
  return resolved;
}

export function validateTradeLayerListenerReplayConfig(value: unknown): TradeLayerListenerReplayConfig {
  const input = record(value);
  const unexpected = Object.keys(input).filter((key) => !KEYS.has(key));
  if (unexpected.length) {
    throw new LaunchKernelError("validation_error", `listener replay config contains unsupported fields: ${unexpected.join(", ")}`);
  }
  if (input.schema !== "bitagent_tradelayer_listener_replay_config_v1") {
    throw new LaunchKernelError("validation_error", "listener replay config schema is invalid");
  }
  const runtimeRaw = String(input.runtimeRoot || "").trim();
  if (!path.isAbsolute(runtimeRaw)) throw new LaunchKernelError("validation_error", "runtimeRoot must be absolute");
  const runtimeRoot = path.resolve(runtimeRaw);
  const sourceRepo = childPath(input.sourceRepo, runtimeRoot, "sourceRepo");
  const rpcCookieFile = childPath(input.rpcCookieFile, runtimeRoot, "rpcCookieFile");
  const nedbRoot = childPath(input.nedbRoot, runtimeRoot, "nedbRoot");
  const logDir = childPath(input.logDir, runtimeRoot, "logDir");
  if ([sourceRepo, rpcCookieFile, nedbRoot, logDir].some((left, index, all) =>
    all.some((right, other) => index !== other && (path.relative(left, right) === ""
      || (!path.relative(left, right).startsWith("..") && !path.isAbsolute(path.relative(left, right))))))) {
    throw new LaunchKernelError("validation_error", "listener replay source, cookie, state, and logs must not overlap");
  }
  const rpcPort = port(input.rpcPort, "rpcPort");
  const listenerPort = port(input.listenerPort, "listenerPort");
  if (rpcPort === listenerPort) {
    throw new LaunchKernelError("validation_error", "rpcPort and listenerPort must be distinct");
  }
  return {
    schema: "bitagent_tradelayer_listener_replay_config_v1",
    runtimeRoot,
    sourceRepo,
    sourceCommit: safeText(input.sourceCommit, "sourceCommit", /^[a-f0-9]{40}$/),
    rpcPort,
    rpcCookieFile,
    listenerPort,
    nodeId: safeText(input.nodeId, "nodeId", /^[A-Za-z0-9._:-]{3,128}$/),
    instanceId: safeText(input.instanceId, "instanceId", /^[A-Za-z0-9._:-]{8,128}$/),
    nedbRoot,
    logDir,
    startupTimeoutMs: boundedInteger(input.startupTimeoutMs, "startupTimeoutMs", 5_000, 120_000),
    replayTimeoutMs: boundedInteger(input.replayTimeoutMs, "replayTimeoutMs", 60_000, 28_800_000)
  };
}

export function validateReplayBitcoinObservation(value: ReplayBitcoinObservation): ReplayBitcoinObservation {
  if (value.chain !== "testnet4") throw new LaunchKernelError("provider_unavailable", "replay backend must be testnet4");
  if (value.pruned) throw new LaunchKernelError("provider_unavailable", "full replay refuses a pruned Bitcoin backend");
  if (value.initialblockdownload || value.blocks < 1 || value.blocks !== value.headers) {
    throw new LaunchKernelError("provider_unavailable", "full replay requires an exactly synchronized Bitcoin backend");
  }
  if (value.networkactive || value.connections !== 0) {
    throw new LaunchKernelError("provider_unavailable", "full replay requires paused Bitcoin peer networking and zero connections");
  }
  if (!/^[a-f0-9]{64}$/.test(value.bestblockhash)) {
    throw new LaunchKernelError("provider_unavailable", "full replay backend best block hash is invalid");
  }
  return value;
}

export function classifyReplayStatus(status: ReplayListenerStatus, targetHeight: number): "waiting" | "complete" {
  if (String(status.phase || "") === "error" || status.error) {
    const code = String(status.errorCode || "listener_replay_error");
    throw new LaunchKernelError("provider_unavailable", `${code}: ${String(status.error || "listener replay failed")}`);
  }
  const heights = [status.trackHeight, status.processedHeight, status.currentHeight].map(Number);
  if (status.initialized === true && status.phase === "realtime" && heights.every((height) => height === targetHeight)) {
    return "complete";
  }
  if (heights.some((height) => Number.isFinite(height) && height > targetHeight)) {
    throw new LaunchKernelError("provider_unavailable", "listener replay advanced beyond the sealed Bitcoin target");
  }
  return "waiting";
}
