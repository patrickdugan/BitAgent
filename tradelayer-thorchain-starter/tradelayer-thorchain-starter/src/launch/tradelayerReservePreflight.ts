import { promises as fs } from "node:fs";
import path from "node:path";
import { verifyReserveIntakePlan, type ReserveIntakePlan } from "./reserveIntake.js";
import { hashObject } from "./canonical.js";
import { LaunchKernelError } from "./errors.js";
import {
  isChainDerivedTradeLayerActivation,
  normalizeTradeLayerActivationSource,
  type TradeLayerActivationSource
} from "./tradelayerActivationProvenance.js";

type PublicProperty = {
  id: number;
  ticker: string;
  type: number | string;
  issuer: string;
  proceduralType?: number;
};

type RegistryDocument = Record<string, unknown> & { _id?: string; $$deleted?: boolean };

export type TradeLayerReserveNodeSnapshot = {
  schema: "bitagent_tradelayer_reserve_node_snapshot_v1";
  snapshotHash: string;
  planHash: string;
  nodeId: string;
  sourceIdentityHash: string;
  network: "BTCTEST";
  blockHeight: number;
  observedAt: string;
  sourceFileHashes: {
    activations: string;
    properties: string;
    procedural: string;
  };
  tx11: {
    active: boolean;
    activationBlock: number | null;
    codeHash: string | null;
    activationSource: TradeLayerActivationSource;
  };
  property: PublicProperty | null;
  template: Record<string, unknown> | null;
  contract: Record<string, unknown> | null;
};

export type TradeLayerReservePreflightEvidence = {
  schema: "bitagent_tradelayer_reserve_preflight_v1";
  evidenceHash: string;
  planHash: string;
  status: "verified" | "failed";
  assessedAt: string;
  maxAgeMs: number;
  minimumIndependentNodes: number;
  acceptedTx11CodeHashes: string[];
  nodes: TradeLayerReserveNodeSnapshot[];
  gates: {
    independentNodeCount: boolean;
    freshSnapshots: boolean;
    tx11Active: boolean;
    tx11ChainDerived: boolean;
    tx11CodeHash: boolean;
    intendedTlBtcProperty: boolean;
    templateParity: boolean;
    contractParity: boolean;
    reserveRedeemAddress: boolean;
  };
  registryParityHash: string | null;
  contractMode: "existing" | "dynamic_create" | "unverified";
  reasons: string[];
};

async function readNedb(filePath: string): Promise<{ docs: Map<string, RegistryDocument>; hash: string; modifiedAt: number }> {
  const [text, stat] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
  const docs = new Map<string, RegistryDocument>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let doc: RegistryDocument;
    try {
      doc = JSON.parse(line) as RegistryDocument;
    } catch {
      throw new LaunchKernelError("provider_unavailable", `TradeLayer snapshot contains malformed NeDB data: ${path.basename(filePath)}`);
    }
    if (!doc._id) continue;
    if (doc.$$deleted) docs.delete(doc._id);
    else docs.set(doc._id, doc);
  }
  return { docs, hash: hashObject(text), modifiedAt: stat.mtimeMs };
}

function snapshotCore(snapshot: TradeLayerReserveNodeSnapshot) {
  const { snapshotHash: _snapshotHash, ...core } = snapshot;
  return core;
}

function parsedValue<T>(doc: RegistryDocument | undefined, label: string): T | null {
  if (!doc) return null;
  try {
    return JSON.parse(String(doc.value || "")) as T;
  } catch {
    throw new LaunchKernelError("provider_unavailable", `TradeLayer ${label} snapshot is not valid JSON`);
  }
}

