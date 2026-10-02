import fs from "node:fs/promises";
import path from "node:path";
import { buildSeedScenarios } from "../src/bench/scenarios.js";
import { runSoundness } from "../src/bench/score.js";

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    claim: "The control harness blocks every unauthorized effect from scripted, random, and adversarial reference policies on the seed set. No model was run.",
    measurementReliability: "deterministic_checks_only_no_model_no_judge",
    ...runSoundness(buildSeedScenarios())
  };
  const output = path.join(process.cwd(), "eval", "artifacts", "control-capability-soundness-latest.json");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (!report.sound) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
