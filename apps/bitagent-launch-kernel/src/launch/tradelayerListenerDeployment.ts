import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { LaunchKernelError } from "./errors.js";

export type TradeLayerListenerDeploymentTarget = {
  name: string;
  nodeId: string;
  instanceId: string;
  port: number;
  rpcPort: number;
  rpcCookieFile: string;
  snapshotDir: string;
  nedbRoot: string;
  logDir: string;
};

export type TradeLayerListenerDeploymentConfig = {
  schema: "bitagent_tradelayer_listener_deployment_config_v1";
  runtimeRoot: string;
  sourceRepo: string;
  startupTimeoutMs: number;
  listeners: [TradeLayerListenerDeploymentTarget, TradeLayerListenerDeploymentTarget];
};

const TOP_LEVEL_KEYS = new Set(["schema", "runtimeRoot", "sourceRepo", "startupTimeoutMs", "listeners"]);
const LISTENER_KEYS = new Set([
  "name", "nodeId", "instanceId", "port", "rpcPort", "rpcCookieFile", "snapshotDir", "nedbRoot", "logDir"
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LaunchKernelError("validation_error", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, label: string) {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw new LaunchKernelError("validation_error", `${label} contains unsupported fields: ${unexpected.join(", ")}`);
  }
}

function text(value: unknown, label: string, pattern: RegExp): string {
  const normalized = String(value || "").trim();
  if (!pattern.test(normalized)) throw new LaunchKernelError("validation_error", `${label} is invalid`);
  return normalized;
}

function port(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1024 || parsed > 65535) {
    throw new LaunchKernelError("validation_error", `${label} must be an unprivileged TCP port`);
  }
  return parsed;
}

function absolutePath(value: unknown, runtimeRoot: string, label: string): string {
  const parsed = String(value || "").trim();
  if (!path.isAbsolute(parsed)) throw new LaunchKernelError("validation_error", `${label} must be absolute`);
  const resolved = path.resolve(parsed);
  const relative = path.relative(runtimeRoot, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new LaunchKernelError("validation_error", `${label} must be a child of runtimeRoot`);
  }
  return resolved;
}

function pathsOverlap(left: string, right: string): boolean {
  const leftToRight = path.relative(left, right);
  const rightToLeft = path.relative(right, left);
  return leftToRight === "" || rightToLeft === ""
    || (!leftToRight.startsWith("..") && !path.isAbsolute(leftToRight))
    || (!rightToLeft.startsWith("..") && !path.isAbsolute(rightToLeft));
}

export function validateTradeLayerListenerDeploymentConfig(value: unknown): TradeLayerListenerDeploymentConfig {
  const input = record(value, "listener deployment config");
  exactKeys(input, TOP_LEVEL_KEYS, "listener deployment config");
  if (input.schema !== "bitagent_tradelayer_listener_deployment_config_v1") {
    throw new LaunchKernelError("validation_error", "listener deployment config schema is invalid");
  }
  const runtimeRootRaw = String(input.runtimeRoot || "").trim();
  if (!path.isAbsolute(runtimeRootRaw)) {
    throw new LaunchKernelError("validation_error", "runtimeRoot must be absolute");
  }
  const runtimeRoot = path.resolve(runtimeRootRaw);
  const sourceRepo = absolutePath(input.sourceRepo, runtimeRoot, "sourceRepo");
  const startupTimeoutMs = Number(input.startupTimeoutMs);
  if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 5_000 || startupTimeoutMs > 120_000) {
    throw new LaunchKernelError("validation_error", "startupTimeoutMs must be between 5000 and 120000");
  }
  if (!Array.isArray(input.listeners) || input.listeners.length !== 2) {
    throw new LaunchKernelError("validation_error", "listener deployment requires exactly two listeners");
  }
  const listeners = input.listeners.map((raw, index) => {
    const listener = record(raw, `listeners[${index}]`);
    exactKeys(listener, LISTENER_KEYS, `listeners[${index}]`);
    const snapshotDir = absolutePath(listener.snapshotDir, runtimeRoot, `listeners[${index}].snapshotDir`);
    const nedbRoot = absolutePath(listener.nedbRoot, runtimeRoot, `listeners[${index}].nedbRoot`);
    const logDir = absolutePath(listener.logDir, runtimeRoot, `listeners[${index}].logDir`);
    if (pathsOverlap(snapshotDir, nedbRoot) || pathsOverlap(logDir, nedbRoot)) {
      throw new LaunchKernelError("validation_error", `listeners[${index}] source, state, and logs must not overlap`);
    }
    return {
      name: text(listener.name, `listeners[${index}].name`, /^[A-Za-z0-9._-]{1,64}$/),
      nodeId: text(listener.nodeId, `listeners[${index}].nodeId`, /^[A-Za-z0-9._:-]{3,128}$/),
      instanceId: text(listener.instanceId, `listeners[${index}].instanceId`, /^[A-Za-z0-9._:-]{8,128}$/),
      port: port(listener.port, `listeners[${index}].port`),
      rpcPort: port(listener.rpcPort, `listeners[${index}].rpcPort`),
      rpcCookieFile: absolutePath(listener.rpcCookieFile, runtimeRoot, `listeners[${index}].rpcCookieFile`),
      snapshotDir,
      nedbRoot,
      logDir
    };
  }) as [TradeLayerListenerDeploymentTarget, TradeLayerListenerDeploymentTarget];
  for (const [label, values] of Object.entries({
    name: listeners.map((item) => item.name),
    nodeId: listeners.map((item) => item.nodeId),
    instanceId: listeners.map((item) => item.instanceId),
    port: listeners.map((item) => item.port),
    rpcPort: listeners.map((item) => item.rpcPort),
    rpcCookieFile: listeners.map((item) => item.rpcCookieFile),
    snapshotDir: listeners.map((item) => item.snapshotDir),
    nedbRoot: listeners.map((item) => item.nedbRoot),
    logDir: listeners.map((item) => item.logDir)
  })) {
    if (new Set(values.map(String)).size !== values.length) {
      throw new LaunchKernelError("validation_error", `listener deployment ${label} values must be unique`);
    }
  }
  return {
    schema: "bitagent_tradelayer_listener_deployment_config_v1",
    runtimeRoot,
    sourceRepo,
    startupTimeoutMs,
    listeners
  };
}

async function inventoryFiles(root: string, directory = root): Promise<Array<{ path: string; bytes: number; sha256: string }>> {
  const result: Array<{ path: string; bytes: number; sha256: string }> = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new LaunchKernelError("validation_error", "listener snapshot may not contain symlinks");
    if (entry.isDirectory()) {
      result.push(...await inventoryFiles(root, fullPath));
    } else if (entry.isFile()) {
      const bytes = await fs.readFile(fullPath);
      result.push({
        path: path.relative(root, fullPath).replaceAll("\\", "/"),
        bytes: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex")
      });
    } else {
      throw new LaunchKernelError("validation_error", "listener snapshot contains an unsupported filesystem entry");
    }
  }
  return result;
}

export async function hashTradeLayerListenerSnapshot(root: string) {
  const files = await inventoryFiles(path.resolve(root));
  const required = ["activations.db", "persistence.db", "txIndex.db"];
  if (required.some((name) => !files.some((file) => file.path === name))) {
    throw new LaunchKernelError("validation_error", "listener snapshot is missing required database files");
  }
  const material = JSON.stringify(files);
  return {
    files: files.length,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    inventoryHash: crypto.createHash("sha256").update(material).digest("hex")
  };
}
