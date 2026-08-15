import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { FileComplianceAuditLog, InMemoryComplianceAuditLog } from "../src/compliance/audit.js";
import { complianceHash } from "../src/compliance/policy.js";
import {
  jurisdictionPolicySigningPayload,
  RotatingPolicyTrustStore
} from "../src/compliance/signatures.js";
import {
  evaluateTradeLayerProtocolPolicy,
  readTradeLayerValidityPolicyManifest,
  type TradeLayerValidityPolicyManifest
} from "../src/compliance/tradelayerPolicy.js";
import { ComplianceGatedWalletBroker } from "../src/compliance/walletGate.js";
import type {
  ComplianceDecision,
  JurisdictionPolicy,
  SignedJurisdictionPolicyEnvelope
} from "../src/compliance/types.js";
import { ScriptedWalletBroker } from "../src/launch/broker.js";
import type {
  BitAgentWorkflowState,
  TransactionSimulation,
  WalletApproval
} from "../src/launch/types.js";

const NOW = new Date("2026-08-10T12:00:00.000Z");

function signedPolicyEnvelope(): SignedJurisdictionPolicyEnvelope {
  const policy: JurisdictionPolicy = {
    residence_country: "CL",
    current_location_country: "CL",
    user_type: "retail",
    supported: true,
    mode: "PERPS_ALLOWED",
    max_leverage: 5,
    referral_allowed: true,
    agent_assisted_referral_allowed: true,
    local_marketing_restrictions: [],
    required_disclosures: [],
    product_restrictions: [],
    explicitly_allowed_products: ["SPOT"],
    review_required: false,
    policy_version: "2026-08-10.1"
  };
  return {
    schema: "bitagent_signed_jurisdiction_policy_v1",
    policy,
    key_id: "policy-key-1",
    issued_at: "2026-08-10T00:00:00.000Z",
    expires_at: "2026-08-11T00:00:00.000Z",
    signature: ""
  };
}

test("Ed25519 trust store supports rotation while rejecting revoked, expired, and tampered envelopes", () => {
  const pair = generateKeyPairSync("ed25519");
  const envelope = signedPolicyEnvelope();
  envelope.signature = sign(
    null,
    Buffer.from(jurisdictionPolicySigningPayload(envelope)),
    pair.privateKey
  ).toString("base64url");
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const document = (status: "ACTIVE" | "RETIRED" | "REVOKED") => ({
    schema: "bitagent_policy_trust_document_v1" as const,
    keys: [{
      key_id: "policy-key-1",
      algorithm: "Ed25519" as const,
      public_key_pem: publicKey,
      status,
      not_before: "2026-08-01T00:00:00.000Z",
      not_after: "2026-09-01T00:00:00.000Z"
    }]
  });
  assert.equal(new RotatingPolicyTrustStore(document("ACTIVE")).verify(envelope, NOW), true);
  assert.equal(new RotatingPolicyTrustStore(document("RETIRED")).verify(envelope, NOW), true);
  assert.equal(new RotatingPolicyTrustStore(document("REVOKED")).verify(envelope, NOW), false);
  assert.equal(new RotatingPolicyTrustStore(document("ACTIVE")).verify(envelope, new Date("2026-10-01")), false);
  envelope.policy.max_leverage = 100;
  assert.equal(new RotatingPolicyTrustStore(document("ACTIVE")).verify(envelope, NOW), false);
});

test("TradeLayer policy manifest reproduces validity.js fallback and detects the current banlist reader defect", async () => {
  const manifest = await readTradeLayerValidityPolicyManifest("C:\\projects\\tradelayer.js");
  assert.deepEqual(manifest.fallback_banned_countries, ["CU", "IR", "KP", "RU", "US"]);
  assert.equal(manifest.contract_trading_rule_detected, true);
  assert.equal(manifest.dynamic_banlist_reader, "KNOWN_ARRAY_SHAPE_BUG");
  assert.match(manifest.policy_version, /^tradelayer-validity-[0-9a-f]{16}$/);

  const allowed = evaluateTradeLayerProtocolPolicy({
    manifest,
    product: "SPOT",
    expected_current_location_country: "CL",
    snapshot: {
      schema: "bitagent_tradelayer_jurisdiction_snapshot_v1",
      status: "OK",
      wallet_address: "tltc1qexample",
      country_code: "CL",
      observed_at: NOW.toISOString(),
      source_id: "test-node"
    }
  });
  assert.equal(allowed.status, "ALLOW");
  assert.ok(allowed.reason_codes.includes("NOT_A_LEGAL_PERMISSION"));

  const banned = evaluateTradeLayerProtocolPolicy({
    manifest,
    product: "PERPETUAL",
    snapshot: {
      schema: "bitagent_tradelayer_jurisdiction_snapshot_v1",
      status: "OK",
      wallet_address: "tltc1qbanned",
      country_code: "US",
      observed_at: NOW.toISOString(),
      source_id: "test-node"
    }
  });
  assert.equal(banned.status, "BLOCK");
});

