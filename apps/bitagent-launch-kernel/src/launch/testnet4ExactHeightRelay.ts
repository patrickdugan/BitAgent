import path from "node:path";
import { LaunchKernelError } from "./errors.js";

export type Testnet4ExactHeightRelayConfig = {
  schema: "bitagent_testnet4_exact_height_relay_config_v1";
  runtimeRoot: string;
  sourceRpcUrl: string;
  sourceCookieFile: string;
  targetRpcUrl: string;
  targetCookieFile: string;
  targetHeight: number;
  maxBlocks: number;
  minFreeBytes: number;
};

export type ExactHeightRelayObservation = {
  chain: string;
  blocks: number;
  bestblockhash: string;
  initialblockdownload: boolean;
  networkactive: boolean;
  connections: number;
};

const KEYS = new Set([
  "schema", "runtimeRoot", "sourceRpcUrl", "sourceCookieFile", "targetRpcUrl", "targetCookieFile",
  "targetHeight", "maxBlocks", "minFreeBytes"
]);

function loopbackUrl(value: unknown, label: string): string {
  const url = new URL(String(value || ""));
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    throw new LaunchKernelError("validation_error", `${label} must be an unauthenticated loopback HTTP URL`);
  }
  if (url.username || url.password) {
    throw new LaunchKernelError("validation_error", `${label} must not contain credentials`);
  }
  return url.toString().replace(/\/$/, "");
}

function childPath(value: unknown, runtimeRoot: string, label: string): string {
  const raw = String(value || "");
  if (!path.isAbsolute(raw)) throw new LaunchKernelError("validation_error", `${label} must be absolute`);
  const resolved = path.resolve(raw);
  const relative = path.relative(runtimeRoot, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new LaunchKernelError("validation_error", `${label} must be a child of runtimeRoot`);
  }
  return resolved;
}

function boundedHeight(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new LaunchKernelError("validation_error", `${label} must be a positive safe integer`);
  }
  return parsed;
}

export function validateTestnet4ExactHeightRelayConfig(value: unknown): Testnet4ExactHeightRelayConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LaunchKernelError("validation_error", "exact-height relay config must be an object");
  }
  const input = value as Record<string, unknown>;
  const unexpected = Object.keys(input).filter((key) => !KEYS.has(key));
  if (unexpected.length) {
    throw new LaunchKernelError("validation_error", `exact-height relay config contains unsupported fields: ${unexpected.join(", ")}`);
  }
  if (input.schema !== "bitagent_testnet4_exact_height_relay_config_v1") {
    throw new LaunchKernelError("validation_error", "exact-height relay config schema is invalid");
  }
  const runtimeRaw = String(input.runtimeRoot || "");
  if (!path.isAbsolute(runtimeRaw)) throw new LaunchKernelError("validation_error", "runtimeRoot must be absolute");
  const runtimeRoot = path.resolve(runtimeRaw);
  const sourceRpcUrl = loopbackUrl(input.sourceRpcUrl, "sourceRpcUrl");
  const targetRpcUrl = loopbackUrl(input.targetRpcUrl, "targetRpcUrl");
  const sourceCookieFile = childPath(input.sourceCookieFile, runtimeRoot, "sourceCookieFile");
  const targetCookieFile = childPath(input.targetCookieFile, runtimeRoot, "targetCookieFile");
  const targetHeight = boundedHeight(input.targetHeight, "targetHeight");
  const maxBlocks = boundedHeight(input.maxBlocks, "maxBlocks");
  const minFreeBytes = input.minFreeBytes === undefined
    ? 750 * 1024 * 1024
    : boundedHeight(input.minFreeBytes, "minFreeBytes");
  if (maxBlocks > 2_000) {
    throw new LaunchKernelError("validation_error", "maxBlocks must not exceed 2000");
  }
  if (sourceRpcUrl === targetRpcUrl || sourceCookieFile === targetCookieFile) {
    throw new LaunchKernelError("validation_error", "source and target Bitcoin nodes must be independent");
  }
  return {
    schema: "bitagent_testnet4_exact_height_relay_config_v1",
    runtimeRoot,
    sourceRpcUrl,
    sourceCookieFile,
    targetRpcUrl,
    targetCookieFile,
    targetHeight,
    maxBlocks,
    minFreeBytes
  };
}

export function hasExactHeightRelayDiskReserve(input: {
  freeBytes: number;
  minFreeBytes: number;
  pendingBlockBytes?: number;
}): boolean {
  const pendingBlockBytes = input.pendingBlockBytes || 0;
  return Number.isSafeInteger(input.freeBytes)
    && Number.isSafeInteger(input.minFreeBytes)
    && Number.isSafeInteger(pendingBlockBytes)
    && input.freeBytes >= input.minFreeBytes + (pendingBlockBytes * 2);
}

export function planTestnet4ExactHeightRelay(input: {
  source: ExactHeightRelayObservation;
  target: ExactHeightRelayObservation;
  sourceHashAtTargetTip: string;
  sourceHashAtExactHeight: string;
  config: Pick<Testnet4ExactHeightRelayConfig, "targetHeight" | "maxBlocks">;
}) {
  for (const [name, observed] of [["source", input.source], ["target", input.target]] as const) {
    if (observed.chain !== "testnet4" || !Number.isSafeInteger(observed.blocks) || observed.blocks < 1
      || !/^[0-9a-f]{64}$/.test(observed.bestblockhash)) {
      throw new LaunchKernelError("validation_error", `${name} must expose a valid testnet4 tip`);
    }
  }
  if (input.source.initialblockdownload) {
    throw new LaunchKernelError("validation_error", "source must be fully synchronized");
  }
  if (input.target.networkactive || input.target.connections !== 0) {
    throw new LaunchKernelError("validation_error", "target peer networking must be paused");
  }
  if (input.target.blocks > input.config.targetHeight) {
    throw new LaunchKernelError("validation_error", "target already overshot the exact height");
  }
  if (input.source.blocks < input.config.targetHeight) {
    throw new LaunchKernelError("validation_error", "source has not reached the exact height");
  }
  if (input.sourceHashAtTargetTip !== input.target.bestblockhash) {
    throw new LaunchKernelError("validation_error", "target tip is not on the source active chain");
  }
  if (!/^[0-9a-f]{64}$/.test(input.sourceHashAtExactHeight)) {
    throw new LaunchKernelError("validation_error", "source exact-height hash is invalid");
  }
  const blockCount = input.config.targetHeight - input.target.blocks;
  if (blockCount > input.config.maxBlocks) {
    throw new LaunchKernelError("validation_error", "exact-height relay exceeds maxBlocks");
  }
  return {
    fromHeight: input.target.blocks + 1,
    toHeight: input.config.targetHeight,
    blockCount,
    expectedTipHash: input.sourceHashAtExactHeight
  };
}
