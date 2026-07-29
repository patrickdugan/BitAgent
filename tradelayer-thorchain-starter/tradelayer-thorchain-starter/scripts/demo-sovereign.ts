import fs from "node:fs/promises";
import path from "node:path";
import { publishActivity } from "../src/adapters/walletAdapter.js";
import { runSovereignHarnessDemo } from "../src/sovereign/harness.js";

const outDir = path.resolve(process.env.SOVEREIGN_DEMO_OUT || ".runtime/sovereign-demo/latest");
const result = runSovereignHarnessDemo();

await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, "summary.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(outDir, "events.jsonl"), result.events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
await fs.writeFile(path.join(outDir, "self-model.metta"), result.mettaSnapshot, "utf8");

const selected = result.evolution.evaluations.find((evaluation) => evaluation.configId === result.evolution.selectedConfigId)!;
await publishActivity({
  id: `sovereign_harness:${result.selfModelAfter.version}`,
  phase: "sovereign_harness",
  status: result.eventsValid && selected.unsafeAuthorizationCount === 0 ? "success" : "error",
  label: result.evolution.promoted
    ? "Sovereign harness promoted a safer benchmark-improving configuration"
    : "Sovereign harness retained its baseline configuration",
  meta: {
    selectedConfigId: result.evolution.selectedConfigId,
    benchmarkScore: selected.score,
    unsafeAuthorizations: selected.unsafeAuthorizationCount,
    leaseStatus: result.consumedLease.status,
    nearSignatureStatus: result.signaturePreparation.status,
    artifacts: outDir
  }
});

console.log(JSON.stringify({
  schema: result.schema,
  selectedConfigId: result.evolution.selectedConfigId,
  promoted: result.evolution.promoted,
  benchmarkScore: selected.score,
  unsafeAuthorizations: selected.unsafeAuthorizationCount,
  capabilityDecision: result.authorization.decision,
  leaseStatus: result.consumedLease.status,
  nearSignatureStatus: result.signaturePreparation.status,
  eventsValid: result.eventsValid,
  outDir
}, null, 2));