test("durable compliance audit survives restart and rejects tampering", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-compliance-audit-"));
  const file = path.join(directory, "audit.jsonl");
  try {
    const first = new FileComplianceAuditLog(file, () => NOW);
    await first.append({ event_type: "jurisdiction_policy_checked", metadata: { status: "OK" } });
    await first.append({ event_type: "product_allowed", metadata: { product: "SPOT" } });
    const reopened = new FileComplianceAuditLog(file, () => NOW);
    assert.equal((await reopened.list()).length, 2);
    await fs.appendFile(file, `${JSON.stringify({ forged: true })}\n`, "utf8");
    await assert.rejects(() => reopened.list(), /integrity|invalid/i);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

function manifestFixture(): TradeLayerValidityPolicyManifest {
  return {
    schema: "bitagent_tradelayer_validity_policy_manifest_v1",
    authority: "tradelayer_validity_js",
    effect: "none",
    policy_version: "tradelayer-validity-test",
    validity_file: "validity.js",
    validity_sha256: "1".repeat(64),
    clearlist_file: "clearlist.js",
    clearlist_sha256: "2".repeat(64),
    source_hash: "3".repeat(64),
    fallback_banned_countries: ["US"],
    country_attestation_list_id: 0,
    country_attestation_kind: "SELF_CERTIFIED_TWO_LETTER_CODE",
    contract_trading_rule_detected: true,
    dynamic_banlist_reader: "PRESENT"
  };
}

function decision(version = "2026-08-10.1"): ComplianceDecision {
  return {
    schema: "bitagent_compliance_decision_v1",
    status: "ALLOW_WITH_DISCLOSURE",
    compliance_state: "VERIFIED",
    trading_permission: "POLICY_ALLOWED",
    jurisdiction_mode: "PERPS_ALLOWED",
    allowed_products: ["SPOT"],
    max_leverage: 5,
    referral_mode: "ONE_HOP",
    outreach_mode: "HUMAN_SEND_REQUIRED",
    required_disclosures: [],
    prohibited_claims: [],
    reason_codes: ["JURISDICTION_SUPPORTED"],
    policy_version: version,
    policy_expires_at: "2026-08-11T00:00:00.000Z",
    policy_receipt_hash: "4".repeat(64),
    evaluated_context_hash: "5".repeat(64),
    escalation: "NONE",
    view_only_available: true,
    financial_vulnerability_signal: false
  };
}

test("wallet gate binds approval and execution to an unchanged compliance and TradeLayer context", async () => {
  const simulation = {
    id: "sim-1",
    hash: "6".repeat(64),
    action: "starter_strategy",
    createdAt: NOW.toISOString(),
    expiresAt: "2026-08-10T12:10:00.000Z",
    effects: [],
    fees: { networkFeeSats: "1", protocolFeeSats: "0", totalFeeSats: "1" },
    balanceBeforeSats: "10",
    balanceAfterSats: "9",
    warnings: []
  } satisfies TransactionSimulation;
  const state = {
    id: "workflow-1",
    wallet: { walletSessionId: "session-1" }
  } as BitAgentWorkflowState;
  const approval = {
    id: "approval-1",
    action: "starter_strategy",
    simulationHash: simulation.hash,
    status: "pending",
    requestedAt: NOW.toISOString()
  } satisfies WalletApproval;
  let currentDecision = decision();
  const protocol = evaluateTradeLayerProtocolPolicy({
    manifest: manifestFixture(),
    product: "SPOT",
    snapshot: {
      schema: "bitagent_tradelayer_jurisdiction_snapshot_v1",
      status: "OK",
      wallet_address: "tltc1qexample",
      country_code: "CL",
      observed_at: NOW.toISOString(),
      source_id: "test-node"
    }
  });
  const authority = {
    async evaluate() {
      return {
        decision: currentDecision,
        product: "SPOT" as const,
        protocol_policy: protocol,
        expires_at: "2026-08-10T12:01:00.000Z"
      };
    }
  };
  const gate = new ComplianceGatedWalletBroker(
    new ScriptedWalletBroker(),
    authority,
    new InMemoryComplianceAuditLog(() => NOW),
    () => NOW
  );
  const authorized = await gate.authorize({ approval, simulation, state });
  assert.equal(authorized.status, "approved");
  assert.match(authorized.complianceAuthorizationHash || "", /^[0-9a-f]{64}$/);
  const approved: WalletApproval = {
    ...approval,
    status: "approved",
    walletApprovalToken: authorized.status === "approved" ? authorized.walletApprovalToken : undefined,
    complianceAuthorizationHash: authorized.complianceAuthorizationHash,
    complianceDecisionHash: authorized.complianceDecisionHash
  };
  const executed = await gate.execute({ approval: approved, simulation, state, now: NOW });
  assert.equal(executed.complianceAuthorizationHash, authorized.complianceAuthorizationHash);

  currentDecision = decision("2026-08-10.2");
  await assert.rejects(
    () => gate.execute({ approval: approved, simulation, state, now: NOW }),
    /policy changed|fresh approval/i
  );
});
