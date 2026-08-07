import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  hashTradeLayerListenerSnapshot,
  validateTradeLayerListenerDeploymentConfig
} from "../src/launch/tradelayerListenerDeployment.js";

function config(runtimeRoot: string) {
  const listener = (name: string, suffix: string, port: number, rpcPort: number) => ({
    name,
    nodeId: `node-${suffix}`,
    instanceId: `candidate10-${suffix}-20260806`,
    port,
    rpcPort,
    rpcCookieFile: path.join(runtimeRoot, `bitcoin-${suffix}`, "testnet4", ".cookie"),
    snapshotDir: path.join(runtimeRoot, `snapshot-${suffix}`),
    nedbRoot: path.join(runtimeRoot, `state-${suffix}`),
    logDir: path.join(runtimeRoot, `logs-${suffix}`)
  });
  return {
    schema: "bitagent_tradelayer_listener_deployment_config_v1",
    runtimeRoot,
    sourceRepo: path.join(runtimeRoot, "tradelayer-candidate10"),
    startupTimeoutMs: 30_000,
    listeners: [listener("a", "a", 3111, 49372), listener("b", "b", 3112, 49382)]
  };
}

test("candidate listener deployment requires two isolated targets and contains no authority", () => {
  const runtimeRoot = path.resolve(".runtime", "listener-deployment-test");
  const value = validateTradeLayerListenerDeploymentConfig(config(runtimeRoot));
  assert.equal(value.listeners.length, 2);
  assert.notEqual(value.listeners[0].snapshotDir, value.listeners[0].nedbRoot);
  assert.notEqual(value.listeners[0].port, value.listeners[1].port);
  assert.equal("approval" in value, false);
  assert.equal("signing" in value, false);
  assert.equal("broadcast" in value, false);
});

test("candidate listener deployment rejects duplicate ports, overlapping state, and secret-shaped fields", () => {
  const runtimeRoot = path.resolve(".runtime", "listener-deployment-test");
  const duplicate = config(runtimeRoot);
  duplicate.listeners[1]!.port = duplicate.listeners[0]!.port;
  assert.throws(() => validateTradeLayerListenerDeploymentConfig(duplicate), /port values must be unique/);

  const overlap = config(runtimeRoot);
  overlap.listeners[0]!.nedbRoot = path.join(overlap.listeners[0]!.snapshotDir, "copy");
  assert.throws(() => validateTradeLayerListenerDeploymentConfig(overlap), /must not overlap/);

  const secret = { ...config(runtimeRoot), rpcPassword: "prohibited" };
  assert.throws(() => validateTradeLayerListenerDeploymentConfig(secret), /unsupported fields: rpcPassword/);
});

test("snapshot inventory seals exact copied bytes and required databases", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-listener-snapshot-"));
  try {
    for (const name of ["activations.db", "persistence.db", "txIndex.db"]) {
      await fs.writeFile(path.join(directory, name), `${name}\n`, "utf8");
    }
    const first = await hashTradeLayerListenerSnapshot(directory);
    const second = await hashTradeLayerListenerSnapshot(directory);
    assert.deepEqual(first, second);
    assert.equal(first.files, 3);
    await fs.writeFile(path.join(directory, "txIndex.db"), "changed\n", "utf8");
    assert.notEqual((await hashTradeLayerListenerSnapshot(directory)).inventoryHash, first.inventoryHash);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
