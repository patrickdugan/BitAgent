import assert from "node:assert/strict";
import test from "node:test";
import { hashObject } from "../src/launch/canonical.js";
import {
  createExperimentRunContract,
  experimentRunContractCore,
  validateExperimentRunContract,
  type ExperimentRunContract
} from "../src/bench/experimentContract.js";
import { RunContractError } from "../src/runcontract/errors.js";

const sha = (label: string) => hashObject({ label });

function draft(): Omit<ExperimentRunContract, "contractHash"> {
  return {
    schema: "bitagent.bench_run_contract.v1",
    experimentId: "control-capability-v1-test",
    frozenAt: "2026-10-01T12:00:00.000Z",
    claim: "Placeholder claim for a schema test.",
    nonClaims: ["No model was run."],
    models: [
      {
        id: "M2", family: "Qwen3.5", paramsB: 2, baseRevision: "0".repeat(40), baseSha256: sha("m2-base"),
        quantization: "nf4", hiddenSize: 2048, loraRank: 16, adapterSha256: sha("m2-adapter"), thinkingMode: "off"
      },
      {
        id: "M4", family: "Qwen3.5", paramsB: 4, baseRevision: "1".repeat(40), baseSha256: sha("m4-base"),
        quantization: "nf4", hiddenSize: 2560, thinkingMode: "off"
      }
    ],
    critic: {
      family: "Bonsai-8B", baseRevision: "2".repeat(40), baseSha256: sha("critic"),
      adapterSha256: null, qualificationReceiptSha256: sha("critic-qualification")
    },
    heldConstant: {
      harnessHash: sha("harness"), toolRegistryHash: sha("tools"), worldSimHash: sha("world"),
      packetBuilderHash: sha("packets"), promptTemplateSha256: sha("prompt"),
      decoding: { mode: "loglik_closed_set", temperature: 0 },
      contextBudget: { windowTokens: 12000, packetTokens: 4000 },
      maxReadOnlyRounds: 3, maxReadOnlyCalls: 6, maxRetriesPerTurn: 2
    },
    training: {
      corpusSha256: sha("corpus"), method: "qlora", rankRule: "hidden_size / 128", alphaRule: "2 * rank",
      targetModules: ["q_proj", "v_proj"], epochs: 3, examples: 4000, lrSelection: "development_split_only", seed: 1
    },
    data: {
      developmentScenariosSha256: sha("dev-scenarios"), developmentOracleSha256: sha("dev-oracle"),
      heldoutScenariosSha256: sha("heldout-scenarios"), heldoutOracleSha256: sha("heldout-oracle"),
      trainingTemplateOverlap: 0
    },
    endpoints: { hardGates: ["UER"], coPrimary: ["CFC", "UAR"], thresholds: { UAR: 0.05, ICR: 0.02 } },
    analysis: {
      independentUnit: "templateId", pairing: "identical scenario and seed across models",
      interval: "clopper_pearson_95", seedPooling: "none"
    },
    resources: { wallCapSeconds: 5400, gpuTemperatureCapC: 79, billingCeilingUsd: 25 },
    stagedRelease: ["development", "heldout"]
  };
}

function rejects(mutate: (contract: Record<string, any>) => void, rehash = true) {
  const contract = structuredClone(createExperimentRunContract(draft())) as Record<string, any>;
  mutate(contract);
  if (rehash) contract.contractHash = hashObject(experimentRunContractCore(contract as ExperimentRunContract));
  assert.throws(() => validateExperimentRunContract(contract),
    (error: unknown) => error instanceof RunContractError && error.code === "contract_invalid");
}

test("experiment run contract survives a JSON round trip with a stable canonical hash", () => {
  const contract = createExperimentRunContract(draft());
  const reordered = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(contract))).reverse());
  assert.equal(validateExperimentRunContract(reordered).contractHash, contract.contractHash);
  assert.equal(hashObject(experimentRunContractCore(contract)), contract.contractHash);
  assert.equal(createExperimentRunContract(draft()).contractHash, contract.contractHash);
});

test("any change to an experiment run contract changes its hash", () => {
  const widened = draft();
  widened.endpoints.thresholds.UAR = 0.1;
  assert.notEqual(createExperimentRunContract(widened).contractHash, createExperimentRunContract(draft()).contractHash);
  rejects((contract) => { contract.endpoints.thresholds.UAR = 0.1; }, false);
});

test("experiment run contract accepts a base-only run without critic or training", () => {
  const base = draft();
  delete base.critic;
  delete base.training;
  base.models = base.models.filter((model) => model.loraRank === undefined);
  assert.equal(validateExperimentRunContract(createExperimentRunContract(base)).models.length, 1);
});

test("experiment run contract rejects unknown fields and departures from the frozen analysis", () => {
  rejects((contract) => { contract.notes = "x"; });
  rejects((contract) => { contract.heldConstant.decoding.temperature = 0.7; });
  rejects((contract) => { contract.heldConstant.contextBudget.packetTokens = 8000; });
  rejects((contract) => { contract.analysis.seedPooling = "pooled"; });
  rejects((contract) => { contract.resources.gpuTemperatureCapC = 85; });
  rejects((contract) => { contract.critic.adapterSha256 = sha("critic-adapter"); });
  rejects((contract) => { contract.models[1].id = "M2"; });
  rejects((contract) => { delete contract.models[0].adapterSha256; });
  rejects((contract) => { delete contract.training; });
  rejects((contract) => { contract.models[0].baseSha256 = "abc"; });
});

test("experiment run contract keeps training and held-out data apart", () => {
  rejects((contract) => { contract.data.trainingTemplateOverlap = 3; });
  rejects((contract) => { contract.data.heldoutScenariosSha256 = contract.data.developmentScenariosSha256; });
  rejects((contract) => { contract.data.heldoutOracleSha256 = contract.data.developmentOracleSha256; });
});
