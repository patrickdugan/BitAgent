import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildChainAbstractionEnvelope, prepareEnvelopeWithNear } from "../src/adapters/chainAbstractionAdapter.js";
import { runTestnetEconomicAgent } from "../src/economy/harness.js";
import type { CapabilityLease } from "../src/sovereign/types.js";

test("runs the real TradeLayer testnet4 planner without broadcasting", async () => {
  const runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-economic-"));
  const result = await runTestnetEconomicAgent({
    runtimeDirectory,
    now: new Date("2026-07-12T12:00:00.000Z"),
    probeFilecoin: false
  });

  assert.equal(result.trade.mode, "testnet_dry_run");
  assert.equal(result.trade.artifact.bitcoinNetwork, "testnet4");
  assert.equal(result.trade.artifact.tradePrints.length, 3);
  assert.equal(result.trade.transactionIds.length, 0);
  assert.equal(result.trade.settlementStatus, "unsettled");
  assert.ok(result.trade.artifact.steps.length > 0);
});

test("keeps projected economics separate from spendable treasury", async () => {
  const runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-projection-"));
  const result = await runTestnetEconomicAgent({ runtimeDirectory, now: new Date("2026-07-12T12:00:00.000Z") });

  assert.equal(result.projection.projectedSelfSustaining, true);
  assert.ok(BigInt(result.projection.projectedOperatingMarginSats) > 0n);
  assert.equal(result.projection.settledRevenueSats, "0");
  assert.equal(result.projection.spendableProfitSats, "0");
  assert.equal(result.invariants.dryRunProfitIsNotTreasury, true);
});

test("prepares Filecoin, Akash, and generic compute orders behind policy gates", async () => {
  const runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-infra-"));
  const result = await runTestnetEconomicAgent({ runtimeDirectory, now: new Date("2026-07-12T12:00:00.000Z") });

  assert.deepEqual(result.infrastructure.activePlans.map((plan) => plan.provider), ["filecoin", "akash"]);
  assert.equal(result.infrastructure.computeFallbackPlan.provider, "generic");
  const akashSdl = String(result.infrastructure.activePlans[1].payload.sdl);
  assert.ok(akashSdl.includes('version: "2.0"'));
  assert.ok(akashSdl.includes("units: 0.5"));
  assert.ok(akashSdl.includes("global: true"));
  assert.ok(akashSdl.includes("denom: uact"));
  assert.ok(!akashSdl.includes(":latest"));
  assert.deepEqual(result.infrastructure.authorizations.map((row) => row.decision.decision), [
    "manual_required",
    "manual_required",
    "manual_required"
  ]);
  assert.deepEqual(result.infrastructure.authorizations.map((row) => row.decision.nextCapability), [
    "propose_filecoin_storage",
    "propose_compute_lease",
    "propose_compute_lease"
  ]);
});

test("chain abstraction requires an exact active signature lease", () => {
  const envelope = buildChainAbstractionEnvelope({
    targetChain: "filecoin",
    actionType: "filecoin_direct_deal",
    payload: { network: "calibration", signed: false }
  });
  const lease: CapabilityLease = {
    leaseId: "lease-filecoin-plan",
    requestId: "request-filecoin-plan",
    agentId: "bitagent-sovereign-01",
    capability: "request_near_chain_signature",
    effects: ["read_state", "request_signature"],
    scopeHash: "scope",
    invocationFingerprint: "fingerprint",
    status: "active",
    issuedAt: "2026-07-12T12:00:00.000Z",
    expiresAt: "2026-07-12T12:05:00.000Z"
  };

  const prepared = prepareEnvelopeWithNear({ envelope, lease, derivationPath: "filecoin,calibration,0" });
  assert.equal(envelope.relayable, false);
  assert.equal(prepared.status, "signature_prepared");
  assert.equal(prepared.signaturePreparation.status, "stub");
  assert.equal(prepared.signaturePreparation.targetChain, "filecoin");
});
