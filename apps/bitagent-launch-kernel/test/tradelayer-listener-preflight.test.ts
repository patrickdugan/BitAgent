import assert from "node:assert/strict";
import test from "node:test";
import { encodeSegwitAddress } from "../src/launch/bitcoin.js";
import { hashObject } from "../src/launch/canonical.js";
import { buildReserveIntakePlan } from "../src/launch/reserveIntake.js";
import type { TradeLayerBitcoinActivationProof } from "../src/launch/tradelayerBitcoinActivation.js";
import {
  buildTradeLayerListenerPreflightEvidence,
  observeTradeLayerListener,
  verifyTradeLayerListenerPreflightEvidence,
  type TradeLayerListenerObservation
} from "../src/launch/tradelayerListenerPreflight.js";

const CODE_HASH = "ab".repeat(32);
const COMMIT = "cd".repeat(20);
const NOW = new Date("2026-08-06T12:00:00.000Z");
const plan = buildReserveIntakePlan({
  workflowId: "listener-preflight-fixture",
  walletSessionId: "wallet-listener-preflight",
  walletAddress: encodeSegwitAddress(Buffer.alloc(20, 31), "bitcoin-testnet4"),
  amountSats: "100000",
  operatorXonly: "04d7f4188a5cbc5335aee6600ad8e327730d73de961534e23b4b91b7d64b6ae4",
  guardianXonly: "d1517d4cbf81891b1c360554cb5352f1d9e307cfb08d493125450147ad01260c",
  propertyId: 1,
  dlcTemplateId: "starter-utxoref-v1",
  settlementState: "FUNDED",
  dlcHash: "ef".repeat(32)
});

type ResponseInput = {
  node: string;
  instance: string;
  challenge: string;
  lag?: number;
  historyLag?: number;
  trackAhead?: number;
  commit?: string;
  secret?: boolean;
  initialBlockDownload?: boolean;
  headersLag?: number;
  bestBlockHash?: string;
  networkActive?: boolean;
  connections?: number;
  activationSource?: Record<string, unknown>;
};

function response(input: ResponseInput) {
  const lag = input.lag || 0;
  const historyLag = input.historyLag ?? lag;
  return {
    schema: "tradelayer_listener_launch_attestation_v1",
    authority: "read_only_observer",
    effect: "none",
    challenge: input.challenge,
    observedAt: NOW.toISOString(),
    listener: { nodeId: input.node, instanceId: input.instance, network: "BTCTEST", releaseCommit: input.commit || COMMIT },
    bitcoinBackend: {
      chain: "testnet4",
      bestBlockHash: input.bestBlockHash || "34".repeat(32),
      blocks: 100,
      headers: 100 + (input.headersLag || 0),
      initialBlockDownload: input.initialBlockDownload === true,
      verificationProgress: input.initialBlockDownload === true ? 0.75 : 1,
      networkActive: input.networkActive !== false,
      connections: input.connections ?? 8,
      pruned: true
    },
    query: { propertyId: 1, dlcTemplateId: plan.tradeLayer.dlcTemplateId, dlcContractId: plan.tradeLayer.dlcContractId },
    sync: {
      initialized: true,
      phase: "realtime",
      chainTip: 100,
      indexedHeight: 100 - historyLag,
      processedHeight: 100 - historyLag,
      trackHeight: 100 - lag + (input.trackAhead || 0),
      updatedAt: NOW.getTime(),
      error: null
    },
    tx11: {
      active: true,
      activationBlock: 1,
      codeHash: CODE_HASH,
      activationSource: input.activationSource || {
        kind: "bitcoin_transaction",
        chainDerived: true,
        txid: "78".repeat(32),
        blockHeight: 1
      }
    },
    property: { ticker: "tlBTC", type: 2, issuer: "fixture-admin", ...(input.secret ? { seedPhrase: "prohibited" } : {}) },
    template: {
      _id: `template-${plan.tradeLayer.dlcTemplateId}`,
      templateId: plan.tradeLayer.dlcTemplateId,
      templateHash: plan.tradeLayer.dlcHash,
      receiptPropertyId: 1
    },
    contract: null
  };
}

function fetchResponse(value: unknown): typeof fetch {
  return async () => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }) as never;
}

async function observation(
  endpoint: string,
  node: string,
  instance: string,
  challenge: string,
  overrides: Partial<ResponseInput> = {}
) {
  return observeTradeLayerListener({
    plan,
    endpoint,
    challenge,
    now: NOW,
    fetchFn: fetchResponse(response({ node, instance, challenge, ...overrides }))
  });
}

async function verifiedPair() {
  return Promise.all([
    observation("http://127.0.0.1:3101", "listener-a", "instance-a-0001", "01".repeat(32)),
    observation("http://127.0.0.1:3102", "listener-b", "instance-b-0002", "02".repeat(32))
  ]);
}

