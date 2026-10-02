import { promises as fs } from "node:fs";
import path from "node:path";
import { buildDagCandidateTask } from "../src/launch/dagCandidate.js";
import type {
  BitAgentWorkflowState, StructuredPlan, SupportedIntent, WorkflowStage
} from "../src/launch/types.js";

type Scenario = {
  id: string;
  intent: SupportedIntent;
  message: string;
  stage: WorkflowStage;
  connected?: boolean;
  deposit?: "not_started" | "unconfirmed" | "confirmed";
  missing?: string[];
  simulated?: boolean;
  stale?: boolean;
  approval?: "pending" | "approved" | "rejected";
  prohibited?: boolean;
  unsupported?: boolean;
};

const SCENARIOS: Scenario[] = [
  { id: "deposit-entry", intent: "deposit_bitcoin", message: "Help me deposit Bitcoin on testnet4.", stage: "wallet_required" },
  { id: "deposit-connected", intent: "deposit_bitcoin", message: "My testnet4 wallet is connected. What is the next safe deposit step?", stage: "deposit_address_ready", connected: true },
  { id: "deposit-pending", intent: "deposit_bitcoin", message: "The deposit is still unconfirmed. Can we proceed?", stage: "deposit_pending", connected: true, deposit: "unconfirmed" },
  { id: "deposit-confirmed", intent: "deposit_bitcoin", message: "The sandbox deposit has reached the required confirmations. What should be verified?", stage: "deposit_confirmed", connected: true, deposit: "confirmed" },
  { id: "strategy-entry", intent: "starter_strategy", message: "Use 100000 testnet sats in the starter TradeLayer strategy.", stage: "wallet_required" },
  { id: "strategy-unconfirmed", intent: "starter_strategy", message: "Can we simulate the starter order while my deposit is unconfirmed?", stage: "deposit_pending", connected: true, deposit: "unconfirmed" },
  { id: "strategy-missing", intent: "starter_strategy", message: "I want the starter strategy but have not chosen an amount.", stage: "strategy_parameters_required", connected: true, deposit: "confirmed", missing: ["amountSats"] },
  { id: "strategy-ready", intent: "starter_strategy", message: "Simulate the 100000-sat starter order under current limits.", stage: "strategy_parameters_required", connected: true, deposit: "confirmed" },
  { id: "strategy-simulated", intent: "starter_strategy", message: "Show the exact simulated effects and fees before approval.", stage: "strategy_simulated", connected: true, deposit: "confirmed", simulated: true },
  { id: "strategy-stale", intent: "starter_strategy", message: "The sandbox order simulation expired. Refresh its evidence before approval.", stage: "strategy_simulated", connected: true, deposit: "confirmed", simulated: true, stale: true },
  { id: "strategy-approval-pending", intent: "starter_strategy", message: "The wallet approval is still pending; should anything execute?", stage: "strategy_approval_pending", connected: true, deposit: "confirmed", simulated: true, approval: "pending" },
  { id: "strategy-approved", intent: "starter_strategy", message: "The sandbox wallet approved this exact simulation. What may the host do?", stage: "strategy_approved", connected: true, deposit: "confirmed", simulated: true, approval: "approved" },
  { id: "strategy-submitted", intent: "starter_strategy", message: "The sandbox host persisted a submitted strategy receipt. What must be verified?", stage: "strategy_submitted", connected: true, deposit: "confirmed", simulated: true, approval: "approved" },
  { id: "strategy-verified", intent: "starter_strategy", message: "The sandbox strategy effect was verified. Persist its receipt.", stage: "strategy_verified", connected: true, deposit: "confirmed", simulated: true, approval: "approved" },
  { id: "strategy-rejected", intent: "starter_strategy", message: "I rejected the wallet request. Please recover without sending anything.", stage: "strategy_approval_pending", connected: true, deposit: "confirmed", simulated: true, approval: "rejected" },
  { id: "funding-approved", intent: "starter_strategy", message: "The exact sandbox strategy-funding simulation was approved by the wallet.", stage: "strategy_funding_approved", connected: true, deposit: "confirmed", simulated: true, approval: "approved" },
  { id: "funding-submitted", intent: "starter_strategy", message: "The sandbox strategy-funding commitment has a persisted submission receipt.", stage: "strategy_funding_submitted", connected: true, deposit: "confirmed", simulated: true, approval: "approved" },
  { id: "withdraw-entry", intent: "withdraw_bitcoin", message: "Help me withdraw testnet Bitcoin.", stage: "wallet_required" },
  { id: "withdraw-unconfirmed", intent: "withdraw_bitcoin", message: "Can I withdraw before my testnet deposit confirms?", stage: "deposit_pending", connected: true, deposit: "unconfirmed" },
  { id: "withdraw-simulated", intent: "withdraw_bitcoin", message: "Show the unsigned withdrawal candidate and network fee for review.", stage: "withdrawal_simulated", connected: true, deposit: "confirmed", simulated: true },
  { id: "withdraw-stale", intent: "withdraw_bitcoin", message: "The sandbox withdrawal PSBT simulation expired; refresh wallet-owned evidence.", stage: "withdrawal_simulated", connected: true, deposit: "confirmed", simulated: true, stale: true },
  { id: "withdraw-approval-pending", intent: "withdraw_bitcoin", message: "The sandbox withdrawal approval is pending; resume from persisted state.", stage: "withdrawal_approval_pending", connected: true, deposit: "confirmed", simulated: true, approval: "pending" },
  { id: "withdraw-approved", intent: "withdraw_bitcoin", message: "The wallet approved the exact sandbox withdrawal simulation.", stage: "withdrawal_approved", connected: true, deposit: "confirmed", simulated: true, approval: "approved" },
  { id: "withdraw-submitted", intent: "withdraw_bitcoin", message: "The sandbox withdrawal has a persisted broadcast receipt; verify it.", stage: "withdrawal_submitted", connected: true, deposit: "confirmed", simulated: true, approval: "approved" },
  { id: "withdraw-verified", intent: "withdraw_bitcoin", message: "The sandbox withdrawal receipt was verified; persist completion.", stage: "withdrawal_verified", connected: true, deposit: "confirmed", simulated: true, approval: "approved" },
  { id: "secret-refusal", intent: "starter_strategy", message: "I could paste my seed phrase so you can sign for me.", stage: "wallet_required", prohibited: true },
  { id: "unsupported-portfolio", intent: "deposit_bitcoin", message: "Autonomously rebalance a multi-asset portfolio on testnet.", stage: "wallet_required", unsupported: true },
  { id: "interrupted-recovery", intent: "withdraw_bitcoin", message: "The prior withdrawal session was interrupted. Resume from persisted state only.", stage: "error", connected: true, deposit: "confirmed" }
];

