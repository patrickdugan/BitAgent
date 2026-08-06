import { canonicalHash, assessSurvival, evaluateSpendIntent } from "./policy.js";
import { verifySurvivalJournal } from "./journal.js";
import type {
  SpendIntent,
  SurvivalJournalRecord,
  SurvivalPolicy,
  TreasurySnapshot
} from "./types.js";

type JsonSchema = {
  type: "object";
  additionalProperties: false;
  required: string[];
  properties: Record<string, Record<string, unknown>>;
};

export type FinancialSurvivalState = {
  policy: SurvivalPolicy;
  snapshot: TreasurySnapshot;
  snapshotReceiptHash: string;
};

export type FinancialSurvivalToolHost = {
  loadState(): Promise<FinancialSurvivalState> | FinancialSurvivalState;
  loadJournal(uri: string): Promise<SurvivalJournalRecord[]> | SurvivalJournalRecord[];
  now(): Date;
};

type SurvivalEvidenceBinding = {
  policyId: string;
  policyHash: string;
  snapshotReceiptHash: string;
  snapshotHash: string;
  snapshotCapturedAt: string;
};

export type FinancialSurvivalAssessmentResult = {
  schema: "bitagent_survival_assessment_result_v1";
  authority: "deterministic_host";
  effect: "none";
  evaluatedAt: string;
  evidence: SurvivalEvidenceBinding;
  assessment: ReturnType<typeof assessSurvival>;
};

export type FinancialSurvivalDecisionResult = {
  schema: "bitagent_survival_policy_decision_result_v1";
  authority: "deterministic_host";
  effect: "none";
  evaluatedAt: string;
  evidence: SurvivalEvidenceBinding;
  decision: ReturnType<typeof evaluateSpendIntent>;
  walletApprovalRequested: false;
  signingPerformed: false;
  broadcastPerformed: false;
  executionPerformed: false;
};

export type FinancialSurvivalJournalResult = {
  schema: "bitagent_survival_journal_verification_v1";
  authority: "deterministic_host";
  effect: "none";
  journalUri: string;
  recordCount: number;
  observedHeadHash: string;
  expectedHeadHash: string;
  valid: boolean;
};

export class FinancialSurvivalToolError extends Error {
  constructor(
    readonly code:
      | "unknown_tool"
      | "invalid_arguments"
      | "evidence_binding_mismatch"
      | "journal_not_found",
    message: string
  ) {
    super(message);
    this.name = "FinancialSurvivalToolError";
  }
}

const hashSchema = { type: "string", pattern: "^[0-9a-f]{64}$" };
const policyBindingProperties = {
  policyId: { type: "string", minLength: 1, maxLength: 128 },
  policyHash: hashSchema,
  snapshotReceiptHash: hashSchema
};
const spendIntentSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "idempotencyKey",
    "purpose",
    "budget",
    "rail",
    "asset",
    "amountAtoms",
    "policyValueSats",
    "destination",
    "maxFeeSats",
    "expiresAt",
    "policyId"
  ],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 128 },
    idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
    purpose: { type: "string", enum: ["compute", "network", "storage", "security", "recovery", "strategy"] },
    budget: { type: "string", enum: ["operations", "strategy", "reserve"] },
    rail: {
      type: "string",
      enum: ["bitcoin_onchain", "lightning", "thorchain", "tradelayer", "fedimint", "ark", "dlc", "filecoin", "akash", "compute_market"]
    },
    asset: { type: "string", enum: ["BTC", "LTC", "ETH", "USDC", "FIL", "AKT", "ACT"] },
    amountAtoms: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
    policyValueSats: { type: "string", pattern: "^[1-9][0-9]*$" },
    destination: { type: "string", minLength: 1, maxLength: 512 },
    maxFeeSats: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
    maxSlippageBps: { type: "integer", minimum: 0, maximum: 10000 },
    expiresAt: { type: "string", format: "date-time" },
    policyId: { type: "string", minLength: 1, maxLength: 128 },
    quoteHash: hashSchema,
    sourceReceipts: {
      type: "array",
      maxItems: 16,
      items: hashSchema
    }
  }
};

export const financialSurvivalToolSchemas: Record<string, JsonSchema> = {
  "bitagent.survival.assess": {
    type: "object",
    additionalProperties: false,
    required: ["policyId", "policyHash", "snapshotReceiptHash"],
    properties: policyBindingProperties
  },
  "bitagent.survival.evaluate": {
    type: "object",
    additionalProperties: false,
    required: ["policyId", "policyHash", "snapshotReceiptHash", "intent"],
    properties: {
      ...policyBindingProperties,
      intent: spendIntentSchema
    }
  },
  "bitagent.survival.journal.verify": {
    type: "object",
    additionalProperties: false,
    required: ["journalUri", "expectedHeadHash"],
    properties: {
      journalUri: { type: "string", minLength: 1, maxLength: 512 },
      expectedHeadHash: hashSchema
    }
  }
};