function activationProof(
  observation: TradeLayerListenerObservation,
  index: number,
  overrides: Partial<Omit<TradeLayerBitcoinActivationProof, "proofHash">> = {}
): TradeLayerBitcoinActivationProof {
  const source = observation.tx11.activationSource;
  if (source.kind !== "bitcoin_transaction") throw new Error("fixture requires Bitcoin activation provenance");
  const core: Omit<TradeLayerBitcoinActivationProof, "proofHash"> = {
    schema: "bitagent_tradelayer_bitcoin_activation_proof_v1",
    authority: "read_only_bitcoin_observer",
    effect: "none",
    listenerObservationHash: observation.observationHash,
    listenerNodeId: observation.listener.nodeId,
    sourceRpcEndpoint: `http://127.0.0.1:${49372 + index}`,
    chain: "testnet4",
    capturedAt: NOW.toISOString(),
    observedBestBlockHash: observation.bitcoinBackend.bestBlockHash,
    observedBestBlockHeight: observation.bitcoinBackend.blocks,
    txid: source.txid,
    blockHash: `${(80 + index).toString(16).padStart(2, "0")}`.repeat(32),
    blockHeight: source.blockHeight,
    confirmations: 99,
    inActiveChain: true,
    payloadHash: "90".repeat(32),
    activatedTxTypes: [11],
    codeHash: CODE_HASH,
    ...overrides
  };
  return { ...core, proofHash: hashObject(core) };
}

function activationProofs(observations: TradeLayerListenerObservation[]) {
  return observations.flatMap((item, index) => item.tx11.activationSource.kind === "bitcoin_transaction"
    ? [activationProof(item, index)]
    : []);
}

function evidence(
  observations: TradeLayerListenerObservation[],
  now = new Date(NOW.getTime() + 1_000),
  proofs = activationProofs(observations)
) {
  return buildTradeLayerListenerPreflightEvidence({
    plan,
    observations,
    bitcoinActivationProofs: proofs,
    now,
    maxAgeMs: 5_000,
    maxSyncLagBlocks: 2,
    acceptedTx11CodeHashes: [CODE_HASH],
    acceptedReleaseCommits: [COMMIT]
  });
}

test("two fresh independent live listeners verify the tx11 registry without transaction authority", async () => {
  const result = evidence(await verifiedPair());
  assert.equal(result.schema, "bitagent_tradelayer_listener_preflight_v2");
  assert.equal(result.bitcoinActivationProofs.length, 2);
  assert.equal(result.status, "verified");
  assert.ok(Object.values(result.gates).every(Boolean));
  assert.equal(result.contractMode, "dynamic_create");
  assert.equal(result.authority, "read_only_observer");
  assert.equal(result.effect, "none");
  assert.equal(verifyTradeLayerListenerPreflightEvidence(result, plan), true);
});

test("duplicate endpoint, node id, instance id, or challenge fails independence", async () => {
  const cases = [
    [
      observation("http://127.0.0.1:3101", "listener-a", "instance-a-0001", "01".repeat(32)),
      observation("http://127.0.0.1:3101", "listener-b", "instance-b-0002", "02".repeat(32))
    ],
    [
      observation("http://127.0.0.1:3101", "listener-a", "instance-a-0001", "01".repeat(32)),
      observation("http://127.0.0.1:3102", "listener-a", "instance-b-0002", "02".repeat(32))
    ],
    [
      observation("http://127.0.0.1:3101", "listener-a", "instance-a-0001", "01".repeat(32)),
      observation("http://127.0.0.1:3102", "listener-b", "instance-a-0001", "02".repeat(32))
    ],
    [
      observation("http://127.0.0.1:3101", "listener-a", "instance-a-0001", "01".repeat(32)),
      observation("http://127.0.0.1:3102", "listener-b", "instance-b-0002", "01".repeat(32))
    ]
  ];
  for (const pair of cases) {
    const observations = await Promise.all(pair);
    assert.equal(evidence(observations).gates.independentLiveListeners, false);
  }
});

test("stale or lagged listeners fail closed", async () => {
  const lagged = await Promise.all([
    observation("http://127.0.0.1:3101", "listener-a", "instance-a-0001", "01".repeat(32), { lag: 3 }),
    observation("http://127.0.0.1:3102", "listener-b", "instance-b-0002", "02".repeat(32))
  ]);
  assert.equal(evidence(lagged).gates.synchronizedTestnet4, false);
  assert.equal(evidence(await verifiedPair(), new Date(NOW.getTime() + 6_000)).gates.freshObservations, false);
});

test("realtime lag follows durable track height, not the historical index boundary", async () => {
  const caughtUp = await Promise.all([
    observation("http://127.0.0.1:3101", "listener-a", "instance-a-0001", "01".repeat(32), { historyLag: 10 }),
    observation("http://127.0.0.1:3102", "listener-b", "instance-b-0002", "02".repeat(32), { historyLag: 20 })
  ]);
  assert.equal(evidence(caughtUp).gates.synchronizedTestnet4, true);

  const impossibleTrack = await Promise.all([
    observation("http://127.0.0.1:3101", "listener-a", "instance-a-0001", "01".repeat(32), { trackAhead: 1 }),
    observation("http://127.0.0.1:3102", "listener-b", "instance-b-0002", "02".repeat(32))
  ]);
  assert.equal(evidence(impossibleTrack).gates.synchronizedTestnet4, false);
});

