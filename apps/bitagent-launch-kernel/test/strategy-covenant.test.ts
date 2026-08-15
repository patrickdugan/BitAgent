import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildStrategyCandidate } from "../src/mandates/allocator.js";
import { createStrategyBenchmarkScenario, runStrategyCovenantBenchmark } from "../src/mandates/benchmark.js";
import { StrategyMandateError } from "../src/mandates/errors.js";
import { FileStrategyReceiptStore } from "../src/mandates/receiptStore.js";
import { buildCommittedSignalDraft } from "../src/mandates/signalBridge.js";
import type { StrategyBenchmarkScenario } from "../src/mandates/benchmark.js";
import type { StrategyCandidate, StrategyCovenant, StrategyProposal } from "../src/mandates/types.js";
import {
  covenantCore,
  createMarketSnapshot,
  createPortfolioState,
  createStrategyCovenant,
  createStrategyCovenantApproval,
  createStrategyProposal,
  marketSnapshotCore,
  portfolioStateCore,
  proposalCore,
  validateStrategyCovenant
} from "../src/mandates/validator.js";
import {
  createStrategyDecisionReceipt,
  verifyStrategyCandidate,
  verifyStrategyDecisionReceipt
} from "../src/mandates/verifier.js";

const fixedNow = new Date("2026-08-05T12:00:00.000Z");

function scenario(): StrategyBenchmarkScenario {
  return createStrategyBenchmarkScenario(new Date(fixedNow));
}

function withProposal(base: StrategyProposal, changes: Partial<Omit<StrategyProposal, "proposalHash">>) {
  return createStrategyProposal({ ...proposalCore(base), ...changes });
}

function withCovenant(base: StrategyCovenant, changes: Partial<Omit<StrategyCovenant, "covenantHash">>) {
  return createStrategyCovenant({ ...covenantCore(base), ...changes });
}

function expectCode(fn: () => unknown, code: string) {
  assert.throws(fn, (error: unknown) => error instanceof StrategyMandateError && error.code === code);
}

test("weighted strategy targets produce an exact candidate-only TradeLayer manifest", () => {
  const setup = scenario();
  const candidate = buildStrategyCandidate(setup);
  assert.equal(candidate.weightedTargetNetDeltaBps, 480);
  assert.equal(candidate.projectedNetDeltaBps, -1);
  assert.equal(candidate.action, "place_limit");
  assert.equal(candidate.side, "buy_tlbtc");
  assert.equal(candidate.nextAuthority, "wallet_user");
  assert.equal(candidate.signingPerformed, false);
  assert.equal(candidate.broadcastPerformed, false);
  assert.equal(candidate.manifest.wallet, setup.covenant.owner.walletAccount);
  assert.equal(candidate.manifest.networkFeeSats, "900");
  assert.equal(candidate.manifest.permission, "place_limit");
  assert.match(candidate.candidateHash, /^[0-9a-f]{64}$/);
});

test("verified candidate produces an effect-free replay receipt", () => {
  const setup = scenario();
  const candidate = buildStrategyCandidate(setup);
  const verification = verifyStrategyCandidate({ ...setup, candidate });
  assert.equal(verification.verified, true);
  const receipt = createStrategyDecisionReceipt({ candidate, covenant: setup.covenant, proposals: setup.proposals, verification });
  assert.equal(verifyStrategyDecisionReceipt(receipt), true);
  assert.equal(receipt.effect, "none");
  assert.equal(receipt.signingPerformed, false);
});

test("covenant weights must total exactly 10000 bps", () => {
  const setup = scenario();
  const strategies = structuredClone(setup.covenant.strategies);
  strategies[0]!.weightBps = 4_999;
  expectCode(() => withCovenant(setup.covenant, { strategies }), "covenant_invalid");
});

test("covenant hash binds capital cap and all policy fields", () => {
  const setup = scenario();
  const tampered = structuredClone(setup.covenant);
  tampered.capital.capAtoms = "999999999999";
  expectCode(() => validateStrategyCovenant(tampered), "covenant_invalid");
});