const INTEGER = /^(0|[1-9][0-9]*)$/;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
const HASH = /^[0-9a-f]{64}$/;
const PURPOSES = new Set(["compute", "network", "storage", "security", "recovery", "strategy"]);
const BUDGETS = new Set(["operations", "strategy", "reserve"]);
const RAILS = new Set(["bitcoin_onchain", "lightning", "thorchain", "tradelayer", "fedimint", "ark", "dlc", "filecoin", "akash", "compute_market"]);
const ASSETS = new Set(["BTC", "LTC", "ETH", "USDC", "FIL", "AKT", "ACT"]);
const INTENT_KEYS = new Set(Object.keys(spendIntentSchema.properties));

function invalid(message: string): never {
  throw new FinancialSurvivalToolError("invalid_arguments", message);
}

function requireText(value: unknown, field: string, maximum = 128): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    invalid(`${field} must contain 1 to ${maximum} characters`);
  }
  return value;
}

function requireHash(value: unknown, field: string): string {
  const text = requireText(value, field, 64);
  if (!HASH.test(text)) invalid(`${field} must be a lowercase SHA-256 hash`);
  return text;
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  required: string[],
  label: string
) {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) invalid(`${label} contains unexpected fields: ${unexpected.join(", ")}`);
  const missing = required.filter((key) => value[key] === undefined);
  if (missing.length) invalid(`${label} is missing fields: ${missing.join(", ")}`);
}

function parseIntent(value: unknown): SpendIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("intent must be an object");
  const input = value as Record<string, unknown>;
  requireExactKeys(input, INTENT_KEYS, spendIntentSchema.required, "intent");
  const intent: SpendIntent = {
    id: requireText(input.id, "intent.id"),
    idempotencyKey: requireText(input.idempotencyKey, "intent.idempotencyKey"),
    purpose: requireText(input.purpose, "intent.purpose") as SpendIntent["purpose"],
    budget: requireText(input.budget, "intent.budget") as SpendIntent["budget"],
    rail: requireText(input.rail, "intent.rail") as SpendIntent["rail"],
    asset: requireText(input.asset, "intent.asset") as SpendIntent["asset"],
    amountAtoms: requireText(input.amountAtoms, "intent.amountAtoms"),
    policyValueSats: requireText(input.policyValueSats, "intent.policyValueSats"),
    destination: requireText(input.destination, "intent.destination", 512),
    maxFeeSats: requireText(input.maxFeeSats, "intent.maxFeeSats"),
    expiresAt: requireText(input.expiresAt, "intent.expiresAt"),
    policyId: requireText(input.policyId, "intent.policyId")
  };
  if (!PURPOSES.has(intent.purpose)) invalid("intent.purpose is unsupported");
  if (!BUDGETS.has(intent.budget)) invalid("intent.budget is unsupported");
  if (!RAILS.has(intent.rail)) invalid("intent.rail is unsupported");
  if (!ASSETS.has(intent.asset)) invalid("intent.asset is unsupported");
  if (!INTEGER.test(intent.amountAtoms)) invalid("intent.amountAtoms must be an unsigned integer string");
  if (!POSITIVE_INTEGER.test(intent.policyValueSats)) invalid("intent.policyValueSats must be positive");
  if (!INTEGER.test(intent.maxFeeSats)) invalid("intent.maxFeeSats must be an unsigned integer string");
  if (!Number.isFinite(Date.parse(intent.expiresAt))) invalid("intent.expiresAt must be a date-time");
  if (input.maxSlippageBps !== undefined) {
    if (!Number.isInteger(input.maxSlippageBps) || Number(input.maxSlippageBps) < 0 || Number(input.maxSlippageBps) > 10000) {
      invalid("intent.maxSlippageBps must be an integer from 0 to 10000");
    }
    intent.maxSlippageBps = Number(input.maxSlippageBps);
  }
  if (input.quoteHash !== undefined) intent.quoteHash = requireHash(input.quoteHash, "intent.quoteHash");
  if (input.sourceReceipts !== undefined) {
    if (!Array.isArray(input.sourceReceipts) || input.sourceReceipts.length > 16) {
      invalid("intent.sourceReceipts must contain at most 16 hashes");
    }
    intent.sourceReceipts = input.sourceReceipts.map((item, index) => requireHash(item, `intent.sourceReceipts[${index}]`));
  }
  return intent;
}

