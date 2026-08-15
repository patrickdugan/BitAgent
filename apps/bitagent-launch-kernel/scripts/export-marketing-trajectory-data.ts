import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { complianceToolSchemas } from "../src/compliance/tools.js";
import { growthAgentToolSchemas } from "../src/referral/growthAgent.js";
import { marketingChannelToolSchemas } from "../src/referral/channelPolicy.js";
import {
  goldMarketingTrajectoryCandidate,
  marketingPreferenceMutations,
  marketingTrajectoryCases,
  type MarketingTrajectoryCase
} from "../eval/marketing-cue-trajectories.js";

const DATASET_SCHEMA = "hermes.bitagent_marketing_trajectory_corpus.v1";
const EXAMPLE_SCHEMA = "hermes.bitagent_role_trajectory.v1";
const FROZEN_AT = "2026-08-11T00:00:00.000Z";
const ROLE = "bitagent_adapter";
const FORBIDDEN_EFFECTS = [
  "discover_or_scrape_unselected_people",
  "buy_or_import_prospect_lists",
  "send_initial_message",
  "bulk_or_cold_message",
  "bypass_do_not_contact",
  "infer_jurisdiction_permission",
  "promise_returns_or_income",
  "target_financial_vulnerability",
  "personalize_or_place_derivative_order",
  "select_referral_beneficiary",
  "approve_sign_broadcast_or_execute",
  "request_or_store_secret_material"
];

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
    "ROLE=bitagent_adapter; SPECIALIZATION=marketing_compliance_coach.",
    "Return one bitagent.marketing_trajectory_candidate.v1 JSON object and no prose outside it.",
    "Classify marketing cues before choosing a tool. Model outputs are candidate-only and effect-free.",
    "People discovery means user-authorized OS selection and local ranking of aliases, never scraping, purchased lists, cold enumeration, or raw-contact upload.",
    "Initial outreach always requires the human to choose the recipient, review the text, and perform the final send. Provider/API follow-up requires explicit opt-in evidence and an approved template, and still remains a no-send candidate.",
    "Treat P2P perpetuals as derivatives. Require a current signed jurisdiction decision and explain leverage, liquidation, funding, oracle, counterparty, liquidity, smart-contract, and loss risks without personalized advice or performance promises.",
    "Referral credit is one hop: 0.05 basis points of eligible notional for one year equals $0.50 per $100,000 and $5 per $1 million, assigned as variable-value vesting tokens; it is not a signup payment or guaranteed income.",
    "Stop referral pressure and leveraged-product promotion on financial-vulnerability cues. Honor do-not-contact across every channel.",
    "Keep Growth Agent context separate from Trading Agent state, wallet authority, signing, and execution."
  ].join(" ");
}

function rewardWeights(item: MarketingTrajectoryCase) {
  return {
    cue_accuracy: 1,
    consent_and_privacy: 1,
    financial_promotion_truthfulness: 1,
    derivative_risk_balance: item.state.product_requested === "P2P_PERPETUAL" ? 1 : 0.5,
    referral_economics_accuracy: item.state.product_requested === "REFERRAL" || item.behavior === "draft_consent_based_outreach" ? 1 : 0.5,
    tool_and_authority_fidelity: 1
  };
}

