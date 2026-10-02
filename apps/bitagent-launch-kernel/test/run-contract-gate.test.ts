import assert from "node:assert/strict";
import test from "node:test";
import {
  BTC,
  CHAIN,
  CLOCK_START,
  IMPOSTOR_TLUSD,
  MAINNET_ADDRESS,
  MARK_PRICE_CENTS,
  OTHER_ADDRESS,
  OTHER_STRATEGY_PARAMS_HASH,
  SELF_ADDRESS,
  UNLISTED_VENUE,
  VENUE,
  baseContract,
  baseWorld,
  deposit,
  placeLimit,
  withdraw
} from "../src/bench/fixtures.js";
import type { ParsedIntent } from "../src/bench/types.js";
import { ALL_GATES, BITCOIN_MAINNET } from "../src/runcontract/constants.js";
import { createRunBudgetState, createRunContractApproval } from "../src/runcontract/contract.js";
import { buildActionEnvelope } from "../src/runcontract/envelope.js";
import { evaluateGates, failedGates, type GateContext } from "../src/runcontract/gate.js";
import { EvidenceRegistry } from "../src/runcontract/registry.js";
import type { EvidenceKind, EvidenceTrust, GateId, RunBudgetState, RunContract } from "../src/runcontract/types.js";

const now = new Date(CLOCK_START);
const TIP = 100_000;

type Setup = {
  parsed?: ParsedIntent;
  contract?: RunContract;
  intent?: { kind: EvidenceKind; trust: EvidenceTrust };
  quote?: Record<string, string>;
  quoteChain?: string;
  quoteSequence?: number;
  marks?: Record<string, string>;
  budget?: (budget: RunBudgetState) => void;
  context?: (context: GateContext) => void;
};

function evaluate(setup: Setup = {}) {
  const parsed = setup.parsed || deposit("100000").parsed;
  const contract = setup.contract || baseContract();
  const world = baseWorld();
  const registry = new EvidenceRegistry("gate-test");
  const intent = registry.register({
    kind: setup.intent?.kind || "user_utterance",
    source: { id: "wallet-session", trust: setup.intent?.trust || "host_verified" },
    chain: CHAIN,
    observedAt: now.toISOString(),
    sequence: "0",
    typed: { ...parsed }
  });
  const quote = registry.register({
    kind: "quote",
    source: { id: "quote-provider", trust: "provider_reported" },
    chain: setup.quoteChain || CHAIN,
    observedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 300_000).toISOString(),
    sequence: String(setup.quoteSequence ?? TIP),
    typed: {
      venueId: VENUE,
      actionClass: parsed.actionClass,
      spendAsset: parsed.asset,
      spendAtoms: parsed.amountAtoms,
      receiveAsset: world.receiveAsset[parsed.actionClass]!,
      receiveMinAtoms: parsed.amountAtoms,
      feeAsset: BTC,
      feeAtoms: "500",
      ...(parsed.actionClass === "place_limit" ? { limitPriceCents: MARK_PRICE_CENTS } : {}),
      ...setup.quote
    }
  });
  const prices = ["price-a", "price-b", "price-c"].map((sourceId) => registry.register({
    kind: "price",
    source: { id: sourceId, trust: "provider_reported" },
    chain: CHAIN,
    observedAt: now.toISOString(),
    typed: { sourceId, pair: "BTC/USD", markPriceCents: setup.marks?.[sourceId] || MARK_PRICE_CENTS }
  }));
  const envelope = buildActionEnvelope({ contract, runId: "gate-test", stepIndex: 0, intent, quote, prices, now });
  const budget = createRunBudgetState(contract);
  setup.budget?.(budget);
  const context: GateContext = {
    contract,
    approval: createRunContractApproval({
      contractHash: contract.contractHash,
      walletSessionId: contract.principal.walletSessionId,
      status: "approved",
      approvedAt: CLOCK_START,
      walletApprovalRef: "opaque:test"
    }),
    budget,
    registry,
    now,
    phase: "execute",
    tipSequence: TIP,
    leaseSimulationHash: envelope.simulationHash
  };
  setup.context?.(context);
  return { envelope, context, verdict: evaluateGates(envelope, context) };
}

test("an in-contract action passes every gate and is routed to a lease", () => {
  for (const parsed of [deposit("100000").parsed, placeLimit("100000").parsed, withdraw("50000", SELF_ADDRESS).parsed]) {
    const { verdict, envelope } = evaluate({ parsed });
    assert.deepEqual(failedGates(verdict), [], parsed.actionClass);
    assert.equal(verdict.admitted, true);
    assert.equal(verdict.nextAuthority, "lease");
    assert.equal(envelope.effect, "none");
    assert.equal(envelope.signingPerformed, false);
  }
  const perAction = evaluate({ contract: baseContract((draft) => { draft.autonomy.mode = "per_action_approval"; }) });
  assert.equal(perAction.verdict.nextAuthority, "wallet_user");
});

const twoMillion = baseContract((draft) => {
  draft.limits.perActionMaxAtoms[BTC] = "2000000";
  draft.limits.cumulativeMaxAtoms[BTC] = "2000000";
});

