import path from "node:path";
import { LaunchKernelError } from "./errors.js";

export type Testnet4TipAlignmentConfig = {
  schema: "bitagent_testnet4_tip_alignment_config_v1";
  runtimeRoot: string;
  sourceRpcUrl: string;
  sourceCookieFile: string;
  targetRpcUrl: string;
  targetCookieFile: string;
  maxBlocks: number;
};

export type BitcoinTipAlignmentObservation = {
  chain: string;
  blocks: number;
  bestblockhash: string;
  networkactive: boolean;
  connections: number;
};

export type SubmittedBlockObservation = {
  hash: string;
  height: number;
  confirmations: number;
};

const KEYS = new Set([
  "schema", "runtimeRoot", "sourceRpcUrl", "sourceCookieFile", "targetRpcUrl", "targetCookieFile", "maxBlocks"
]);

function loopbackUrl(value: unknown, label: string): string {
  const url = new URL(String(value || ""));
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    throw new LaunchKernelError("validation_error", `${label} must be an unauthenticated loopback HTTP URL`);
  }
  if (url.username || url.password) throw new LaunchKernelError("validation_error", `${label} must not contain credentials`);
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

export function validateTestnet4TipAlignmentConfig(value: unknown): Testnet4TipAlignmentConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LaunchKernelError("validation_error", "tip alignment config must be an object");
  }
  const input = value as Record<string, unknown>;
  const unexpected = Object.keys(input).filter((key) => !KEYS.has(key));
  if (unexpected.length) throw new LaunchKernelError("validation_error", `tip alignment config contains unsupported fields: ${unexpected.join(", ")}`);
  if (input.schema !== "bitagent_testnet4_tip_alignment_config_v1") {
    throw new LaunchKernelError("validation_error", "tip alignment config schema is invalid");
  }
  const runtimeRaw = String(input.runtimeRoot || "");
  if (!path.isAbsolute(runtimeRaw)) throw new LaunchKernelError("validation_error", "runtimeRoot must be absolute");
  const runtimeRoot = path.resolve(runtimeRaw);
  const sourceRpcUrl = loopbackUrl(input.sourceRpcUrl, "sourceRpcUrl");
  const targetRpcUrl = loopbackUrl(input.targetRpcUrl, "targetRpcUrl");
  const sourceCookieFile = childPath(input.sourceCookieFile, runtimeRoot, "sourceCookieFile");
  const targetCookieFile = childPath(input.targetCookieFile, runtimeRoot, "targetCookieFile");
  const maxBlocks = Number(input.maxBlocks);
  if (!Number.isSafeInteger(maxBlocks) || maxBlocks < 1 || maxBlocks > 128) {
    throw new LaunchKernelError("validation_error", "maxBlocks must be between 1 and 128");
  }
  if (sourceRpcUrl === targetRpcUrl || sourceCookieFile === targetCookieFile) {
    throw new LaunchKernelError("validation_error", "source and target Bitcoin nodes must be independent");
  }
  return {
    schema: "bitagent_testnet4_tip_alignment_config_v1",
    runtimeRoot,
    sourceRpcUrl,
    sourceCookieFile,
    targetRpcUrl,
    targetCookieFile,
    maxBlocks
  };
}

export function planTestnet4TipAlignment(input: {
  source: BitcoinTipAlignmentObservation;
  target: BitcoinTipAlignmentObservation;
  sourceHashAtTargetHeight: string;
  commonAncestorHeight?: number;
  sourceHashAtCommonAncestor?: string;
  targetHashAtCommonAncestor?: string;
  maxBlocks: number;
}) {
  for (const [name, observed] of [["source", input.source], ["target", input.target]] as const) {
    if (observed.chain !== "testnet4" || !Number.isSafeInteger(observed.blocks) || observed.blocks < 1
      || !/^[0-9a-f]{64}$/.test(observed.bestblockhash)) {
      throw new LaunchKernelError("validation_error", `${name} must expose a valid testnet4 tip`);
    }
    if (observed.networkactive || observed.connections !== 0) {
      throw new LaunchKernelError("validation_error", `${name} peer networking must be paused`);
    }
  }
  const targetTipIsOnSource = /^[0-9a-f]{64}$/.test(input.sourceHashAtTargetHeight)
    && input.sourceHashAtTargetHeight === input.target.bestblockhash;
  let commonAncestorHeight = input.target.blocks;
  if (!targetTipIsOnSource) {
    const sourceCommonHash = String(input.sourceHashAtCommonAncestor || "");
    const targetCommonHash = String(input.targetHashAtCommonAncestor || "");
    commonAncestorHeight = Number(input.commonAncestorHeight);
    if (!Number.isSafeInteger(commonAncestorHeight) || commonAncestorHeight < 1
      || commonAncestorHeight >= input.target.blocks || commonAncestorHeight > input.source.blocks
      || !/^[0-9a-f]{64}$/.test(sourceCommonHash) || sourceCommonHash !== targetCommonHash) {
      throw new LaunchKernelError("validation_error", "target tip is not on the source active chain");
    }
  }
  const blockCount = input.source.blocks - commonAncestorHeight;
  const targetReorgDepth = input.target.blocks - commonAncestorHeight;
  if (blockCount < 0) throw new LaunchKernelError("validation_error", "target must not be ahead of source");
  if (blockCount > input.maxBlocks || targetReorgDepth > input.maxBlocks) {
    throw new LaunchKernelError("validation_error", "tip alignment exceeds maxBlocks");
  }
  const plan = {
    fromHeight: commonAncestorHeight + 1,
    toHeight: input.source.blocks,
    blockCount,
    expectedTipHash: input.source.bestblockhash
  };
  return targetTipIsOnSource ? plan : {
    ...plan,
    commonAncestorHeight,
    commonAncestorHash: input.sourceHashAtCommonAncestor,
    targetReorgDepth
  };
}

export function classifyTestnet4BlockSubmission(input: {
  result: null | string;
  expectedHash: string;
  expectedHeight: number;
  observed?: SubmittedBlockObservation;
}): "accepted" | "known_valid_candidate" {
  if (input.result === null) return "accepted";
  const observed = input.observed;
  if ((input.result === "inconclusive" || input.result === "duplicate") && observed
    && observed.hash === input.expectedHash && observed.height === input.expectedHeight
    && Number.isSafeInteger(observed.confirmations) && observed.confirmations >= -1) {
    return "known_valid_candidate";
  }
  throw new LaunchKernelError("validation_error", `target rejected block ${input.expectedHeight}: ${String(input.result)}`);
}
