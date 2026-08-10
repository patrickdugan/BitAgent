import { hashObject } from "./canonical.js";
import { LaunchKernelError } from "./errors.js";
import { verifyStarterOrderPlan } from "./tradelayerTool.js";
import type { StarterOrderPlan } from "./types.js";

export type StarterOrderNodeSnapshot = {
  schema: "bitagent_tradelayer_starter_order_node_snapshot_v1";
  snapshotHash: string;
  nodeId: string;
  instanceId: string;
  capturedAt: string;
  blockHeight: number;
  synchronized: boolean;
  tx5: {
    active: boolean;
    activationSource: "bitcoin_transaction" | "local_seed" | "unknown";
    activationBlock: number | null;
    codeHash: string;
  };
  properties: {
    offeredPropertyId: number;
    offeredSymbol: string;
    desiredPropertyId: number;
    desiredSymbol: string;
  };
  balance: {
    address: string;
    tlBtcAvailableSats: string;
  };
};

export type StarterOrderPreflightEvidence = {
  schema: "bitagent_tradelayer_starter_order_preflight_v1";
  status: "verified" | "failed";
  planHash: string;
  assessedAt: string;
  maxAgeMs: number;
  minimumIndependentNodes: number;
  observedNodeCount: number;
  expectedCodeHash: string;
  gates: {
    independentNodeCount: boolean;
    freshSnapshots: boolean;
    tx5Active: boolean;
    tx5ChainDerived: boolean;
    tx5CodeHash: boolean;
    intendedProperties: boolean;
    walletTlBtcBalance: boolean;
    quoteFresh: boolean;
    postOnlyExact: boolean;
  };
  nodes: StarterOrderNodeSnapshot[];
  reasons: string[];
  evidenceHash: string;
};

function snapshotCore(snapshot: StarterOrderNodeSnapshot) {
  const { snapshotHash: _snapshotHash, ...core } = snapshot;
  return core;
}

export function sealStarterOrderNodeSnapshot(
  core: Omit<StarterOrderNodeSnapshot, "snapshotHash">
): StarterOrderNodeSnapshot {
  return { ...core, snapshotHash: hashObject(core) };
}

export function verifyStarterOrderNodeSnapshot(snapshot: StarterOrderNodeSnapshot): boolean {
  try {
    return snapshot?.schema === "bitagent_tradelayer_starter_order_node_snapshot_v1"
      && /^[A-Za-z0-9._:-]{3,128}$/.test(snapshot.nodeId)
      && /^[A-Za-z0-9._:-]{8,128}$/.test(snapshot.instanceId)
      && Number.isSafeInteger(snapshot.blockHeight) && snapshot.blockHeight >= 0
      && Number.isFinite(Date.parse(snapshot.capturedAt))
      && /^[a-f0-9]{64}$/.test(snapshot.tx5.codeHash)
      && Number.isSafeInteger(snapshot.properties.offeredPropertyId)
      && Number.isSafeInteger(snapshot.properties.desiredPropertyId)
      && /^(0|[1-9][0-9]*)$/.test(snapshot.balance.tlBtcAvailableSats)
      && /^[a-f0-9]{64}$/.test(snapshot.snapshotHash)
      && hashObject(snapshotCore(snapshot)) === snapshot.snapshotHash;
  } catch {
    return false;
  }
}

function evidenceCore(evidence: StarterOrderPreflightEvidence) {
  const { evidenceHash: _evidenceHash, ...core } = evidence;
  return core;
}

