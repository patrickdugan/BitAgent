import { hashObject, opaqueId } from "../launch/canonical.js";
import { StrategyMandateError } from "./errors.js";
import type {
  StrategyCovenant,
  StrategyCovenantApproval,
  StrategyMarketSnapshot,
  StrategyPortfolioState,
  StrategyProposal
} from "./types.js";

const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const SECRET_FIELD = /(private.?key|seed.?phrase|mnemonic|\bwif\b|api.?secret|secret.?key|password)/i;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StrategyMandateError("covenant_invalid", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string) {
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = keys.filter((key) => value[key] === undefined);
  if (unexpected.length || missing.length) {
    throw new StrategyMandateError(
      "covenant_invalid",
      `${label} keys are invalid (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`
    );
  }
}

function rejectSecrets(value: unknown, path = "input") {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectSecrets(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELD.test(key)) {
      throw new StrategyMandateError("secret_material_prohibited", `Secret-bearing field is prohibited: ${path}.${key}`);
    }
    rejectSecrets(item, `${path}.${key}`);
  }
}

function text(value: unknown, label: string, pattern = ID) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new StrategyMandateError("covenant_invalid", `${label} is invalid`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new StrategyMandateError("covenant_invalid", `${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return Number(value);
}

function atoms(value: unknown, label: string, allowZero = false) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value) || (!allowZero && value === "0")) {
    throw new StrategyMandateError("covenant_invalid", `${label} must be ${allowZero ? "an" : "a positive"} integer string`);
  }
  return value;
}

function iso(value: unknown, label: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new StrategyMandateError("covenant_invalid", `${label} must be an ISO timestamp`);
  }
  return value;
}

function hash(value: unknown, label: string) {
  return text(value, label, HASH);
}

export function covenantCore(covenant: StrategyCovenant) {
  const { covenantHash: _hash, ...core } = covenant;
  return core;
}

export function proposalCore(proposal: StrategyProposal) {
  const { proposalHash: _hash, ...core } = proposal;
  return core;
}

export function marketSnapshotCore(snapshot: StrategyMarketSnapshot) {
  const { snapshotHash: _hash, ...core } = snapshot;
  return core;
}

export function portfolioStateCore(state: StrategyPortfolioState) {
  const { stateRoot: _hash, ...core } = state;
  return core;
}

export function createStrategyCovenant(input: Omit<StrategyCovenant, "covenantHash">) {
  return validateStrategyCovenant({ ...structuredClone(input), covenantHash: hashObject(input) });
}

export function validateStrategyCovenant(raw: unknown, now?: Date): StrategyCovenant {
  rejectSecrets(raw);
  const value = record(raw, "covenant");
  exactKeys(value, [
    "schema", "mandateId", "version", "owner", "capital", "channelIds", "strategies", "allocation",
    "risk", "execution", "runtime", "effectiveAt", "expiresAt", "covenantHash"
  ], "covenant");
  if (value.schema !== "bitagent_strategy_covenant_v1") throw new StrategyMandateError("covenant_invalid", "Unsupported covenant schema");
  const owner = record(value.owner, "owner");
  exactKeys(owner, ["walletAccount", "walletProvider"], "owner");
  const capital = record(value.capital, "capital");
  exactKeys(capital, ["asset", "capAtoms"], "capital");
  const allocation = record(value.allocation, "allocation");
  exactKeys(allocation, ["absoluteMaxDriftBps"], "allocation");
  const risk = record(value.risk, "risk");
  exactKeys(risk, [
    "maxGrossLeverageBps", "maxNetDeltaBps", "maxOrderFractionNavBps", "maxDailyLossBps",
    "maxDrawdownBps", "maxSlippageBps", "maxNetworkFeeSats"
  ], "risk");
  const execution = record(value.execution, "execution");
  exactKeys(execution, [
    "instruments", "permittedActions", "orderTtlMs", "maxMarketAgeMs", "oraclePolicy", "counterpartyPolicy"
  ], "execution");
  const runtime = record(value.runtime, "runtime");
  exactKeys(runtime, ["baseModelHash", "allocatorHash", "verifierHash"], "runtime");

  if (!Array.isArray(value.channelIds) || value.channelIds.length === 0 || value.channelIds.length > 16) {
    throw new StrategyMandateError("covenant_invalid", "channelIds must contain 1 through 16 channels");
  }
  const channelIds = value.channelIds.map((item, index) => text(item, `channelIds[${index}]`));
  if (new Set(channelIds).size !== channelIds.length) throw new StrategyMandateError("covenant_invalid", "channelIds must be unique");
  if (!Array.isArray(value.strategies) || value.strategies.length === 0 || value.strategies.length > 8) {
    throw new StrategyMandateError("covenant_invalid", "strategies must contain 1 through 8 modules");
  }
  const strategies = value.strategies.map((item, index) => {
    const module = record(item, `strategies[${index}]`);
    exactKeys(module, ["strategyId", "strategyVersion", "weightBps", "adapterHash"], `strategies[${index}]`);
    return {
      strategyId: text(module.strategyId, `strategies[${index}].strategyId`),
      strategyVersion: text(module.strategyVersion, `strategies[${index}].strategyVersion`),
      weightBps: integer(module.weightBps, `strategies[${index}].weightBps`, 1, 10_000),
      adapterHash: hash(module.adapterHash, `strategies[${index}].adapterHash`)
    };
  });
  if (strategies.reduce((sum, item) => sum + item.weightBps, 0) !== 10_000) {
    throw new StrategyMandateError("covenant_invalid", "Strategy weights must total exactly 10000 bps");
  }
  const identities = strategies.map((item) => `${item.strategyId}@${item.strategyVersion}`);
  if (new Set(identities).size !== identities.length) throw new StrategyMandateError("covenant_invalid", "Strategy identities must be unique");

  const instruments = execution.instruments;
  if (!Array.isArray(instruments) || instruments.length !== 1 || instruments[0] !== "TLBTC/TLUSD") {
    throw new StrategyMandateError("covenant_invalid", "Only TLBTC/TLUSD is supported");
  }
  const allowedActions = new Set(["place_limit", "cancel", "reduce_position", "rebalance"]);
  if (!Array.isArray(execution.permittedActions) || execution.permittedActions.length === 0
    || execution.permittedActions.some((item) => typeof item !== "string" || !allowedActions.has(item))) {
    throw new StrategyMandateError("covenant_invalid", "permittedActions contains an unsupported action");
  }
  const permittedActions = [...new Set(execution.permittedActions)] as StrategyCovenant["execution"]["permittedActions"];
  const effectiveAt = iso(value.effectiveAt, "effectiveAt");
  const expiresAt = iso(value.expiresAt, "expiresAt");
  if (Date.parse(effectiveAt) >= Date.parse(expiresAt)) throw new StrategyMandateError("covenant_invalid", "Covenant expiry must follow activation");
  if (now && (now.getTime() < Date.parse(effectiveAt) || now.getTime() >= Date.parse(expiresAt))) {
    throw new StrategyMandateError("covenant_expired", "Covenant is not currently active");
  }

  const covenant: StrategyCovenant = {
    schema: "bitagent_strategy_covenant_v1",
    mandateId: text(value.mandateId, "mandateId"),
    version: integer(value.version, "version", 1, Number.MAX_SAFE_INTEGER),
    owner: {
      walletAccount: text(owner.walletAccount, "owner.walletAccount", /^[A-Za-z0-9][A-Za-z0-9:._/-]{2,255}$/),
      walletProvider: owner.walletProvider as StrategyCovenant["owner"]["walletProvider"]
    },
    capital: { asset: capital.asset as "tlUSD", capAtoms: atoms(capital.capAtoms, "capital.capAtoms") },
    channelIds,
    strategies,
    allocation: { absoluteMaxDriftBps: integer(allocation.absoluteMaxDriftBps, "allocation.absoluteMaxDriftBps", 0, 2_500) },
    risk: {
      maxGrossLeverageBps: integer(risk.maxGrossLeverageBps, "risk.maxGrossLeverageBps", 0, 50_000),
      maxNetDeltaBps: integer(risk.maxNetDeltaBps, "risk.maxNetDeltaBps", 0, 10_000),
      maxOrderFractionNavBps: integer(risk.maxOrderFractionNavBps, "risk.maxOrderFractionNavBps", 1, 10_000),
      maxDailyLossBps: integer(risk.maxDailyLossBps, "risk.maxDailyLossBps", 1, 10_000),
      maxDrawdownBps: integer(risk.maxDrawdownBps, "risk.maxDrawdownBps", 1, 10_000),
      maxSlippageBps: integer(risk.maxSlippageBps, "risk.maxSlippageBps", 0, 5_000),
      maxNetworkFeeSats: atoms(risk.maxNetworkFeeSats, "risk.maxNetworkFeeSats", true)
    },
    execution: {
      instruments: ["TLBTC/TLUSD"],
      permittedActions,
      orderTtlMs: integer(execution.orderTtlMs, "execution.orderTtlMs", 250, 60_000),
      maxMarketAgeMs: integer(execution.maxMarketAgeMs, "execution.maxMarketAgeMs", 100, 60_000),
      oraclePolicy: text(execution.oraclePolicy, "execution.oraclePolicy"),
      counterpartyPolicy: text(execution.counterpartyPolicy, "execution.counterpartyPolicy")
    },
    runtime: {
      baseModelHash: hash(runtime.baseModelHash, "runtime.baseModelHash"),
      allocatorHash: hash(runtime.allocatorHash, "runtime.allocatorHash"),
      verifierHash: hash(runtime.verifierHash, "runtime.verifierHash")
    },
    effectiveAt,
    expiresAt,
    covenantHash: hash(value.covenantHash, "covenantHash")
  };
  if (!(["bitcoin_wallet", "metamask", "phantom"] as unknown[]).includes(owner.walletProvider)) {
    throw new StrategyMandateError("covenant_invalid", "walletProvider is unsupported");
  }
  if (capital.asset !== "tlUSD") throw new StrategyMandateError("covenant_invalid", "Only tlUSD capital is supported");
  if (hashObject(covenantCore(covenant)) !== covenant.covenantHash) {
    throw new StrategyMandateError("covenant_invalid", "Covenant hash does not match its canonical fields");
  }
  return structuredClone(covenant);
}

export function createStrategyProposal(input: Omit<StrategyProposal, "proposalHash">) {
  return validateStrategyProposal({ ...structuredClone(input), proposalHash: hashObject(input) });
}

export function createStrategyCovenantApproval(input: Omit<StrategyCovenantApproval, "approvalId">) {
  const approval = {
    ...structuredClone(input),
    approvalId: opaqueId("covenant_approval", input)
  };
  return validateStrategyCovenantApproval(approval);
}

export function validateStrategyCovenantApproval(raw: unknown, covenant?: StrategyCovenant, now?: Date): StrategyCovenantApproval {
  rejectSecrets(raw);
  const value = record(raw, "covenantApproval");
  exactKeys(value, [
    "schema", "approvalId", "covenantHash", "walletSessionId", "status", "approvedAt", "expiresAt", "walletApprovalRef"
  ], "covenantApproval");
  if (value.schema !== "bitagent_strategy_covenant_approval_v1" || !["approved", "revoked"].includes(String(value.status))) {
    throw new StrategyMandateError("covenant_invalid", "Covenant approval schema or status is invalid");
  }
  const approval: StrategyCovenantApproval = {
    schema: "bitagent_strategy_covenant_approval_v1",
    approvalId: text(value.approvalId, "approvalId"),
    covenantHash: hash(value.covenantHash, "covenantHash"),
    walletSessionId: text(value.walletSessionId, "walletSessionId"),
    status: value.status as StrategyCovenantApproval["status"],
    approvedAt: iso(value.approvedAt, "approvedAt"),
    expiresAt: iso(value.expiresAt, "expiresAt"),
    walletApprovalRef: text(value.walletApprovalRef, "walletApprovalRef", /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/)
  };
  if (Date.parse(approval.approvedAt) >= Date.parse(approval.expiresAt)) {
    throw new StrategyMandateError("covenant_invalid", "Covenant approval expiry is invalid");
  }
  if (covenant && (approval.covenantHash !== covenant.covenantHash
    || Date.parse(approval.expiresAt) > Date.parse(covenant.expiresAt))) {
    throw new StrategyMandateError("covenant_invalid", "Covenant approval is not bound to the active covenant");
  }
  if (now && (approval.status !== "approved" || now.getTime() < Date.parse(approval.approvedAt)
    || now.getTime() >= Date.parse(approval.expiresAt))) {
    throw new StrategyMandateError("covenant_expired", "Covenant approval is revoked, stale, or future-dated");
  }
  return structuredClone(approval);
}

export function validateStrategyProposal(raw: unknown): StrategyProposal {
  rejectSecrets(raw);
  const value = record(raw, "proposal");
  exactKeys(value, [
    "schema", "strategyId", "strategyVersion", "adapterHash", "marketSnapshotHash", "targetNetDeltaBps",
    "policyHint", "generatedAt", "expiresAt", "proposalHash"
  ], "proposal");
  const hints = ["HOLD", "QUOTE_BOTH_SIDES", "SHIFT_BID", "SHIFT_ASK", "REDUCE_DELTA", "REBALANCE_TO_TARGET", "CANCEL_STALE"];
  if (value.schema !== "bitagent_strategy_proposal_v1" || !hints.includes(String(value.policyHint))) {
    throw new StrategyMandateError("proposal_invalid", "Unsupported proposal schema or policy hint");
  }
  const proposal = {
    schema: "bitagent_strategy_proposal_v1" as const,
    strategyId: text(value.strategyId, "strategyId"),
    strategyVersion: text(value.strategyVersion, "strategyVersion"),
    adapterHash: hash(value.adapterHash, "adapterHash"),
    marketSnapshotHash: hash(value.marketSnapshotHash, "marketSnapshotHash"),
    targetNetDeltaBps: integer(value.targetNetDeltaBps, "targetNetDeltaBps", -10_000, 10_000),
    policyHint: value.policyHint as StrategyProposal["policyHint"],
    generatedAt: iso(value.generatedAt, "generatedAt"),
    expiresAt: iso(value.expiresAt, "expiresAt"),
    proposalHash: hash(value.proposalHash, "proposalHash")
  };
  if (Date.parse(proposal.generatedAt) >= Date.parse(proposal.expiresAt)) throw new StrategyMandateError("proposal_invalid", "Proposal expiry is invalid");
  if (hashObject(proposalCore(proposal)) !== proposal.proposalHash) throw new StrategyMandateError("proposal_invalid", "Proposal hash is invalid");
  return structuredClone(proposal);
}

export function createMarketSnapshot(input: Omit<StrategyMarketSnapshot, "snapshotHash">) {
  return validateMarketSnapshot({ ...structuredClone(input), snapshotHash: hashObject(input) });
}

export function validateMarketSnapshot(raw: unknown): StrategyMarketSnapshot {
  rejectSecrets(raw);
  const value = raw as StrategyMarketSnapshot;
  if (!value || value.schema !== "bitagent_strategy_market_snapshot_v1" || value.pair !== "TLBTC/TLUSD"
    || !HASH.test(String(value.snapshotHash)) || hashObject(marketSnapshotCore(value)) !== value.snapshotHash) {
    throw new StrategyMandateError("market_state_invalid", "Market snapshot fingerprint is invalid");
  }
  for (const [key, price] of [["bid", value.bidPriceUsd], ["ask", value.askPriceUsd], ["mark", value.markPriceUsd]] as const) {
    if (!/^([1-9][0-9]*)(\.[0-9]{1,2})?$/.test(price)) throw new StrategyMandateError("market_state_invalid", `${key} price is invalid`);
  }
  if (!Number.isFinite(Date.parse(value.observedAt)) || !ID.test(value.oraclePolicy) || typeof value.source !== "string" || !value.source) {
    throw new StrategyMandateError("market_state_invalid", "Market snapshot metadata is invalid");
  }
  return structuredClone(value);
}

export function createPortfolioState(input: Omit<StrategyPortfolioState, "stateRoot">) {
  return validatePortfolioState({ ...structuredClone(input), stateRoot: hashObject(input) });
}

export function validatePortfolioState(raw: unknown): StrategyPortfolioState {
  rejectSecrets(raw);
  const value = raw as StrategyPortfolioState;
  if (!value || value.schema !== "bitagent_strategy_portfolio_v1" || !HASH.test(String(value.stateRoot))
    || hashObject(portfolioStateCore(value)) !== value.stateRoot) {
    throw new StrategyMandateError("portfolio_state_invalid", "Portfolio state fingerprint is invalid");
  }
  if (!ID.test(value.channelId) || !/^(0|[1-9][0-9]*)$/.test(value.capitalAtoms)
    || !Number.isSafeInteger(value.currentNetDeltaBps) || Math.abs(value.currentNetDeltaBps) > 10_000
    || !Number.isSafeInteger(value.grossLeverageBps) || value.grossLeverageBps < 0
    || !Number.isSafeInteger(value.dailyLossBps) || value.dailyLossBps < 0
    || !Number.isSafeInteger(value.drawdownBps) || value.drawdownBps < 0
    || !Number.isSafeInteger(value.nonce) || value.nonce < 0 || !Number.isFinite(Date.parse(value.observedAt))) {
    throw new StrategyMandateError("portfolio_state_invalid", "Portfolio state values are invalid");
  }
  return structuredClone(value);
}
