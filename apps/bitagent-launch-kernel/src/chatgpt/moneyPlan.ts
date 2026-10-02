import { vulnerabilitySessionState } from "../compliance/marketing.js";
import { hashObject, parseDecimal } from "../launch/canonical.js";
import { containsSecretMaterial } from "../launch/intent.js";
import { moneyGuardrails } from "./config.js";
import { ChatGptPluginError } from "./errors.js";

export type MoneyPlanInput = {
  budgetSats?: string;
  emergencyFundMonths?: number;
  highInterestDebt?: boolean;
  fundsBorrowedOrNeededSoon?: boolean;
  strategyShareBps?: number;
  userDeclaredBtcPriceUsd?: string;
  userStatements?: string[];
};

export type MoneyPlanReason =
  | "financial_vulnerability_signal"
  | "funds_borrowed_or_needed_soon"
  | "emergency_fund_below_minimum"
  | "high_interest_debt_declared"
  | "budget_below_fee_buffer";

// The exact questions ChatGPT must ask the person. The host never infers an
// answer, and the model is told not to either.
const QUESTIONS: Array<{ field: keyof MoneyPlanInput; ask: string }> = [
  {
    field: "fundsBorrowedOrNeededSoon",
    ask: "Is any of this money borrowed, or needed for rent, food, or bills in the next few months?"
  },
  {
    field: "emergencyFundMonths",
    ask: "Outside of crypto, about how many months of living expenses do you have set aside?"
  },
  {
    field: "highInterestDebt",
    ask: "Do you currently carry high-interest debt, such as credit-card balances or payday loans?"
  },
  {
    field: "budgetSats",
    ask: "How much bitcoin, in sats, could you lose entirely without it touching your bills or savings? (100,000,000 sats is 1 BTC.)"
  }
];

const ALWAYS_AVAILABLE = ["explanation", "self_host_setup", "practice_sandbox", "self_custody_education"] as const;

function base(status: string, reasonCodes: MoneyPlanReason[]) {
  return {
    kind: "money_plan" as const,
    status,
    reasonCodes,
    policyId: moneyGuardrails.policyId,
    network: "bitcoin-testnet4" as const,
    fundedExecutionAllowed: false as const,
    stillAvailable: [...ALWAYS_AVAILABLE],
    authority: "deterministic_host" as const,
    effect: "none" as const
  };
}

export function buildMoneyPlan(input: MoneyPlanInput) {
  const statements = input.userStatements || [];
  if (statements.some(containsSecretMaterial)) {
    throw new ChatGptPluginError(
      "secret_material_prohibited",
      "Statements must be short phrases under 12 words and must never contain a seed phrase, private key, mnemonic, or WIF. BitAgent never needs them."
    );
  }
  const session = vulnerabilitySessionState(statements);
  if (session.financial_vulnerability_signal || input.fundsBorrowedOrNeededSoon === true) {
    return {
      ...base("hold_view_only", [
        ...(session.financial_vulnerability_signal ? ["financial_vulnerability_signal" as const] : []),
        ...(input.fundsBorrowedOrNeededSoon === true ? ["funds_borrowed_or_needed_soon" as const] : [])
      ]),
      summary: "This money should stay where it is. BitAgent stays in setup and view-only mode: you can still learn how it works and rehearse with valueless testnet coins.",
      session
    };
  }

  const missing = QUESTIONS.filter(({ field }) => input[field] === undefined);
  if (missing.length) {
    return {
      ...base("needs_answers", []),
      summary: "Ask the person the next question exactly, one at a time. Do not guess or assume an answer.",
      questions: missing
    };
  }

  const reasons: MoneyPlanReason[] = [];
  if (Number(input.emergencyFundMonths) < moneyGuardrails.minimumEmergencyFundMonths) {
    reasons.push("emergency_fund_below_minimum");
  }
  if (input.highInterestDebt === true) reasons.push("high_interest_debt_declared");
  const budget = BigInt(String(input.budgetSats));
  const strategyShareBps = input.strategyShareBps ?? moneyGuardrails.defaultStrategyShareBps;
  const afterFees = budget > moneyGuardrails.feeBufferSats ? budget - moneyGuardrails.feeBufferSats : 0n;
  const strategyCap = afterFees * BigInt(strategyShareBps) / 10_000n;
  if (strategyCap < 1n) reasons.push("budget_below_fee_buffer");
  if (reasons.length) {
    return {
      ...base("practice_only", reasons),
      summary: "The guardrails are not met, so no spending limits were set. Rehearsing with valueless testnet coins is still available.",
      guardrails: {
        minimumEmergencyFundMonths: moneyGuardrails.minimumEmergencyFundMonths,
        feeBufferSats: moneyGuardrails.feeBufferSats.toString()
      }
    };
  }

  const keep = afterFees - strategyCap;
  const limits = {
    budgetSats: budget.toString(),
    feeBufferSats: moneyGuardrails.feeBufferSats.toString(),
    strategyCapSats: strategyCap.toString(),
    keepSpendableSats: keep.toString(),
    strategyShareBps,
    strategyShareSource: input.strategyShareBps === undefined ? "guardrail_default" as const : "user_declared" as const,
    maxStrategyShareBps: moneyGuardrails.maxStrategyShareBps
  };
  const priceCents = input.userDeclaredBtcPriceUsd
    ? parseDecimal(input.userDeclaredBtcPriceUsd, 2, "userDeclaredBtcPriceUsd")
    : undefined;
  const usd = (sats: bigint) => {
    const cents = sats * (priceCents as bigint) / 100_000_000n;
    return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
  };
  return {
    ...base("limits_recorded", []),
    summary: "These are the person's own limits, computed from their answers. They are a rehearsal on Bitcoin testnet4; this release cannot move real funds.",
    limits,
    approxUsd: priceCents === undefined ? undefined : {
      source: "user_declared_price_not_a_quote" as const,
      budget: usd(budget),
      strategyCap: usd(strategyCap),
      keepSpendable: usd(keep)
    },
    rules: [
      `Bring at most ${limits.budgetSats} sats to BitAgent.`,
      `The starter strategy may use at most ${limits.strategyCapSats} sats.`,
      `${limits.keepSpendableSats} sats stay as plain spendable Bitcoin in your own wallet.`,
      `${limits.feeBufferSats} sats are set aside for network fees.`,
      "Every action is simulated first and happens only after you approve it in your own wallet."
    ],
    planHash: hashObject({ policyId: moneyGuardrails.policyId, limits }),
    handoff: {
      where: "your self-hosted BitAgent",
      sayThis: `Use ${limits.strategyCapSats} sats in the starter TradeLayer strategy.`
    }
  };
}
