import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeAtomicStatusFile } from "../src/launch/atomicStatusFile.js";

test("retries transient Windows rename contention and seals the exact status", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-atomic-status-"));
  const output = path.join(root, "status.json");
  let attempts = 0;
  try {
    await writeAtomicStatusFile(output, { status: "running", height: 118765 }, {
      retryDelayMs: 0,
      rename: async (source, target) => {
        attempts += 1;
        if (attempts < 3) throw Object.assign(new Error("simulated Windows contention"), { code: "EPERM" });
        await fs.rename(source, target);
      }
    });
    assert.equal(attempts, 3);
    assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), { status: "running", height: 118765 });
    assert.deepEqual(await fs.readdir(root), ["status.json"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("exhausted rename contention preserves the prior receipt and removes temp state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-atomic-status-"));
  const output = path.join(root, "status.json");
  await fs.writeFile(output, '{"status":"prior"}\n', "utf8");
  let attempts = 0;
  try {
    await assert.rejects(() => writeAtomicStatusFile(output, { status: "new" }, {
      maxRenameAttempts: 3,
      retryDelayMs: 0,
      rename: async () => {
        attempts += 1;
        throw Object.assign(new Error("simulated permanent contention"), { code: "EBUSY" });
      }
    }), /simulated permanent contention/);
    assert.equal(attempts, 3);
    assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), { status: "prior" });
    assert.deepEqual(await fs.readdir(root), ["status.json"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
