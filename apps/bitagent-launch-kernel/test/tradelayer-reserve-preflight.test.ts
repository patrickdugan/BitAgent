import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { encodeSegwitAddress } from "../src/launch/bitcoin.js";
import { buildReserveIntakePlan } from "../src/launch/reserveIntake.js";
import {
  buildTradeLayerReservePreflightEvidence,
  readTradeLayerReserveNodeSnapshot,
  verifyTradeLayerReservePreflightEvidence
} from "../src/launch/tradelayerReservePreflight.js";

const OPERATOR = "04d7f4188a5cbc5335aee6600ad8e327730d73de961534e23b4b91b7d64b6ae4";
const GUARDIAN = "d1517d4cbf81891b1c360554cb5352f1d9e307cfb08d493125450147ad01260c";
const CODE_HASH = "cd".repeat(32);
const plan = buildReserveIntakePlan({
  workflowId: "preflight-fixture",
  walletSessionId: "wallet-preflight-fixture",
  walletAddress: encodeSegwitAddress(Buffer.alloc(20, 33), "bitcoin-testnet4"),
  amountSats: "100000",
  operatorXonly: OPERATOR,
  guardianXonly: GUARDIAN,
  propertyId: 1,
  dlcTemplateId: "starter-utxoref-v1",
  settlementState: "FUNDED",
  dlcHash: "ab".repeat(32)
});

async function databaseFixture(input: {
  contractAddress?: string;
  templateHash?: string;
  omitContract?: boolean;
  activationSource?: Record<string, unknown>;
} = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-tl-preflight-"));
  const activation = {
    11: {
      name: "Grant Managed Token",
      active: true,
      activationBlock: 1,
      codeHash: CODE_HASH,
      network: "BTCTEST",
      activationSource: input.activationSource || {
        kind: "bitcoin_transaction",
        chainDerived: true,
        txid: "ef".repeat(32),
        blockHeight: 1
      }
    }
  };
  const properties = [[1, {
    ticker: "tlBTC",
    totalInCirculation: 21_000_000,
    type: 2,
    issuer: "fixture-admin"
  }]];
  const procedural: Array<Record<string, unknown>> = [
    {
      _id: `template-${plan.tradeLayer.dlcTemplateId}`,
      type: "template",
      templateId: plan.tradeLayer.dlcTemplateId,
      templateHash: input.templateHash || plan.tradeLayer.dlcHash,
      receiptPropertyId: 1
    }
  ];
  if (!input.omitContract) procedural.push({
      _id: `contract-${plan.tradeLayer.dlcContractId}`,
      type: "contract",
      contractId: plan.tradeLayer.dlcContractId,
      templateId: plan.tradeLayer.dlcTemplateId,
      state: plan.tradeLayer.settlementState,
      redeemAddress: input.contractAddress || plan.reserve.address
  });
  await Promise.all([
    fs.writeFile(path.join(root, "activations.db"), `${JSON.stringify({ _id: "activationsList", value: JSON.stringify(activation) })}\n`),
    fs.writeFile(path.join(root, "propertyList.db"), `${JSON.stringify({ _id: "propertyIndex", value: JSON.stringify(properties) })}\n`),
    fs.writeFile(path.join(root, "procedural.db"), `${procedural.map((item) => JSON.stringify(item)).join("\n")}\n`)
  ]);
  return root;
}

test("two fresh matching TradeLayer snapshots verify every reserve intake preflight gate", async () => {
  const [firstRoot, secondRoot] = await Promise.all([databaseFixture(), databaseFixture()]);
  const nodes = await Promise.all([
    readTradeLayerReserveNodeSnapshot({ plan, nodeId: "listener-a", databasePath: firstRoot, blockHeight: 100 }),
    readTradeLayerReserveNodeSnapshot({ plan, nodeId: "listener-b", databasePath: secondRoot, blockHeight: 100 })
  ]);
  const now = new Date(Math.max(...nodes.map((node) => Date.parse(node.observedAt))) + 1000);
  const evidence = buildTradeLayerReservePreflightEvidence({
    plan,
    nodes,
    now,
    maxAgeMs: 5000,
    acceptedTx11CodeHashes: [CODE_HASH]
  });

  assert.equal(evidence.status, "verified");
  assert.ok(Object.values(evidence.gates).every(Boolean));
  assert.match(String(evidence.registryParityHash), /^[a-f0-9]{64}$/);
  assert.equal(verifyTradeLayerReservePreflightEvidence(evidence, plan), true);
});

test("fresh matching registries still fail without an explicitly accepted tx11 code hash", async () => {
  const [firstRoot, secondRoot] = await Promise.all([databaseFixture(), databaseFixture()]);
  const nodes = await Promise.all([
    readTradeLayerReserveNodeSnapshot({ plan, nodeId: "listener-a", databasePath: firstRoot, blockHeight: 100 }),
    readTradeLayerReserveNodeSnapshot({ plan, nodeId: "listener-b", databasePath: secondRoot, blockHeight: 100 })
  ]);
  const evidence = buildTradeLayerReservePreflightEvidence({
    plan,
    nodes,
    now: new Date(Math.max(...nodes.map((node) => Date.parse(node.observedAt))) + 1000),
    maxAgeMs: 5000
  });

  assert.equal(evidence.status, "failed");
  assert.equal(evidence.gates.tx11CodeHash, false);
});