test("secret-bearing covenant fields are rejected before persistence", () => {
  const setup = scenario();
  const unsafe = { ...setup.covenant, privateKey: "never-read-this" };
  expectCode(() => validateStrategyCovenant(unsafe), "secret_material_prohibited");
});

test("wallet approval must match the exact covenant hash", () => {
  const setup = scenario();
  setup.approval = createStrategyCovenantApproval({
    ...setup.approval,
    covenantHash: "ff".repeat(32)
  });
  expectCode(() => buildStrategyCandidate(setup), "covenant_invalid");
});

test("revoked covenant approval cannot produce a candidate", () => {
  const setup = scenario();
  setup.approval = createStrategyCovenantApproval({ ...setup.approval, status: "revoked" });
  expectCode(() => buildStrategyCandidate(setup), "covenant_expired");
});

test("expired covenant approval cannot produce a candidate", () => {
  const setup = scenario();
  setup.approval = createStrategyCovenantApproval({
    ...setup.approval,
    approvedAt: new Date(fixedNow.getTime() - 2_000).toISOString(),
    expiresAt: new Date(fixedNow.getTime() - 1_000).toISOString()
  });
  expectCode(() => buildStrategyCandidate(setup), "covenant_expired");
});

test("every committed strategy must provide one proposal", () => {
  const setup = scenario();
  setup.proposals.pop();
  expectCode(() => buildStrategyCandidate(setup), "proposal_invalid");
});

test("duplicate strategy proposals are rejected", () => {
  const setup = scenario();
  setup.proposals[3] = setup.proposals[0]!;
  expectCode(() => buildStrategyCandidate(setup), "proposal_invalid");
});

test("proposal adapter hash must match the committed module", () => {
  const setup = scenario();
  setup.proposals[0] = withProposal(setup.proposals[0]!, { adapterHash: "aa".repeat(32) });
  expectCode(() => buildStrategyCandidate(setup), "proposal_invalid");
});

test("expired strategy proposal is rejected", () => {
  const setup = scenario();
  setup.proposals[0] = withProposal(setup.proposals[0]!, {
    generatedAt: new Date(fixedNow.getTime() - 2_000).toISOString(),
    expiresAt: new Date(fixedNow.getTime() - 1_000).toISOString()
  });
  expectCode(() => buildStrategyCandidate(setup), "proposal_invalid");
});

test("future-dated strategy proposal is rejected", () => {
  const setup = scenario();
  setup.proposals[0] = withProposal(setup.proposals[0]!, {
    generatedAt: new Date(fixedNow.getTime() + 1_000).toISOString(),
    expiresAt: new Date(fixedNow.getTime() + 2_000).toISOString()
  });
  expectCode(() => buildStrategyCandidate(setup), "proposal_invalid");
});

test("proposal market root must match the current snapshot", () => {
  const setup = scenario();
  setup.proposals[0] = withProposal(setup.proposals[0]!, { marketSnapshotHash: "bb".repeat(32) });
  expectCode(() => buildStrategyCandidate(setup), "proposal_invalid");
});

test("stale market snapshot is rejected", () => {
  const setup = scenario();
  setup.market = createMarketSnapshot({
    ...marketSnapshotCore(setup.market),
    observedAt: new Date(fixedNow.getTime() - 3_000).toISOString()
  });
  setup.proposals = setup.proposals.map((proposal) => withProposal(proposal, { marketSnapshotHash: setup.market.snapshotHash }));
  expectCode(() => buildStrategyCandidate(setup), "market_state_invalid");
});

test("unapproved oracle policy is rejected", () => {
  const setup = scenario();
  setup.market = createMarketSnapshot({ ...marketSnapshotCore(setup.market), oraclePolicy: "attacker-oracle" });
  setup.proposals = setup.proposals.map((proposal) => withProposal(proposal, { marketSnapshotHash: setup.market.snapshotHash }));
  expectCode(() => buildStrategyCandidate(setup), "market_state_invalid");
});

