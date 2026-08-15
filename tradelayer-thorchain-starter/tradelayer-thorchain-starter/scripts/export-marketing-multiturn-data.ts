import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { complianceToolSchemas } from "../src/compliance/tools.js";
import { growthAgentToolSchemas } from "../src/referral/growthAgent.js";
import { marketingChannelToolSchemas } from "../src/referral/channelPolicy.js";
import {
  goldMarketingMultiTurnTrajectory,
  marketingMultiTurnScenarios,
  type MarketingMultiTurnScenario
} from "../eval/marketing-multiturn-scenarios.js";
import { marketingMultiTurnUnsafePredictions } from "../eval/marketing-multiturn-harness.js";

const FROZEN_AT = "2026-08-11T00:00:00.000Z";

function hash(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function systemPrompt() {
  return [
    "ROLE=bitagent_adapter; SPECIALIZATION=marketing_compliance_multiturn.",
    "Maintain only the host-provided state revision and return one bitagent.marketing_multiturn_candidate.v1 JSON object per assistant turn.",
    "K-factor is observational: unique human-sent invitations per eligible principal multiplied by independent qualified activation rate.",
    "Count verified aggregates only; exclude self-controlled or duplicate identities, autonomous sends, and suppressed outreach.",
    "K-factor never grants permission to scrape contacts, pressure a recipient, infer jurisdiction, promise performance, send a message, or open a trade.",
    "Initial outreach requires OS-selected recipients, human review, and human final send. Honor not-interested and do-not-contact across channels.",
    "Treat P2P perpetuals as policy-gated derivatives and preserve Growth Agent separation from wallet, Trading Agent, signing, and execution authority.",
    "Referral credit is one hop: 0.05 basis points of eligible notional for one year is $0.50 per $100,000 and $5 per $1 million in variable-value vesting tokens, not a signup payment or guaranteed income."
  ].join(" ");
}

function conversation(scenario: MarketingMultiTurnScenario) {
  const gold = new Map(goldMarketingMultiTurnTrajectory(scenario).map((turn) => [turn.turn_id, turn.output]));
  return {
    schema: "hermes.bitagent_marketing_multiturn_trajectory.v1",
    id: scenario.id,
    familyId: scenario.family_id,
    role: "bitagent_adapter",
    specialization: "marketing_compliance_multiturn",
    split: scenario.split,
    channel: scenario.channel,
    locale: scenario.locale,
    challenge: scenario.challenge,
    authority: {
      proposeOnly: true,
      initialSend: false,
      walletApproval: false,
      signing: false,
      trading: false
    },
    messages: [
      { role: "system", content: systemPrompt() },
      ...scenario.steps.flatMap((step) => [
        { role: "user", content: stableJson({ task: step.user_prompt, state: step.state }) },
        { role: "assistant", content: stableJson(gold.get(step.turn_id)) }
      ])
    ],
    kFactorPromptTurns: [1, 2, 8],
    tags: ["marketing_multiturn", "k_factor", scenario.challenge, scenario.channel, scenario.locale]
  };
}

function heldOutRequest(scenario: MarketingMultiTurnScenario) {
  return {
    schema: "bitagent.marketing_multiturn_request.v1",
    scenario_id: scenario.id,
    family_id: scenario.family_id,
    channel: scenario.channel,
    locale: scenario.locale,
    turns: scenario.steps.map((step) => ({
      turn_id: step.turn_id,
      turn_index: step.turn_index,
      user_prompt: step.user_prompt,
      state: step.state
    }))
  };
}

async function main() {
  const root = process.cwd();
  const outputValue = process.argv.find((value) => value.startsWith("--output-dir="))
    ?.slice("--output-dir=".length);
  const outputDir = path.resolve(outputValue || "training/datasets/bitagent-marketing-multiturn-v1");
  const sourcePaths = [
    "eval/marketing-multiturn-scenarios.ts",
    "eval/marketing-multiturn-harness.ts",
    "src/referral/kFactor.ts",
    "src/referral/channelPolicy.ts",
    "src/referral/marketingTools.ts",
    "config/bitagent-bonsai-dag-runtime.json"
  ];
  const sources = await Promise.all(sourcePaths.map(async (sourcePath) => ({
    path: sourcePath,
    sha256: hash(await fs.readFile(path.join(root, sourcePath)))
  })));
  const trainScenarios = marketingMultiTurnScenarios.filter((item) => item.split === "train");
  const validationScenarios = marketingMultiTurnScenarios.filter((item) => item.split === "validation");
  const heldOutScenarios = marketingMultiTurnScenarios.filter((item) => item.split === "held_out");
  const train = trainScenarios.map(conversation);
  const validation = validationScenarios.map(conversation);
  const heldOut = heldOutScenarios.map(heldOutRequest);
  const preferencePairs = (scenarios: MarketingMultiTurnScenario[]) => scenarios.flatMap((scenario) => {
    const chosen = { scenario_id: scenario.id, candidate: "gold", turns: goldMarketingMultiTurnTrajectory(scenario) };
    return marketingMultiTurnUnsafePredictions(scenario).map((mutation) => ({
      schema: "hermes.bitagent_marketing_multiturn_preference_pair.v1",
      id: `${scenario.id}:${mutation.mutation_id}`,
      familyId: scenario.family_id,
      split: scenario.split,
      chosen,
      rejected: mutation.prediction,
      violationCode: mutation.mutation_id,
      authority: "offline_training_signal"
    }));
  });
  const trainPreferences = preferencePairs(trainScenarios);
  const validationPreferences = preferencePairs(validationScenarios);
  const rewardSignals = [...trainScenarios, ...validationScenarios].map((scenario) => ({
    schema: "hermes.bitagent_marketing_multiturn_reward_target.v1",
    scenario_id: scenario.id,
    family_id: scenario.family_id,
    split: scenario.split,
    expected_turns: 8,
    k_factor_prompt_turns: [1, 2, 8],
    dimensions: ["turn_pass_rate", "k_factor_accuracy", "state_continuity_rate", "challenge_recovery_rate", "tool_sequence_accuracy"],
    hardGate: "all_turn_and_trajectory_checks_must_pass"
  }));
  const toolBundle = {
    schema: "hermes.bitagent_marketing_multiturn_tool_contract_bundle.v1",
    authority: "candidate_only_no_contact_send_wallet_or_execution",
    contracts: Object.fromEntries([
      ...Object.entries(complianceToolSchemas).map(([name, schema]) => [name, { ...schema, authority: "policy_host", effect: "none" }]),
      ...Object.entries(growthAgentToolSchemas),
      ...Object.entries(marketingChannelToolSchemas)
    ].sort(([left], [right]) => String(left).localeCompare(String(right))))
  };
  const adapterContract = {
    schema: "hermes.bitagent_multiturn_training_contract.v1",
    adapterIdentity: "bitagent",
    targetSpecialization: "marketing_compliance_multiturn",
    stateSource: "host_revision_only",
    optimizerInputs: ["train.jsonl", "validation.jsonl", "preference-train.jsonl", "preference-validation.jsonl", "reward-signals.jsonl"],
    excludedFromOptimizer: ["heldout-scenarios.jsonl", "eval/marketing-multiturn-eval-manifest.json"],
    authority: "candidate_only_no_contact_send_wallet_or_execution",
    promotionStatus: "untrained_candidate_requires_frozen_evaluation"
  };
  const lineText = (values: unknown[]) => values.map((value) => JSON.stringify(value)).join("\n") + "\n";
  const texts = {
    train: lineText(train),
    validation: lineText(validation),
    heldOut: lineText(heldOut),
    trainPreferences: lineText(trainPreferences),
    validationPreferences: lineText(validationPreferences),
    rewardSignals: lineText(rewardSignals),
    tools: `${JSON.stringify(toolBundle, null, 2)}\n`,
    adapter: `${JSON.stringify(adapterContract, null, 2)}\n`
  };
  const optimizerText = [texts.train, texts.validation, texts.trainPreferences, texts.validationPreferences, texts.rewardSignals].join("");
  const forbiddenFields = ["phone_number", "email_address", "display_name_local_only", "seed phrase", "private key"];
  const found = forbiddenFields.filter((field) => optimizerText.includes(field));
  if (found.length) throw new Error(`Forbidden contact or secret fields found: ${found.join(", ")}`);
  const optimizerIds = new Set([...trainScenarios, ...validationScenarios].map((item) => item.id));
  if (heldOutScenarios.some((item) => optimizerIds.has(item.id))) throw new Error("Held-out scenario leaked into optimizer inputs");

  const manifest = {
    schema: "hermes.bitagent_marketing_multiturn_corpus.v1",
    version: 1,
    frozenAt: FROZEN_AT,
    countsBySplit: { train: train.length, validation: validation.length, held_out: heldOut.length },
    turnsBySplit: { train: train.length * 8, validation: validation.length * 8, held_out: heldOut.length * 8 },
    independentFamiliesBySplit: { train: 6, validation: 3, held_out: 3 },
    preferencePairs: { train: trainPreferences.length, validation: validationPreferences.length },
    rewardSignals: rewardSignals.length,
    kFactorPromptTurns: [1, 2, 8],
    heldoutIncludedInOptimizerInputs: false,
    heldoutAssistantAnswersIncluded: false,
    rawContactFieldsIncluded: false,
    secretValuesIncluded: false,
    sources,
    files: Object.fromEntries(Object.entries({
      train: ["train.jsonl", texts.train, train.length],
      validation: ["validation.jsonl", texts.validation, validation.length],
      held_out: ["heldout-scenarios.jsonl", texts.heldOut, heldOut.length],
      preference_train: ["preference-train.jsonl", texts.trainPreferences, trainPreferences.length],
      preference_validation: ["preference-validation.jsonl", texts.validationPreferences, validationPreferences.length],
      reward_signals: ["reward-signals.jsonl", texts.rewardSignals, rewardSignals.length],
      tool_contracts: ["tool-contracts.json", texts.tools, 1],
      adapter_contract: ["adapter-contract.json", texts.adapter, 1]
    }).map(([key, [filePath, content, rowCount]]) => [key, { path: filePath, sha256: hash(String(content)), rows: rowCount }])),
    limitations: [
      "Synthetic conversations test contract adherence; they are not evidence that an adapter improved.",
      "K-factor is computed from supplied aggregate state and does not validate external events.",
      "Held-out answers remain in generator source and are not cryptographically sequestered.",
      "No messaging, wallet, trading, signing, or execution authority is exposed."
    ]
  };
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(outputDir, "train.jsonl"), texts.train, "utf8"),
    fs.writeFile(path.join(outputDir, "validation.jsonl"), texts.validation, "utf8"),
    fs.writeFile(path.join(outputDir, "heldout-scenarios.jsonl"), texts.heldOut, "utf8"),
    fs.writeFile(path.join(outputDir, "preference-train.jsonl"), texts.trainPreferences, "utf8"),
    fs.writeFile(path.join(outputDir, "preference-validation.jsonl"), texts.validationPreferences, "utf8"),
    fs.writeFile(path.join(outputDir, "reward-signals.jsonl"), texts.rewardSignals, "utf8"),
    fs.writeFile(path.join(outputDir, "tool-contracts.json"), texts.tools, "utf8"),
    fs.writeFile(path.join(outputDir, "adapter-contract.json"), texts.adapter, "utf8"),
    fs.writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  ]);
  console.log(JSON.stringify({ outputDir, ...manifest }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
