import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { testnetAgentRuntimeDir } from "../src/config.js";
import { runTestnetEconomicAgent } from "../src/economy/harness.js";

async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDirectory = path.join(testnetAgentRuntimeDir, "runs", runId);
  const latestDirectory = path.join(testnetAgentRuntimeDir, "latest");
  const result = await runTestnetEconomicAgent({
    runtimeDirectory: runDirectory,
    probeFilecoin: process.env.FILECOIN_PROBE === "true"
  });

  await fs.mkdir(latestDirectory, { recursive: true });
  await fs.writeFile(path.join(runDirectory, "summary.json"), `${JSON.stringify(result, null, 2)}\n`);
  await fs.writeFile(path.join(runDirectory, "activities.jsonl"), `${result.activities.map((row) => JSON.stringify(row)).join("\n")}\n`);
  await fs.copyFile(path.join(runDirectory, "summary.json"), path.join(latestDirectory, "summary.json"));
  await fs.copyFile(path.join(runDirectory, "activities.jsonl"), path.join(latestDirectory, "activities.jsonl"));
  await fs.copyFile(result.trade.artifactPath, path.join(latestDirectory, "tradelayer-testnet-vwap.json"));

  console.log(JSON.stringify({
    ok: true,
    mode: result.mode,
    summary: path.join(latestDirectory, "summary.json"),
    tradePrints: result.trade.artifact.tradePrints.length,
    settlementStatus: result.trade.settlementStatus,
    projectedOperatingMarginSats: result.projection.projectedOperatingMarginSats,
    projectedSelfSustaining: result.projection.projectedSelfSustaining,
    spendableProfitSats: result.projection.spendableProfitSats,
    infrastructureDecisions: result.infrastructure.authorizations.map((row) => row.decision.decision)
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});

