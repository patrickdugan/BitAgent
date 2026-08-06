import { createRequire } from "node:module";
import path from "node:path";
import { externalRepos } from "../config.js";
import { formatUnits, hashObject, opaqueId, parseDecimal } from "./canonical.js";
import { validateBitcoinAddress } from "./bitcoin.js";
import { LaunchKernelError } from "./errors.js";
import { verifyReserveIntakePlan, type ReserveIntakePlan } from "./reserveIntake.js";
import type {
  QuoteSnapshot,
  StarterStrategyParameters,
  TransactionSimulation,
  WalletReserveIntakeCandidate,
  WalletWithdrawalCandidate
} from "./types.js";

const require = createRequire(import.meta.url);
const encoder = require(path.join(externalRepos.tradelayer, "src", "txEncoder.js"));

type StrategySimulationInput = {
  amountSats: string;
  balanceSats: string;
  tlBtcAvailableSats: string;
  networkFeeSats: string;
  quote: QuoteSnapshot;
  now: Date;
  offeredPropertyId?: number;
  desiredPropertyId?: number;
};

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

    const priceCents = parseDecimal(input.quote.priceUsd, 2, "priceUsd");
    const expectedTlUsdAtoms = amountSats * priceCents / 100n;
    const parameters: StarterStrategyParameters = {
      strategyId: "starter-tlbtc-tlusd-limit-v1",
      amountSats: amountSats.toString(),
      limitPriceUsd: formatUnits(priceCents, 2),
      expectedTlUsdAtoms: expectedTlUsdAtoms.toString(),
      postOnly: true,
      offeredPropertyId: input.offeredPropertyId || 1,
      desiredPropertyId: input.desiredPropertyId || 2
    };
    const payload = encoder.encodeOnChainTokenForToken({
      propertyIdOffered: parameters.offeredPropertyId,
      propertyIdDesired: parameters.desiredPropertyId,
      amountOffered: formatUnits(amountSats, 8),
      amountExpected: formatUnits(expectedTlUsdAtoms, 8),
      stop: false,
      post: true
    });
    if (!String(payload).startsWith("tl5")) throw new Error("TradeLayer encoder did not return a type-5 payload");

    const core = {
      action: "starter_strategy" as const,
      createdAt: input.now.toISOString(),
      expiresAt: input.quote.expiresAt,
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
      payload: String(payload),
      payloadHex: Buffer.from(String(payload), "utf8").toString("hex"),
      quote: input.quote,
      strategy: parameters,
      warnings: [
        "This is a post-only limit order; it may remain open and does not guarantee a fill.",
        "The tlUSD amount is conditional on a fill, not an immediate credit.",
        "The selected amount comes from independently verified tlBTC backed by a separate UTXORef reserve.",
        "Only the exact displayed payload may be approved."
      ]
    };
    const hash = hashObject(core);
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
