import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGitWorktreePorcelain,
  selectVerifiedTx11ReleaseSource,
  type Tx11ReleaseSourceCandidate
} from "../src/launch/tradelayerReleaseSource.js";

const verification = {
  schema: "bitagent.tradelayer.tx11-release-verification.v1" as const,
  verifiedAt: "2026-08-06T00:00:00.000Z",
  authority: "read_only_observer" as const,
  effect: "none" as const,
  releaseId: "candidate-8",
  releaseStatus: "candidate_not_deployed",
  manifestCodeHash: "11".repeat(32),
  currentCodeHash: "11".repeat(32),
  currentCommit: "aa".repeat(20),
  sourceFileParity: true,
  commitIncluded: true,
  sourceVerified: true,
  deploymentVerified: false as const,
  executable: false as const,
  reasons: []
};

test("parses branch and detached Git worktree inventory records", () => {
  const records = parseGitWorktreePorcelain([
    "worktree C:/projects/tradelayer.js",
    `HEAD ${"11".repeat(20)}`,
    "branch refs/heads/master",
    "",
    "worktree D:/candidate8",
    `HEAD ${"aa".repeat(20)}`,
    "detached",
    ""
  ].join("\n"));
  assert.deepEqual(records, [
    { path: "C:/projects/tradelayer.js", head: "11".repeat(20), detached: false, branch: "refs/heads/master" },
    { path: "D:/candidate8", head: "aa".repeat(20), detached: true }
  ]);
});

test("selects only an exact verified, tracked-clean, non-executable release source", () => {
  const candidates: Tx11ReleaseSourceCandidate[] = [
    {
      path: "C:/dirty",
      head: verification.currentCommit,
      detached: false,
      trackedClean: false,
      rejectionReasons: ["tracked_worktree_dirty"]
    },
    {
      path: "D:/candidate8",
      head: verification.currentCommit,
      detached: true,
      trackedClean: true,
      verification,
      rejectionReasons: []
    }
  ];
  assert.equal(selectVerifiedTx11ReleaseSource(candidates, "C:/dirty").path, "D:/candidate8");
  assert.throws(
    () => selectVerifiedTx11ReleaseSource(candidates.map((candidate) => ({ ...candidate, trackedClean: false }))),
    /No tracked-clean worktree/
  );
});
