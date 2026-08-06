import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export type Tx11ReleaseManifest = {
  schema: "bitagent.tradelayer.tx11-release.v1";
  releaseId: string;
  status: string;
  codeHash: string;
  deploymentCommit: string;
  tradelayerCommits: string[];
  consensusSourceFiles: string[];
  promotionRequirements: string[];
};

export type Tx11ReleaseVerification = {
  schema: "bitagent.tradelayer.tx11-release-verification.v1";
  verifiedAt: string;
  authority: "read_only_observer";
  effect: "none";
  releaseId: string;
  releaseStatus: string;
  manifestCodeHash: string;
  currentCodeHash: string | null;
  currentCommit: string;
  sourceFileParity: boolean;
  commitIncluded: boolean;
  sourceVerified: boolean;
  deploymentVerified: false;
  executable: false;
  reasons: string[];
};

function isHex32(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function validateTx11ReleaseManifest(value: unknown): Tx11ReleaseManifest {
  const manifest = value as Partial<Tx11ReleaseManifest>;
  if (!manifest || manifest.schema !== "bitagent.tradelayer.tx11-release.v1") {
    throw new Error("TradeLayer tx11 release manifest schema is invalid");
  }
  if (!manifest.releaseId?.trim() || !manifest.status?.trim() || !isHex32(manifest.codeHash)
    || !/^[a-f0-9]{40}$/.test(manifest.deploymentCommit || "")) {
    throw new Error("TradeLayer tx11 release identity, status, or code hash is invalid");
  }
  for (const [label, list] of Object.entries({
    tradelayerCommits: manifest.tradelayerCommits,
    consensusSourceFiles: manifest.consensusSourceFiles,
    promotionRequirements: manifest.promotionRequirements
  })) {
    if (!Array.isArray(list) || !list.length || list.some((item) => typeof item !== "string" || !item.trim())) {
      throw new Error(`TradeLayer tx11 release ${label} must be a non-empty string list`);
    }
  }
  if (manifest.tradelayerCommits!.some((commit) => !/^[a-f0-9]{40}$/.test(commit))) {
    throw new Error("TradeLayer tx11 release commits must be full 40-byte hex object IDs");
  }
  if (manifest.tradelayerCommits!.at(-1) !== manifest.deploymentCommit) {
    throw new Error("TradeLayer tx11 deployment commit must be the release lineage head");
  }
  return manifest as Tx11ReleaseManifest;
}

export function verifyLocalTx11Release(input: {
  manifest: Tx11ReleaseManifest;
  tradelayerRepo: string;
  currentCommit: string;
  now?: Date;
}): Tx11ReleaseVerification {
  const manifest = validateTx11ReleaseManifest(input.manifest);
  const currentCommit = input.currentCommit.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(currentCommit)) {
    throw new Error("Current TradeLayer commit must be a full 40-byte hex object ID");
  }
  const profilePath = path.join(input.tradelayerRepo, "scripts", "testnetActivationProfile.js");
  const profile = require(profilePath) as {
    CONSENSUS_SOURCE_FILES: string[];
    codeHashFromSource(sourceDirectory?: string): string;
  };
  const canonicalFiles = profile.CONSENSUS_SOURCE_FILES.map((file) => `${file}.js`);
  const currentCodeHash = profile.codeHashFromSource(path.join(input.tradelayerRepo, "src"));
  const sourceFileParity = JSON.stringify(manifest.consensusSourceFiles) === JSON.stringify(canonicalFiles);
  const commitIncluded = manifest.deploymentCommit === currentCommit;
  const reasons: string[] = [];
  if (!sourceFileParity) reasons.push("consensus_source_file_order_mismatch");
  if (currentCodeHash !== manifest.codeHash) reasons.push("consensus_source_hash_mismatch");
  if (!commitIncluded) reasons.push("current_tradelayer_commit_not_deployment_commit");
  if (manifest.status !== "candidate_not_deployed") reasons.push("unsupported_release_status_without_deployment_evidence");
  const sourceVerified = reasons.length === 0;
  return {
    schema: "bitagent.tradelayer.tx11-release-verification.v1",
    verifiedAt: (input.now || new Date()).toISOString(),
    authority: "read_only_observer",
    effect: "none",
    releaseId: manifest.releaseId,
    releaseStatus: manifest.status,
    manifestCodeHash: manifest.codeHash,
    currentCodeHash: isHex32(currentCodeHash) ? currentCodeHash : null,
    currentCommit,
    sourceFileParity,
    commitIncluded,
    sourceVerified,
    deploymentVerified: false,
    executable: false,
    reasons
  };
}
