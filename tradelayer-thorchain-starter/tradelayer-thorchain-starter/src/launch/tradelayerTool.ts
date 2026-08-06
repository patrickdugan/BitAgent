import { createRequire } from "node:module";
import path from "node:path";
import { externalRepos } from "../config.js";
import { formatUnits, hashObject, opaqueId, parseDecimal } from "./canonical.js";
import { validateBitcoinAddress } from "./bitcoin.js";
import { LaunchKernelError } from "./errors.js";
import type {
  QuoteSnapshot,
  StarterStrategyParameters,
  TransactionSimulation,
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
