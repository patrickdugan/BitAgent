import { createRequire } from "node:module";
import crypto from "node:crypto";
import path from "node:path";
import { externalRepos } from "../config.js";
import { formatUnits, hashObject, opaqueId, parseDecimal } from "./canonical.js";
import { validateBitcoinAddress } from "./bitcoin.js";
import { LaunchKernelError } from "./errors.js";
import { verifyReserveIntakePlan, type ReserveIntakePlan } from "./reserveIntake.js";
import type {
  QuoteSnapshot,
  StarterOrderPlan,
  StarterStrategyParameters,
  TransactionSimulation,
  WalletReserveIntakeCandidate,
  WalletStarterOrderCandidate,
  WalletWithdrawalCandidate
} from "./types.js";

const require = createRequire(import.meta.url);
const encoder = require(path.join(externalRepos.tradelayer, "src", "txEncoder.js"));

function asciiNormalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(asciiNormalize);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .forEach((key) => { output[key] = asciiNormalize((value as Record<string, unknown>)[key]); });
    return output;
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

export function hashStarterOrderProtocolObject(value: unknown): string {
  return crypto.createHash("sha256")
    .update(JSON.stringify(asciiNormalize(value)))
    .digest("hex");
}

type StrategySimulationInput = {
  amountSats: string;
  balanceSats: string;
  tlBtcAvailableSats: string;
  networkFeeSats: string;
  quote: QuoteSnapshot;
  now: Date;
  offeredPropertyId?: number;
  desiredPropertyId?: number;
  starterOrderPlan: StarterOrderPlan;
  walletCandidate: WalletStarterOrderCandidate;
};

type StarterOrderPlanInput = {
  workflowId: string;
  walletSessionId: string;
  walletAddress: string;
  network: "bitcoin" | "bitcoin-testnet4";
  amountSats: string;
  quote: QuoteSnapshot;
  offeredPropertyId?: number;
  desiredPropertyId?: number;
};

function starterTerms(input: Pick<StarterOrderPlanInput,
  "amountSats" | "quote" | "offeredPropertyId" | "desiredPropertyId">) {
  const amountSats = BigInt(input.amountSats);
  if (amountSats <= 0n) throw new Error("amountSats must be positive");
  const priceCents = parseDecimal(input.quote.priceUsd, 2, "priceUsd");
  const expectedTlUsdAtoms = amountSats * priceCents / 100n;
  const strategy: StarterStrategyParameters = {
    strategyId: "starter-tlbtc-tlusd-limit-v1",
    amountSats: amountSats.toString(),
    limitPriceUsd: input.quote.priceUsd,
    expectedTlUsdAtoms: expectedTlUsdAtoms.toString(),
    postOnly: true,
    offeredPropertyId: input.offeredPropertyId || 1,
    desiredPropertyId: input.desiredPropertyId || 2
  };
  const payload = String(encoder.encodeOnChainTokenForToken({
    propertyIdOffered: strategy.offeredPropertyId,
    propertyIdDesired: strategy.desiredPropertyId,
    amountOffered: formatUnits(amountSats, 8),
    amountExpected: formatUnits(expectedTlUsdAtoms, 8),
    stop: false,
    post: true
  }));
  if (!payload.startsWith("tl5")) throw new Error("TradeLayer encoder did not return a type-5 payload");
  return { amountSats, expectedTlUsdAtoms, strategy, payload };
}

