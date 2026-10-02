import { moneyGuardrails, pluginConfig, researchGuardrails } from "./config.js";
import { ChatGptPluginError } from "./errors.js";
import { buildMoneyPlan, type MoneyPlanInput } from "./moneyPlan.js";
import { PracticeSandbox } from "./practiceSandbox.js";
import { assertMatches, type ObjectSchema, type Schema } from "./schema.js";
import { buildSelfHostPlan, type SelfHostPlatform } from "./selfHostPlan.js";
import {
  buildResearchBrief,
  COVENANT_BOUNDS,
  POLICY_HINTS,
  runStrategyStressTest,
  type CovenantDraft,
  type StressScenario
} from "./strategyResearch.js";

type ToolResult = { summary: string; structuredContent: Record<string, unknown> };

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: ObjectSchema;
  // false only for the practice tools, which write scripted sandbox state.
  readOnly: boolean;
  widget: boolean;
  invoking: string;
  invoked: string;
  run(args: Record<string, unknown>): Promise<ToolResult> | ToolResult;
};

const SATS = "^[1-9][0-9]*$";
const USD = "^(0|[1-9][0-9]*)(\\.[0-9]{1,2})?$";
const PRICE = "^[1-9][0-9]*(\\.[0-9]{1,2})?$";
const ID = "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$";
const noArguments: ObjectSchema = { type: "object", properties: {}, required: [], additionalProperties: false };
const bps = (bounds: { minimum: number; maximum: number }, description: string): Schema =>
  ({ type: "integer", minimum: bounds.minimum, maximum: bounds.maximum, description });

const covenantDraftSchema: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mandateId", "capitalCapUsd", "strategies", "absoluteMaxDriftBps", "risk"],
  properties: {
    mandateId: { type: "string", pattern: ID, description: "Short identifier for this research draft, e.g. btc-range-maker-v1." },
    capitalCapUsd: { type: "string", pattern: USD, description: "Hypothetical tlUSD capital ceiling, e.g. 1000.00." },
    strategies: {
      type: "array",
      minItems: COVENANT_BOUNDS.strategies.minimum,
      maxItems: COVENANT_BOUNDS.strategies.maximum,
      description: "Named strategy modules. Weights must total exactly 10000 bps.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["strategyId", "weightBps"],
        properties: {
          strategyId: { type: "string", pattern: ID },
          weightBps: bps(COVENANT_BOUNDS.weightBps, "Share of the mandate in basis points.")
        }
      }
    },
    absoluteMaxDriftBps: bps(COVENANT_BOUNDS.absoluteMaxDriftBps, "No order is proposed while net delta is within this distance of target."),
    risk: {
      type: "object",
      additionalProperties: false,
      required: [
        "maxGrossLeverageBps", "maxNetDeltaBps", "maxOrderFractionNavBps", "maxDailyLossBps",
        "maxDrawdownBps", "maxSlippageBps", "maxNetworkFeeSats"
      ],
      properties: {
        maxGrossLeverageBps: bps(COVENANT_BOUNDS.maxGrossLeverageBps, "Gross exposure cap; 10000 is 1x, the maximum on this surface."),
        maxNetDeltaBps: bps(COVENANT_BOUNDS.maxNetDeltaBps, "Largest allowed net BTC exposure, either direction."),
        maxOrderFractionNavBps: bps(COVENANT_BOUNDS.maxOrderFractionNavBps, "Largest single order as a share of capital."),
        maxDailyLossBps: bps(COVENANT_BOUNDS.maxDailyLossBps, "Daily loss at which the target is forced to neutral."),
        maxDrawdownBps: bps(COVENANT_BOUNDS.maxDrawdownBps, "Drawdown at which the target is forced to neutral."),
        maxSlippageBps: bps(COVENANT_BOUNDS.maxSlippageBps, "Slippage ceiling."),
        maxNetworkFeeSats: { type: "string", pattern: "^(0|[1-9][0-9]*)$", description: "Largest acceptable network fee in sats." }
      }
    }
  }
};

