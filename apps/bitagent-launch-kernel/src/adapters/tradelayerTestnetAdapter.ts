import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { externalRepos } from "../config.js";
import type { TradeLayerTestnetArtifact, TradeLayerTestnetRun } from "../economy/types.js";
import { IntegrationBoundaryError } from "../types.js";

const execFileAsync = promisify(execFile);

function validateArtifact(value: unknown): TradeLayerTestnetArtifact {
  const artifact = value as Partial<TradeLayerTestnetArtifact>;
  if (
    artifact.kind !== "tradelayer_btctest_vwap_trade_history" ||
    artifact.network !== "BTCTEST" ||
    artifact.bitcoinNetwork !== "testnet4" ||
    artifact.dryRun !== true ||
    !Array.isArray(artifact.steps) ||
    !Array.isArray(artifact.tradePrints) ||
    artifact.tradePrints.length === 0
  ) {
    throw new IntegrationBoundaryError("tradelayer_trade_error", "TradeLayer testnet planner returned an invalid artifact", value);
  }
  if (artifact.tradePrints.some((trade) => trade.makerTxid || trade.takerTxid)) {
    throw new IntegrationBoundaryError("tradelayer_trade_error", "Dry-run artifact unexpectedly contains broadcast transaction IDs");
  }
  return artifact as TradeLayerTestnetArtifact;
}

export async function runTradeLayerTestnetMock(input: {
  runtimeDirectory: string;
  tradelayerRepo?: string;
}): Promise<TradeLayerTestnetRun> {
  const tradelayerRepo = input.tradelayerRepo || externalRepos.tradelayer;
  const scriptPath = path.join(tradelayerRepo, "scripts", "broadcastBtctestVwapTrades.js");
  const artifactPath = path.resolve(input.runtimeDirectory, "tradelayer-testnet-vwap.json");
  await fs.mkdir(input.runtimeDirectory, { recursive: true });

  try {
    await fs.access(scriptPath);
    await execFileAsync(process.execPath, [scriptPath, "--dry-run", `--artifact=${artifactPath}`], {
      cwd: tradelayerRepo,
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024
    });
    const artifact = validateArtifact(JSON.parse(await fs.readFile(artifactPath, "utf8")));
    const transactionIds = artifact.steps.flatMap((step) => (step.txid ? [step.txid] : []));
    return {
      mode: "testnet_dry_run",
      artifactPath,
      artifact,
      transactionIds,
      settlementStatus: transactionIds.length > 0 ? "settled" : "unsettled"
    };
  } catch (error) {
    if (error instanceof IntegrationBoundaryError) throw error;
    throw new IntegrationBoundaryError("tradelayer_trade_error", "Failed to construct TradeLayer BTC testnet4 mock trades", error);
  }
}

export function prepareTradeLayerTestnetSubmission(input: {
  artifactPath: string;
  tradelayerRepo?: string;
}): { status: "external_broker_required"; executable: string; args: string[]; requiredEnvironment: string[] } {
  const tradelayerRepo = input.tradelayerRepo || externalRepos.tradelayer;
  return {
    status: "external_broker_required",
    executable: process.execPath,
    args: [path.join(tradelayerRepo, "scripts", "broadcastBtctestVwapTrades.js"), `--artifact=${path.resolve(input.artifactPath)}`],
    requiredEnvironment: ["BITCOIN_BIN", "BTCTEST_DATADIR", "BTCTEST_WALLET", "TL_TESTNET_SUBMIT=true"]
  };
}