test("crossed market prices are rejected", () => {
  const setup = scenario();
  setup.market = createMarketSnapshot({
    ...marketSnapshotCore(setup.market),
    bidPriceUsd: "65020.00",
    askPriceUsd: "65010.00",
    markPriceUsd: "65015.00"
  });
  setup.proposals = setup.proposals.map((proposal) => withProposal(proposal, { marketSnapshotHash: setup.market.snapshotHash }));
  expectCode(() => buildStrategyCandidate(setup), "market_state_invalid");
});

test("portfolio channel must be covenant-scoped", () => {
  const setup = scenario();
  setup.portfolio = createPortfolioState({ ...portfolioStateCore(setup.portfolio), channelId: "tl-channel-attacker" });
  expectCode(() => buildStrategyCandidate(setup), "portfolio_state_invalid");
});

test("network fee cap is enforced before approval", () => {
  const setup = scenario();
  setup.networkFeeSats = "5001";
  expectCode(() => buildStrategyCandidate(setup), "risk_rejected");
});

test("daily loss circuit breaker proposes only a bounded reduction", () => {
  const setup = scenario();
  setup.portfolio = createPortfolioState({
    ...portfolioStateCore(setup.portfolio),
    currentNetDeltaBps: 400,
    dailyLossBps: setup.covenant.risk.maxDailyLossBps
  });
  const candidate = buildStrategyCandidate(setup);
  assert.equal(candidate.action, "reduce_position");
  assert.equal(candidate.side, "sell_tlbtc");
  assert.ok(candidate.riskFlags.includes("daily_loss_circuit_breaker"));
});

test("drawdown circuit breaker is deterministic", () => {
  const setup = scenario();
  setup.portfolio = createPortfolioState({
    ...portfolioStateCore(setup.portfolio),
    currentNetDeltaBps: -400,
    drawdownBps: setup.covenant.risk.maxDrawdownBps
  });
  const candidate = buildStrategyCandidate(setup);
  assert.equal(candidate.action, "reduce_position");
  assert.equal(candidate.side, "buy_tlbtc");
  assert.ok(candidate.riskFlags.includes("drawdown_circuit_breaker"));
});

test("gross leverage circuit breaker is deterministic", () => {
  const setup = scenario();
  setup.portfolio = createPortfolioState({
    ...portfolioStateCore(setup.portfolio),
    currentNetDeltaBps: 300,
    grossLeverageBps: setup.covenant.risk.maxGrossLeverageBps + 1
  });
  const candidate = buildStrategyCandidate(setup);
  assert.equal(candidate.action, "reduce_position");
  assert.ok(candidate.riskFlags.includes("gross_leverage_circuit_breaker"));
});

test("capital above the covenant cap cannot expand transaction authority", () => {
  const setup = scenario();
  setup.portfolio = createPortfolioState({ ...portfolioStateCore(setup.portfolio), capitalAtoms: "900000000000" });
  const candidate = buildStrategyCandidate(setup);
  assert.ok(candidate.riskFlags.includes("capital_scoped_to_covenant_cap"));
  assert.equal(candidate.quantitySats, "30769");
});

test("order size is projected through the NAV fraction cap", () => {
  const setup = scenario();
  const candidate = buildStrategyCandidate(setup);
  assert.ok(candidate.riskFlags.includes("order_scoped_to_nav_fraction"));
  assert.equal(candidate.projectedNetDeltaBps, -1);
});

test("allocation inside the drift corridor creates no transaction or fee", () => {
  const setup = scenario();
  setup.portfolio = createPortfolioState({ ...portfolioStateCore(setup.portfolio), currentNetDeltaBps: 470 });
  const candidate = buildStrategyCandidate(setup);
  assert.equal(candidate.action, "hold");
  assert.equal(candidate.nextAuthority, "none");
  assert.equal(candidate.networkFeeSats, "0");
  assert.equal(candidate.manifest.permission, "none");
});

