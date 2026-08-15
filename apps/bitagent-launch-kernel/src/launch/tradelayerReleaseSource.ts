import path from "node:path";
import type { Tx11ReleaseVerification } from "./tradelayerRelease.js";

export type GitWorktreeRecord = {
  path: string;
  head: string;
  detached: boolean;
  branch?: string;
};

export type Tx11ReleaseSourceCandidate = GitWorktreeRecord & {
  trackedClean: boolean;
  verification?: Tx11ReleaseVerification;
  rejectionReasons: string[];
};

function normalizedPath(value: string): string {
  return path.resolve(value).replaceAll("\\", "/").toLowerCase();
}

export function parseGitWorktreePorcelain(output: string): GitWorktreeRecord[] {
  const records: GitWorktreeRecord[] = [];
  let current: Partial<GitWorktreeRecord> | undefined;
  const flush = () => {
    if (!current) return;
    if (!current.path || !current.head || !/^[a-f0-9]{40}$/i.test(current.head)) {
      throw new Error("Git worktree inventory contained an incomplete worktree record");
    }
    records.push({
      path: current.path,
      head: current.head.toLowerCase(),
      detached: current.detached === true,
      ...(current.branch ? { branch: current.branch } : {})
    });
    current = undefined;
  };

  for (const line of output.replaceAll("\r\n", "\n").split("\n")) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: line.slice("worktree ".length) };
    } else if (line.startsWith("HEAD ")) {
      if (!current) throw new Error("Git worktree inventory listed HEAD before worktree");
      current.head = line.slice("HEAD ".length);
    } else if (line === "detached") {
      if (!current) throw new Error("Git worktree inventory listed detached before worktree");
      current.detached = true;
    } else if (line.startsWith("branch ")) {
      if (!current) throw new Error("Git worktree inventory listed branch before worktree");
      current.branch = line.slice("branch ".length);
    }
  }
  flush();
  return records;
}

export function selectVerifiedTx11ReleaseSource(
  candidates: Tx11ReleaseSourceCandidate[],
  preferredPath?: string
): Tx11ReleaseSourceCandidate {
  const eligible = candidates.filter((candidate) =>
    candidate.trackedClean
    && candidate.verification?.sourceVerified === true
    && candidate.verification.deploymentVerified === false
    && candidate.verification.executable === false
    && candidate.rejectionReasons.length === 0
  );
  if (!eligible.length) {
    throw new Error("No tracked-clean worktree matches the exact TradeLayer tx11 candidate release");
  }
  if (preferredPath) {
    const preferred = eligible.find((candidate) => normalizedPath(candidate.path) === normalizedPath(preferredPath));
    if (preferred) return preferred;
  }
  return [...eligible].sort((left, right) => normalizedPath(left.path).localeCompare(normalizedPath(right.path)))[0]!;
}
