import assert from "node:assert/strict";
import test from "node:test";

import { buildDemoIntent, buildDemoSnapshot, defaultSurvivalPolicy } from "../src/survival/harness.js";
import { canonicalHash } from "../src/survival/policy.js";
import {
  FinancialSurvivalToolError,
  FinancialSurvivalToolRegistry,
  financialSurvivalToolSchemas,
  type FinancialSurvivalToolHost
} from "../src/survival/tools.js";
import type { SurvivalJournalRecord } from "../src/survival/types.js";

const now = new Date("2026-08-06T12:00:00.000Z");
const snapshot = buildDemoSnapshot(now);
const snapshotReceiptHash = canonicalHash({ source: "two-host-observer-quorum", snapshot });
const policyHash = canonicalHash(defaultSurvivalPolicy);

function journalRecord(
  sequence: number,
  previousHash: string,
  eventId: string
): SurvivalJournalRecord {
  const material = {
    sequence,
    eventId,
    type: "snapshot_assessed" as const,
    occurredAt: now.toISOString(),
    payloadHash: canonicalHash({ eventId }),
    previousHash
  };
  return { ...material, hash: canonicalHash(material) };
}

const firstRecord = journalRecord(0, "0".repeat(64), "evt-0");
const secondRecord = journalRecord(1, firstRecord.hash, "evt-1");
const journal = [firstRecord, secondRecord];

function host(records: SurvivalJournalRecord[] = journal): FinancialSurvivalToolHost {
  return {
    loadState: () => ({ policy: defaultSurvivalPolicy, snapshot, snapshotReceiptHash }),
    loadJournal: (uri) => {
      if (uri !== "mcp://bitagent/survival-journal/current") throw new Error("not found");
      return records;
    },
    now: () => now
  };
}

function stateBindings() {
  return {
    policyId: defaultSurvivalPolicy.id,
    policyHash,
    snapshotReceiptHash
  };
}

test("financial survival exposes exactly three effect-free deterministic tools", () => {
  assert.deepEqual(Object.keys(financialSurvivalToolSchemas).sort(), [
    "bitagent.survival.assess",
    "bitagent.survival.evaluate",
    "bitagent.survival.journal.verify"
  ]);
  for (const schema of Object.values(financialSurvivalToolSchemas)) {
    assert.equal(schema.additionalProperties, false);
    assert.ok(schema.required.length > 0);
  }
});

test("assessment uses host policy and treasury state without an effect", async () => {
  const registry = new FinancialSurvivalToolRegistry(host());
  const result = await registry.call("bitagent.survival.assess", stateBindings());
  assert.equal(result.schema, "bitagent_survival_assessment_result_v1");
  assert.equal(result.authority, "deterministic_host");
  assert.equal(result.effect, "none");
  assert.equal(result.assessment.mode, "healthy");
  assert.equal(result.evidence.snapshotReceiptHash, snapshotReceiptHash);
});

test("evaluation returns policy capability material without approval or execution", async () => {
  const registry = new FinancialSurvivalToolRegistry(host());
  const result = await registry.call("bitagent.survival.evaluate", {
    ...stateBindings(),
    intent: buildDemoIntent(now)
  });
  assert.equal(result.schema, "bitagent_survival_policy_decision_result_v1");
  assert.equal(result.effect, "none");
  assert.equal(result.decision.decision, "authorized");
  assert.equal(result.decision.nextCapability, "pay_invoice_capped");
  assert.equal(result.walletApprovalRequested, false);
  assert.equal(result.signingPerformed, false);
  assert.equal(result.broadcastPerformed, false);
  assert.equal(result.executionPerformed, false);
});

test("changed policy or treasury evidence fails before evaluation", async () => {
  const registry = new FinancialSurvivalToolRegistry(host());
  await assert.rejects(
    registry.call("bitagent.survival.assess", {
      ...stateBindings(),
      snapshotReceiptHash: "f".repeat(64)
    }),
    (error: unknown) => error instanceof FinancialSurvivalToolError
      && error.code === "evidence_binding_mismatch"
  );
});

test("intent extras including secret-bearing fields are rejected", async () => {
  const registry = new FinancialSurvivalToolRegistry(host());
  await assert.rejects(
    registry.call("bitagent.survival.evaluate", {
      ...stateBindings(),
      intent: { ...buildDemoIntent(now), privateKey: "must-not-enter-the-tool" }
    }),
    (error: unknown) => error instanceof FinancialSurvivalToolError
      && error.code === "invalid_arguments"
  );
});

test("journal verification loads raw records host-side and returns only compact evidence", async () => {
  const registry = new FinancialSurvivalToolRegistry(host());
  const result = await registry.call("bitagent.survival.journal.verify", {
    journalUri: "mcp://bitagent/survival-journal/current",
    expectedHeadHash: secondRecord.hash
  });
  assert.equal(result.schema, "bitagent_survival_journal_verification_v1");
  assert.equal(result.effect, "none");
  assert.equal(result.valid, true);
  assert.equal(result.recordCount, 2);
  assert.equal("records" in result, false);
});

test("journal corruption and unresolved URIs fail closed", async () => {
  const corrupt = journal.map((record) => ({ ...record }));
  corrupt[1]!.previousHash = "a".repeat(64);
  const registry = new FinancialSurvivalToolRegistry(host(corrupt));
  const result = await registry.call("bitagent.survival.journal.verify", {
    journalUri: "mcp://bitagent/survival-journal/current",
    expectedHeadHash: secondRecord.hash
  });
  assert.equal(result.valid, false);

  await assert.rejects(
    registry.call("bitagent.survival.journal.verify", {
      journalUri: "mcp://bitagent/survival-journal/missing",
      expectedHeadHash: secondRecord.hash
    }),
    (error: unknown) => error instanceof FinancialSurvivalToolError
      && error.code === "journal_not_found"
  );
});