test("weighted target is projected to the covenant net-delta limit", () => {
  const setup = scenario();
  setup.covenant = withCovenant(setup.covenant, {
    risk: { ...setup.covenant.risk, maxNetDeltaBps: 200 }
  });
  setup.approval = createStrategyCovenantApproval({ ...setup.approval, covenantHash: setup.covenant.covenantHash });
  const candidate = buildStrategyCandidate(setup);
  assert.equal(candidate.weightedTargetNetDeltaBps, 200);
  assert.ok(candidate.riskFlags.includes("target_projected_to_net_delta_limit"));
});

test("circuit breaker fails closed if reduce_position is not permitted", () => {
  const setup = scenario();
  setup.covenant = withCovenant(setup.covenant, {
    execution: { ...setup.covenant.execution, permittedActions: ["place_limit", "cancel", "rebalance"] }
  });
  setup.approval = createStrategyCovenantApproval({ ...setup.approval, covenantHash: setup.covenant.covenantHash });
  setup.portfolio = createPortfolioState({
    ...portfolioStateCore(setup.portfolio),
    currentNetDeltaBps: 400,
    dailyLossBps: setup.covenant.risk.maxDailyLossBps
  });
  expectCode(() => buildStrategyCandidate(setup), "risk_rejected");
});

test("candidate field tampering fails deterministic recomputation", () => {
  const setup = scenario();
  const candidate = buildStrategyCandidate(setup);
  candidate.quantitySats = "99999999";
  const verification = verifyStrategyCandidate({ ...setup, candidate });
  assert.equal(verification.verified, false);
  assert.ok(verification.reasonCodes.includes("candidate_hash_invalid"));
});

test("candidate cannot claim signing or broadcast effects", () => {
  const setup = scenario();
  const candidate = buildStrategyCandidate(setup) as unknown as Record<string, unknown>;
  candidate.signingPerformed = true;
  const verification = verifyStrategyCandidate({ ...setup, candidate: candidate as StrategyCandidate });
  assert.equal(verification.verified, false);
  assert.ok(verification.reasonCodes.includes("unauthorized_effect_claim"));
});

test("decision receipt tampering is detectable", () => {
  const setup = scenario();
  const candidate = buildStrategyCandidate(setup);
  const verification = verifyStrategyCandidate({ ...setup, candidate });
  const receipt = createStrategyDecisionReceipt({ candidate, covenant: setup.covenant, proposals: setup.proposals, verification });
  receipt.projectedNetDeltaBps += 1;
  assert.equal(verifyStrategyDecisionReceipt(receipt), false);
});

test("decision receipts persist and resume from the file store", async () => {
  const setup = scenario();
  const candidate = buildStrategyCandidate(setup);
  const verification = verifyStrategyCandidate({ ...setup, candidate });
  const receipt = createStrategyDecisionReceipt({ candidate, covenant: setup.covenant, proposals: setup.proposals, verification });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-covenant-receipts-"));
  const store = new FileStrategyReceiptStore(directory);
  await store.save(receipt);
  await store.save(receipt);
  assert.deepEqual(await new FileStrategyReceiptStore(directory).list(), [receipt]);
});

test("four-mode benchmark separates timing from execution eligibility", () => {
  const report = runStrategyCovenantBenchmark({ scenario: scenario(), iterations: 10 });
  assert.equal(report.results.length, 4);
  assert.equal(report.taskResult, true);
  assert.equal(report.results.find((row) => row.mode === "direct_baseline")?.candidateSafetyEligible, false);
  assert.equal(report.results.find((row) => row.mode === "direct_baseline")?.verificationStatus, "not_run");
  assert.equal(report.results.find((row) => row.mode === "single_enclave")?.candidateSafetyEligible, true);
  assert.equal(report.results.find((row) => row.mode === "sharded_verification")?.independentVerifierImplementations, 1);
  assert.deepEqual(report.unmeasuredStages, ["T6 channel signature", "T7 counterparty cosign", "T8 TradeLayer state update"]);
});