export function verifyStarterOrderPlan(plan: StarterOrderPlan): boolean {
  try {
    if (plan?.schema !== "bitagent_starter_order_plan_v1" || plan.network !== "bitcoin-testnet4") return false;
    validateBitcoinAddress(plan.walletAddress, plan.network);
    const terms = starterTerms({
      amountSats: plan.strategy.amountSats,
      quote: plan.quote,
      offeredPropertyId: plan.strategy.offeredPropertyId,
      desiredPropertyId: plan.strategy.desiredPropertyId
    });
    const { planHash: _planHash, ...core } = plan;
    return plan.strategy.strategyId === "starter-tlbtc-tlusd-limit-v1"
      && plan.strategy.postOnly === true
      && plan.strategy.offeredPropertyId !== plan.strategy.desiredPropertyId
      && hashObject(plan.strategy) === hashObject(terms.strategy)
      && plan.tradeLayer.transactionType === 5
      && plan.tradeLayer.payload === terms.payload
      && plan.tradeLayer.payloadHex === Buffer.from(terms.payload, "utf8").toString("hex")
      && plan.tradeLayer.payloadBytes === Buffer.byteLength(terms.payload, "utf8")
      && plan.tradeLayer.payloadBytes > 0 && plan.tradeLayer.payloadBytes <= 80
      && plan.requiredOutputOrder.length === 2
      && plan.requiredOutputOrder[0].vout === 0
      && plan.requiredOutputOrder[0].kind === "tradelayer_op_return"
      && plan.requiredOutputOrder[0].payloadHex === plan.tradeLayer.payloadHex
      && plan.requiredOutputOrder[1].vout === 1
      && plan.requiredOutputOrder[1].kind === "wallet_change"
      && Array.isArray(plan.preconditions) && plan.preconditions.length > 0
      && Date.parse(plan.quote.expiresAt) > Date.parse(plan.quote.quotedAt)
      && hashStarterOrderProtocolObject(core) === plan.planHash;
  } catch {
    return false;
  }
}

export function buildStarterOrderPlan(input: StarterOrderPlanInput): StarterOrderPlan {
  if (input.network !== "bitcoin-testnet4") {
    throw new LaunchKernelError("validation_error", "Starter-order wallet candidates currently require Bitcoin testnet4");
  }
  const walletAddress = validateBitcoinAddress(input.walletAddress, input.network).address;
  const terms = starterTerms(input);
  const payloadHex = Buffer.from(terms.payload, "utf8").toString("hex");
  const core = {
    schema: "bitagent_starter_order_plan_v1" as const,
    network: "bitcoin-testnet4" as const,
    workflowId: input.workflowId,
    walletSessionId: input.walletSessionId,
    walletAddress,
    quote: input.quote,
    strategy: terms.strategy,
    tradeLayer: {
      transactionType: 5 as const,
      payload: terms.payload,
      payloadHex,
      payloadBytes: Buffer.byteLength(terms.payload, "utf8")
    },
    requiredOutputOrder: [
      { vout: 0 as const, kind: "tradelayer_op_return" as const, payloadHex },
      { vout: 1 as const, kind: "wallet_change" as const }
    ] as StarterOrderPlan["requiredOutputOrder"],
    preconditions: [
      "Independent TradeLayer nodes must prove tx5 activation, code identity, intended properties, and fresh state.",
      "Verified tlBTC availability must cover the offered amount and the quote must remain fresh.",
      "The wallet must approve this exact post-only payload, carrier input, fee, and wallet-owned change."
    ]
  };
  const plan = { ...core, planHash: hashStarterOrderProtocolObject(core) };
  if (!verifyStarterOrderPlan(plan)) {
    throw new LaunchKernelError("validation_error", "Starter-order plan failed deterministic verification");
  }
  return plan;
}

