import {
  createTradeLayerActivationBrokerRequest,
  TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS
} from "../broker/tradelayerActivationCandidateBroker.js";
import { canonicalHash } from "../survival/policy.js";
import { validateBitcoinAddress } from "./bitcoin.js";
import {
  validateTx11ReleaseManifest,
  type Tx11ReleaseManifest
} from "./tradelayerRelease.js";

export type Tx11LaunchSourceReceipt = {
  schema: "bitagent.tradelayer.tx11-launch-source.v1";
  verifiedAt: string;
  authority: "read_only_observer";
  effect: "none";
  releaseId: string;
  releaseStatus: string;
  selectedSource: {
    path: string;
    commit: string;
    codeHash: string;
    trackedClean: boolean;
    sourceVerified: boolean;
  };
  deploymentVerified: boolean;
  executable: boolean;
};

function isHex(value: unknown, length: number): value is string {
  return typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
}

export function validateTx11LaunchSourceReceipt(input: {
  receipt: unknown;
  manifest: Tx11ReleaseManifest;
  now?: Date;
  maxAgeMs?: number;
}): Tx11LaunchSourceReceipt {
  const manifest = validateTx11ReleaseManifest(input.manifest);
  const receipt = input.receipt as Partial<Tx11LaunchSourceReceipt>;
  if (!receipt || receipt.schema !== "bitagent.tradelayer.tx11-launch-source.v1"
    || receipt.authority !== "read_only_observer" || receipt.effect !== "none") {
    throw new Error("TradeLayer tx11 launch source receipt schema or authority is invalid");
  }
  const selected = receipt.selectedSource;
  if (!selected?.path?.trim() || !isHex(selected.commit, 40) || !isHex(selected.codeHash, 64)) {
    throw new Error("TradeLayer tx11 selected source identity is invalid");
  }
  if (receipt.releaseId !== manifest.releaseId || receipt.releaseStatus !== manifest.status
    || selected.commit !== manifest.deploymentCommit || selected.codeHash !== manifest.codeHash) {
    throw new Error("TradeLayer tx11 launch source does not match the pinned release manifest");
  }
  if (!selected.trackedClean || !selected.sourceVerified) {
    throw new Error("TradeLayer tx11 launch source is not clean and source-verified");
  }
  if (receipt.deploymentVerified !== false || receipt.executable !== false) {
    throw new Error("Candidate-only tx11 source receipt has an invalid execution claim");
  }
  const verifiedAt = Date.parse(receipt.verifiedAt || "");
  const nowMs = (input.now || new Date()).getTime();
  const maxAgeMs = input.maxAgeMs ?? 15 * 60 * 1000;
  if (!Number.isFinite(verifiedAt) || maxAgeMs <= 0 || verifiedAt > nowMs + 30_000 || nowMs - verifiedAt > maxAgeMs) {
    throw new Error("TradeLayer tx11 launch source receipt is stale or has an invalid verification time");
  }
  return receipt as Tx11LaunchSourceReceipt;
}

export function tx11SourceVerificationHash(
  receipt: Tx11LaunchSourceReceipt,
  manifest: Tx11ReleaseManifest
): string {
  return canonicalHash({
    schema: "bitagent.tradelayer.tx11-source-verification-binding.v1",
    releaseId: manifest.releaseId,
    releaseStatus: manifest.status,
    deploymentCommit: manifest.deploymentCommit,
    codeHash: manifest.codeHash,
    selectedSource: receipt.selectedSource
  });
}

export function tx11ActivationPolicyFingerprint(input: {
  manifest: Tx11ReleaseManifest;
  wallet: string;
  senderAddress: string;
  maxFeeSats: string;
}): string {
  const manifest = validateTx11ReleaseManifest(input.manifest);
  const wallet = input.wallet.trim();
  if (!wallet) throw new Error("TradeLayer activation wallet name is required");
  if (!/^[1-9][0-9]*$/.test(input.maxFeeSats)) {
    throw new Error("TradeLayer activation fee cap must be a positive integer string");
  }
  const senderAddress = validateBitcoinAddress(input.senderAddress, "bitcoin-testnet4").address;
  if (senderAddress !== TRADELAYER_TESTNET4_ACTIVATION_ADMIN_ADDRESS) {
    throw new Error("TradeLayer testnet4 activation sender must equal the protocol admin address");
  }
  return canonicalHash({
    schema: "bitagent.tradelayer.tx11-activation-policy.v1",
    network: "testnet4",
    wallet,
    senderAddress,
    releaseId: manifest.releaseId,
    releaseStatus: manifest.status,
    deploymentCommit: manifest.deploymentCommit,
    codeHash: manifest.codeHash,
    maxFeeSats: input.maxFeeSats,
    requiredOutputOrder: ["tx11_op_return_vout0", "same_address_positive_change_vout1"],
    requiredInputCount: 1,
    signingAuthority: "external_bitcoin_core_wallet",
    modelExecutionAllowed: false
  });
}

export function createReleaseBoundActivationRequest(input: {
  receipt: unknown;
  manifest: Tx11ReleaseManifest;
  requestId: string;
  wallet: string;
  senderAddress: string;
  policyFingerprint?: string;
  maxFeeSats: string;
  expiresAt: string;
  now?: Date;
  maxSourceAgeMs?: number;
}) {
  const manifest = validateTx11ReleaseManifest(input.manifest);
  const receipt = validateTx11LaunchSourceReceipt({
    receipt: input.receipt,
    manifest,
    now: input.now,
    maxAgeMs: input.maxSourceAgeMs
  });
  const senderAddress = validateBitcoinAddress(input.senderAddress, "bitcoin-testnet4").address;
  const policyFingerprint = tx11ActivationPolicyFingerprint({
    manifest,
    wallet: input.wallet,
    senderAddress,
    maxFeeSats: input.maxFeeSats
  });
  if (input.policyFingerprint !== undefined && input.policyFingerprint !== policyFingerprint) {
    throw new Error("TradeLayer activation policy fingerprint differs from the deterministic release policy");
  }
  return createTradeLayerActivationBrokerRequest({
    requestId: input.requestId,
    wallet: input.wallet,
    senderAddress,
    releaseId: manifest.releaseId,
    deploymentCommit: manifest.deploymentCommit,
    codeHash: manifest.codeHash,
    sourceVerificationHash: tx11SourceVerificationHash(receipt, manifest),
    policyFingerprint,
    maxFeeSats: input.maxFeeSats,
    expiresAt: input.expiresAt
  });
}
