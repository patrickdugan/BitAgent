import crypto from "node:crypto";
import { hashObject } from "./canonical.js";
import { LaunchKernelError } from "./errors.js";
import { verifyReserveIntakePlan, type ReserveIntakePlan } from "./reserveIntake.js";

const SECRET_FIELD = /(private.?key|seed.?phrase|mnemonic|\bwif\b|api.?secret|secret.?key|password|authorization)/i;
type PublicRecord = Record<string, unknown>;

export type TradeLayerListenerObservation = {
  schema: "bitagent_tradelayer_listener_observation_v1";
  observationHash: string;
  authority: "read_only_observer";
  effect: "none";
  sourceEndpoint: string;
  challenge: string;
  capturedAt: string;
  listenerObservedAt: string;
  responseHash: string;
  listener: { nodeId: string; instanceId: string; network: "BTCTEST"; releaseCommit: string };
  bitcoinBackend: {
    chain: "testnet4";
    bestBlockHash: string;
    blocks: number;
    headers: number;
    initialBlockDownload: boolean;
    verificationProgress: number;
    networkActive: boolean;
    connections: number;
    pruned: boolean;
  };
  sync: {
    initialized: boolean;
    phase: string;
    chainTip: number;
    indexedHeight: number;
    processedHeight: number;
    updatedAt: number;
    error: unknown;
  };
  tx11: { active: boolean; activationBlock: number | null; codeHash: string | null };
  property: PublicRecord | null;
  template: PublicRecord | null;
  contract: PublicRecord | null;
};

export type TradeLayerListenerPreflightEvidence = {
  schema: "bitagent_tradelayer_listener_preflight_v1";
  evidenceHash: string;
  authority: "read_only_observer";
  effect: "none";
  planHash: string;
  status: "verified" | "failed";
  assessedAt: string;
  maxAgeMs: number;
  maxSyncLagBlocks: number;
  minimumIndependentNodes: number;
  acceptedTx11CodeHashes: string[];
  acceptedReleaseCommits: string[];
  observations: TradeLayerListenerObservation[];
  gates: {
    independentLiveListeners: boolean;
    freshObservations: boolean;
    synchronizedTestnet4: boolean;
    exactReleaseCommit: boolean;
    tx11Active: boolean;
    tx11CodeHash: boolean;
    intendedTlBtcProperty: boolean;
    templateParity: boolean;
    contractParity: boolean;
    reserveRedeemAddress: boolean;
  };
  registryParityHash: string | null;
  contractMode: "existing" | "dynamic_create" | "unverified";
  independenceClaim: "unique_live_endpoints_and_operator_node_instances";
  reasons: string[];
};

function record(value: unknown, label: string): PublicRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LaunchKernelError("provider_unavailable", `TradeLayer listener ${label} is malformed`);
  }
  return value as PublicRecord;
}

function nullableRecord(value: unknown, label: string): PublicRecord | null {
  return value === null || value === undefined ? null : record(value, label);
}

function safeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new LaunchKernelError("provider_unavailable", `TradeLayer listener ${label} is invalid`);
  }
  return parsed;
}

function safeFraction(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new LaunchKernelError("provider_unavailable", `TradeLayer listener ${label} is invalid`);
  }
  return parsed;
}

function requiredText(value: unknown, label: string, pattern: RegExp): string {
  const text = String(value || "").trim();
  if (!pattern.test(text)) {
    throw new LaunchKernelError("provider_unavailable", `TradeLayer listener ${label} is invalid`);
  }
  return text;
}