const scenarioSchema: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["label", "market", "portfolio", "targets"],
  properties: {
    label: { type: "string", pattern: ID, description: "Short identifier, e.g. gap-down-10pct." },
    market: {
      type: "object",
      additionalProperties: false,
      required: ["bidPriceUsd", "askPriceUsd", "markPriceUsd"],
      properties: {
        bidPriceUsd: { type: "string", pattern: PRICE },
        askPriceUsd: { type: "string", pattern: PRICE },
        markPriceUsd: { type: "string", pattern: PRICE, description: "Must lie between bid and ask." }
      }
    },
    portfolio: {
      type: "object",
      additionalProperties: false,
      required: ["capitalUsd", "currentNetDeltaBps", "grossLeverageBps", "dailyLossBps", "drawdownBps"],
      properties: {
        capitalUsd: { type: "string", pattern: USD },
        currentNetDeltaBps: bps(COVENANT_BOUNDS.targetNetDeltaBps, "Current net BTC exposure."),
        grossLeverageBps: { type: "integer", minimum: 0, maximum: 50_000 },
        dailyLossBps: { type: "integer", minimum: 0, maximum: 10_000 },
        drawdownBps: { type: "integer", minimum: 0, maximum: 10_000 }
      }
    },
    targets: {
      type: "array",
      minItems: 1,
      maxItems: COVENANT_BOUNDS.strategies.maximum,
      description: "Exactly one target per strategy in the draft.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["strategyId", "targetNetDeltaBps", "policyHint"],
        properties: {
          strategyId: { type: "string", pattern: ID },
          targetNetDeltaBps: bps(COVENANT_BOUNDS.targetNetDeltaBps, "What this strategy would want net exposure to be."),
          policyHint: { type: "string", enum: POLICY_HINTS }
        }
      }
    },
    networkFeeSats: { type: "string", pattern: "^(0|[1-9][0-9]*)$" }
  }
};

function buildOverview() {
  return {
    kind: "overview" as const,
    product: "BitAgent",
    stage: "candidate-only testnet/scripted MVP",
    oneLine: "A self-hosted agent that helps you deposit Bitcoin, try one starter TradeLayer strategy, and withdraw. Every action is simulated first and happens only after you approve it in your own wallet.",
    supportedIntents: [
      "Help me deposit Bitcoin.",
      "Use part of my Bitcoin in the starter TradeLayer strategy.",
      "Help me withdraw my Bitcoin."
    ],
    starterStrategy: "One post-only tlBTC-for-tlUSD limit order. It may stay open and is never guaranteed to fill.",
    journey: [
      { step: 1, where: "ChatGPT", title: "Set your own money limits", tool: "bitagent_money_plan" },
      { step: 2, where: "ChatGPT", title: "Rehearse with pretend testnet coins", tool: "bitagent_practice_start" },
      { step: 3, where: "Your device", title: "Download and run your own BitAgent", tool: "bitagent_self_host_plan" },
      { step: 4, where: "Your device", title: "Simulate, then approve in your own wallet" },
      { step: 5, where: "ChatGPT", title: "Research trading-system ideas against the real risk engine", tool: "bitagent_research_brief" }
    ],
    authorityBoundary: {
      chatgptMay: ["explain", "collect the person's own answers", "ask the host to simulate", "draft research candidates"],
      chatgptNever: [
        "ask for or accept a seed phrase, private key, mnemonic, or WIF",
        "approve, sign, broadcast, or execute anything",
        "invent a balance, quote, confirmation, or transaction",
        "recommend what to buy or how much to invest",
        "suggest VPNs or other ways around a regional restriction"
      ],
      onlyTheWalletUserCan: "approve the exact simulated action, on their self-hosted BitAgent"
    },
    sessionDefaults: {
      compliance_state: "UNKNOWN",
      trading_permission: "NONE",
      referral_permission: "LINK_ONLY",
      leverage_permission: "NONE"
    },
    fundedExecutionAllowed: false as const,
    authority: "deterministic_host" as const,
    effect: "none" as const
  };
}

export class ChatGptToolRegistry {
  private readonly tools: Map<string, ToolDefinition>;

