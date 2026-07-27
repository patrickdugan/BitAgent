import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "skills", "tradelayer-collateral-lifecycle");
const validator = path.join(skillRoot, "scripts", "validate-lifecycle-receipt.mjs");
const example = path.join(skillRoot, "references", "scripted-receipt.example.json");

function run(filePath: string) {
  return spawnSync(process.execPath, [validator, filePath], {
    cwd: root,
    encoding: "utf8"
  });
}

test("lifecycle skill example passes the deterministic receipt validator", () => {
  const output = execFileSync(process.execPath, [validator, example], {
    cwd: root,
    encoding: "utf8"
  });
  const result = JSON.parse(output);
  assert.equal(result.ok, true);
  assert.equal(result.settledPnlSats, "5000");
  assert.equal(result.withdrawnPnlSats, "4000");
});

test("lifecycle validator rejects withdrawal above released PnL", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-lifecycle-skill-"));
  const receipt = JSON.parse(await fs.readFile(example, "utf8"));
  receipt.withdrawal.amountSats = "5001";
  const filePath = path.join(directory, "overdrawn.json");
  await fs.writeFile(filePath, JSON.stringify(receipt), "utf8");
  const result = run(filePath);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /withdrawal exceeds released PnL/);
});

test("lifecycle validator rejects open-order PnL claims", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-lifecycle-skill-"));
  const receipt = JSON.parse(await fs.readFile(example, "utf8"));
  receipt.order.positionOrOrderState = "open";
  const filePath = path.join(directory, "open-order.json");
  await fs.writeFile(filePath, JSON.stringify(receipt), "utf8");
  const result = run(filePath);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be filled or closed/);
});

test("lifecycle validator rejects production receipts backed by scripted evidence", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-lifecycle-skill-"));
  const receipt = JSON.parse(await fs.readFile(example, "utf8"));
  receipt.mode = "production";
  receipt.network = "bitcoin";
  const filePath = path.join(directory, "fake-production.json");
  await fs.writeFile(filePath, JSON.stringify(receipt), "utf8");
  const result = run(filePath);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot be scripted in production/);
});

test("lifecycle validator rejects secret-like fields anywhere in the receipt", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-lifecycle-skill-"));
  const receipt = JSON.parse(await fs.readFile(example, "utf8"));
  receipt.wallet = { seedPhrase: "must never be persisted" };
  const filePath = path.join(directory, "secret.json");
  await fs.writeFile(filePath, JSON.stringify(receipt), "utf8");
  const result = run(filePath);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /secret-like field is prohibited/);
});