export function simulateStarterStrategy(input: StrategySimulationInput): TransactionSimulation {
  try {
    const amountSats = BigInt(input.amountSats);
    const balance = BigInt(input.balanceSats);
    const tlBtcAvailable = BigInt(input.tlBtcAvailableSats);
    const networkFee = BigInt(input.networkFeeSats);
    if (amountSats <= 0n) throw new Error("amountSats must be positive");
    if (amountSats > tlBtcAvailable) {
      throw new LaunchKernelError("insufficient_funds", "Verified tlBTC availability cannot cover the strategy amount");
    }
    if (networkFee > balance) {
      throw new LaunchKernelError("insufficient_funds", "Spendable Bitcoin cannot cover the strategy carrier fee");
    }
    if (input.now.getTime() >= new Date(input.quote.expiresAt).getTime()) {
      throw new LaunchKernelError("simulation_stale", "Strategy quote is already stale");
    }

    const terms = starterTerms(input);
    const expectedTlUsdAtoms = terms.expectedTlUsdAtoms;
    const parameters = terms.strategy;
    const payload = terms.payload;
    const plan = input.starterOrderPlan;
    const candidate = input.walletCandidate;
    if (!verifyStarterOrderPlan(plan)
      || plan.strategy.amountSats !== amountSats.toString()
      || hashObject(plan.quote) !== hashObject(input.quote)
      || hashObject(plan.strategy) !== hashObject(parameters)
      || plan.tradeLayer.payload !== payload
      || candidate.schema !== "bitagent_wallet_starter_order_candidate_v1"
      || candidate.planHash !== plan.planHash
      || candidate.dataOutput.payload !== payload
      || candidate.dataOutput.payloadHex !== plan.tradeLayer.payloadHex
      || candidate.feeSats !== networkFee.toString()
      || candidate.signingPerformed !== false
      || candidate.broadcastPerformed !== false
      || Date.parse(candidate.expiresAt) <= input.now.getTime()) {
      throw new LaunchKernelError("state_conflict", "Wallet starter-order candidate differs from the exact tx5 plan");
    }

    const core = {
      action: "starter_strategy" as const,
      createdAt: input.now.toISOString(),
      expiresAt: new Date(Math.min(
        Date.parse(input.quote.expiresAt),
        Date.parse(candidate.expiresAt)
      )).toISOString(),
      effects: [
        {
          asset: "tlBTC" as const,
          direction: "lock" as const,
          amount: amountSats.toString(),
          unit: "sats" as const,
          condition: "immediate" as const
        },
        {
          asset: "tlUSD" as const,
          direction: "credit" as const,
          amount: expectedTlUsdAtoms.toString(),
          unit: "token_atoms" as const,
          condition: "on_fill" as const
        },
        {
          asset: "BTC_ORDER" as const,
          direction: "credit" as const,
          amount: "1",
          unit: "order" as const,
          condition: "immediate" as const
        }
      ],
      fees: {
        networkFeeSats: networkFee.toString(),
        protocolFeeSats: "0",
        totalFeeSats: networkFee.toString()
      },
      balanceBeforeSats: balance.toString(),
      balanceAfterSats: (balance - networkFee).toString(),
      payload,
      payloadHex: plan.tradeLayer.payloadHex,
      quote: input.quote,
      strategy: parameters,
      starterOrderPlan: plan,
      walletCandidate: candidate,
      warnings: [
        "This is a post-only limit order; it may remain open and does not guarantee a fill.",
        "The tlUSD amount is conditional on a fill, not an immediate credit.",
        "The selected amount comes from independently verified tlBTC backed by a separate UTXORef reserve.",
        "Only the exact displayed payload may be approved."
      ]
    };
    const hash = hashStarterOrderProtocolObject(core);
    return { id: opaqueId("sim", core), hash, ...core };
  } catch (error) {
    if (error instanceof LaunchKernelError) throw error;
    throw new LaunchKernelError("validation_error", "Unable to simulate the starter strategy", error);
  }
}

