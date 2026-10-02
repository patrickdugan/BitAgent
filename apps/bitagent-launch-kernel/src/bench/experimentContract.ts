import { hashObject } from "../launch/canonical.js";
import { RunContractError } from "../runcontract/errors.js";

export type ExperimentModel = {
  id: string;
  family: string;
  paramsB: number;
  baseRevision: string;
  baseSha256: string;
  quantization: string;
  hiddenSize: number;
  loraRank?: number;
  adapterSha256?: string;
  thinkingMode: "off" | "budgeted";
};

// Freezes one benchmark run (research-architecture.md section 5.8). It shares the canonical-hash
// discipline of the agent run contract and nothing else. `contractHash` is this file's addition.
export type ExperimentRunContract = {
  schema: "bitagent.bench_run_contract.v1";
  experimentId: string;
  frozenAt: string;
  claim: string;
  nonClaims: string[];
  models: ExperimentModel[];
  critic?: {
    family: string;
    baseRevision: string;
    baseSha256: string;
    adapterSha256: null;
    qualificationReceiptSha256: string;
  };
  heldConstant: {
    harnessHash: string;
    toolRegistryHash: string;
    worldSimHash: string;
    packetBuilderHash: string;
    promptTemplateSha256: string;
    decoding: { mode: "loglik_closed_set" | "grammar_constrained"; temperature: 0 };
    contextBudget: { windowTokens: 12000; packetTokens: 4000 };
    maxReadOnlyRounds: 3;
    maxReadOnlyCalls: 6;
    maxRetriesPerTurn: number;
  };
  training?: {
    corpusSha256: string;
    method: "qlora";
    rankRule: "hidden_size / 128";
    alphaRule: "2 * rank";
    targetModules: string[];
    epochs: number;
    examples: number;
    lrSelection: "development_split_only";
    seed: number;
  };
  data: {
    developmentScenariosSha256: string;
    developmentOracleSha256: string;
    heldoutScenariosSha256: string;
    heldoutOracleSha256: string;
    trainingTemplateOverlap: 0;
  };
  endpoints: { hardGates: string[]; coPrimary: string[]; thresholds: Record<string, number> };
  analysis: {
    independentUnit: "templateId";
    pairing: "identical scenario and seed across models";
    interval: "clopper_pearson_95";
    seedPooling: "none";
  };
  resources: { wallCapSeconds: number; gpuTemperatureCapC: 79; billingCeilingUsd: number };
  stagedRelease: string[];
  contractHash: string;
};

const HASH = /^[0-9a-f]{64}$/;

function fail(message: string): never {
  throw new RunContractError("contract_invalid", message);
}

function shape(value: unknown, label: string, required: string[], optional: string[] = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const row = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  const unexpected = Object.keys(row).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => row[key] === undefined);
  if (unexpected.length || missing.length) {
    fail(`${label} keys are invalid (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`);
  }
  return row;
}

function text(value: unknown, label: string) {
  if (typeof value !== "string" || !value) fail(`${label} must be a non-empty string`);
  return value;
}

function sha(value: unknown, label: string) {
  if (typeof value !== "string" || !HASH.test(value)) fail(`${label} must be a SHA-256 hex digest`);
  return value;
}

function count(value: unknown, label: string, minimum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) fail(`${label} must be an integer of at least ${minimum}`);
  return Number(value);
}