export function buildStarterOrderPreflightEvidence(input: {
  plan: StarterOrderPlan;
  nodes: StarterOrderNodeSnapshot[];
  expectedCodeHash: string;
  now: Date;
  maxAgeMs?: number;
  minimumIndependentNodes?: number;
}): StarterOrderPreflightEvidence {
  if (!verifyStarterOrderPlan(input.plan) || !/^[a-f0-9]{64}$/.test(input.expectedCodeHash)) {
    throw new LaunchKernelError("validation_error", "Starter-order preflight plan or code hash is invalid");
  }
  const maxAgeMs = input.maxAgeMs ?? 60_000;
  const minimumIndependentNodes = input.minimumIndependentNodes ?? 2;
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > 5 * 60_000
    || !Number.isSafeInteger(minimumIndependentNodes) || minimumIndependentNodes < 2) {
    throw new LaunchKernelError("validation_error", "Starter-order preflight policy is invalid");
  }
  const nodes = input.nodes.map((node) => structuredClone(node));
  const validSnapshots = nodes.every(verifyStarterOrderNodeSnapshot);
  const distinctNodes = new Set(nodes.map((node) => node.nodeId));
  const distinctInstances = new Set(nodes.map((node) => node.instanceId));
  const independentNodeCount = validSnapshots
    && nodes.length >= minimumIndependentNodes
    && distinctNodes.size === nodes.length
    && distinctInstances.size === nodes.length;
  const freshSnapshots = validSnapshots && nodes.every((node) => {
    const captured = Date.parse(node.capturedAt);
    return captured <= input.now.getTime() + 60_000
      && input.now.getTime() - captured <= maxAgeMs
      && node.synchronized;
  });
  const tx5Active = validSnapshots && nodes.every((node) => node.tx5.active);
  const tx5ChainDerived = validSnapshots && nodes.every((node) =>
    node.tx5.activationSource === "bitcoin_transaction"
    && Number.isSafeInteger(node.tx5.activationBlock)
    && Number(node.tx5.activationBlock) >= 0
    && Number(node.tx5.activationBlock) <= node.blockHeight
  );
  const tx5CodeHash = validSnapshots && nodes.every((node) =>
    node.tx5.codeHash === input.expectedCodeHash
  );
  const intendedProperties = validSnapshots && nodes.every((node) =>
    node.properties.offeredPropertyId === input.plan.strategy.offeredPropertyId
    && node.properties.desiredPropertyId === input.plan.strategy.desiredPropertyId
    && node.properties.offeredSymbol === "tlBTC"
    && node.properties.desiredSymbol === "tlUSD"
  );
  const balances = nodes.map((node) => node.balance.tlBtcAvailableSats);
  const walletTlBtcBalance = validSnapshots && nodes.every((node) =>
    node.balance.address === input.plan.walletAddress
    && BigInt(node.balance.tlBtcAvailableSats) >= BigInt(input.plan.strategy.amountSats)
  ) && new Set(balances).size === 1;
  const quotedAt = Date.parse(input.plan.quote.quotedAt);
  const expiresAt = Date.parse(input.plan.quote.expiresAt);
  const quoteFresh = Number.isFinite(quotedAt) && Number.isFinite(expiresAt)
    && quotedAt <= input.now.getTime() + 60_000
    && input.now.getTime() < expiresAt;
  const postOnlyExact = input.plan.strategy.postOnly === true
    && input.plan.tradeLayer.payload.endsWith(",0,1")
    && verifyStarterOrderPlan(input.plan);
  const gates = {
    independentNodeCount,
    freshSnapshots,
    tx5Active,
    tx5ChainDerived,
    tx5CodeHash,
    intendedProperties,
    walletTlBtcBalance,
    quoteFresh,
    postOnlyExact
  };
  const reasons = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([gate]) => `${gate} is not verified`);
  const core = {
    schema: "bitagent_tradelayer_starter_order_preflight_v1" as const,
    status: reasons.length === 0 ? "verified" as const : "failed" as const,
    planHash: input.plan.planHash,
    assessedAt: input.now.toISOString(),
    maxAgeMs,
    minimumIndependentNodes,
    observedNodeCount: nodes.length,
    expectedCodeHash: input.expectedCodeHash,
    gates,
    nodes,
    reasons
  };
  return { ...core, evidenceHash: hashObject(core) };
}

export function verifyStarterOrderPreflightEvidence(
  evidence: StarterOrderPreflightEvidence,
  plan: StarterOrderPlan
): boolean {
  try {
    return verifyStarterOrderPlan(plan)
      && evidence?.schema === "bitagent_tradelayer_starter_order_preflight_v1"
      && evidence.planHash === plan.planHash
      && /^[a-f0-9]{64}$/.test(evidence.evidenceHash)
      && hashObject(evidenceCore(evidence)) === evidence.evidenceHash
      && evidence.nodes.every(verifyStarterOrderNodeSnapshot);
  } catch {
    return false;
  }
}
