import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { externalRepos } from "../src/config.js";
import {
  validateTx11ReleaseManifest,
  verifyLocalTx11Release
} from "../src/launch/tradelayerRelease.js";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const manifestPath = path.join(root, "config", "tradelayer-tx11-release.json");
const outputPath = path.join(root, ".runtime", "testnet-agent", "tx11-release-verification.json");

async function main() {
  const manifest = validateTx11ReleaseManifest(JSON.parse(await fs.readFile(manifestPath, "utf8")));
  const { stdout } = await execFileAsync("git", ["-C", externalRepos.tradelayer, "rev-parse", "HEAD"], {
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  const verification = verifyLocalTx11Release({
    manifest,
    tradelayerRepo: externalRepos.tradelayer,
    currentCommit: stdout.trim()
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(verification, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    sourceVerified: verification.sourceVerified,
    deploymentVerified: verification.deploymentVerified,
    executable: verification.executable,
    releaseId: verification.releaseId,
    releaseStatus: verification.releaseStatus,
    currentCodeHash: verification.currentCodeHash,
    currentCommit: verification.currentCommit,
    reasons: verification.reasons,
    output: path.relative(root, outputPath)
  }, null, 2));
  if (!verification.sourceVerified) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
