import { createRequire } from "node:module";
import path from "node:path";
import { externalRepos } from "../config.js";
import { formatUnits, hashObject, opaqueId, parseDecimal } from "./canonical.js";
import { validateBitcoinAddress } from "./bitcoin.js";
import { LaunchKernelError } from "./errors.js";
import type {
  QuoteSnapshot,
  StarterStrategyParameters,
  TransactionSimulation
} from "./types.js";

const require = createRequire(import.meta.url);
const encoder = require(path.join(externalRepos.tradelayer, "src", "txEncoder.js"));

type StrategySimulationInput = {
  amountSats: string;
  balanceSats: string;
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
    const networkFee = BigInt(input.networkFeeSats);
    if (amountSats <= 0n) throw new Error("amountSats must be positive");
    if (amountSats + networkFee > balance) {
      throw new LaunchKernelError("insufficient_funds", "Confirmed balance cannot cover strategy amount and fee");
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
        { asset: "tlBTC" as const, direction: "lock" as const, amount: amountSats.toString(), unit: "sats" as const },
        {
          asset: "tlUSD" as const,
          direction: "credit" as const,
          amount: expectedTlUsdAtoms.toString(),
          unit: "token_atoms" as const
        },
        { asset: "BTC_ORDER" as const, direction: "credit" as const, amount: "1", unit: "order" as const }
      ],
      fees: {
        networkFeeSats: networkFee.toString(),
        protocolFeeSats: "0",
        totalFeeSats: networkFee.toString()
      },
      balanceBeforeSats: balance.toString(),
      balanceAfterSats: (balance - amountSats - networkFee).toString(),
      payload: String(payload),
      payloadHex: Buffer.from(String(payload), "utf8").toString("hex"),
      quote: input.quote,
      strategy: parameters,
      warnings: [
        "This is a post-only limit order; it may remain open and does not guarantee a fill.",
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

  const core = {
    action: "withdraw_bitcoin" as const,
    createdAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + input.ttlMs).toISOString(),
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
    warnings: [
      "Bitcoin withdrawals are irreversible after broadcast.",
      "The wallet must approve the exact destination, amount, fee, and change."
    ]
  };
  const hash = hashObject(core);
  return { id: opaqueId("sim", core), hash, ...core };
}
