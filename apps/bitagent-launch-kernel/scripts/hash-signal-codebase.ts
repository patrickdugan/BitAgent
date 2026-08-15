import "dotenv/config";
import path from "node:path";
import { computeGitCommitment, computeSourceTreeCommitment } from "../src/signals/codebaseVerifier.js";

async function main() {
  const rootPath = path.resolve(
    process.argv.find((argument) => !argument.startsWith("--") && argument !== process.argv[0] && argument !== process.argv[1])
      || process.env.SIGNAL_CODEBASE_REPO
      || "C:\\projects\\Trading Algos"
  );
  const kind = process.argv.includes("--git") ? "git_commit" : "sha256_source_tree";
  if (kind === "git_commit") {
    const result = await computeGitCommitment(rootPath);
    if (!result.clean) throw new Error("Git codebase is dirty; commit or remove every change before allowlisting it");
    console.log(JSON.stringify({
      codebaseId: process.env.SIGNAL_CODEBASE_ID || "operator-trading-algorithms",
      kind,
      digest: result.digest,
      rootPath,
      clean: result.clean
    }, null, 2));
    return;
  }
  const result = await computeSourceTreeCommitment(rootPath);
  console.log(JSON.stringify({
    codebaseId: process.env.SIGNAL_CODEBASE_ID || "operator-trading-algorithms",
    kind,
    digest: result.digest,
    rootPath,
    fileCount: result.files.length,
    algorithm: result.algorithm
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