export async function readTradeLayerReserveNodeSnapshot(input: {
  plan: ReserveIntakePlan;
  nodeId: string;
  databasePath: string;
  blockHeight: number;
}): Promise<TradeLayerReserveNodeSnapshot> {
  if (!verifyReserveIntakePlan(input.plan) || !input.nodeId.trim() || !Number.isSafeInteger(input.blockHeight) || input.blockHeight < 0) {
    throw new LaunchKernelError("validation_error", "A verified reserve plan, node id, and non-negative listener height are required");
  }
  const [activations, properties, procedural] = await Promise.all([
    readNedb(path.join(input.databasePath, "activations.db")),
    readNedb(path.join(input.databasePath, "propertyList.db")),
    readNedb(path.join(input.databasePath, "procedural.db"))
  ]);
  const activationRegistry = parsedValue<Record<string, Record<string, unknown>>>(
    activations.docs.get("activationsList"),
    "activation registry"
  ) || {};
  const tx11 = activationRegistry["11"] || {};
  const propertyIndex = parsedValue<Array<[number | string, Record<string, unknown>]>>(
    properties.docs.get("propertyIndex"),
    "property registry"
  ) || [];
  const propertyRow = propertyIndex.find(([id]) => Number(id) === input.plan.tradeLayer.propertyId);
  const property = propertyRow ? {
    id: input.plan.tradeLayer.propertyId,
    ticker: String(propertyRow[1].ticker || ""),
    type: typeof propertyRow[1].type === "number" ? propertyRow[1].type : String(propertyRow[1].type || ""),
    issuer: String(propertyRow[1].issuer || ""),
    proceduralType: propertyRow[1].proceduralType === undefined ? undefined : Number(propertyRow[1].proceduralType)
  } satisfies PublicProperty : null;
  const observedAt = new Date(Math.max(activations.modifiedAt, properties.modifiedAt, procedural.modifiedAt)).toISOString();
  const core = {
    schema: "bitagent_tradelayer_reserve_node_snapshot_v1" as const,
    planHash: input.plan.planHash,
    nodeId: input.nodeId,
    sourceIdentityHash: hashObject(`tradelayer-nedb:${path.resolve(input.databasePath)}`),
    network: "BTCTEST" as const,
    blockHeight: input.blockHeight,
    observedAt,
    sourceFileHashes: {
      activations: activations.hash,
      properties: properties.hash,
      procedural: procedural.hash
    },
    tx11: {
      active: tx11.active === true,
      activationBlock: Number.isSafeInteger(Number(tx11.activationBlock)) ? Number(tx11.activationBlock) : null,
      codeHash: /^[a-f0-9]{64}$/i.test(String(tx11.codeHash || "")) ? String(tx11.codeHash).toLowerCase() : null,
      activationSource: normalizeTradeLayerActivationSource(tx11.activationSource)
    },
    property,
    template: procedural.docs.get(`template-${input.plan.tradeLayer.dlcTemplateId}`) || null,
    contract: procedural.docs.get(`contract-${input.plan.tradeLayer.dlcContractId}`) || null
  };
  return { ...core, snapshotHash: hashObject(core) };
}

function isManagedTlBtc(snapshot: TradeLayerReserveNodeSnapshot, plan: ReserveIntakePlan): boolean {
  const property = snapshot.property;
  return property?.id === plan.tradeLayer.propertyId
    && property.ticker.toUpperCase() === "TLBTC"
    && (property.type === 2 || String(property.type).toUpperCase() === "MANAGED");
}

function templateMatches(snapshot: TradeLayerReserveNodeSnapshot, plan: ReserveIntakePlan): boolean {
  const template = snapshot.template;
  if (!template) return false;
  const receiptPropertyId = template.receiptPropertyId;
  return String(template.templateId) === plan.tradeLayer.dlcTemplateId
    && String(template.templateHash || template.dlcHash || "").toLowerCase() === plan.tradeLayer.dlcHash
    && (receiptPropertyId === undefined || Number(receiptPropertyId) === plan.tradeLayer.propertyId);
}

function contractMatches(snapshot: TradeLayerReserveNodeSnapshot, plan: ReserveIntakePlan): boolean {
  const contract = snapshot.contract;
  return !!contract
    && String(contract.contractId) === plan.tradeLayer.dlcContractId
    && String(contract.templateId) === plan.tradeLayer.dlcTemplateId
    && String(contract.state || "").toUpperCase() === plan.tradeLayer.settlementState;
}

function registryIdentity(snapshot: TradeLayerReserveNodeSnapshot) {
  return {
    tx11: snapshot.tx11,
    property: snapshot.property,
    template: snapshot.template,
    contract: snapshot.contract
  };
}

function evidenceCore(evidence: TradeLayerReservePreflightEvidence) {
  const { evidenceHash: _evidenceHash, ...core } = evidence;
  return core;
}