test("public candidate and receipt contain no key or signature material", () => {
  const setup = scenario();
  const candidate = buildStrategyCandidate(setup);
  const verification = verifyStrategyCandidate({ ...setup, candidate });
  const receipt = createStrategyDecisionReceipt({ candidate, covenant: setup.covenant, proposals: setup.proposals, verification });
  const publicTrace = JSON.stringify({ candidate, verification, receipt }).toLowerCase();
  assert.equal(publicTrace.includes("privatekey"), false);
  assert.equal(publicTrace.includes("seedphrase"), false);
  assert.equal(publicTrace.includes("walletapprovalref"), false);
  assert.equal(publicTrace.includes("signature"), false);
});

test("verified candidate bridges to an unsigned committed-signal draft", () => {
  const setup = scenario();
  const candidate = buildStrategyCandidate(setup);
  const verification = verifyStrategyCandidate({ ...setup, candidate });
  const draft = buildCommittedSignalDraft({
    candidate,
    verification,
    covenant: setup.covenant,
    codebase: { codebaseId: "fixture-allocator", kind: "sha256_source_tree", digest: "aa".repeat(32) },
    producerKeyId: "fixture-producer",
    now: setup.now
  });
  assert.equal(draft.signalInput.amountSats, candidate.quantitySats);
  assert.equal(draft.signalInput.limitPriceUsd, candidate.limitPriceUsd);
  assert.equal(draft.signalInput.inputSnapshotHash.length, 64);
  assert.equal(draft.nextAuthority, "approved_signal_producer");
  assert.equal(draft.signingPerformed, false);
});

test("hold decision cannot be converted into an executable signal", () => {
  const setup = scenario();
  setup.portfolio = createPortfolioState({ ...portfolioStateCore(setup.portfolio), currentNetDeltaBps: 470 });
  const candidate = buildStrategyCandidate(setup);
  const verification = verifyStrategyCandidate({ ...setup, candidate });
  expectCode(() => buildCommittedSignalDraft({
    candidate,
    verification,
    covenant: setup.covenant,
    codebase: { codebaseId: "fixture-allocator", kind: "sha256_source_tree", digest: "aa".repeat(32) },
    producerKeyId: "fixture-producer",
    now: setup.now
  }), "candidate_invalid");
});

test("expired verified candidate cannot become a signal draft", () => {
  const setup = scenario();
  const candidate = buildStrategyCandidate(setup);
  const verification = verifyStrategyCandidate({ ...setup, candidate });
  expectCode(() => buildCommittedSignalDraft({
    candidate,
    verification,
    covenant: setup.covenant,
    codebase: { codebaseId: "fixture-allocator", kind: "sha256_source_tree", digest: "aa".repeat(32) },
    producerKeyId: "fixture-producer",
    now: new Date(Date.parse(candidate.expiresAt) + 1)
  }), "candidate_invalid");
});

test("signal bridge enforces commitment length by commitment kind", () => {
  const setup = scenario();
  const candidate = buildStrategyCandidate(setup);
  const verification = verifyStrategyCandidate({ ...setup, candidate });
  expectCode(() => buildCommittedSignalDraft({
    candidate,
    verification,
    covenant: setup.covenant,
    codebase: { codebaseId: "fixture-allocator", kind: "git_commit", digest: "aa".repeat(32) },
    producerKeyId: "fixture-producer",
    now: setup.now
  }), "candidate_invalid");
});

test("receipt store never overwrites a corrupt existing receipt", async () => {
  const setup = scenario();
  const candidate = buildStrategyCandidate(setup);
  const verification = verifyStrategyCandidate({ ...setup, candidate });
  const receipt = createStrategyDecisionReceipt({ candidate, covenant: setup.covenant, proposals: setup.proposals, verification });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bitagent-covenant-corrupt-"));
  const target = path.join(directory, `${receipt.receiptId}.json`);
  await fs.writeFile(target, "corrupt-evidence\n", "utf8");
  await assert.rejects(new FileStrategyReceiptStore(directory).save(receipt), (error: unknown) =>
    error instanceof StrategyMandateError && error.code === "candidate_invalid");
  assert.equal(await fs.readFile(target, "utf8"), "corrupt-evidence\n");
});
