import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PreparedReserveIntakeCandidate } from "../src/broker/reserveIntakeCandidateBroker.js";
import type { ReserveIntakePlan } from "../src/launch/reserveIntake.js";
import {
  buildTradeLayerReservePreflightEvidence,
  readTradeLayerReserveNodeSnapshot
} from "../src/launch/tradelayerReservePreflight.js";

function list(value: string | undefined, fallback: string[]): string[] {
  return value ? value.split(";").map((item) => item.trim()).filter(Boolean) : fallback;
}

async function main() {
  const candidatePath = path.resolve(
    process.env.RESERVE_INTAKE_CANDIDATE_PATH
      || path.join(".runtime", "testnet-agent", "reserve-intake-candidate", "prepared-candidate.json")
  );
  const outputPath = path.resolve(
    process.env.RESERVE_PREFLIGHT_OUTPUT
      || path.join(".runtime", "testnet-agent", "reserve-intake-candidate", "tradelayer-preflight.json")
  );
  const raw = JSON.parse(await fs.readFile(candidatePath, "utf8")) as PreparedReserveIntakeCandidate | ReserveIntakePlan;
  const plan = (raw as PreparedReserveIntakeCandidate).request?.plan || raw as ReserveIntakePlan;
  const databasePaths = list(process.env.TRADELAYER_PREFLIGHT_DB_PATHS, [
    path.resolve("C:\\projects\\tradelayer.js\\nedb-data\\btc-test")
  ]);
  const nodeIds = list(process.env.TRADELAYER_PREFLIGHT_NODE_IDS, databasePaths.map((_, index) => `local-listener-${index + 1}`));
  const heights = list(process.env.TRADELAYER_PREFLIGHT_BLOCK_HEIGHTS, databasePaths.map(() => "0"));
  if (nodeIds.length !== databasePaths.length || heights.length !== databasePaths.length) {
    throw new Error("TradeLayer preflight database paths, node ids, and block heights must have equal lengths");
  }
  const nodes = await Promise.all(databasePaths.map((databasePath, index) => readTradeLayerReserveNodeSnapshot({
    plan,
    nodeId: nodeIds[index]!,
    databasePath: path.resolve(databasePath),
    blockHeight: Number(heights[index])
  })));
  const evidence = buildTradeLayerReservePreflightEvidence({
    plan,
    nodes,
    now: new Date(),
    maxAgeMs: Number(process.env.TRADELAYER_PREFLIGHT_MAX_AGE_MS || 120_000),
    minimumIndependentNodes: Number(process.env.TRADELAYER_PREFLIGHT_MIN_NODES || 2),
    acceptedTx11CodeHashes: list(process.env.TRADELAYER_ACCEPTED_TX11_CODE_HASHES, [])
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: evidence.status === "verified",
    status: evidence.status,
    planHash: evidence.planHash,
    nodeCount: evidence.nodes.length,
    gates: evidence.gates,
    reasons: evidence.reasons,
    output: outputPath
  }, null, 2));
  if (evidence.status !== "verified") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
