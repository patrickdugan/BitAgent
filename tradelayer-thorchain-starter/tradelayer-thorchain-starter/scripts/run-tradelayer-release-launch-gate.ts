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

const execFileAsync = promisify(execFile);
const root = process.cwd();
const manifestPath = path.join(root, "config", "tradelayer-tx11-release.json");
const outputPath = path.join(root, ".runtime", "testnet-agent", "tx11-launch-source.json");

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
  const childNpmScript = process.argv.includes("--preflight") ? "preflight:launch" : "test:launch";
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `npm run ${childNpmScript}`]
    : ["run", childNpmScript];
  await new Promise<void>((resolve, reject) => {
    const child = execFile(command, args, {
      cwd: root,
      env: { ...process.env, TRADELAYER_JS_REPO: selected.path },
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
