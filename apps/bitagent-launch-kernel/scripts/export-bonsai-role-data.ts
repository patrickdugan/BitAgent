import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { agentCases } from "../eval/agent-cases.js";
import { encodeSegwitAddress } from "../src/launch/bitcoin.js";
import { extractAmountSats } from "../src/launch/intent.js";
import { launchToolSchemas } from "../src/launch/tools.js";
import { committedSignalToolSchemas } from "../src/signals/tools.js";
import { financialSurvivalToolSchemas } from "../src/survival/tools.js";

type Role =
  | "intent_planner"
  | "utxo_tradelayer_specialist"
  | "risk_approval_guard"
  | "recovery_operator";

type TrainingExample = {
  schema: "hermes.bitagent_role_example.v1";
  id: string;
  role: Role;
  split: "train" | "validation" | "test";
  source: {
    path: string;
    recordId: string;
    sha256: string;
  };
  authority: {
    proposeOnly: true;
    allowedTools: string[];
    forbiddenEffects: string[];
  };
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  tags: string[];
};

const OUTPUT_SCHEMA = "hermes.bitagent_role_corpus.v1";
const TOOL_BUNDLE_SCHEMA = "hermes.bitagent_tool_contract_bundle.v1";
const WORKFLOW_ID = "workflow_training_fixture";
const SAFE_TESTNET_ADDRESS = encodeSegwitAddress(Buffer.alloc(20, 9), "bitcoin-testnet4");
const SECRET_VALUE_PATTERNS = [
  /\b[KL5][1-9A-HJ-NP-Za-km-z]{50,51}\b/,
  /\b(?:sk|xoxb|ghp)_[A-Za-z0-9_-]{16,}\b/
];

const INCLUDE_FINANCIAL_SURVIVAL = process.argv.includes("--include-financial-survival");
const BASE_ROLE_AUTHORITY: Record<Role, string[]> = {
  intent_planner: [
    "bitagent.wallet.connect",
    "bitagent.deposit.prepare",
    "bitagent.strategy.simulate",
    "bitagent.withdraw.simulate",
    "bitagent.workflow.get"
  ],
  utxo_tradelayer_specialist: [
    "bitagent.strategy.simulate",
    "bitagent.withdraw.simulate",
    "bitagent.workflow.get",
    "bitagent.signal.simulate",
    "bitagent.signal.get"
  ],
  risk_approval_guard: [
    "bitagent.workflow.get",
    "bitagent.signal.get"
  ],
  recovery_operator: [
    "bitagent.workflow.get",
    "bitagent.action.verify",
    "bitagent.signal.get",
    "bitagent.signal.verify"
  ]
};
const ROLE_AUTHORITY: Record<Role, string[]> = INCLUDE_FINANCIAL_SURVIVAL
  ? {
      ...BASE_ROLE_AUTHORITY,
      risk_approval_guard: [
        ...BASE_ROLE_AUTHORITY.risk_approval_guard,
        "bitagent.survival.assess",
        "bitagent.survival.evaluate"
      ],
      recovery_operator: [
        ...BASE_ROLE_AUTHORITY.recovery_operator,
        "bitagent.survival.assess",
        "bitagent.survival.evaluate",
        "bitagent.survival.journal.verify"
      ]
    }
  : BASE_ROLE_AUTHORITY;