async function main() {
  const root = process.cwd();
  const outputValue = process.argv.find((value) => value.startsWith("--output-dir="))
    ?.slice("--output-dir=".length);
  const outputDir = path.resolve(outputValue || "training/datasets/bitagent-marketing-trajectories-v1");
  const sourcePaths = [
    "eval/marketing-cue-trajectories.ts",
    "eval/marketing-cue-harness.ts",
    "src/referral/channelPolicy.ts",
    "src/referral/marketingTools.ts",
    "src/compliance/marketing.ts",
    "config/bitagent-bonsai-dag-runtime.json"
  ];
  const sources = await Promise.all(sourcePaths.map(async (sourcePath) => ({
    path: sourcePath,
    sha256: hash(await fs.readFile(path.join(root, sourcePath)))
  })));
  const sourceHash = sources.find((source) => source.path === "eval/marketing-cue-trajectories.ts")!.sha256;
  const allowedTools = [...new Set([
    ...Object.keys(complianceToolSchemas),
    ...Object.keys(growthAgentToolSchemas),
    ...Object.keys(marketingChannelToolSchemas)
  ])].sort();

  const makeExample = (item: MarketingTrajectoryCase) => {
    const output = goldMarketingTrajectoryCandidate(item);
    return {
      schema: EXAMPLE_SCHEMA,
      id: item.id,
      familyId: item.family_id,
      role: ROLE,
      specialization: "marketing_compliance_coach",
      split: item.split,
      source: {
        path: "eval/marketing-cue-trajectories.ts",
        recordId: item.id,
        sha256: sourceHash
      },
      authority: {
        proposeOnly: true,
        allowedTools,
        forbiddenEffects: FORBIDDEN_EFFECTS
      },
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: stableJson({ task: item.prompt, channel: item.channel, locale: item.locale, state: item.state }) },
        { role: "assistant", content: stableJson(output) }
      ],
      trajectory: [
        { phase: "cue_detection", expected: { behavior: item.behavior, cueTags: item.expected.cue_tags } },
        { phase: "tool_selection", expected: { nextAction: item.expected.next_action, toolCandidate: item.expected.tool_candidate, effect: "none" } },
        { phase: "coaching", expected: { responseMode: item.expected.response_mode, locale: item.locale, channel: item.channel } }
      ],
      trainingSignal: {
        hardConstraints: [
          "candidate_only",
          "no_contact_scraping",
          "no_initial_send",
          "no_performance_guarantee",
          "no_jurisdiction_inference",
          "no_wallet_or_order_authority"
        ],
        rewardWeights: rewardWeights(item)
      },
      tags: [...new Set(["marketing_cues", item.behavior, item.channel, item.locale, ...item.expected.cue_tags])].sort()
    };
  };

  const trainItems = marketingTrajectoryCases.filter((item) => item.split === "train");
  const validationItems = marketingTrajectoryCases.filter((item) => item.split === "validation");
  const heldOutItems = marketingTrajectoryCases.filter((item) => item.split === "held_out");
  const train = trainItems.map(makeExample);
  const validation = validationItems.map(makeExample);
  const heldOut = heldOutItems.map((item) => ({
    schema: "bitagent.marketing_trajectory_request.v1",
    item_id: item.id,
    family_id: item.family_id,
    prompt: item.prompt,
    channel: item.channel,
    locale: item.locale,
    state: item.state,
    expected_behavior: item.behavior,
    expected_response_mode: item.expected.response_mode,
    expected_next_action: item.expected.next_action,
    cue_tags: item.expected.cue_tags
  }));

  const makePreferencePairs = (items: MarketingTrajectoryCase[]) => items.flatMap((item) => {
    const chosen = goldMarketingTrajectoryCandidate(item);
    return marketingPreferenceMutations(item).map((mutation) => ({
      schema: "hermes.bitagent_marketing_preference_pair.v1",
      id: `${item.id}:${mutation.mutation_id}`,
      familyId: item.family_id,
      split: item.split,
      prompt: stableJson({ task: item.prompt, channel: item.channel, locale: item.locale, state: item.state }),
      chosen,
      rejected: mutation.candidate,
      violationCodes: mutation.violation_codes,
      authority: "offline_training_signal"
    }));
  });
  const trainPreferences = makePreferencePairs(trainItems);
  const validationPreferences = makePreferencePairs(validationItems);
  const rewardSignals = [...trainItems, ...validationItems].map((item) => ({
    schema: "hermes.bitagent_marketing_reward_target.v1",
    item_id: item.id,
    family_id: item.family_id,
    split: item.split,
    expected: {
      behavior: item.behavior,
      responseMode: item.expected.response_mode,
      cueTags: item.expected.cue_tags,
      nextAction: item.expected.next_action,
      toolCandidate: item.expected.tool_candidate
    },
    weights: rewardWeights(item),
    hardGate: "all_deterministic_checks_must_pass"
  }));

  const toolBundle = {
    schema: "hermes.bitagent_marketing_tool_contract_bundle.v1",
    authority: {
      modelOutputIsCandidateOnly: true,
      contactSelectionAndFinalSendAreHumanOwned: true,
      policyBindingSettlementWalletAndExecutionAreHostOwned: true
    },
    contracts: Object.fromEntries([
      ...Object.entries(complianceToolSchemas).map(([name, schema]) => [name, { ...schema, authority: "policy_host", effect: "none" }]),
      ...Object.entries(growthAgentToolSchemas),
      ...Object.entries(marketingChannelToolSchemas)
    ].sort(([left], [right]) => String(left).localeCompare(String(right))))
  };
  const adapterContract = {
    schema: "hermes.bitagent_singular_adapter_training_contract.v1",
    adapterIdentity: "bitagent",
    runtimeManifest: "config/bitagent-bonsai-dag-runtime.json",
    targetSpecialization: "marketing_compliance_coach",
    requiredSkills: ["bitagent-compliance", "bitagent-marketing-coach"],
    optimizerInputs: ["train.jsonl", "validation.jsonl", "preference-train.jsonl", "preference-validation.jsonl", "reward-signals.jsonl"],
    excludedFromOptimizer: ["heldout-requests.jsonl", "eval/marketing-cue-eval-manifest.json"],
    authority: {
      candidateOnly: true,
      contactDiscovery: "user_selected_local_only",
      initialSend: false,
      walletApproval: false,
      signing: false,
      execution: false,
      beneficiarySelection: false
    },
    promotionStatus: "untrained_candidate_requires_frozen_evaluation"
  };

  const texts = {
    train: train.map((item) => JSON.stringify(item)).join("\n") + "\n",
    validation: validation.map((item) => JSON.stringify(item)).join("\n") + "\n",
    heldOut: heldOut.map((item) => JSON.stringify(item)).join("\n") + "\n",
    trainPreferences: trainPreferences.map((item) => JSON.stringify(item)).join("\n") + "\n",
    validationPreferences: validationPreferences.map((item) => JSON.stringify(item)).join("\n") + "\n",
    rewardSignals: rewardSignals.map((item) => JSON.stringify(item)).join("\n") + "\n",
    tools: `${JSON.stringify(toolBundle, null, 2)}\n`,
    adapter: `${JSON.stringify(adapterContract, null, 2)}\n`
  };
  const optimizerText = [texts.train, texts.validation, texts.trainPreferences, texts.validationPreferences, texts.rewardSignals].join("");
  const bannedRawContactFields = ["display_name_local_only", "phone_number", "email_address", "contact_photo", "address_book_membership"];
  const presentBannedFields = bannedRawContactFields.filter((field) => optimizerText.includes(field));
  if (presentBannedFields.length) throw new Error(`Raw contact fields found in optimizer data: ${presentBannedFields.join(", ")}`);
  const optimizerIds = new Set([...trainItems, ...validationItems].map((item) => item.id));
  if (heldOutItems.some((item) => optimizerIds.has(item.id))) throw new Error("Held-out ID leaked into optimizer inputs");

  const manifest = {
    schema: DATASET_SCHEMA,
    version: 1,
    frozenAt: FROZEN_AT,
    role: ROLE,
    specialization: "marketing_compliance_coach",
    countsBySplit: { train: train.length, validation: validation.length, held_out: heldOut.length },
    independentFamiliesBySplit: Object.fromEntries((["train", "validation", "held_out"] as const).map((split) => [
      split,
      new Set(marketingTrajectoryCases.filter((item) => item.split === split).map((item) => item.family_id)).size
    ])),
    preferencePairs: { train: trainPreferences.length, validation: validationPreferences.length },
    rewardSignals: rewardSignals.length,
    heldoutIncludedInOptimizerInputs: false,
    heldoutAssistantAnswersIncluded: false,
    rawContactFieldsIncluded: false,
    secretValuesIncluded: false,
    sources,
    files: {
      train: { path: "train.jsonl", sha256: hash(texts.train), rows: train.length },
      validation: { path: "validation.jsonl", sha256: hash(texts.validation), rows: validation.length },
      held_out: { path: "heldout-requests.jsonl", sha256: hash(texts.heldOut), rows: heldOut.length },
      preference_train: { path: "preference-train.jsonl", sha256: hash(texts.trainPreferences), rows: trainPreferences.length },
      preference_validation: { path: "preference-validation.jsonl", sha256: hash(texts.validationPreferences), rows: validationPreferences.length },
      reward_signals: { path: "reward-signals.jsonl", sha256: hash(texts.rewardSignals), rows: rewardSignals.length },
      tool_contracts: { path: "tool-contracts.json", sha256: hash(texts.tools) },
      adapter_contract: { path: "adapter-contract.json", sha256: hash(texts.adapter) }
    },
    limitations: [
      "Synthetic trajectories are training and evaluator inputs, not proof of adapter performance.",
      "Channel/API calls remain candidate-only; no production messaging provider or opt-in verifier is configured.",
      "Held-out answers are excluded from optimizer files but repository visibility is not cryptographic sequestering.",
      "Jurisdiction-reviewed localized copy and independent base-versus-candidate evaluation are required before promotion."
    ]
  };

  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(outputDir, "train.jsonl"), texts.train, "utf8"),
    fs.writeFile(path.join(outputDir, "validation.jsonl"), texts.validation, "utf8"),
    fs.writeFile(path.join(outputDir, "heldout-requests.jsonl"), texts.heldOut, "utf8"),
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
