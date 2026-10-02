import { hashObject, parseDecimal } from "../launch/canonical.js";
import type { StrategyCovenant, StrategyPolicyAction } from "../mandates/types.js";
import { ACTION_CLASSES, REAPPROVAL_TRIGGERS } from "./constants.js";
import { RunContractError } from "./errors.js";
import type {
  ActionClass,
  RunBudgetState,
  RunContract,
  RunContractApproval
} from "./types.js";

const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const ATOMS = /^(0|[1-9][0-9]*)$/;
const SECRET_FIELD = /(private.?key|seed.?phrase|mnemonic|\bwif\b|api.?secret|secret.?key|password)/i;

function fail(message: string): never {
  throw new RunContractError("contract_invalid", message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[], label: string) {
  const allowed = new Set([...required, ...optional]);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => value[key] === undefined);
  if (unexpected.length || missing.length) {
    fail(`${label} keys are invalid (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`);
  }
}

function rejectSecrets(value: unknown, path = "input") {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectSecrets(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELD.test(key)) {
      throw new RunContractError("secret_material_prohibited", `Secret-bearing field is prohibited: ${path}.${key}`);
    }
    rejectSecrets(item, `${path}.${key}`);
  }
}

function text(value: unknown, label: string, pattern = ID) {
  if (typeof value !== "string" || !pattern.test(value)) fail(`${label} is invalid`);
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return Number(value);
}

function iso(value: unknown, label: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail(`${label} must be an ISO timestamp`);
  return value;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) fail(`${label} must not contain duplicates`);
  return values;
}