function rejectSecrets(value: unknown, at = "listener_response") {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectSecrets(item, `${at}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as PublicRecord)) {
    if (SECRET_FIELD.test(key)) {
      throw new LaunchKernelError("secret_material_prohibited", `Secret-bearing listener field is prohibited: ${at}.${key}`);
    }
    rejectSecrets(item, `${at}.${key}`);
  }
}

function sourceEndpoint(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new LaunchKernelError("validation_error", "TradeLayer listener endpoint must be an absolute HTTP(S) URL", error);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new LaunchKernelError("validation_error", "TradeLayer listener endpoint contains unsupported components");
  }
  return url.toString().replace(/\/$/, "");
}

function observationCore(observation: TradeLayerListenerObservation) {
  const { observationHash: _observationHash, ...core } = observation;
  return core;
}

function normalizeObservation(input: {
  plan: ReserveIntakePlan;
  endpoint: string;
  challenge: string;
  capturedAt: Date;
  response: unknown;
}): TradeLayerListenerObservation {
  const response = record(input.response, "attestation response");
  rejectSecrets(response);
  if (response.schema !== "tradelayer_listener_launch_attestation_v1"
    || response.authority !== "read_only_observer" || response.effect !== "none"
    || response.challenge !== input.challenge) {
    throw new LaunchKernelError("provider_unavailable", "TradeLayer listener attestation envelope or challenge is invalid");
  }
  const query = record(response.query, "attestation query");
  if (Number(query.propertyId) !== input.plan.tradeLayer.propertyId
    || query.dlcTemplateId !== input.plan.tradeLayer.dlcTemplateId
    || query.dlcContractId !== input.plan.tradeLayer.dlcContractId) {
    throw new LaunchKernelError("provider_unavailable", "TradeLayer listener attestation query does not match the reserve plan");
  }
  const listener = record(response.listener, "identity");
  const bitcoinBackend = record(response.bitcoinBackend, "Bitcoin backend status");
  const sync = record(response.sync, "sync status");
  const tx11 = nullableRecord(response.tx11, "tx11 activation");
  const codeHash = String(tx11?.codeHash || "").toLowerCase();
  const core = {
    schema: "bitagent_tradelayer_listener_observation_v1" as const,
    authority: "read_only_observer" as const,
    effect: "none" as const,
    sourceEndpoint: sourceEndpoint(input.endpoint),
    challenge: input.challenge,
    capturedAt: input.capturedAt.toISOString(),
    listenerObservedAt: requiredText(response.observedAt, "observedAt", /^\d{4}-\d{2}-\d{2}T/),
    responseHash: hashObject(response),
    listener: {
      nodeId: requiredText(listener.nodeId, "node id", /^[A-Za-z0-9._:-]{3,128}$/),
      instanceId: requiredText(listener.instanceId, "instance id", /^[A-Za-z0-9._:-]{8,128}$/),
      network: requiredText(listener.network, "network", /^BTCTEST$/) as "BTCTEST",
      releaseCommit: requiredText(listener.releaseCommit, "release commit", /^[a-f0-9]{40}$/)
    },
    bitcoinBackend: {
      chain: requiredText(bitcoinBackend.chain, "Bitcoin backend chain", /^testnet4$/) as "testnet4",
      bestBlockHash: requiredText(bitcoinBackend.bestBlockHash, "Bitcoin backend best block hash", /^[a-f0-9]{64}$/),
      blocks: safeInteger(bitcoinBackend.blocks, "Bitcoin backend block height"),
      headers: safeInteger(bitcoinBackend.headers, "Bitcoin backend header height"),
      initialBlockDownload: bitcoinBackend.initialBlockDownload === true,
      verificationProgress: safeFraction(bitcoinBackend.verificationProgress, "Bitcoin backend verification progress"),
      networkActive: bitcoinBackend.networkActive === true,
      connections: safeInteger(bitcoinBackend.connections, "Bitcoin backend peer count"),
      pruned: bitcoinBackend.pruned === true
    },
    sync: {
      initialized: sync.initialized === true,
      phase: String(sync.phase || ""),
      chainTip: safeInteger(sync.chainTip, "chain tip"),
      indexedHeight: safeInteger(sync.indexedHeight, "indexed height"),
      processedHeight: safeInteger(sync.processedHeight, "processed height"),
      updatedAt: safeInteger(sync.updatedAt, "sync timestamp"),
      error: sync.error ?? null
    },
    tx11: {
      active: tx11?.active === true,
      activationBlock: tx11 && Number.isSafeInteger(Number(tx11.activationBlock)) ? Number(tx11.activationBlock) : null,
      codeHash: /^[a-f0-9]{64}$/.test(codeHash) ? codeHash : null
    },
    property: nullableRecord(response.property, "property"),
    template: nullableRecord(response.template, "template"),
    contract: nullableRecord(response.contract, "contract")
  };
  return { ...core, observationHash: hashObject(core) };
}

export async function observeTradeLayerListener(input: {
  plan: ReserveIntakePlan;
  endpoint: string;
  challenge?: string;
  now?: Date;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchFn?: typeof fetch;
}): Promise<TradeLayerListenerObservation> {
  if (!verifyReserveIntakePlan(input.plan)) throw new LaunchKernelError("validation_error", "Reserve plan failed verification");
  const endpoint = sourceEndpoint(input.endpoint);
  const challenge = input.challenge || crypto.randomBytes(32).toString("hex");
  if (!/^[a-f0-9]{64}$/.test(challenge)) throw new LaunchKernelError("validation_error", "Listener challenge must be 32-byte lowercase hex");
  const timeoutMs = input.timeoutMs ?? 5_000;
  const maxResponseBytes = input.maxResponseBytes ?? 1_000_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000
    || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1_024 || maxResponseBytes > 5_000_000) {
    throw new LaunchKernelError("validation_error", "Listener observation resource limits are invalid");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (input.fetchFn || fetch)(`${endpoint}/tl_getLaunchAttestation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challenge,
        propertyId: input.plan.tradeLayer.propertyId,
        dlcTemplateId: input.plan.tradeLayer.dlcTemplateId,
        dlcContractId: input.plan.tradeLayer.dlcContractId
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxResponseBytes) throw new Error("response exceeds configured byte limit");
    return normalizeObservation({
      plan: input.plan,
      endpoint,
      challenge,
      capturedAt: input.now || new Date(),
      response: JSON.parse(text)
    });
  } catch (error) {
    if (error instanceof LaunchKernelError) throw error;
    throw new LaunchKernelError("provider_unavailable", "Read-only TradeLayer listener attestation failed", error);
  } finally {
    clearTimeout(timer);
  }
}

