import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { launchToolSchemas } from "../src/launch/tools.js";
import { committedSignalToolSchemas } from "../src/signals/tools.js";
import { financialSurvivalToolSchemas } from "../src/survival/tools.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifact = path.join(root, "training", "artifacts", "bonsai-role-corpus-v1", "tool-contracts.json");

test("Bonsai tool contract bundle mirrors production schemas and denies effectful model calls", async () => {
  const bundle = JSON.parse(await fs.readFile(artifact, "utf8"));
  assert.equal(bundle.schema, "hermes.bitagent_tool_contract_bundle.v1");
  assert.equal(bundle.authority.modelOutputIsCandidateOnly, true);
  assert.equal(bundle.authority.approvalSigningBroadcastExecutionHostOwned, true);

  const expected = {
    ...launchToolSchemas,
    ...committedSignalToolSchemas,
    ...financialSurvivalToolSchemas
  };
  assert.deepEqual(Object.keys(bundle.contracts).sort(), Object.keys(expected).sort());
  for (const [name, schema] of Object.entries(expected)) {
    assert.deepEqual(bundle.contracts[name].inputSchema, schema, name);
  }

  for (const contract of Object.values(bundle.contracts) as Array<Record<string, unknown>>) {
    if (contract.effect !== "none") assert.equal(contract.modelCallable, false);
  }
  assert.equal(bundle.contracts["bitagent.strategy.simulate"].modelCallable, true);
  assert.equal(bundle.contracts["bitagent.survival.evaluate"].modelCallable, true);
  assert.equal(bundle.contracts["bitagent.survival.evaluate"].effect, "none");
  assert.equal(bundle.contracts["bitagent.action.execute"].modelCallable, false);
  assert.equal(bundle.contracts["bitagent.wallet.request_approval"].modelCallable, false);
});