function atomsByAsset(value: unknown, scoped: Set<string>, label: string) {
  const entries = Object.entries(record(value, label));
  for (const [asset, atoms] of entries) {
    if (!scoped.has(asset)) fail(`${label} names an asset outside scope: ${asset}`);
    if (typeof atoms !== "string" || !ATOMS.test(atoms)) fail(`${label}.${asset} must be an integer string`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

export function runContractCore(contract: RunContract) {
  const { contractHash: _hash, ...core } = contract;
  return core;
}

export function createRunContract(input: Omit<RunContract, "contractHash">) {
  return validateRunContract({ ...structuredClone(input), contractHash: hashObject(input) });
}

export function validateRunContract(raw: unknown, now?: Date): RunContract {
  rejectSecrets(raw);
  const value = record(raw, "contract");
  exactKeys(value, [
    "schema", "contractId", "version", "principal", "objective", "scope", "limits",
    "autonomy", "stop", "runtime", "effectiveAt", "contractHash"
  ], ["parentContractHash", "source", "strategy"], "contract");
  if (value.schema !== "bitagent.run_contract.v1") fail("Unsupported run-contract schema");
  text(value.contractId, "contractId");
  integer(value.version, "version", 1, 1_000_000);
  if (value.parentContractHash !== undefined) text(value.parentContractHash, "parentContractHash", HASH);
  if (value.source !== undefined) {
    const source = record(value.source, "source");
    exactKeys(source, ["schema", "hash"], [], "source");
    text(source.schema, "source.schema");
    text(source.hash, "source.hash", HASH);
  }

  const principal = record(value.principal, "principal");
  exactKeys(principal, ["walletAccount", "walletProvider", "walletSessionId"], [], "principal");
  text(principal.walletAccount, "principal.walletAccount");
  if (!["bitcoin_wallet", "metamask", "phantom"].includes(String(principal.walletProvider))) {
    fail("principal.walletProvider is invalid");
  }
  text(principal.walletSessionId, "principal.walletSessionId");

  const objective = record(value.objective, "objective");
  exactKeys(objective, ["intent", "summary", "sourceUtteranceIds"], [], "objective");
  text(objective.intent, "objective.intent");
  if (typeof objective.summary !== "string" || objective.summary.length > 280) fail("objective.summary is invalid");
  list(objective.sourceUtteranceIds, "objective.sourceUtteranceIds")
    .forEach((id, index) => text(id, `objective.sourceUtteranceIds[${index}]`));

  const scope = record(value.scope, "scope");
  exactKeys(scope, ["chains", "assets", "venues", "destinations", "actions"], [], "scope");
  const chains = unique(
    list(scope.chains, "scope.chains").map((chain, index) => text(chain, `scope.chains[${index}]`)),
    "scope.chains"
  );
  if (chains.length === 0) fail("scope.chains must not be empty");
  const assets = list(scope.assets, "scope.assets").map((item, index) => {
    const asset = record(item, `scope.assets[${index}]`);
    exactKeys(asset, ["asset", "decimals", "registryHash", "role"], [], `scope.assets[${index}]`);
    const id = text(asset.asset, `scope.assets[${index}].asset`);
    if (!chains.some((chain) => id.startsWith(`${chain}/`))) fail(`scope.assets[${index}] is not on a scoped chain`);
    integer(asset.decimals, `scope.assets[${index}].decimals`, 0, 18);
    text(asset.registryHash, `scope.assets[${index}].registryHash`, HASH);
    if (!["spend", "receive", "both"].includes(String(asset.role))) fail(`scope.assets[${index}].role is invalid`);
    return id;
  });
  if (assets.length === 0) fail("scope.assets must not be empty");
  const scopedAssets = new Set(unique(assets, "scope.assets"));
  unique(list(scope.venues, "scope.venues").map((item, index) => {
    const venue = record(item, `scope.venues[${index}]`);
    exactKeys(venue, ["id", "kind"], ["codeHash"], `scope.venues[${index}]`);
    if (!["router", "dex", "tradelayer", "bridge"].includes(String(venue.kind))) fail(`scope.venues[${index}].kind is invalid`);
    if (venue.codeHash !== undefined) text(venue.codeHash, `scope.venues[${index}].codeHash`, HASH);
    return text(venue.id, `scope.venues[${index}].id`);
  }), "scope.venues");
  unique(list(scope.destinations, "scope.destinations").map((item, index) => {
    const destination = record(item, `scope.destinations[${index}]`);
    exactKeys(destination, ["chain", "address", "label"], [], `scope.destinations[${index}]`);
    const chain = text(destination.chain, `scope.destinations[${index}].chain`);
    if (!chains.includes(chain)) fail(`scope.destinations[${index}] is not on a scoped chain`);
    if (!["self", "venue"].includes(String(destination.label))) fail(`scope.destinations[${index}].label is invalid`);
    return `${chain}|${text(destination.address, `scope.destinations[${index}].address`)}`;
  }), "scope.destinations");
  const actions = unique(
    list(scope.actions, "scope.actions").map((action) => String(action)),
    "scope.actions"
  );
  if (actions.length === 0 || actions.some((action) => !ACTION_CLASSES.includes(action as ActionClass))) {
    fail("scope.actions is invalid");
  }

  const limits = record(value.limits, "limits");
  exactKeys(limits, [
    "perActionMaxAtoms", "cumulativeMaxAtoms", "maxTotalFeeAtoms", "maxActions", "maxSlippageBps",
    "maxQuoteAgeMs", "minPriceSources", "maxPriceDeviationBps"
  ], ["maxLossBps"], "limits");
  const perAction = atomsByAsset(limits.perActionMaxAtoms, scopedAssets, "limits.perActionMaxAtoms");
  const cumulative = atomsByAsset(limits.cumulativeMaxAtoms, scopedAssets, "limits.cumulativeMaxAtoms");
  atomsByAsset(limits.maxTotalFeeAtoms, scopedAssets, "limits.maxTotalFeeAtoms");
  for (const [asset, atoms] of Object.entries(perAction)) {
    if (cumulative[asset] !== undefined && BigInt(atoms) > BigInt(cumulative[asset]!)) {
      fail(`limits.perActionMaxAtoms.${asset} exceeds the cumulative cap`);
    }
  }
  integer(limits.maxActions, "limits.maxActions", 1, 10_000);
  integer(limits.maxSlippageBps, "limits.maxSlippageBps", 0, 10_000);
  integer(limits.maxQuoteAgeMs, "limits.maxQuoteAgeMs", 1, 86_400_000);
  integer(limits.minPriceSources, "limits.minPriceSources", 1, 10);
  integer(limits.maxPriceDeviationBps, "limits.maxPriceDeviationBps", 0, 10_000);
  if (limits.maxLossBps !== undefined) integer(limits.maxLossBps, "limits.maxLossBps", 0, 10_000);

  if (value.strategy !== undefined) {
    const strategy = record(value.strategy, "strategy");
    exactKeys(strategy, ["strategyId", "strategyVersion", "paramsHash", "driftBoundsBps"], [], "strategy");
    text(strategy.strategyId, "strategy.strategyId");
    text(strategy.strategyVersion, "strategy.strategyVersion");
    text(strategy.paramsHash, "strategy.paramsHash", HASH);
    integer(strategy.driftBoundsBps, "strategy.driftBoundsBps", 0, 10_000);
  }

  const autonomy = record(value.autonomy, "autonomy");
  exactKeys(autonomy, ["mode", "reapprovalTriggers"], [], "autonomy");
  if (!["per_action_approval", "delegated_within_contract"].includes(String(autonomy.mode))) fail("autonomy.mode is invalid");
  const triggers = unique(
    list(autonomy.reapprovalTriggers, "autonomy.reapprovalTriggers").map((trigger) => String(trigger)),
    "autonomy.reapprovalTriggers"
  );
  if (triggers.some((trigger) => !(REAPPROVAL_TRIGGERS as string[]).includes(trigger))) {
    fail("autonomy.reapprovalTriggers is invalid");
  }

  const stop = record(value.stop, "stop");
  exactKeys(stop, ["expiresAt", "maxModelTurns", "maxWallMs", "haltOnIncident"], [], "stop");
  const expiresAt = Date.parse(iso(stop.expiresAt, "stop.expiresAt"));
  integer(stop.maxModelTurns, "stop.maxModelTurns", 1, 1_000_000);
  integer(stop.maxWallMs, "stop.maxWallMs", 1, 30 * 86_400_000);
  if (typeof stop.haltOnIncident !== "boolean") fail("stop.haltOnIncident must be a boolean");

  const runtime = record(value.runtime, "runtime");
  exactKeys(runtime, ["modelHash", "adapterHash", "harnessHash", "toolRegistryHash"], [], "runtime");
  for (const key of ["modelHash", "adapterHash", "harnessHash", "toolRegistryHash"]) {
    text(runtime[key], `runtime.${key}`, HASH);
  }

  const effectiveAt = Date.parse(iso(value.effectiveAt, "effectiveAt"));
  if (expiresAt <= effectiveAt) fail("stop.expiresAt must be after effectiveAt");

  const contract = value as unknown as RunContract;
  if (text(value.contractHash, "contractHash", HASH) !== hashObject(runContractCore(contract))) {
    fail("contractHash does not match the canonical contract");
  }
  if (now) {
    if (now.getTime() < effectiveAt) throw new RunContractError("contract_not_effective", "Run contract is not yet effective");
    if (now.getTime() >= expiresAt) throw new RunContractError("contract_expired", "Run contract has expired");
  }
  return contract;
}

export function createRunContractApproval(input: Omit<RunContractApproval, "schema">): RunContractApproval {
  rejectSecrets(input);
  if (!HASH.test(input.contractHash)) throw new RunContractError("approval_invalid", "contractHash is invalid");
  if (!ID.test(input.walletSessionId)) throw new RunContractError("approval_invalid", "walletSessionId is invalid");
  if (!["approved", "revoked"].includes(input.status)) throw new RunContractError("approval_invalid", "status is invalid");
  if (!Number.isFinite(Date.parse(input.approvedAt))) throw new RunContractError("approval_invalid", "approvedAt is invalid");
  if (typeof input.walletApprovalRef !== "string" || !input.walletApprovalRef) {
    throw new RunContractError("approval_invalid", "walletApprovalRef is required");
  }
  return { schema: "bitagent.run_contract_approval.v1", ...input };
}

export function createRunBudgetState(contract: RunContract): RunBudgetState {
  return {
    schema: "bitagent.run_budget_state.v1",
    contractHash: contract.contractHash,
    spentAtoms: {},
    feeAtoms: {},
    actionsUsed: 0,
    modelTurnsUsed: 0,
    idempotencyKeys: [],
    inFlight: []
  };
}

const UNIT_DECIMALS: Record<string, number> = { BTC: 8, mBTC: 5, bits: 2 };

// Converts the amount a user actually wrote into atoms, using the pinned registry decimals.
export function amountTextToAtoms(amountText: string, unit: string, decimals: number) {
  try {
    if (unit === "sats" || unit === "atoms") {
      if (!ATOMS.test(amountText)) throw new Error("amount must be an integer");
      return BigInt(amountText);
    }
    if (unit === "units") return parseDecimal(amountText, decimals, "amount");
    const unitDecimals = UNIT_DECIMALS[unit];
    if (unitDecimals === undefined) throw new Error(`unsupported unit ${unit}`);
    if (decimals !== 8) throw new Error(`${unit} requires an 8-decimal asset`);
    return parseDecimal(amountText, unitDecimals, "amount");
  } catch (error) {
    throw new RunContractError("unit_parse_error", `Cannot parse "${amountText}" ${unit}`, error);
  }
}

const COVENANT_ACTIONS: Record<StrategyPolicyAction, ActionClass[]> = {
  place_limit: ["place_limit"],
  cancel: ["cancel"],
  reduce_position: ["reduce_position"],
  rebalance: ["place_limit", "reduce_position"]
};

export type CovenantMapOptions = {
  walletSessionId: string;
  chain: string;
  tlUsdAsset: { asset: string; decimals: number };
  tlBtcAsset: { asset: string; decimals: number };
  feeAsset: { asset: string; decimals: number };
  registryHash: string;
  maxActions: number;
  maxModelTurns: number;
  maxWallMs: number;
  minPriceSources: number;
  maxPriceDeviationBps: number;
  harnessHash: string;
  toolRegistryHash: string;
};

// A covenant caps tlUSD notional only. The mapped contract carries those caps and nothing else, so
// tlBTC-spending actions stay default-denied until an amendment supplies an explicit tlBTC cap.
export function covenantToRunContract(covenant: StrategyCovenant, options: CovenantMapOptions): RunContract {
  try {
    const cap = BigInt(covenant.capital.capAtoms);
    const perAction = cap * BigInt(covenant.risk.maxOrderFractionNavBps) / 10_000n;
    const actions = [...new Set(covenant.execution.permittedActions.flatMap((action) => COVENANT_ACTIONS[action]))];
    return createRunContract({
      schema: "bitagent.run_contract.v1",
      contractId: covenant.mandateId,
      version: covenant.version,
      source: { schema: covenant.schema, hash: covenant.covenantHash },
      principal: { ...covenant.owner, walletSessionId: options.walletSessionId },
      objective: {
        intent: "strategy_covenant",
        summary: `Strategy covenant ${covenant.mandateId} v${covenant.version}`,
        sourceUtteranceIds: []
      },
      scope: {
        chains: [options.chain],
        assets: [
          { ...options.tlUsdAsset, registryHash: options.registryHash, role: "both" },
          { ...options.tlBtcAsset, registryHash: options.registryHash, role: "both" },
          { ...options.feeAsset, registryHash: options.registryHash, role: "spend" }
        ],
        venues: covenant.channelIds.map((id) => ({ id, kind: "tradelayer" as const })),
        destinations: covenant.channelIds.map((id) => ({ chain: options.chain, address: id, label: "venue" as const })),
        actions
      },
      limits: {
        perActionMaxAtoms: { [options.tlUsdAsset.asset]: perAction.toString() },
        cumulativeMaxAtoms: { [options.tlUsdAsset.asset]: cap.toString() },
        maxTotalFeeAtoms: {
          [options.feeAsset.asset]: (BigInt(covenant.risk.maxNetworkFeeSats) * BigInt(options.maxActions)).toString()
        },
        maxActions: options.maxActions,
        maxSlippageBps: covenant.risk.maxSlippageBps,
        maxQuoteAgeMs: covenant.execution.maxMarketAgeMs,
        minPriceSources: options.minPriceSources,
        maxPriceDeviationBps: options.maxPriceDeviationBps,
        maxLossBps: covenant.risk.maxDailyLossBps
      },
      strategy: {
        strategyId: covenant.mandateId,
        strategyVersion: String(covenant.version),
        paramsHash: hashObject(covenant.strategies),
        driftBoundsBps: covenant.allocation.absoluteMaxDriftBps
      },
      autonomy: { mode: "per_action_approval", reapprovalTriggers: [...REAPPROVAL_TRIGGERS] },
      stop: {
        expiresAt: covenant.expiresAt,
        maxModelTurns: options.maxModelTurns,
        maxWallMs: options.maxWallMs,
        haltOnIncident: true
      },
      runtime: {
        modelHash: covenant.runtime.baseModelHash,
        adapterHash: hashObject(covenant.strategies.map((strategy) => strategy.adapterHash)),
        harnessHash: options.harnessHash,
        toolRegistryHash: options.toolRegistryHash
      },
      effectiveAt: covenant.effectiveAt
    });
  } catch (error) {
    if (error instanceof RunContractError && error.code === "secret_material_prohibited") throw error;
    throw new RunContractError("covenant_map_error", "Strategy covenant cannot be mapped to a run contract", error);
  }
}