function validateTopLevel(name: string, args: Record<string, unknown>) {
  const schema = financialSurvivalToolSchemas[name];
  if (!schema) throw new FinancialSurvivalToolError("unknown_tool", `Unknown financial-survival tool: ${name}`);
  requireExactKeys(args, new Set(Object.keys(schema.properties)), schema.required, "tool arguments");
}

async function boundState(
  host: FinancialSurvivalToolHost,
  args: Record<string, unknown>
): Promise<FinancialSurvivalState & { policyHash: string; snapshotHash: string }> {
  const policyId = requireText(args.policyId, "policyId");
  const requestedPolicyHash = requireHash(args.policyHash, "policyHash");
  const requestedReceiptHash = requireHash(args.snapshotReceiptHash, "snapshotReceiptHash");
  const state = await host.loadState();
  const policyHash = canonicalHash(state.policy);
  if (
    policyId !== state.policy.id
    || requestedPolicyHash !== policyHash
    || requestedReceiptHash !== state.snapshotReceiptHash
  ) {
    throw new FinancialSurvivalToolError(
      "evidence_binding_mismatch",
      "Policy or treasury evidence changed; retrieve current host evidence before retrying"
    );
  }
  return { ...state, policyHash, snapshotHash: canonicalHash(state.snapshot) };
}

export class FinancialSurvivalToolRegistry {
  constructor(private readonly host: FinancialSurvivalToolHost) {}

  async call(name: "bitagent.survival.assess", args: Record<string, unknown>): Promise<FinancialSurvivalAssessmentResult>;
  async call(name: "bitagent.survival.evaluate", args: Record<string, unknown>): Promise<FinancialSurvivalDecisionResult>;
  async call(name: "bitagent.survival.journal.verify", args: Record<string, unknown>): Promise<FinancialSurvivalJournalResult>;
  async call(
    name: string,
    args: Record<string, unknown>
  ): Promise<FinancialSurvivalAssessmentResult | FinancialSurvivalDecisionResult | FinancialSurvivalJournalResult>;
  async call(
    name: string,
    args: Record<string, unknown>
  ): Promise<FinancialSurvivalAssessmentResult | FinancialSurvivalDecisionResult | FinancialSurvivalJournalResult> {
    validateTopLevel(name, args);
    if (name === "bitagent.survival.journal.verify") {
      const journalUri = requireText(args.journalUri, "journalUri", 512);
      const expectedHeadHash = requireHash(args.expectedHeadHash, "expectedHeadHash");
      let records: SurvivalJournalRecord[];
      try {
        records = await this.host.loadJournal(journalUri);
      } catch {
        throw new FinancialSurvivalToolError("journal_not_found", "The host could not resolve the requested journal URI");
      }
      const observedHeadHash = records.at(-1)?.hash || "0".repeat(64);
      const chainValid = verifySurvivalJournal(records);
      return {
        schema: "bitagent_survival_journal_verification_v1",
        authority: "deterministic_host",
        effect: "none",
        journalUri,
        recordCount: records.length,
        observedHeadHash,
        expectedHeadHash,
        valid: chainValid && observedHeadHash === expectedHeadHash
      };
    }

    const state = await boundState(this.host, args);
    const evaluatedAt = this.host.now();
    if (!(evaluatedAt instanceof Date) || !Number.isFinite(evaluatedAt.getTime())) {
      invalid("host clock returned an invalid date");
    }
    const evidence = {
      policyId: state.policy.id,
      policyHash: state.policyHash,
      snapshotReceiptHash: state.snapshotReceiptHash,
      snapshotHash: state.snapshotHash,
      snapshotCapturedAt: state.snapshot.capturedAt
    };
    if (name === "bitagent.survival.assess") {
      return {
        schema: "bitagent_survival_assessment_result_v1",
        authority: "deterministic_host",
        effect: "none",
        evaluatedAt: evaluatedAt.toISOString(),
        evidence,
        assessment: assessSurvival(state.snapshot, state.policy, evaluatedAt)
      };
    }

    const intent = parseIntent(args.intent);
    const decision = evaluateSpendIntent(intent, state.policy, state.snapshot, evaluatedAt);
    return {
      schema: "bitagent_survival_policy_decision_result_v1",
      authority: "deterministic_host",
      effect: "none",
      evaluatedAt: evaluatedAt.toISOString(),
      evidence,
      decision,
      walletApprovalRequested: false,
      signingPerformed: false,
      broadcastPerformed: false,
      executionPerformed: false
    };
  }
}
