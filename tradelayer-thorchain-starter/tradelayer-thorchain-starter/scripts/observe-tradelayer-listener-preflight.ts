import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PreparedReserveIntakeCandidate } from "../src/broker/reserveIntakeCandidateBroker.js";
import type { ReserveIntakePlan } from "../src/launch/reserveIntake.js";
import {
  buildTradeLayerListenerPreflightEvidence,
  observeTradeLayerListener
} from "../src/launch/tradelayerListenerPreflight.js";
import { validateTx11ReleaseManifest } from "../src/launch/tradelayerRelease.js";

function list(value: string | undefined): string[] {
  return (value || "").split(";").map((item) => item.trim()).filter(Boolean);
}

async function main() {
  const candidatePath = path.resolve(process.env.RESERVE_INTAKE_CANDIDATE_PATH
    || path.join(".runtime", "testnet-agent", "reserve-intake-candidate", "prepared-candidate.json"));
  const outputPath = path.resolve(process.env.LISTENER_PREFLIGHT_OUTPUT
    || path.join(".runtime", "testnet-agent", "reserve-intake-candidate", "listener-preflight.json"));
  const manifestPath = path.resolve("config", "tradelayer-tx11-release.json");
  const [rawCandidate, rawManifest] = await Promise.all([
    fs.readFile(candidatePath, "utf8"),
    fs.readFile(manifestPath, "utf8")
  ]);
  const candidate = JSON.parse(rawCandidate) as PreparedReserveIntakeCandidate | ReserveIntakePlan;
  const plan = (candidate as PreparedReserveIntakeCandidate).request?.plan || candidate as ReserveIntakePlan;
  const manifest = validateTx11ReleaseManifest(JSON.parse(rawManifest));
  const endpoints = list(process.env.TRADELAYER_PREFLIGHT_ENDPOINTS);
  if (endpoints.length < 2) throw new Error("At least two TRADELAYER_PREFLIGHT_ENDPOINTS are required");
  const observations = await Promise.all(endpoints.map((endpoint) => observeTradeLayerListener({
    plan,
    endpoint,
    timeoutMs: Number(process.env.TRADELAYER_PREFLIGHT_TIMEOUT_MS || 5_000),
    maxResponseBytes: Number(process.env.TRADELAYER_PREFLIGHT_MAX_RESPONSE_BYTES || 1_000_000)
  })));
  const evidence = buildTradeLayerListenerPreflightEvidence({
    plan,
    observations,
    now: new Date(),
    maxAgeMs: Number(process.env.TRADELAYER_PREFLIGHT_MAX_AGE_MS || 120_000),
    maxSyncLagBlocks: Number(process.env.TRADELAYER_PREFLIGHT_MAX_LAG_BLOCKS || 2),
    minimumIndependentNodes: Number(process.env.TRADELAYER_PREFLIGHT_MIN_NODES || 2),
    acceptedTx11CodeHashes: [manifest.codeHash],
    acceptedReleaseCommits: manifest.tradelayerCommits
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: evidence.status === "verified",
    status: evidence.status,
    planHash: evidence.planHash,
    listenerCount: evidence.observations.length,
    independenceClaim: evidence.independenceClaim,
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
