import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";

export type RecoveryArtifact = {
  role: "self_model" | "policy" | "ledger" | "settlement_receipt" | "benchmark";
  cid: string;
  sha256: string;
  sizeBytes: string;
};

export type RecoveryManifest = {
  schema: "sovereign_recovery_manifest_v1";
  agentId: string;
  version: number;
  previousManifestHash: string;
  createdAt: string;
  artifacts: RecoveryArtifact[];
  storage: {
    network: "filecoin-calibration";
    mode: "filecoin_pin_alpha" | "direct_deal";
    proofStatus: "pending" | "confirmed" | "failed";
    dealId?: string;
    proofEvidenceHash?: string;
  };
  signature?: { signer: string; signature: string; payloadHash: string };
  manifestHash: string;
};

export function createRecoveryManifest(input: Omit<RecoveryManifest, "schema" | "manifestHash">): RecoveryManifest {
  if (!Number.isInteger(input.version) || input.version < 1 || input.artifacts.length === 0) {
    throw new IntegrationBoundaryError("recovery_error", "Recovery manifest requires a positive version and artifacts");
  }
  const { signature, ...unsignedInput } = input;
  const material = { schema: "sovereign_recovery_manifest_v1" as const, ...unsignedInput };
  const manifestHash = canonicalHash(material);
  if (signature && signature.payloadHash !== manifestHash) {
    throw new IntegrationBoundaryError("recovery_error", "Recovery signature is not bound to the unsigned manifest hash");
  }
  return { ...material, signature, manifestHash };
}

export function verifyRecoveryChain(manifests: RecoveryManifest[]): boolean {
  let previous = "0".repeat(64);
  for (let index = 0; index < manifests.length; index += 1) {
    const manifest = manifests[index]!;
    const { manifestHash, signature, ...material } = manifest;
    if (manifest.version !== index + 1 || manifest.previousManifestHash !== previous || canonicalHash(material) !== manifestHash) return false;
    if (manifest.signature && manifest.signature.payloadHash !== manifestHash) return false;
    previous = manifestHash;
  }
  return manifests.length > 0;
}

export function persistenceIsSpendableEvidence(manifest: RecoveryManifest): boolean {
  return Boolean(
    manifest.storage.proofStatus === "confirmed" &&
      manifest.storage.proofEvidenceHash &&
      (manifest.storage.mode === "filecoin_pin_alpha" || manifest.storage.dealId)
  );
}