test("IBD, stale headers, paused networking, or zero peers fail synchronization", async () => {
  for (const backend of [
    { initialBlockDownload: true },
    { headersLag: 1 },
    { networkActive: false },
    { connections: 0 }
  ]) {
    const observations = await Promise.all([
      observation("http://127.0.0.1:3101", "listener-a", "instance-a-0001", "01".repeat(32), backend),
      observation("http://127.0.0.1:3102", "listener-b", "instance-b-0002", "02".repeat(32))
    ]);
    assert.equal(evidence(observations).gates.synchronizedTestnet4, false);
  }
});

test("different Bitcoin best-block hashes fail synchronization parity", async () => {
  const observations = await Promise.all([
    observation("http://127.0.0.1:3101", "listener-a", "instance-a-0001", "01".repeat(32)),
    observation("http://127.0.0.1:3102", "listener-b", "instance-b-0002", "02".repeat(32), {
      bestBlockHash: "56".repeat(32)
    })
  ]);
  assert.equal(evidence(observations).gates.synchronizedTestnet4, false);
});

test("unallowlisted listener release commit fails closed", async () => {
  const observations = await Promise.all([
    observation("http://127.0.0.1:3101", "listener-a", "instance-a-0001", "01".repeat(32), { commit: "ee".repeat(20) }),
    observation("http://127.0.0.1:3102", "listener-b", "instance-b-0002", "02".repeat(32))
  ]);
  assert.equal(evidence(observations).gates.exactReleaseCommit, false);
});

test("local-db or missing tx11 provenance cannot satisfy the chain-derived gate", async () => {
  for (const activationSource of [
    { kind: "local_db_seed", chainDerived: false, profileId: "sandbox" },
    { kind: "legacy_unknown", chainDerived: false }
  ]) {
    const observations = await Promise.all([
      observation("http://127.0.0.1:3101", "listener-a", "instance-a-0001", "01".repeat(32), { activationSource }),
      observation("http://127.0.0.1:3102", "listener-b", "instance-b-0002", "02".repeat(32), { activationSource })
    ]);
    const result = evidence(observations);
    assert.equal(result.status, "failed");
    assert.equal(result.gates.tx11Active, true);
    assert.equal(result.gates.tx11ChainDerived, false);
  }
});

test("missing, stale, tampered, or non-independent Bitcoin activation proofs fail closed", async () => {
  const observations = await verifiedPair();
  const proofs = activationProofs(observations);
  assert.equal(evidence(observations, undefined, proofs.slice(0, 1)).gates.tx11ChainDerived, false);

  const stale = activationProof(observations[0]!, 0, { capturedAt: new Date(NOW.getTime() - 10_000).toISOString() });
  assert.equal(evidence(observations, undefined, [stale, proofs[1]!]).gates.tx11ChainDerived, false);

  const tampered = structuredClone(proofs[0]!);
  tampered.codeHash = "ef".repeat(32);
  assert.equal(evidence(observations, undefined, [tampered, proofs[1]!]).gates.tx11ChainDerived, false);

  const duplicateRpc = activationProof(observations[1]!, 1, { sourceRpcEndpoint: proofs[0]!.sourceRpcEndpoint });
  assert.equal(evidence(observations, undefined, [proofs[0]!, duplicateRpc]).gates.tx11ChainDerived, false);
});

test("challenge mismatch is rejected before evidence exists", async () => {
  await assert.rejects(() => observeTradeLayerListener({
    plan,
    endpoint: "http://127.0.0.1:3101",
    challenge: "01".repeat(32),
    now: NOW,
    fetchFn: fetchResponse(response({ node: "listener-a", instance: "instance-a-0001", challenge: "02".repeat(32) }))
  }), /challenge is invalid/);
});

test("secret-bearing listener responses are rejected", async () => {
  const challenge = "01".repeat(32);
  await assert.rejects(() => observeTradeLayerListener({
    plan,
    endpoint: "http://127.0.0.1:3101",
    challenge,
    now: NOW,
    fetchFn: fetchResponse(response({ node: "listener-a", instance: "instance-a-0001", challenge, secret: true }))
  }), /Secret-bearing listener field is prohibited/);
  await assert.rejects(() => observeTradeLayerListener({
    plan,
    endpoint: "http://operator:credential@127.0.0.1:3101",
    challenge,
    now: NOW,
    fetchFn: fetchResponse({})
  }), /unsupported components/);
});

test("evidence fingerprints reject semantic gate tampering", async () => {
  const original = evidence(await verifiedPair());
  const tampered = structuredClone(original);
  tampered.gates.tx11Active = false;
  assert.equal(verifyTradeLayerListenerPreflightEvidence(tampered, plan), false);
});