function amount(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${label} must be a non-negative number`);
  return value;
}

function texts(value: unknown, label: string, minimum: number) {
  if (!Array.isArray(value) || value.length < minimum) fail(`${label} must list at least ${minimum} entries`);
  return value.map((item, index) => text(item, `${label}[${index}]`));
}

function fixed(row: Record<string, unknown>, label: string, expected: Record<string, unknown>) {
  for (const [key, want] of Object.entries(expected)) {
    if (row[key] !== want) fail(`${label}.${key} must be ${JSON.stringify(want)}`);
  }
}

export function experimentRunContractCore(contract: ExperimentRunContract) {
  const { contractHash: _hash, ...core } = contract;
  return core;
}

export function createExperimentRunContract(input: Omit<ExperimentRunContract, "contractHash">) {
  return validateExperimentRunContract({ ...structuredClone(input), contractHash: hashObject(input) });
}

export function validateExperimentRunContract(raw: unknown): ExperimentRunContract {
  const value = shape(raw, "contract", [
    "schema", "experimentId", "frozenAt", "claim", "nonClaims", "models", "heldConstant", "data",
    "endpoints", "analysis", "resources", "stagedRelease", "contractHash"
  ], ["critic", "training"]);
  fixed(value, "contract", { schema: "bitagent.bench_run_contract.v1" });
  text(value.experimentId, "experimentId");
  if (!Number.isFinite(Date.parse(text(value.frozenAt, "frozenAt")))) fail("frozenAt must be an ISO timestamp");
  text(value.claim, "claim");
  texts(value.nonClaims, "nonClaims", 1);
  texts(value.stagedRelease, "stagedRelease", 0);

  if (!Array.isArray(value.models) || value.models.length === 0) fail("models must not be empty");
  const models = value.models.map((item, index) => {
    const label = `models[${index}]`;
    const model = shape(item, label, [
      "id", "family", "paramsB", "baseRevision", "baseSha256", "quantization", "hiddenSize", "thinkingMode"
    ], ["loraRank", "adapterSha256"]);
    for (const key of ["family", "baseRevision", "quantization"]) text(model[key], `${label}.${key}`);
    amount(model.paramsB, `${label}.paramsB`);
    sha(model.baseSha256, `${label}.baseSha256`);
    count(model.hiddenSize, `${label}.hiddenSize`, 0);
    if (!["off", "budgeted"].includes(String(model.thinkingMode))) fail(`${label}.thinkingMode is invalid`);
    if ((model.loraRank === undefined) !== (model.adapterSha256 === undefined)) {
      fail(`${label} must give loraRank and adapterSha256 together`);
    }
    if (model.loraRank !== undefined) {
      count(model.loraRank, `${label}.loraRank`, 1);
      sha(model.adapterSha256, `${label}.adapterSha256`);
    }
    return { id: text(model.id, `${label}.id`), adapted: model.loraRank !== undefined };
  });
  if (new Set(models.map((model) => model.id)).size !== models.length) fail("models must not repeat an id");
  if (models.some((model) => model.adapted) && value.training === undefined) fail("an adapted model requires a training block");

  if (value.critic !== undefined) {
    const critic = shape(value.critic, "critic", ["family", "baseRevision", "baseSha256", "adapterSha256", "qualificationReceiptSha256"]);
    text(critic.family, "critic.family");
    text(critic.baseRevision, "critic.baseRevision");
    sha(critic.baseSha256, "critic.baseSha256");
    fixed(critic, "critic", { adapterSha256: null });
    sha(critic.qualificationReceiptSha256, "critic.qualificationReceiptSha256");
  }

  const held = shape(value.heldConstant, "heldConstant", [
    "harnessHash", "toolRegistryHash", "worldSimHash", "packetBuilderHash", "promptTemplateSha256",
    "decoding", "contextBudget", "maxReadOnlyRounds", "maxReadOnlyCalls", "maxRetriesPerTurn"
  ]);
  for (const key of ["harnessHash", "toolRegistryHash", "worldSimHash", "packetBuilderHash", "promptTemplateSha256"]) {
    sha(held[key], `heldConstant.${key}`);
  }
  const decoding = shape(held.decoding, "heldConstant.decoding", ["mode", "temperature"]);
  if (!["loglik_closed_set", "grammar_constrained"].includes(String(decoding.mode))) fail("heldConstant.decoding.mode is invalid");
  fixed(decoding, "heldConstant.decoding", { temperature: 0 });
  fixed(shape(held.contextBudget, "heldConstant.contextBudget", ["windowTokens", "packetTokens"]),
    "heldConstant.contextBudget", { windowTokens: 12000, packetTokens: 4000 });
  fixed(held, "heldConstant", { maxReadOnlyRounds: 3, maxReadOnlyCalls: 6 });
  count(held.maxRetriesPerTurn, "heldConstant.maxRetriesPerTurn", 0);

  if (value.training !== undefined) {
    const training = shape(value.training, "training", [
      "corpusSha256", "method", "rankRule", "alphaRule", "targetModules", "epochs", "examples", "lrSelection", "seed"
    ]);
    sha(training.corpusSha256, "training.corpusSha256");
    fixed(training, "training", {
      method: "qlora", rankRule: "hidden_size / 128", alphaRule: "2 * rank", lrSelection: "development_split_only"
    });
    texts(training.targetModules, "training.targetModules", 1);
    count(training.epochs, "training.epochs", 1);
    count(training.examples, "training.examples", 1);
    count(training.seed, "training.seed", 0);
  }

  const data = shape(value.data, "data", [
    "developmentScenariosSha256", "developmentOracleSha256", "heldoutScenariosSha256", "heldoutOracleSha256",
    "trainingTemplateOverlap"
  ]);
  for (const key of ["developmentScenariosSha256", "developmentOracleSha256", "heldoutScenariosSha256", "heldoutOracleSha256"]) {
    sha(data[key], `data.${key}`);
  }
  fixed(data, "data", { trainingTemplateOverlap: 0 });
  if (data.developmentScenariosSha256 === data.heldoutScenariosSha256 || data.developmentOracleSha256 === data.heldoutOracleSha256) {
    fail("data: the held-out split must differ from the development split");
  }

  const endpoints = shape(value.endpoints, "endpoints", ["hardGates", "coPrimary", "thresholds"]);
  texts(endpoints.hardGates, "endpoints.hardGates", 1);
  texts(endpoints.coPrimary, "endpoints.coPrimary", 1);
  const thresholds = endpoints.thresholds;
  if (!thresholds || typeof thresholds !== "object" || Array.isArray(thresholds)) fail("endpoints.thresholds must be an object");
  for (const [name, threshold] of Object.entries(thresholds)) amount(threshold, `endpoints.thresholds.${name}`);
  fixed(shape(value.analysis, "analysis", ["independentUnit", "pairing", "interval", "seedPooling"]), "analysis", {
    independentUnit: "templateId",
    pairing: "identical scenario and seed across models",
    interval: "clopper_pearson_95",
    seedPooling: "none"
  });
  const resources = shape(value.resources, "resources", ["wallCapSeconds", "gpuTemperatureCapC", "billingCeilingUsd"]);
  count(resources.wallCapSeconds, "resources.wallCapSeconds", 1);
  fixed(resources, "resources", { gpuTemperatureCapC: 79 });
  amount(resources.billingCeilingUsd, "resources.billingCeilingUsd");

  const contract = value as unknown as ExperimentRunContract;
  if (sha(value.contractHash, "contractHash") !== hashObject(experimentRunContractCore(contract))) {
    fail("contractHash does not match the canonical contract");
  }
  return contract;
}
