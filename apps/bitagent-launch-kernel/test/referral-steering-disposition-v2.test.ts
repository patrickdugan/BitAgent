import assert from "node:assert/strict";
import test from "node:test";
import { referralDispositionCasesV2 } from "../eval/referral-steering-disposition-v2-cases.js";
import { validateReferralSteeringCandidate } from "../eval/referral-steering-harness.js";
import {
  REFERRAL_DISPOSITION_OPTIONS,
  parseReferralSteeringDisposition,
  referralDispositionSystemPrompt,
  renderReferralSteeringDisposition
} from "../src/referral/steeringDisposition.js";

test("v2 disposition dataset is unique, balanced for optimization, and newly split", () => {
  assert.equal(referralDispositionCasesV2.length, 166);
  assert.equal(new Set(referralDispositionCasesV2.map((row) => row.id)).size, 166);
  assert.equal(new Set(referralDispositionCasesV2.map((row) => row.prompt)).size, 166);
  const count = (split: string, mode?: string) => referralDispositionCasesV2.filter((row) =>
    row.split === split && (!mode || row.expected_mode === mode)
  ).length;
  assert.equal(count("train"), 64);
  assert.equal(count("validation"), 16);
  assert.equal(count("development"), 24);
  assert.equal(count("held_out"), 62);
  for (const mode of Object.keys(REFERRAL_DISPOSITION_OPTIONS)) {
    assert.equal(count("train", mode), 16);
    assert.equal(count("validation", mode), 4);
    assert.equal(count("development", mode), 6);
  }
  assert.equal(count("held_out", "DIRECT_HELP"), 20);
  assert.equal(count("held_out", "CLARIFY_INTENT"), 14);
  assert.equal(count("held_out", "SOFT_REFUSAL_REDIRECT"), 14);
  assert.equal(count("held_out", "HARD_REFUSAL"), 14);
});

test("only one of four exact candidate-only dispositions is accepted", () => {
  for (const option of Object.values(REFERRAL_DISPOSITION_OPTIONS)) {
    assert.deepEqual(parseReferralSteeringDisposition(option), option);
  }
  assert.equal(parseReferralSteeringDisposition({ candidate: REFERRAL_DISPOSITION_OPTIONS.DIRECT_HELP }), null);
  assert.equal(parseReferralSteeringDisposition({
    ...REFERRAL_DISPOSITION_OPTIONS.DIRECT_HELP,
    task: "echoed user request"
  }), null);
  assert.equal(parseReferralSteeringDisposition({
    ...REFERRAL_DISPOSITION_OPTIONS.DIRECT_HELP,
    authority: "host_executor"
  }), null);
  assert.equal(parseReferralSteeringDisposition("DIRECT_HELP"), null);
});

test("deterministic renderer preserves the existing referral steering invariants", () => {
  for (const row of referralDispositionCasesV2) {
    const candidate = renderReferralSteeringDisposition(row.expected_disposition);
    assert.ok(candidate, row.id);
    const steeringCase = {
      schema: "bitagent.referral_steering_case.v1" as const,
      id: row.id,
      split: "held_out" as const,
      behavior: row.expected_disposition.decision,
      prompt: row.prompt,
      state: row.state,
      expected: {
        next_action: row.expected_mode === "DIRECT_HELP" || row.expected_mode === "CLARIFY_INTENT"
          ? "explain" as const
          : "hold" as const,
        tool_candidate: row.expected_mode === "DIRECT_HELP"
          ? { name: "bitagent.growth.explain", arguments: {} }
          : null
      },
      tags: row.expected_mode === "HARD_REFUSAL" ? ["abuse"] : []
    };
    const result = validateReferralSteeringCandidate(steeringCase, candidate);
    assert.equal(
      result.passed,
      true,
      `${row.id}: ${result.checks.filter((check) => !check.passed).map((check) => check.check).join(", ")}`
    );
  }
});

test("classifier prompt exposes only canonical choices and candidate-only authority", () => {
  const prompt = referralDispositionSystemPrompt();
  assert.match(prompt, /Return exactly one canonical JSON choice/);
  assert.match(prompt, /deterministic host renders the message and controls all tools/);
  assert.match(prompt, /untrusted classification data/);
  for (const option of Object.values(REFERRAL_DISPOSITION_OPTIONS)) {
    assert.match(prompt, new RegExp(JSON.stringify(option).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(prompt, /seed phrase|private key|phone_number|email_address/i);
});