function templateMatches(observation: TradeLayerListenerObservation, plan: ReserveIntakePlan) {
  const template = observation.template;
  return !!template
    && String(template.templateId) === plan.tradeLayer.dlcTemplateId
    && String(template.templateHash || template.dlcHash || "").toLowerCase() === plan.tradeLayer.dlcHash
    && (template.receiptPropertyId === undefined || Number(template.receiptPropertyId) === plan.tradeLayer.propertyId);
}

function contractMatches(observation: TradeLayerListenerObservation, plan: ReserveIntakePlan) {
  const contract = observation.contract;
  return !!contract
    && String(contract.contractId) === plan.tradeLayer.dlcContractId
    && String(contract.templateId) === plan.tradeLayer.dlcTemplateId
    && String(contract.state || "").toUpperCase() === plan.tradeLayer.settlementState;
}

function registryIdentity(observation: TradeLayerListenerObservation) {
  return { tx11: observation.tx11, property: observation.property, template: observation.template, contract: observation.contract };
}

function evidenceCore(evidence: TradeLayerListenerPreflightEvidence) {
  const { evidenceHash: _evidenceHash, ...core } = evidence;
  return core;
}

export function buildTradeLayerListenerPreflightEvidence(input: {
  plan: ReserveIntakePlan;
  observations: TradeLayerListenerObservation[];
  now: Date;
  maxAgeMs?: number;
  maxSyncLagBlocks?: number;
  minimumIndependentNodes?: number;
  acceptedTx11CodeHashes: string[];
  acceptedReleaseCommits: string[];
}): TradeLayerListenerPreflightEvidence {
  if (!verifyReserveIntakePlan(input.plan)) throw new LaunchKernelError("validation_error", "Reserve plan failed verification");
  const maxAgeMs = input.maxAgeMs ?? 120_000;
  const maxSyncLagBlocks = input.maxSyncLagBlocks ?? 2;
  const minimumIndependentNodes = input.minimumIndependentNodes ?? 2;
  const acceptedTx11CodeHashes = [...new Set(input.acceptedTx11CodeHashes.map((value) => value.toLowerCase()))].sort();
  const acceptedReleaseCommits = [...new Set(input.acceptedReleaseCommits.map((value) => value.toLowerCase()))].sort();
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0 || !Number.isSafeInteger(maxSyncLagBlocks) || maxSyncLagBlocks < 0
    || !Number.isSafeInteger(minimumIndependentNodes) || minimumIndependentNodes < 2
    || acceptedTx11CodeHashes.some((value) => !/^[a-f0-9]{64}$/.test(value))
    || acceptedReleaseCommits.some((value) => !/^[a-f0-9]{40}$/.test(value))) {
    throw new LaunchKernelError("validation_error", "Listener preflight policy is invalid");
  }
  const observationsValid = input.observations.every((item) =>
    item.schema === "bitagent_tradelayer_listener_observation_v1"
    && item.authority === "read_only_observer" && item.effect === "none"
    && hashObject(observationCore(item)) === item.observationHash
  );
  const sets = [
    new Set(input.observations.map((item) => item.sourceEndpoint)),
    new Set(input.observations.map((item) => item.listener.nodeId)),
    new Set(input.observations.map((item) => item.listener.instanceId)),
    new Set(input.observations.map((item) => item.challenge))
  ];
  const independentLiveListeners = observationsValid && input.observations.length >= minimumIndependentNodes
    && sets.every((set) => set.size === input.observations.length);
  const freshObservations = observationsValid && input.observations.every((item) => {
    const times = [Date.parse(item.capturedAt), Date.parse(item.listenerObservedAt), item.sync.updatedAt];
    return times.every((value) => Number.isFinite(value) && value <= input.now.getTime() && input.now.getTime() - value <= maxAgeMs);
  });
  const bitcoinTipHashes = new Set(input.observations.map((item) => item.bitcoinBackend.bestBlockHash));
  const synchronizedTestnet4 = observationsValid && input.observations.length > 0
    && bitcoinTipHashes.size === 1 && input.observations.every((item) =>
    item.listener.network === "BTCTEST" && item.sync.initialized && item.sync.phase === "realtime" && !item.sync.error
    && item.bitcoinBackend.chain === "testnet4" && !item.bitcoinBackend.initialBlockDownload
    && item.bitcoinBackend.networkActive && item.bitcoinBackend.connections > 0
    && item.bitcoinBackend.blocks === item.bitcoinBackend.headers
    && item.bitcoinBackend.blocks === item.sync.chainTip
    && item.bitcoinBackend.verificationProgress >= 0.999999
    && item.sync.indexedHeight <= item.sync.chainTip && item.sync.processedHeight <= item.sync.chainTip
    && item.sync.chainTip - Math.min(item.sync.indexedHeight, item.sync.processedHeight) <= maxSyncLagBlocks
  );
  const exactReleaseCommit = observationsValid && acceptedReleaseCommits.length > 0
    && input.observations.every((item) => acceptedReleaseCommits.includes(item.listener.releaseCommit));
  const tx11Active = observationsValid && input.observations.length > 0 && input.observations.every((item) =>
    item.tx11.active && item.tx11.activationBlock !== null && item.sync.processedHeight >= item.tx11.activationBlock
  );
  const tx11CodeHash = observationsValid && acceptedTx11CodeHashes.length > 0
    && input.observations.every((item) => !!item.tx11.codeHash && acceptedTx11CodeHashes.includes(item.tx11.codeHash));
  const intendedTlBtcProperty = observationsValid && input.observations.length > 0 && input.observations.every((item) =>
    !!item.property && String(item.property.ticker || "").toUpperCase() === "TLBTC"
    && (item.property.type === 2 || String(item.property.type || "").toUpperCase() === "MANAGED")
  );
  const templatesMatch = observationsValid && input.observations.length > 0
    && input.observations.every((item) => templateMatches(item, input.plan));
  const existingContractsMatch = observationsValid && input.observations.length > 0
    && input.observations.every((item) => contractMatches(item, input.plan));
  const dynamicContractCreation = observationsValid && tx11CodeHash && templatesMatch && input.observations.length > 0
    && /^utxoref-[a-f0-9]{40}$/.test(input.plan.tradeLayer.dlcContractId)
    && input.plan.tradeLayer.settlementState === "FUNDED"
    && input.observations.every((item) => item.contract === null);
  const contractMode: TradeLayerListenerPreflightEvidence["contractMode"] = existingContractsMatch
    ? "existing"
    : dynamicContractCreation ? "dynamic_create" : "unverified";
  const reserveRedeemAddress = existingContractsMatch
    ? input.observations.every((item) => String(item.contract?.redeemAddress || "") === input.plan.reserve.address)
    : dynamicContractCreation;
  const registryHashes = new Set(input.observations.map((item) => hashObject(registryIdentity(item))));
  const exactRegistryParity = independentLiveListeners && registryHashes.size === 1;
  const gates = {
    independentLiveListeners,
    freshObservations,
    synchronizedTestnet4,
    exactReleaseCommit,
    tx11Active,
    tx11CodeHash,
    intendedTlBtcProperty,
    templateParity: templatesMatch && exactRegistryParity,
    contractParity: (existingContractsMatch || dynamicContractCreation) && exactRegistryParity,
    reserveRedeemAddress
  };
  const reasons = Object.entries(gates).filter(([, ok]) => !ok).map(([gate]) => `Failed gate: ${gate}`);
  const core = {
    schema: "bitagent_tradelayer_listener_preflight_v1" as const,
    authority: "read_only_observer" as const,
    effect: "none" as const,
    planHash: input.plan.planHash,
    status: (reasons.length ? "failed" : "verified") as "verified" | "failed",
    assessedAt: input.now.toISOString(),
    maxAgeMs,
    maxSyncLagBlocks,
    minimumIndependentNodes,
    acceptedTx11CodeHashes,
    acceptedReleaseCommits,
    observations: input.observations,
    gates,
    registryParityHash: exactRegistryParity ? [...registryHashes][0]! : null,
    contractMode,
    independenceClaim: "unique_live_endpoints_and_operator_node_instances" as const,
    reasons
  };
  return { ...core, evidenceHash: hashObject(core) };
}

export function verifyTradeLayerListenerPreflightEvidence(evidence: TradeLayerListenerPreflightEvidence, plan: ReserveIntakePlan) {
  try {
    const rebuilt = buildTradeLayerListenerPreflightEvidence({
      plan,
      observations: evidence.observations,
      now: new Date(evidence.assessedAt),
      maxAgeMs: evidence.maxAgeMs,
      maxSyncLagBlocks: evidence.maxSyncLagBlocks,
      minimumIndependentNodes: evidence.minimumIndependentNodes,
      acceptedTx11CodeHashes: evidence.acceptedTx11CodeHashes,
      acceptedReleaseCommits: evidence.acceptedReleaseCommits
    });
    return hashObject(evidenceCore(evidence)) === evidence.evidenceHash && rebuilt.evidenceHash === evidence.evidenceHash;
  } catch {
    return false;
  }
}