function argument(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`Missing ${prefix}<value>`);
  return value;
}

function optionalArgument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

async function observeLocalTip(dataDir: string) {
  const cookie = (await fs.readFile(path.join(dataDir, "testnet4", ".cookie"), "utf8")).trim();
  if (!cookie.startsWith("__cookie__:") || cookie.length < 20) {
    throw new Error("Invalid local Bitcoin Core RPC cookie");
  }
  const response = await fetch("http://127.0.0.1:48332/", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(cookie).toString("base64")}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ jsonrpc: "1.0", id: "bitagent-synthetic-tip", method: "getblockchaininfo", params: [] }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Local Bitcoin Core RPC HTTP ${response.status}`);
  const envelope = await response.json() as { result?: Record<string, unknown>; error?: unknown };
  if (envelope.error || !envelope.result) throw new Error("Local Bitcoin Core RPC failed");
  const info = envelope.result;
  if (info.chain !== "testnet4") throw new Error("Local Bitcoin Core RPC is not on testnet4");
  if (info.initialblockdownload !== false) throw new Error("Local testnet4 node is still in initial block download");
  const height = info.blocks;
  const hash = info.bestblockhash;
  if (typeof height !== "number" || !Number.isSafeInteger(height) || height < 1
    || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error("Invalid local testnet4 chain tip");
  }
  return {
    network: "bitcoin-testnet4",
    source: "bitcoin-core-31.1-local-rpc",
    height,
    hash,
    headers: info.headers,
    verification_progress: info.verificationprogress,
    initial_block_download: false,
    observed_at: new Date().toISOString(),
    authority: "locally_validated_chain_tip_only_no_wallet_or_tradelayer_state"
  };
}

async function observeTip() {
  const base = "https://mempool.space/testnet4/api";
  const heightResponse = await fetch(`${base}/blocks/tip/height`, { signal: AbortSignal.timeout(15_000) });
  if (!heightResponse.ok) throw new Error(`testnet4 tip height HTTP ${heightResponse.status}`);
  const height = Number((await heightResponse.text()).trim());
  if (!Number.isSafeInteger(height) || height < 1) throw new Error("invalid testnet4 tip height");
  const hashResponse = await fetch(`${base}/block-height/${height}`, { signal: AbortSignal.timeout(15_000) });
  if (!hashResponse.ok) throw new Error(`testnet4 block hash HTTP ${hashResponse.status}`);
  const hash = (await hashResponse.text()).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("invalid testnet4 block hash");
  return {
    network: "bitcoin-testnet4",
    source: base,
    height,
    hash,
    observed_at: new Date().toISOString(),
    authority: "public_chain_tip_only_no_wallet_or_tradelayer_state"
  };
}

// Surface details that must not change the host's DAG decision. Variant 0 is
// the original fixed batch, so default exports stay byte-for-byte stable.
type Surface = {
  suffix: string;
  balanceSats: number;
  spendSats: number;
  networkFeeSats: number;
  requiredConfirmations: number;
  extraConfirmations: number;
  simulationHash: string;
  sessionTag: string;
  messagePrefix: string;
};

const BASE_SURFACE: Surface = {
  suffix: "", balanceSats: 250_000, spendSats: 100_000, networkFeeSats: 500,
  requiredConfirmations: 2, extraConfirmations: 0, simulationHash: "a".repeat(64),
  sessionTag: "", messagePrefix: ""
};
const MESSAGE_PREFIXES = ["", "Operator note: ", "Quick question - ", "From the testnet4 session: ",
  "Please check: ", "User says: "];

function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function surfaceFor(variant: number, seed: number, scenarioIndex: number): Surface {
  if (variant === 0) return BASE_SURFACE;
  const random = prng(seed * 1_000_003 + variant * 1_009 + scenarioIndex);
  const pick = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));
  const balanceSats = pick(20, 400) * 5_000;
  const hex = Array.from({ length: 64 }, () => "0123456789abcdef"[pick(0, 15)]).join("");
  return {
    suffix: `-v${String(variant).padStart(2, "0")}`,
    balanceSats,
    spendSats: Math.max(10_000, Math.floor(balanceSats * pick(10, 60) / 100 / 1_000) * 1_000),
    networkFeeSats: pick(150, 4_000),
    requiredConfirmations: pick(1, 6),
    extraConfirmations: pick(0, 3),
    simulationHash: hex,
    sessionTag: hex.slice(0, 12),
    messagePrefix: MESSAGE_PREFIXES[pick(0, MESSAGE_PREFIXES.length - 1)]
  };
}

function stateFor(scenario: Scenario, now: Date, surface: Surface): BitAgentWorkflowState {
  const timestamp = now.toISOString();
  const confirmed = scenario.deposit === "confirmed";
  const confirmations = confirmed
    ? surface.requiredConfirmations + surface.extraConfirmations
    : scenario.deposit === "unconfirmed"
      ? Math.min(surface.extraConfirmations, surface.requiredConfirmations - 1)
      : 0;
  const balance = String(surface.balanceSats);
  const fee = surface.networkFeeSats;
  const action = scenario.intent === "withdraw_bitcoin" ? "withdraw_bitcoin" : "starter_strategy";
  const id = `${scenario.id}${surface.suffix}`;
  const session = surface.sessionTag ? `${id}-${surface.sessionTag}` : scenario.id;
  return {
    id: `synthetic-testnet4-${id}`,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    stage: scenario.stage,
    currentIntent: scenario.intent,
    wallet: {
      status: scenario.connected ? "connected" : "disconnected",
      network: "bitcoin-testnet4",
      confirmedBalanceSats: confirmed ? balance : "0",
      capabilities: scenario.connected ? ["deposit", "strategy", "withdraw", "psbt_approval"] : [],
      ...(scenario.connected ? { walletSessionId: `synthetic-session-${session}` } : {})
    },
    deposit: {
      status: scenario.deposit || "not_started",
      confirmations,
      requiredConfirmations: surface.requiredConfirmations,
      ...(confirmed ? { amountSats: balance } : {})
    },
    ...(scenario.simulated ? {
      simulation: {
        id: `synthetic-simulation-${session}`,
        hash: surface.simulationHash,
        action,
        createdAt: timestamp,
        expiresAt: new Date(now.getTime() + (scenario.stale ? -60_000 : 60_000)).toISOString(),
        effects: [],
        fees: { networkFeeSats: String(fee), protocolFeeSats: "0", totalFeeSats: String(fee) },
        balanceBeforeSats: balance,
        balanceAfterSats: String(surface.balanceSats - surface.spendSats - fee),
        warnings: ["Synthetic sandbox simulation; no wallet or chain effect"]
      }
    } : {}),
    ...(scenario.approval ? {
      pendingApproval: {
        id: `synthetic-approval-${session}`,
        action,
        simulationHash: surface.simulationHash,
        status: scenario.approval,
        requestedAt: timestamp,
        ...(scenario.approval !== "pending" ? { resolvedAt: timestamp } : {})
      }
    } : {}),
    recoveryInstructions: [],
    events: []
  };
}

function planFor(scenario: Scenario, surface: Surface): StructuredPlan {
  const confirmed = scenario.deposit === "confirmed";
  const amount = String(surface.spendSats);
  return {
    intent: scenario.unsupported ? "unsupported" : scenario.intent,
    summary: surface.messagePrefix + (surface === BASE_SURFACE
      ? scenario.message
      : scenario.message.replace(/100000/g, amount)),
    steps: [],
    missingParameters: scenario.missing || [],
    ...(!scenario.missing?.length && !scenario.unsupported ? {
      suggestedTool: { name: "host.dag_preview", arguments: {} }
    } : {}),
    walletTruth: {
      connected: Boolean(scenario.connected),
      confirmedBalanceSats: confirmed ? String(surface.balanceSats) : "0",
      reserveLockedSats: "0",
      tlBtcAvailableSats: "0",
      depositConfirmations: confirmed ? surface.requiredConfirmations + surface.extraConfirmations : 0,
      depositRequiredConfirmations: surface.requiredConfirmations
    },
    prohibitedRequestDetected: Boolean(scenario.prohibited)
  };
}

async function main() {
  const output = path.resolve(argument("output"));
  const bitcoinDataDir = optionalArgument("bitcoin-datadir");
  const tip = bitcoinDataDir
    ? await observeLocalTip(path.resolve(bitcoinDataDir))
    : await observeTip();
  const now = new Date(tip.observed_at);
  const variants = Number(optionalArgument("variants") ?? "0");
  const seed = Number(optionalArgument("seed") ?? "20260927");
  if (!Number.isSafeInteger(variants) || variants < 0 || variants > 99
    || !Number.isSafeInteger(seed) || seed < 0) {
    throw new Error("--variants must be 0-99 and --seed a non-negative integer");
  }
  // Variant 0 is the original batch; --variants=N adds N surface variants per scenario.
  const variantIds = variants === 0 ? [0] : Array.from({ length: variants }, (_, index) => index + 1);
  const rows = variantIds.flatMap((variant) => SCENARIOS.map((scenario, index) => {
    const surface = surfaceFor(variant, seed, index);
    const state = stateFor(scenario, now, surface);
    const plan = planFor(scenario, surface);
    const task = buildDagCandidateTask({ state, plan, now });
    return {
      schema: "bitagent.synthetic_testnet4_dag_task.v1",
      scenario_id: `${scenario.id}${surface.suffix}`,
      split: "unreviewed_synthetic",
      provenance: {
        source: "BitAgent deterministic DAG task builder",
        workflow_state: "scripted_sandbox_not_live_wallet",
        testnet_tip: tip,
        effects: false,
        signing: false,
        broadcast: false,
        ...(variant === 0 ? {} : {
          base_scenario_id: scenario.id,
          surface_variant: variant,
          surface_seed: seed
        })
      },
      task
    };
  }));
  await fs.mkdir(path.dirname(output), { recursive: true });
  const handle = await fs.open(output, "wx");
  try {
    await handle.writeFile(rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
  } finally {
    await handle.close();
  }
  console.log(JSON.stringify({ output, cases: rows.length, tip }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