export function simulateReserveIntake(input: {
  plan: ReserveIntakePlan;
  balanceSats: string;
  networkFeeSats: string;
  walletCandidate: WalletReserveIntakeCandidate;
  now: Date;
  ttlMs: number;
}): TransactionSimulation {
  const plan = input.plan;
  const candidate = input.walletCandidate;
  if (!verifyReserveIntakePlan(plan)) {
    throw new LaunchKernelError("validation_error", "Reserve intake plan failed deterministic verification");
  }
  if (!/^(0|[1-9][0-9]*)$/.test(input.balanceSats)
    || !/^[1-9][0-9]*$/.test(input.networkFeeSats)) {
    throw new LaunchKernelError("validation_error", "Reserve balance and fee must be canonical satoshi amounts");
  }
  const amount = BigInt(plan.amountSats);
  const balance = BigInt(input.balanceSats);
  const fee = BigInt(input.networkFeeSats);
  const wallet = validateBitcoinAddress(plan.walletAddress, plan.network);
  const candidateInput = candidate.inputUtxos[0];
  const { candidateId, candidateHash, ...candidateCore } = candidate;
  const expectedCandidateHash = hashObject(candidateCore);
  if (amount <= 0n || fee <= 0n || amount + fee > balance) {
    throw new LaunchKernelError("insufficient_funds", "Confirmed Bitcoin cannot cover reserve amount and fee");
  }
  if (candidate.schema !== "bitagent_wallet_reserve_intake_candidate_v1"
    || candidateHash !== expectedCandidateHash
    || candidateId !== `reserve_candidate_${expectedCandidateHash.slice(0, 32)}`
    || candidate.network !== plan.network
    || candidate.workflowId !== plan.workflowId
    || candidate.walletSessionId !== plan.walletSessionId
    || candidate.planHash !== plan.planHash
    || candidate.bindingHash !== plan.bindingHash
    || candidate.reserveOutput.address !== plan.reserve.address
    || candidate.reserveOutput.scriptPubKeyHex !== plan.reserve.scriptPubKeyHex.toLowerCase()
    || candidate.reserveOutput.valueSats !== plan.amountSats
    || candidate.dataOutput.payloadHex !== plan.tradeLayer.payloadHex.toLowerCase()
    || candidate.dataOutput.payloadBytes !== plan.tradeLayer.payloadBytes
    || candidate.reserveOutput.vout !== 0
    || candidate.dataOutput.vout !== 1
    || candidate.changeOutput.vout !== 2
    || candidate.inputUtxos.length !== 1
    || !candidateInput
    || !/^[a-f0-9]{64}$/.test(candidateInput.txid)
    || !Number.isSafeInteger(candidateInput.vout) || candidateInput.vout < 0
    || candidateInput.address !== wallet.address
    || candidateInput.scriptPubKeyHex !== wallet.scriptPubKeyHex
    || candidate.changeOutput.address !== wallet.address
    || candidate.changeOutput.scriptPubKeyHex !== wallet.scriptPubKeyHex
    || !/^[1-9][0-9]*$/.test(candidateInput.valueSats)
    || !/^[1-9][0-9]*$/.test(candidate.changeOutput.valueSats)
    || BigInt(candidate.changeOutput.valueSats) <= 0n
    || BigInt(candidateInput.valueSats) !== amount + fee + BigInt(candidate.changeOutput.valueSats)
    || candidate.feeSats !== fee.toString()
    || !Number.isSafeInteger(candidate.feeRateSatVb)
    || candidate.feeRateSatVb < 1 || candidate.feeRateSatVb > 1000
    || !/^[a-f0-9]{64}$/.test(candidate.unsignedTxid)
    || !/^[a-f0-9]{64}$/.test(candidate.unsignedPsbtHash)
    || !Number.isFinite(Date.parse(candidate.preparedAt))
    || !Number.isFinite(Date.parse(candidate.expiresAt))
    || Date.parse(candidate.expiresAt) <= Date.parse(candidate.preparedAt)
    || candidate.signingPerformed !== false || candidate.broadcastPerformed !== false
    || Date.parse(candidate.expiresAt) <= input.now.getTime()) {
    throw new LaunchKernelError("state_conflict", "Wallet reserve candidate differs from the exact intake plan");
  }
  const expiresAt = new Date(Math.min(
    input.now.getTime() + input.ttlMs,
    Date.parse(candidate.expiresAt)
  )).toISOString();
  const core = {
    action: "fund_starter_strategy" as const,
    createdAt: input.now.toISOString(),
    expiresAt,
    effects: [{
      asset: "BTC" as const,
      direction: "lock" as const,
      amount: amount.toString(),
      unit: "sats" as const,
      destination: plan.reserve.address,
      condition: "immediate" as const
    }],
    fees: {
      networkFeeSats: fee.toString(),
      protocolFeeSats: "0",
      totalFeeSats: fee.toString()
    },
    balanceBeforeSats: balance.toString(),
    balanceAfterSats: (balance - amount - fee).toString(),
    payload: plan.tradeLayer.payload,
    payloadHex: plan.tradeLayer.payloadHex,
    reservePlan: plan,
    walletCandidate: candidate,
    warnings: [
      "This transaction locks Bitcoin into the displayed UTXORef reserve and publishes the exact tx11 intake payload.",
      "TradeLayer tx11 activation, property, template, contract, and reserve-address parity must pass before wallet approval.",
      "The strategy order is a later, separately simulated and approved wallet action.",
      "Only the wallet may sign and broadcast this exact candidate."
    ]
  };
  const hash = hashObject(core);
  return { id: opaqueId("sim", core), hash, ...core };
}

