import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { externalRepos } from "../src/config.js";
import {
  validateTx11ReleaseManifest,
  verifyLocalTx11Release
} from "../src/launch/tradelayerRelease.js";
import {
  parseGitWorktreePorcelain,
  selectVerifiedTx11ReleaseSource,
  type Tx11ReleaseSourceCandidate
} from "../src/launch/tradelayerReleaseSource.js";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: npm run demo:onboard -- [options]

Runs the read-only release-source gate before the onboarding demo. The demo
obtains a fresh quote but never signs, broadcasts, or moves funds.

Required environment:
  DEST_BTC_ADDRESS or DEST_LTC_ADDRESS   destination address for the quote

Optional environment:
  NEAR_INTENTS_REFUND_ADDRESS             origin-wallet refund address for NEAR Intents
  AMOUNT_IN_TOKEN_UNITS                   quote amount (default is demo-only)
  SOURCE_ASSET, SOURCE_CHAIN, DEST_ASSET  supported quote overrides

Use npm run preflight:launch:release for the release gate only.`);
  process.exit(0);
}

const execFileAsync = promisify(execFile);
const root = process.cwd();
const configRoot = path.join(root, "config");
const manifestPath = path.resolve(process.env.BITAGENT_TRADELAYER_RELEASE_MANIFEST
  || path.join(configRoot, "tradelayer-tx11-release.json"));
const manifestRelative = path.relative(configRoot, manifestPath);
if (manifestRelative === "" || manifestRelative.startsWith("..") || path.isAbsolute(manifestRelative)
  || path.extname(manifestPath).toLowerCase() !== ".json") {
  throw new Error("TradeLayer release manifest must be a JSON child of the project config directory");
}
const outputPath = path.resolve(process.env.BITAGENT_TRADELAYER_RELEASE_SOURCE_RECEIPT
  || path.join(root, ".runtime", "testnet-agent", "tx11-launch-source.json"));

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repo, ...args], {
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
  return stdout;
}

async function inspectCandidate(
  worktree: ReturnType<typeof parseGitWorktreePorcelain>[number],
  manifest: ReturnType<typeof validateTx11ReleaseManifest>
): Promise<Tx11ReleaseSourceCandidate> {
  const rejectionReasons: string[] = [];
  if (manifest.deploymentCommit !== worktree.head) {
    rejectionReasons.push("worktree_commit_not_deployment_commit");
    return { ...worktree, trackedClean: false, rejectionReasons };
  }
  let trackedClean = false;
  try {
    trackedClean = (await git(worktree.path, ["status", "--porcelain", "--untracked-files=no"])).trim() === "";
  } catch {
    rejectionReasons.push("worktree_status_unavailable");
    return { ...worktree, trackedClean, rejectionReasons };
  }
  if (!trackedClean) {
    rejectionReasons.push("tracked_worktree_dirty");
    return { ...worktree, trackedClean, rejectionReasons };
  }
  try {
    const verification = verifyLocalTx11Release({
      manifest,
      tradelayerRepo: worktree.path,
      currentCommit: worktree.head
    });
    rejectionReasons.push(...verification.reasons);
    return { ...worktree, trackedClean, verification, rejectionReasons };
  } catch {
    rejectionReasons.push("release_source_verification_error");
    return { ...worktree, trackedClean, rejectionReasons };
  }
}

async function main() {
  const manifest = validateTx11ReleaseManifest(JSON.parse(await fs.readFile(manifestPath, "utf8")));
  const inventory = parseGitWorktreePorcelain(await git(externalRepos.tradelayer, ["worktree", "list", "--porcelain"]));
  const inspected = await Promise.all(inventory.map((worktree) => inspectCandidate(worktree, manifest)));
  const selected = selectVerifiedTx11ReleaseSource(inspected, externalRepos.tradelayer);
  const verification = selected.verification!;
  const receipt = {
    schema: "bitagent.tradelayer.tx11-launch-source.v1",
    verifiedAt: new Date().toISOString(),
    authority: "read_only_observer",
    effect: "none",
    releaseId: manifest.releaseId,
    releaseStatus: manifest.status,
    selectedSource: {
      path: selected.path,
      commit: selected.head,
      codeHash: verification.currentCodeHash,
      trackedClean: selected.trackedClean,
      sourceVerified: verification.sourceVerified
    },
    deploymentVerified: false,
    executable: false,
    inspectedWorktrees: inspected.map((candidate) => ({
      path: candidate.path,
      commit: candidate.head,
      trackedClean: candidate.trackedClean,
      sourceVerified: candidate.verification?.sourceVerified === true,
      rejectionReasons: candidate.rejectionReasons
    }))
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    selectedSource: receipt.selectedSource,
    releaseStatus: receipt.releaseStatus,
    deploymentVerified: receipt.deploymentVerified,
    executable: receipt.executable,
    receipt: path.relative(root, outputPath)
  }, null, 2));

  if (process.argv.includes("--verify-only")) return;
  const childNpmScript = process.argv.includes("--demo-onboard")
    ? "demo:onboard:direct"
    : process.argv.includes("--preflight")
      ? "preflight:launch"
      : "test:launch";
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `npm run ${childNpmScript}`]
    : ["run", childNpmScript];
  const nodePath = [
    path.join(selected.path, "node_modules"),
    path.join(externalRepos.tradelayer, "node_modules"),
    process.env.NODE_PATH
  ].filter((value): value is string => !!value).join(path.delimiter);
  await new Promise<void>((resolve, reject) => {
    const child = execFile(command, args, {
      cwd: root,
      env: { ...process.env, NODE_PATH: nodePath, TRADELAYER_JS_REPO: selected.path },
      windowsHide: true
    });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${childNpmScript} exited with code ${code}`)));
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