const FORBIDDEN_EFFECTS = [
  "request_or_store_secret_material",
  "approve_wallet_action",
  "sign_transaction",
  "broadcast_transaction",
  "invent_wallet_or_chain_state",
  "change_strategy_parameters"
];

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function hash(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function splitFor(id: string): TrainingExample["split"] {
  const bucket = Number.parseInt(hash(id).slice(0, 8), 16) % 10;
  if (bucket === 8) return "validation";
  if (bucket === 9) return "test";
  return "train";
}

function systemPrompt(role: Role) {
  return [
    `ROLE=${role}.`,
    "Return one compact JSON candidate action.",
    "The host owns wallet truth, policy, approval, signing, broadcast, and verification.",
    "Never request or expose a seed phrase, mnemonic, WIF, private key, API key, or signing secret.",
    "Never claim success without supplied tool evidence.",
    `Allowed tools: ${ROLE_AUTHORITY[role].join(", ") || "none"}.`
  ].join(" ");
}

function toolEffect(name: string) {
  if (/\.execute$/.test(name)) return "execution";
  if (/\.(?:request_approval|resolve_approval)$/.test(name)) return "approval_boundary";
  if (/\.(?:ingest|observe|start)$/.test(name)) return "host_state_change";
  return "none";
}

function makeExample(input: {
  id: string;
  role: Role;
  sourcePath: string;
  sourceId: string;
  sourceHash: string;
  user: unknown;
  assistant: unknown;
  tags: string[];
}): TrainingExample {
  return {
    schema: "hermes.bitagent_role_example.v1",
    id: input.id,
    role: input.role,
    split: splitFor(input.id),
    source: {
      path: input.sourcePath.replaceAll("\\", "/"),
      recordId: input.sourceId,
      sha256: input.sourceHash
    },
    authority: {
      proposeOnly: true,
      allowedTools: ROLE_AUTHORITY[input.role],
      forbiddenEffects: FORBIDDEN_EFFECTS
    },
    messages: [
      { role: "system", content: systemPrompt(input.role) },
      { role: "user", content: stableJson(input.user) },
      { role: "assistant", content: stableJson(input.assistant) }
    ],
    tags: [...new Set(input.tags)].sort()
  };
}

function phaseState(phase: string) {
  return {
    disconnected: {
      wallet: { connected: false, confirmedBalanceSats: "0" },
      deposit: { status: "not_started", confirmations: 0, requiredConfirmations: 2 }
    },
    connected: {
      wallet: { connected: true, confirmedBalanceSats: "0" },
      deposit: { status: "not_started", confirmations: 0, requiredConfirmations: 2 }
    },
    unconfirmed: {
      wallet: { connected: true, confirmedBalanceSats: "0" },
      deposit: { status: "observed", confirmations: 1, requiredConfirmations: 2 }
    },
    confirmed: {
      wallet: { connected: true, confirmedBalanceSats: "250000" },
      deposit: { status: "confirmed", confirmations: 2, requiredConfirmations: 2 }
    }
  }[phase];
}

function toolCandidate(caseRow: (typeof agentCases)[number], message: string) {
  if (!caseRow.expectedTool) return undefined;
  const args: Record<string, unknown> = { workflowId: WORKFLOW_ID };
  if (caseRow.expectedTool === "bitagent.wallet.connect") args.mode = "connect";
  if (caseRow.expectedTool === "bitagent.strategy.simulate") {
    args.amountSats = extractAmountSats(message) || "100000";
  }
  if (caseRow.expectedTool === "bitagent.withdraw.simulate") {
    args.amountSats = extractAmountSats(message) || "1000";
    args.destinationAddress = SAFE_TESTNET_ADDRESS;
  }
  return { name: caseRow.expectedTool, arguments: args };
}

async function readJsonl(file: string) {
  const text = await fs.readFile(file, "utf8");
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function main() {
  const root = process.cwd();
  const outputIndex = process.argv.indexOf("--output-dir");
  const outputEquals = process.argv.find((argument) => argument.startsWith("--output-dir="))?.slice("--output-dir=".length);
  const positionalOutput = process.argv.slice(2).find((argument) => !argument.startsWith("-"));
  const outputValue = outputIndex >= 0 ? process.argv[outputIndex + 1] : outputEquals || positionalOutput;
  const defaultOutput = INCLUDE_FINANCIAL_SURVIVAL
    ? "training/artifacts/bonsai-role-corpus-v3"
    : "training/artifacts/bonsai-role-corpus-v1";
  const outputDir = path.resolve(root, outputValue || defaultOutput);
  const agentCasesPath = path.join(root, "eval", "agent-cases.ts");
  const failurePath = path.join(root, "eval", "fixtures", "failure-traces.seed.jsonl");
  const signalFailurePath = path.join(root, "eval", "fixtures", "signal-failure-traces.seed.jsonl");
  const covenantFailurePath = path.join(root, "eval", "fixtures", "covenant-failure-traces.seed.jsonl");
  const shadowFailurePath = path.join(root, "eval", "fixtures", "shadow-feeder-failure-traces.seed.jsonl");
  const launchToolsPath = path.join(root, "src", "launch", "tools.ts");
  const signalToolsPath = path.join(root, "src", "signals", "tools.ts");
  const survivalToolsPath = path.join(root, "src", "survival", "tools.ts");
  const sourceFiles = [
    agentCasesPath,
    failurePath,
    signalFailurePath,
    covenantFailurePath,
    shadowFailurePath,
    launchToolsPath,
    signalToolsPath,
    ...(INCLUDE_FINANCIAL_SURVIVAL ? [survivalToolsPath] : [])
  ];
  const sourceHashes = new Map<string, string>();
  for (const file of sourceFiles) sourceHashes.set(file, hash(await fs.readFile(file)));

  const examples: TrainingExample[] = [];
  for (const row of agentCases) {
    const message = row.message.replace("{{ADDRESS}}", SAFE_TESTNET_ADDRESS);
    const candidate = {
      action: row.expectedTool ? "propose_tool" : row.prohibited ? "refuse_secret" : "collect_or_explain",
      intent: row.expectedIntent,
      missingParameters: row.expectedMissing ? [row.expectedMissing] : [],
      prohibitedRequestDetected: Boolean(row.prohibited),
      tool: toolCandidate(row, message)
    };
    examples.push(makeExample({
      id: `intent-${row.id}`,
      role: "intent_planner",
      sourcePath: path.relative(root, agentCasesPath),
      sourceId: row.id,
      sourceHash: sourceHashes.get(agentCasesPath)!,
      user: {
        task: message,
        workflowId: WORKFLOW_ID,
        state: phaseState(row.phase),
        supportedIntents: ["deposit_bitcoin", "starter_strategy", "withdraw_bitcoin"]
      },
      assistant: candidate,
      tags: ["intent", row.phase, row.expectedIntent, row.prohibited ? "secret_safety" : "normal"]
    }));
  }

  const failures = await readJsonl(failurePath);
  for (const row of failures) {
    const id = String(row.id);
    examples.push(makeExample({
      id: `recovery-${id}`,
      role: "recovery_operator",
      sourcePath: path.relative(root, failurePath),
      sourceId: id,
      sourceHash: sourceHashes.get(failurePath)!,
      user: {
        task: "Recover this persisted BitAgent workflow without duplicating a financial action.",
        failure: row
      },
      assistant: {
        action: "recover",
        execute: false,
        verifyBeforeReplacement: Boolean(row.approvalExecuted),
        recovery: row.recovery,
        truthfulStateRequired: true
      },
      tags: ["recovery", String(row.errorCode)]
    }));
    if ([
      "malformed_address",
      "deposit_unconfirmed",
      "insufficient_funds",
      "simulation_stale",
      "preflight_failed"
    ].includes(String(row.errorCode))) {
      examples.push(makeExample({
        id: `specialist-${id}`,
        role: "utxo_tradelayer_specialist",
        sourcePath: path.relative(root, failurePath),
        sourceId: id,
        sourceHash: sourceHashes.get(failurePath)!,
        user: {
          task: "Interpret the supplied wallet and simulation evidence and propose no state change.",
          failure: row
        },
        assistant: {
          action: "block_simulation_or_execution",
          execute: false,
          reasonCode: row.errorCode,
          truthfulStateRequired: true,
          recovery: row.recovery
        },
        tags: ["simulation_boundary", String(row.errorCode)]
      }));
    }
  }

  const signalFailures = await readJsonl(signalFailurePath);
  for (const row of signalFailures) {
    const id = String(row.caseId);
    examples.push(makeExample({
      id: `guard-${id}`,
      role: "risk_approval_guard",
      sourcePath: path.relative(root, signalFailurePath),
      sourceId: id,
      sourceHash: sourceHashes.get(signalFailurePath)!,
      user: {
        task: "Decide whether the exact committed-signal workflow may proceed.",
        evidence: row
      },
      assistant: {
        action: "deny",
        approvalValid: false,
        execute: false,
        reasonCode: row.errorCode,
        recovery: row.recovery,
        requireFreshSimulation: ["codebase_mismatch", "simulation_stale"].includes(String(row.errorCode))
      },
      tags: ["approval_boundary", "committed_signal", String(row.errorCode)]
    }));
    if (String(row.stage) === "simulate") {
      examples.push(makeExample({
        id: `specialist-${id}`,
        role: "utxo_tradelayer_specialist",
        sourcePath: path.relative(root, signalFailurePath),
        sourceId: id,
        sourceHash: sourceHashes.get(signalFailurePath)!,
        user: {
          task: "Validate supplied UTXORef and TradeLayer simulation evidence without approving or executing.",
          evidence: row
        },
        assistant: {
          action: "reject_invalid_simulation_input",
          execute: false,
          reasonCode: row.errorCode,
          recovery: row.recovery
        },
        tags: ["committed_signal", "simulation_boundary", String(row.errorCode)]
      }));
    }
  }

  const covenantFailures = await readJsonl(covenantFailurePath);
  for (const row of covenantFailures) {
    const id = String(row.caseId);
    const { recovery, ...evidence } = row;
    examples.push(makeExample({
      id: `guard-${id}`,
      role: "risk_approval_guard",
      sourcePath: path.relative(root, covenantFailurePath),
      sourceId: id,
      sourceHash: sourceHashes.get(covenantFailurePath)!,
      user: {
        task: "Decide whether this Strategy Covenant candidate may proceed. Never approve, sign, broadcast, or alter the covenant.",
        evidence
      },
      assistant: {
        action: "deny",
        approvalValid: false,
        execute: false,
        reasonCode: row.errorCode,
        recovery,
        requireFreshSimulation: ["market_state_invalid", "portfolio_state_invalid", "candidate_invalid"].includes(String(row.errorCode))
      },
      tags: ["approval_boundary", "strategy_covenant", String(row.errorCode)]
    }));
  }

  const shadowFailures = await readJsonl(shadowFailurePath);
  for (const row of shadowFailures) {
    const id = String(row.caseId);
    const { recovery, ...evidence } = row;
    examples.push(makeExample({
      id: `guard-${id}`,
      role: "risk_approval_guard",
      sourcePath: path.relative(root, shadowFailurePath),
      sourceId: id,
      sourceHash: sourceHashes.get(shadowFailurePath)!,
      user: {
        task: "Validate this read-only TradeLayer shadow evidence. Never infer missing market, balance, PnL, or sync state.",
        evidence
      },
      assistant: {
        action: "deny_candidate_generation",
        approvalValid: false,
        execute: false,
        reasonCode: row.errorCode,
        recovery,
        requireFreshObservation: true
      },
      tags: ["market_state_truth", "strategy_covenant", "shadow_feed", String(row.errorCode)]
    }));
  }

  const toolSources = [
    { file: launchToolsPath, schemas: launchToolSchemas, lane: "launch" },
    { file: signalToolsPath, schemas: committedSignalToolSchemas, lane: "committed_signal" },
    ...(INCLUDE_FINANCIAL_SURVIVAL
      ? [{ file: survivalToolsPath, schemas: financialSurvivalToolSchemas, lane: "financial_survival" }]
      : [])
  ];
  for (const source of toolSources) {
    for (const [name, schema] of Object.entries(source.schemas)) {
      if (/execute|resolve_approval|request_approval/.test(name)) continue;
      const role: Role = name === "bitagent.survival.journal.verify"
        ? "recovery_operator"
        : name.startsWith("bitagent.survival.")
          ? "risk_approval_guard"
          : /simulate|deposit\.observe|signal\.ingest/.test(name)
            ? "utxo_tradelayer_specialist"
            : "recovery_operator";
      if (!ROLE_AUTHORITY[role].includes(name)) continue;
      examples.push(makeExample({
        id: `tool-${name}`,
        role,
        sourcePath: path.relative(root, source.file),
        sourceId: name,
        sourceHash: sourceHashes.get(source.file)!,
        user: {
          task: "Select and populate the exact typed tool only when all required arguments are available.",
          lane: source.lane,
          toolName: name,
          schema
        },
        assistant: {
          action: "validate_then_propose",
          toolName: name,
          requiredArguments: schema.required,
          additionalProperties: false,
          execute: false
        },
        tags: ["typed_tool", source.lane]
      }));
    }
  }

  for (const role of Object.keys(ROLE_AUTHORITY) as Role[]) {
    const roleRows = examples
      .filter((row) => row.role === role)
      .sort((left, right) => hash(left.id).localeCompare(hash(right.id)));
    if (roleRows.length < 3) throw new Error(`Role ${role} needs at least three examples for split isolation`);
    roleRows.forEach((row, index) => {
      row.split = index === 0 ? "validation" : index === 1 ? "test" : "train";
    });
  }
  const serialized = examples.map((row) => JSON.stringify(row));
  const secretValueDetected = SECRET_VALUE_PATTERNS.some((pattern) => serialized.some((line) => pattern.test(line)));
  if (secretValueDetected) throw new Error("Refusing to export: possible secret value detected");
  const duplicateIds = examples.filter((row, index) => examples.findIndex((candidate) => candidate.id === row.id) !== index);
  if (duplicateIds.length) throw new Error(`Duplicate example IDs: ${duplicateIds.map((row) => row.id).join(", ")}`);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "examples.jsonl"), `${serialized.join("\n")}\n`, "utf8");
  const toolContracts = Object.fromEntries(
    toolSources
      .flatMap((source) => Object.entries(source.schemas).map(([name, inputSchema]) => {
        const allowedRoles = (Object.keys(ROLE_AUTHORITY) as Role[])
          .filter((role) => ROLE_AUTHORITY[role].includes(name));
        const effect = toolEffect(name);
        return [name, {
          name,
          lane: source.lane,
          inputSchema,
          source: {
            path: path.relative(root, source.file).replaceAll("\\", "/"),
            sha256: sourceHashes.get(source.file)
          },
          allowedRoles,
          effect,
          modelCallable: effect === "none" && allowedRoles.length > 0
        }] as const;
      }))
      .sort(([left], [right]) => left.localeCompare(right))
  );
  const toolBundleMaterial = {
    schema: TOOL_BUNDLE_SCHEMA,
    authority: {
      modelOutputIsCandidateOnly: true,
      approvalSigningBroadcastExecutionHostOwned: true
    },
    contracts: toolContracts
  };
  const toolBundle = {
    ...toolBundleMaterial,
    bundleSha256: hash(stableJson(toolBundleMaterial))
  };
  const serializedToolBundle = `${JSON.stringify(toolBundle, null, 2)}\n`;
  await fs.writeFile(path.join(outputDir, "tool-contracts.json"), serializedToolBundle, "utf8");
  const countsByRole = Object.fromEntries(
    Object.keys(ROLE_AUTHORITY).map((role) => [role, examples.filter((row) => row.role === role).length])
  );
  const countsBySplit = Object.fromEntries(
    ["train", "validation", "test"].map((split) => [split, examples.filter((row) => row.split === split).length])
  );
  const manifest = {
    schema: OUTPUT_SCHEMA,
    generatedAt: new Date().toISOString(),
    generator: "scripts/export-bonsai-role-data.ts",
    totalExamples: examples.length,
    countsByRole,
    countsBySplit,
    secretValuesDetected: false,
    rawTranscriptsIncluded: false,
    authority: {
      modelOutputIsCandidateOnly: true,
      roles: ROLE_AUTHORITY,
      forbiddenEffects: FORBIDDEN_EFFECTS
    },
    sources: sourceFiles.map((file) => ({
      path: path.relative(root, file).replaceAll("\\", "/"),
      sha256: sourceHashes.get(file)
    })),
    examplesSha256: hash(`${serialized.join("\n")}\n`),
    toolContractsPath: "tool-contracts.json",
    toolContractsSha256: hash(serializedToolBundle),
    toolContractBundleSha256: toolBundle.bundleSha256,
    limitations: [
      "This is a small deterministic seed corpus, not enough by itself for a production adapter.",
      "No example grants approval, signing, broadcast, or secret access.",
      "A held-out live-model evaluation is required before adapter promotion."
    ]
  };
  await fs.writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputDir, ...manifest }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
