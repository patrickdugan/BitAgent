import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { hashObject } from "../launch/canonical.js";
import { SignalKernelError } from "./errors.js";
import type {
  ApprovedSignalCodebase,
  CodebaseFileCommitment,
  CodebaseVerification,
  SignalCodebaseCommitment
} from "./types.js";

const execFileAsync = promisify(execFile);
const EXCLUDED_DIRECTORIES = new Set([".git", ".runtime", "coverage", "dist", "node_modules"]);
const SOURCE_EXTENSIONS = new Set([
  ".cjs", ".go", ".java", ".js", ".json", ".lock", ".mjs", ".py", ".rs",
  ".sol", ".toml", ".ts", ".tsx", ".vy", ".yaml", ".yml"
]);
const SECRET_FILE = /(^|[._-])(credential|mnemonic|private[-_]?key|secret|seed|wif)([._-]|$)|^\.env/i;

async function sourceFiles(rootPath: string): Promise<CodebaseFileCommitment[]> {
  const root = path.resolve(rootPath);
  const rows: CodebaseFileCommitment[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new SignalKernelError("codebase_mismatch", `Symlinks are not allowed in a source-tree commitment: ${absolute}`);
      }
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (!entry.isFile() || (extension && !SOURCE_EXTENSIONS.has(extension))) continue;
      if (SECRET_FILE.test(entry.name)) {
        throw new SignalKernelError("secret_material_prohibited", `Secret-like file cannot enter a codebase commitment: ${entry.name}`);
      }
      const stat = await fs.stat(absolute);
      if (stat.size > 5 * 1024 * 1024) {
        throw new SignalKernelError("codebase_mismatch", `Source file exceeds the 5 MiB commitment limit: ${entry.name}`);
      }
      const content = await fs.readFile(absolute);
      rows.push({
        path: path.relative(root, absolute).split(path.sep).join("/"),
        sha256: crypto.createHash("sha256").update(content).digest("hex"),
        sizeBytes: content.byteLength
      });
      if (rows.length > 10_000) {
        throw new SignalKernelError("codebase_mismatch", "Source-tree commitment exceeds the 10,000-file safety limit");
      }
    }
  }

  await walk(root);
  if (rows.length === 0) throw new SignalKernelError("codebase_mismatch", "Codebase contains no supported source files");
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

export async function computeSourceTreeCommitment(rootPath: string) {
  const files = await sourceFiles(rootPath);
  return {
    algorithm: "sha256-source-tree-v1" as const,
    digest: hashObject({ algorithm: "sha256-source-tree-v1", files }),
    files
  };
}

export async function computeGitCommitment(rootPath: string) {
  try {
    const [head, status] = await Promise.all([
      execFileAsync("git", ["-C", path.resolve(rootPath), "rev-parse", "HEAD"], { windowsHide: true }),
      execFileAsync("git", ["-C", path.resolve(rootPath), "status", "--porcelain", "--untracked-files=all"], {
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024
      })
    ]);
    const digest = head.stdout.trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(digest)) {
      throw new SignalKernelError("codebase_mismatch", "Git did not return a full 40-character commit");
    }
    const dirtyEntries = status.stdout.split(/\r?\n/).filter(Boolean);
    return { digest, clean: dirtyEntries.length === 0, dirtyEntries };
  } catch (error) {
    if (error instanceof SignalKernelError) throw error;
    throw new SignalKernelError("codebase_mismatch", "Unable to inspect the configured Git codebase", error);
  }
}

export class SignalCodebaseVerifier {
  private readonly approved = new Map<string, ApprovedSignalCodebase>();

  constructor(approvedCodebases: ApprovedSignalCodebase[]) {
    for (const item of approvedCodebases) {
      const key = `${item.codebaseId}:${item.kind}:${item.digest.toLowerCase()}`;
      if (this.approved.has(key)) throw new Error(`Duplicate approved codebase: ${key}`);
      this.approved.set(key, { ...item, digest: item.digest.toLowerCase(), rootPath: path.resolve(item.rootPath) });
    }
  }

  async verify(commitment: SignalCodebaseCommitment, now = new Date()): Promise<CodebaseVerification> {
    const digest = commitment.digest.toLowerCase();
    const approved = this.approved.get(`${commitment.codebaseId}:${commitment.kind}:${digest}`);
    if (!approved) {
      throw new SignalKernelError(
        "codebase_unapproved",
        `Codebase commitment is not operator-allowlisted: ${commitment.codebaseId}@${digest}`
      );
    }

    if (commitment.kind === "git_commit") {
      const observed = await computeGitCommitment(approved.rootPath);
      if (!observed.clean) {
        throw new SignalKernelError("codebase_dirty", "Approved Git codebase has local modifications or untracked files");
      }
      if (observed.digest !== digest) {
        throw new SignalKernelError("codebase_mismatch", "Approved Git codebase HEAD no longer matches the signal");
      }
      return {
        codebaseId: commitment.codebaseId,
        kind: commitment.kind,
        expectedDigest: digest,
        observedDigest: observed.digest,
        clean: true,
        verifiedAt: now.toISOString()
      };
    }

    let observed: Awaited<ReturnType<typeof computeSourceTreeCommitment>>;
    try {
      observed = await computeSourceTreeCommitment(approved.rootPath);
    } catch (error) {
      if (error instanceof SignalKernelError) throw error;
      throw new SignalKernelError("codebase_mismatch", "Unable to inspect the configured source-tree codebase", error);
    }
    if (observed.digest !== digest) {
      throw new SignalKernelError("codebase_mismatch", "Approved source tree no longer matches the signal");
    }
    return {
      codebaseId: commitment.codebaseId,
      kind: commitment.kind,
      expectedDigest: digest,
      observedDigest: observed.digest,
      clean: true,
      verifiedAt: now.toISOString(),
      fileCount: observed.files.length
    };
  }
}