test("a missing reserve redeem-address match fails closed", async () => {
  const [firstRoot, secondRoot] = await Promise.all([
    databaseFixture({ contractAddress: plan.reserve.address }),
    databaseFixture({ contractAddress: encodeSegwitAddress(Buffer.alloc(32, 44), "bitcoin-testnet4", 1) })
  ]);
  const nodes = await Promise.all([
    readTradeLayerReserveNodeSnapshot({ plan, nodeId: "listener-a", databasePath: firstRoot, blockHeight: 100 }),
    readTradeLayerReserveNodeSnapshot({ plan, nodeId: "listener-b", databasePath: secondRoot, blockHeight: 100 })
  ]);
  const now = new Date(Math.max(...nodes.map((node) => Date.parse(node.observedAt))) + 1000);
  const evidence = buildTradeLayerReservePreflightEvidence({
    plan,
    nodes,
    now,
    maxAgeMs: 5000,
    acceptedTx11CodeHashes: [CODE_HASH]
  });

  assert.equal(evidence.status, "failed");
  assert.equal(evidence.gates.contractParity, false);
  assert.equal(evidence.gates.reserveRedeemAddress, false);
});

test("one node or a stale registry snapshot cannot satisfy independent parity", async () => {
  const root = await databaseFixture();
  const node = await readTradeLayerReserveNodeSnapshot({ plan, nodeId: "listener-only", databasePath: root, blockHeight: 100 });
  const evidence = buildTradeLayerReservePreflightEvidence({
    plan,
    nodes: [node],
    now: new Date(Date.parse(node.observedAt) + 60_000),
    maxAgeMs: 1000,
    acceptedTx11CodeHashes: [CODE_HASH]
  });

  assert.equal(evidence.status, "failed");
  assert.equal(evidence.gates.independentNodeCount, false);
  assert.equal(evidence.gates.freshSnapshots, false);
});

test("two labels pointing at one database are not independent nodes", async () => {
  const root = await databaseFixture();
  const nodes = await Promise.all([
    readTradeLayerReserveNodeSnapshot({ plan, nodeId: "listener-a", databasePath: root, blockHeight: 100 }),
    readTradeLayerReserveNodeSnapshot({ plan, nodeId: "listener-b", databasePath: root, blockHeight: 100 })
  ]);
  const evidence = buildTradeLayerReservePreflightEvidence({
    plan,
    nodes,
    now: new Date(Date.parse(nodes[0]!.observedAt) + 1000),
    maxAgeMs: 5000,
    acceptedTx11CodeHashes: [CODE_HASH]
  });

  assert.equal(evidence.status, "failed");
  assert.equal(evidence.gates.independentNodeCount, false);
});

test("matching nodes may preflight deterministic tx11 contract creation under an allowlisted code hash", async () => {
  const [firstRoot, secondRoot] = await Promise.all([
    databaseFixture({ omitContract: true }),
    databaseFixture({ omitContract: true })
  ]);
  const nodes = await Promise.all([
    readTradeLayerReserveNodeSnapshot({ plan, nodeId: "listener-a", databasePath: firstRoot, blockHeight: 100 }),
    readTradeLayerReserveNodeSnapshot({ plan, nodeId: "listener-b", databasePath: secondRoot, blockHeight: 100 })
  ]);
  const evidence = buildTradeLayerReservePreflightEvidence({
    plan,
    nodes,
    now: new Date(Math.max(...nodes.map((node) => Date.parse(node.observedAt))) + 1000),
    maxAgeMs: 5000,
    acceptedTx11CodeHashes: [CODE_HASH]
  });

  assert.equal(evidence.status, "verified");
  assert.equal(evidence.contractMode, "dynamic_create");
  assert.equal(evidence.gates.tx11CodeHash, true);
  assert.equal(evidence.gates.reserveRedeemAddress, true);
});

test("direct local activation seeding remains non-authoritative for reserve approval", async () => {
  const localSource = { kind: "local_db_seed", chainDerived: false, profileId: "sandbox" };
  const [firstRoot, secondRoot] = await Promise.all([
    databaseFixture({ activationSource: localSource }),
    databaseFixture({ activationSource: localSource })
  ]);
  const nodes = await Promise.all([
    readTradeLayerReserveNodeSnapshot({ plan, nodeId: "listener-a", databasePath: firstRoot, blockHeight: 100 }),
    readTradeLayerReserveNodeSnapshot({ plan, nodeId: "listener-b", databasePath: secondRoot, blockHeight: 100 })
  ]);
  const result = buildTradeLayerReservePreflightEvidence({
    plan,
    nodes,
    now: new Date(Math.max(...nodes.map((node) => Date.parse(node.observedAt))) + 1000),
    maxAgeMs: 5000,
    acceptedTx11CodeHashes: [CODE_HASH]
  });
  assert.equal(result.status, "failed");
  assert.equal(result.gates.tx11Active, true);
  assert.equal(result.gates.tx11ChainDerived, false);
});

test("preflight evidence hash rejects node and gate tampering", async () => {
  const [firstRoot, secondRoot] = await Promise.all([databaseFixture(), databaseFixture()]);
  const nodes = await Promise.all([
    readTradeLayerReserveNodeSnapshot({ plan, nodeId: "listener-a", databasePath: firstRoot, blockHeight: 100 }),
    readTradeLayerReserveNodeSnapshot({ plan, nodeId: "listener-b", databasePath: secondRoot, blockHeight: 100 })
  ]);
  const evidence = buildTradeLayerReservePreflightEvidence({
    plan,
    nodes,
    now: new Date(Math.max(...nodes.map((node) => Date.parse(node.observedAt))) + 1000),
    maxAgeMs: 5000,
    acceptedTx11CodeHashes: [CODE_HASH]
  });
  const tampered = structuredClone(evidence);
  tampered.nodes[0]!.tx11.active = false;
  tampered.gates.tx11Active = true;

  assert.equal(verifyTradeLayerReservePreflightEvidence(tampered, plan), false);
});