  constructor(options: { practice?: PracticeSandbox; now?: () => Date; modelLockPath?: string } = {}) {
    const practice = options.practice || new PracticeSandbox();
    const now = options.now || (() => new Date());
    const definitions: ToolDefinition[] = [
      {
        name: "bitagent_overview",
        title: "What BitAgent is",
        description: "Use this first, or whenever someone asks what BitAgent is, whether it is safe, or how to get started. Returns the product facts, the onboarding journey, and the rules you must follow. Never describe BitAgent from memory.",
        inputSchema: noArguments,
        readOnly: true,
        widget: true,
        invoking: "Opening BitAgent",
        invoked: "BitAgent overview ready",
        run: () => ({ summary: "BitAgent overview. Funded execution is disabled; this is a testnet MVP.", structuredContent: buildOverview() })
      },
      {
        name: "bitagent_self_host_plan",
        title: "Download and self-host BitAgent",
        description: "Use this when someone wants to download, install, or run BitAgent on their own computer or Android phone. Returns the exact ordered steps and commands for their platform. Ask which device they use first. Walk them through one step at a time, and state any stub in the result plainly instead of inventing a download link.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["platform"],
          properties: {
            platform: { type: "string", enum: ["windows", "macos", "linux", "android"], description: "The device the person told you they use." },
            includeLocalModel: { type: "boolean", description: "True to include the optional on-device model download details (Android)." }
          }
        },
        readOnly: true,
        widget: true,
        invoking: "Building your setup steps",
        invoked: "Setup steps ready",
        run: async (args) => {
          const plan = await buildSelfHostPlan({
            platform: args.platform as SelfHostPlatform,
            includeLocalModel: args.includeLocalModel === true,
            modelLockPath: options.modelLockPath
          });
          return {
            summary: `Self-host plan for ${plan.platform}: ${plan.steps.length} steps, ${plan.stubs.length} not yet self-serve.`,
            structuredContent: plan
          };
        }
      },
      {
        name: "bitagent_money_plan",
        title: "Set your money limits",
        description: "Use this for the money-management conversation before anyone brings bitcoin to BitAgent. Call it with only the answers the person has actually given; it returns the next exact question to ask, a hold, or their own limits computed deterministically. Never guess an answer, never recommend an amount, and never restate the result as investment advice.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: [],
          properties: {
            fundsBorrowedOrNeededSoon: { type: "boolean", description: "The person's answer: is any of this money borrowed or needed for essentials soon?" },
            emergencyFundMonths: { type: "integer", minimum: 0, maximum: 600, description: "The person's answer: months of living expenses saved outside crypto." },
            highInterestDebt: { type: "boolean", description: "The person's answer: do they carry high-interest debt?" },
            budgetSats: { type: "string", pattern: SATS, maxLength: 16, description: "The person's answer, in sats: what they could lose entirely without hardship." },
            strategyShareBps: {
              type: "integer",
              minimum: 1,
              maximum: moneyGuardrails.maxStrategyShareBps,
              description: "Optional. The share of the budget the person wants the starter strategy to be able to use, in basis points."
            },
            userDeclaredBtcPriceUsd: { type: "string", pattern: PRICE, description: "Optional. A BTC price the person stated, used only to show rough dollar figures. Never supply one yourself." },
            userStatements: {
              type: "array",
              maxItems: 8,
              description: "Optional. Short verbatim phrases (under 12 words) the person said about this money, screened for signs of financial pressure.",
              items: { type: "string", minLength: 1, maxLength: 160 }
            }
          }
        },
        readOnly: true,
        widget: true,
        invoking: "Checking your limits",
        invoked: "Limits checked",
        run: (args) => {
          const plan = buildMoneyPlan(args as MoneyPlanInput);
          return { summary: `Money plan status: ${plan.status}. ${plan.summary}`, structuredContent: plan };
        }
      },
      {
        name: "bitagent_practice_start",
        title: "Start a practice run",
        description: "Use this when someone wants to see how BitAgent works before installing it. Creates a scripted rehearsal with a pretend wallet and a pretend confirmed testnet deposit. Nothing real is created; always say so.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["practiceDepositSats"],
          properties: {
            practiceDepositSats: { type: "string", pattern: SATS, maxLength: 9, description: "Pretend deposit size in sats, e.g. 250000." }
          }
        },
        readOnly: false,
        widget: true,
        invoking: "Setting up a practice run",
        invoked: "Practice run ready",
        run: async (args) => {
          const state = await practice.start({ practiceDepositSats: String(args.practiceDepositSats) });
          return { summary: `Practice run ${state.workflowId} started with a pretend ${state.deposit.amountSats}-sat deposit.`, structuredContent: state };
        }
      },
      {
        name: "bitagent_practice_simulate",
        title: "Rehearse an action",
        description: "Use this inside a practice run to simulate the starter strategy or a withdrawal. Returns the exact effects and fees the host computed. Show them as given, then stop: approval is only possible in the person's own wallet on their self-hosted BitAgent, and you must never say an action was approved or executed.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["workflowId", "action", "amountSats"],
          properties: {
            workflowId: { type: "string", minLength: 1, maxLength: 128 },
            action: { type: "string", enum: ["starter_strategy", "withdraw_bitcoin"] },
            amountSats: { type: "string", pattern: SATS, maxLength: 9 },
            destinationAddress: { type: "string", minLength: 14, maxLength: 90, description: "Required for withdraw_bitcoin: a Bitcoin testnet4 address the person provided." }
          }
        },
        readOnly: false,
        widget: true,
        invoking: "Simulating",
        invoked: "Simulation ready",
        run: async (args) => {
          const state = await practice.simulate(args as Parameters<PracticeSandbox["simulate"]>[0]);
          return {
            summary: `Simulated ${state.simulation?.action}. Fee ${state.simulation?.fees.totalFeeSats} sats. Nothing was approved or executed.`,
            structuredContent: state
          };
        }
      },
      {
        name: "bitagent_practice_status",
        title: "Check a practice run",
        description: "Use this to re-read a practice run's current scripted state instead of recalling it from the conversation.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["workflowId"],
          properties: { workflowId: { type: "string", minLength: 1, maxLength: 128 } }
        },
        readOnly: true,
        widget: true,
        invoking: "Reading the practice run",
        invoked: "Practice run loaded",
        run: async (args) => {
          const state = await practice.status(String(args.workflowId));
          return { summary: `Practice run ${state.workflowId} is at ${state.stage}.`, structuredContent: state };
        }
      },
      {
        name: "bitagent_research_brief",
        title: "Trading-system research rules",
        description: "Use this before researching or designing any trading system for BitAgent. Returns the Strategy Covenant limits, the allocation math, the research protocol to follow, and what a replay does not prove.",
        inputSchema: noArguments,
        readOnly: true,
        widget: false,
        invoking: "Loading research rules",
        invoked: "Research rules loaded",
        run: () => ({ summary: "Strategy Covenant research brief. Candidates only; nothing here is executable.", structuredContent: buildResearchBrief() })
      },
      {
        name: "bitagent_research_stress_test",
        title: "Stress-test a strategy idea",
        description: "Use this to check a trading-system idea you researched. Express it as a covenant draft plus hypothetical scenarios; the host validates the draft and runs BitAgent's real allocator and verifier on each scenario. Scenario numbers are yours, not market data: present results as what-if outcomes, never as a backtest, forecast, or recommendation.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["covenantDraft"],
          properties: {
            covenantDraft: covenantDraftSchema,
            scenarios: { type: "array", maxItems: researchGuardrails.maxScenarios, items: scenarioSchema }
          }
        },
        readOnly: true,
        widget: true,
        invoking: "Running the risk engine",
        invoked: "Stress test complete",
        run: (args) => {
          const result = runStrategyStressTest({
            covenantDraft: args.covenantDraft as CovenantDraft,
            scenarios: args.scenarios as StressScenario[] | undefined
          }, now());
          return {
            summary: result.draftStatus === "valid"
              ? `Draft valid. ${result.summary.replayed} scenarios replayed, ${result.summary.rejected} rejected. Hypothetical only.`
              : `Draft rejected: ${result.reasonCode}. ${result.message}`,
            structuredContent: result
          };
        }
      }
    ];
    this.tools = new Map(definitions.map((tool) => [tool.name, tool]));
  }

  list() {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: {
        title: tool.title,
        readOnlyHint: tool.readOnly,
        destructiveHint: false,
        idempotentHint: tool.readOnly,
        openWorldHint: false
      },
      _meta: {
        ...(tool.widget
          ? { ui: { resourceUri: pluginConfig.widgetUri }, "openai/outputTemplate": pluginConfig.widgetUri }
          : {}),
        "openai/toolInvocation/invoking": tool.invoking,
        "openai/toolInvocation/invoked": tool.invoked
      }
    }));
  }

  async call(name: string, args: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) throw new ChatGptPluginError("unknown_tool", `Unknown tool: ${name}`);
    const input = args === undefined || args === null ? {} : args;
    assertMatches(tool.inputSchema, input);
    return tool.run(input as Record<string, unknown>);
  }
}