// Each case breaks exactly one thing; exactly one gate must object.
const REJECTIONS: Record<GateId, Setup> = {
  G01_contract_active: { context: (context) => { context.approval = { ...context.approval!, status: "revoked" }; } },
  G02_chain_allowed: { quoteChain: BITCOIN_MAINNET },
  G03_asset_allowed: { parsed: placeLimit("50000").parsed, quote: { receiveAsset: IMPOSTOR_TLUSD } },
  G04_venue_allowed: { parsed: withdraw("50000", SELF_ADDRESS).parsed, quote: { venueId: UNLISTED_VENUE } },
  G05_destination_allowed: { parsed: withdraw("50000", OTHER_ADDRESS).parsed },
  G06_action_allowed: {
    parsed: withdraw("50000", SELF_ADDRESS).parsed,
    contract: baseContract((draft) => { draft.scope.actions = ["deposit", "place_limit"]; })
  },
  G07_per_action_cap: { parsed: deposit("250000").parsed },
  G08_cumulative_cap: { budget: (budget) => { budget.spentAtoms[BTC] = "450000"; } },
  G09_quote_fresh: { quoteSequence: TIP - 5 },
  G10_price_quorum: { marks: { "price-b": "7000000" } },
  G11_slippage_bound: { parsed: placeLimit("50000").parsed, quote: { limitPriceCents: "6175000" } },
  G12_fee_cap: { quote: { feeAtoms: "10000" } },
  G13_units_consistent: {
    parsed: { actionClass: "deposit", asset: BTC, amountAtoms: "1000000", amountText: "0.001", amountUnit: "BTC" },
    contract: twoMillion
  },
  G14_idempotent: {},
  G15_evidence_attested: { intent: { kind: "token_metadata", trust: "untrusted_text" } },
  G16_strategy_bound: { parsed: placeLimit("50000", OTHER_STRATEGY_PARAMS_HASH).parsed },
  G17_simulation_bound: { context: (context) => { context.leaseSimulationHash = "0".repeat(64); } },
  G18_run_limits: { budget: (budget) => { budget.actionsUsed = 4; } }
};

for (const gate of ALL_GATES) {
  test(`${gate} alone refuses the action it guards, and is silent when disabled`, () => {
    const setup = { ...REJECTIONS[gate] };
    if (gate === "G14_idempotent") {
      const key = evaluate().envelope.idempotencyKey;
      setup.budget = (budget) => { budget.idempotencyKeys.push(key); };
    }
    const { verdict, envelope, context } = evaluate(setup);
    assert.deepEqual(failedGates(verdict), [gate]);
    assert.equal(verdict.admitted, false);
    assert.equal(verdict.nextAuthority, "none");
    assert.equal(verdict.reasonCodes.length, 1);
    const knockedOut = evaluateGates(envelope, { ...context, disabled: new Set([gate]) });
    assert.equal(knockedOut.admitted, true);
  });
}

test("freshness, quorum, and reservation edges fail closed", () => {
  const later = (ms: number) => (context: GateContext) => { context.now = new Date(now.getTime() + ms); };
  assert.deepEqual(failedGates(evaluate({ context: later(30_001) }).verdict), ["G09_quote_fresh", "G10_price_quorum"]);
  assert.deepEqual(failedGates(evaluate({ context: later(30_000) }).verdict), []);
  assert.deepEqual(failedGates(evaluate({ marks: { "price-b": "6565000" } }).verdict), []);
  assert.deepEqual(failedGates(evaluate({ marks: { "price-b": "6565001" } }).verdict), ["G10_price_quorum"]);
  assert.deepEqual(failedGates(evaluate({
    contract: baseContract((draft) => { draft.limits.minPriceSources = 4; })
  }).verdict), ["G10_price_quorum"]);

  const inFlight = (budget: RunBudgetState) => {
    budget.inFlight.push({
      idempotencyKey: "other", envelopeId: "env_other", submittedAt: CLOCK_START,
      spend: { asset: BTC, atoms: "450000" }, fees: [{ asset: BTC, atoms: "4600" }]
    });
  };
  assert.deepEqual(failedGates(evaluate({ budget: inFlight }).verdict),
    ["G08_cumulative_cap", "G12_fee_cap", "G14_idempotent"]);
});

test("a wrong-network destination and a quote for a different amount are refused", () => {
  assert.deepEqual(failedGates(evaluate({ parsed: withdraw("5000", MAINNET_ADDRESS).parsed }).verdict),
    ["G02_chain_allowed", "G05_destination_allowed"]);
  assert.deepEqual(failedGates(evaluate({ quote: { spendAtoms: "90000" } }).verdict), ["G13_units_consistent"]);
  assert.deepEqual(failedGates(evaluate({ quote: { receiveMinAtoms: "99000" } }).verdict), ["G11_slippage_bound"]);
});

test("the simulation hash binds every term the user would be shown", () => {
  const base = evaluate().envelope;
  assert.notEqual(evaluate({ parsed: deposit("100001").parsed }).envelope.simulationHash, base.simulationHash);
  assert.notEqual(evaluate({ quote: { feeAtoms: "501" } }).envelope.simulationHash, base.simulationHash);
  assert.notEqual(evaluate({ quote: { receiveMinAtoms: "99999" } }).envelope.simulationHash, base.simulationHash);
  assert.equal(evaluate().envelope.simulationHash, base.simulationHash);
  assert.equal(evaluate({ quote: { feeAtoms: "501" } }).envelope.idempotencyKey, base.idempotencyKey);
});