export function buildTradeLayerReservePreflightEvidence(input: {
  plan: ReserveIntakePlan;
  nodes: TradeLayerReserveNodeSnapshot[];
  now: Date;
  maxAgeMs?: number;
  minimumIndependentNodes?: number;
  acceptedTx11CodeHashes?: string[];
}): TradeLayerReservePreflightEvidence {
  if (!verifyReserveIntakePlan(input.plan)) throw new LaunchKernelError("validation_error", "Reserve plan failed verification");
  const maxAgeMs = input.maxAgeMs ?? 120_000;
  const minimumIndependentNodes = input.minimumIndependentNodes ?? 2;
  const acceptedTx11CodeHashes = [...new Set((input.acceptedTx11CodeHashes || []).map((value) => value.toLowerCase()))].sort();
  if (acceptedTx11CodeHashes.some((value) => !/^[a-f0-9]{64}$/.test(value))) {
    throw new LaunchKernelError("validation_error", "Accepted tx11 code hashes must be 32-byte lowercase hex values");
  }
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0 || !Number.isSafeInteger(minimumIndependentNodes) || minimumIndependentNodes < 2) {
    throw new LaunchKernelError("validation_error", "Preflight freshness and independent-node thresholds are invalid");
  }
  const nodesValid = input.nodes.every((node) =>
    node.schema === "bitagent_tradelayer_reserve_node_snapshot_v1"
    && node.planHash === input.plan.planHash
    && hashObject(snapshotCore(node)) === node.snapshotHash
  );
  const uniqueNodeCount = new Set(input.nodes.map((node) => node.nodeId)).size;
  const uniqueSourceCount = new Set(input.nodes.map((node) => node.sourceIdentityHash)).size;
  const freshSnapshots = nodesValid && input.nodes.every((node) => {
    const observed = Date.parse(node.observedAt);
    return Number.isFinite(observed) && observed <= input.now.getTime() && input.now.getTime() - observed <= maxAgeMs;
  });
  const tx11Active = nodesValid && input.nodes.length > 0 && input.nodes.every((node) =>
    node.network === "BTCTEST" && node.tx11.active && node.tx11.activationBlock !== null
    && node.blockHeight >= node.tx11.activationBlock
  );
  const tx11ChainDerived = nodesValid && input.nodes.length > 0 && input.nodes.every((node) =>
    isChainDerivedTradeLayerActivation(node.tx11.activationSource, node.tx11.activationBlock)
  );
  const tx11CodeHash = nodesValid && acceptedTx11CodeHashes.length > 0 && input.nodes.every((node) =>
    !!node.tx11.codeHash && acceptedTx11CodeHashes.includes(node.tx11.codeHash)
  );
  const intendedTlBtcProperty = nodesValid && input.nodes.length > 0 && input.nodes.every((node) => isManagedTlBtc(node, input.plan));
  const templateParity = nodesValid && input.nodes.length > 0 && input.nodes.every((node) => templateMatches(node, input.plan));
  const existingContractParity = nodesValid && input.nodes.length > 0 && input.nodes.every((node) => contractMatches(node, input.plan));
  const dynamicContractCreation = nodesValid && tx11CodeHash && templateParity && input.nodes.length > 0
    && /^utxoref-[a-f0-9]{40}$/.test(input.plan.tradeLayer.dlcContractId)
    && input.plan.tradeLayer.settlementState === "FUNDED"
    && input.nodes.every((node) => node.contract === null);
  const contractMode: TradeLayerReservePreflightEvidence["contractMode"] = existingContractParity
    ? "existing"
    : dynamicContractCreation
      ? "dynamic_create"
      : "unverified";
  const reserveRedeemAddress = existingContractParity && input.nodes.every((node) =>
    String(node.contract?.redeemAddress || "") === input.plan.reserve.address
  ) || dynamicContractCreation;
  const parityHashes = new Set(input.nodes.map((node) => hashObject(registryIdentity(node))));
  const independentNodeCount = nodesValid
    && uniqueNodeCount >= minimumIndependentNodes
    && uniqueNodeCount === input.nodes.length
    && uniqueSourceCount === input.nodes.length;
  const exactRegistryParity = independentNodeCount && parityHashes.size === 1;
  const gates = {
    independentNodeCount,
    freshSnapshots,
    tx11Active,
    tx11ChainDerived,
    tx11CodeHash,
    intendedTlBtcProperty,
    templateParity: templateParity && exactRegistryParity,
    contractParity: (existingContractParity || dynamicContractCreation) && exactRegistryParity,
    reserveRedeemAddress
  };
  const reasons = Object.entries(gates).filter(([, ok]) => !ok).map(([gate]) => `Failed gate: ${gate}`);
  const core = {
    schema: "bitagent_tradelayer_reserve_preflight_v1" as const,
    planHash: input.plan.planHash,
    status: (reasons.length === 0 ? "verified" : "failed") as "verified" | "failed",
    assessedAt: input.now.toISOString(),
    maxAgeMs,
    minimumIndependentNodes,
    acceptedTx11CodeHashes,
    nodes: input.nodes,
    gates,
    registryParityHash: exactRegistryParity ? [...parityHashes][0]! : null,
    contractMode,
    reasons
  };
  return { ...core, evidenceHash: hashObject(core) };
}

export function verifyTradeLayerReservePreflightEvidence(
  evidence: TradeLayerReservePreflightEvidence,
  plan: ReserveIntakePlan
): boolean {
  try {
    const rebuilt = buildTradeLayerReservePreflightEvidence({
      plan,
      nodes: evidence.nodes,
      now: new Date(evidence.assessedAt),
      maxAgeMs: evidence.maxAgeMs,
      minimumIndependentNodes: evidence.minimumIndependentNodes,
      acceptedTx11CodeHashes: evidence.acceptedTx11CodeHashes
    });
    return hashObject(evidenceCore(evidence)) === evidence.evidenceHash
      && rebuilt.evidenceHash === evidence.evidenceHash;
  } catch {
    return false;
  }
}