export function simulateBitcoinWithdrawal(input: {
  destinationAddress: string;
  network: "bitcoin" | "bitcoin-testnet4";
  amountSats: string;
  balanceSats: string;
  networkFeeSats: string;
  walletCandidate?: WalletWithdrawalCandidate;
  now: Date;
  ttlMs: number;
}): TransactionSimulation {
  const address = validateBitcoinAddress(input.destinationAddress, input.network);
  const amount = BigInt(input.amountSats);
  const balance = BigInt(input.balanceSats);
  const fee = BigInt(input.networkFeeSats);
  if (amount <= 0n) throw new LaunchKernelError("validation_error", "Withdrawal amount must be positive");
  if (amount + fee > balance) {
    throw new LaunchKernelError("insufficient_funds", "Confirmed balance cannot cover withdrawal amount and fee");
  }

  const candidate = input.walletCandidate;
  if (candidate && (candidate.network !== input.network
    || candidate.destinationOutput.address !== address.address
    || candidate.destinationOutput.valueSats !== amount.toString()
    || candidate.feeSats !== fee.toString()
    || candidate.signingPerformed !== false
    || candidate.broadcastPerformed !== false
    || Date.parse(candidate.expiresAt) <= input.now.getTime())) {
    throw new LaunchKernelError("state_conflict", "Wallet withdrawal candidate differs from the exact withdrawal effects");
  }
  const requestedExpiry = input.now.getTime() + input.ttlMs;
  const expiresAt = candidate
    ? new Date(Math.min(requestedExpiry, Date.parse(candidate.expiresAt))).toISOString()
    : new Date(requestedExpiry).toISOString();

  const core = {
    action: "withdraw_bitcoin" as const,
    createdAt: input.now.toISOString(),
    expiresAt,
    effects: [{
      asset: "BTC" as const,
      direction: "debit" as const,
      amount: amount.toString(),
      unit: "sats" as const,
      destination: address.address
    }],
    fees: {
      networkFeeSats: fee.toString(),
      protocolFeeSats: "0",
      totalFeeSats: fee.toString()
    },
    balanceBeforeSats: balance.toString(),
    balanceAfterSats: (balance - amount - fee).toString(),
    destinationAddress: address.address,
    ...(candidate ? { walletCandidate: candidate } : {}),
    warnings: [
      "Bitcoin withdrawals are irreversible after broadcast.",
      "The wallet must approve the exact destination, amount, fee, and change."
    ]
  };
  const hash = hashObject(core);
  return { id: opaqueId("sim", core), hash, ...core };
}
