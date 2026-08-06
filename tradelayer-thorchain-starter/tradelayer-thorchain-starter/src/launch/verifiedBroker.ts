import { formatUnits } from "./canonical.js";
import type {
  ActionVerification,
  WalletExecutionBroker
} from "./types.js";
import {
  observeStarterTradeLayerOrder,
  type TradeLayerOrderObservation,
  type TradeLayerOrderReadSource
} from "../settlement/tradelayerOrderVerifier.js";

export class IndependentlyVerifyingWalletBroker implements WalletExecutionBroker {
  constructor(
    private readonly wallet: WalletExecutionBroker,
    private readonly tradeLayer: TradeLayerOrderReadSource
  ) {}

  connect(input: Parameters<WalletExecutionBroker["connect"]>[0]) {
    return this.wallet.connect(input);
  }

  getDepositAddress(input: Parameters<WalletExecutionBroker["getDepositAddress"]>[0]) {
    return this.wallet.getDepositAddress(input);
  }

  estimateFee(input: Parameters<WalletExecutionBroker["estimateFee"]>[0]) {
    return this.wallet.estimateFee(input);
  }

  authorize(input: Parameters<WalletExecutionBroker["authorize"]>[0]) {
    return this.wallet.authorize(input);
  }

  execute(input: Parameters<WalletExecutionBroker["execute"]>[0]) {
    return this.wallet.execute(input);
  }

  async verify(input: Parameters<WalletExecutionBroker["verify"]>[0]): Promise<ActionVerification> {
    if (input.simulation.action !== "starter_strategy") return this.wallet.verify(input);
    const strategy = input.simulation.strategy;
    const txid = String(input.execution.txid || "").toLowerCase();
    const address = String(input.state.wallet.bitcoinAddress || "");
    const expectedTlUsdAtoms = input.simulation.effects.find((effect) =>
      effect.asset === "tlUSD" && effect.direction === "credit" && effect.unit === "token_atoms"
    )?.amount;
    if (!strategy || !expectedTlUsdAtoms || !/^[a-f0-9]{64}$/.test(txid) || !address) {
      return {
        action: "starter_strategy",
        status: "failed",
        checkedAt: input.now.toISOString(),
        txid: input.execution.txid,
        evidence: {
          source: this.tradeLayer.source,
          reason: "Submitted strategy lacks the exact public fields required for independent verification"
        }
      };
    }
    let result: TradeLayerOrderObservation;
    try {
      result = await observeStarterTradeLayerOrder({
        source: this.tradeLayer,
        now: input.now,
        expected: {
          txid,
          address,
          offeredPropertyId: strategy.offeredPropertyId,
          desiredPropertyId: strategy.desiredPropertyId,
          amountOffered: formatUnits(BigInt(strategy.amountSats), 8),
          amountExpected: formatUnits(BigInt(expectedTlUsdAtoms), 8),
          postOnly: true
        }
      });
    } catch (error) {
      return {
        action: "starter_strategy",
        status: "pending",
        checkedAt: input.now.toISOString(),
        txid,
        evidence: {
          source: this.tradeLayer.source,
          reason: error instanceof Error
            ? `Independent TradeLayer observation is temporarily unavailable: ${error.message}`
            : "Independent TradeLayer observation is temporarily unavailable"
        }
      };
    }
    return {
      action: "starter_strategy",
      status: result.status,
      checkedAt: result.checkedAt,
      txid: result.txid,
      orderId: result.status === "verified" ? result.txid : undefined,
      evidence: {
        source: result.source,
        evidenceHash: result.evidenceHash,
        evidenceDigest: result.evidenceDigest,
        reason: result.reason,
        positionOrOrderState: result.positionOrOrderState || null,
        transactionProcessed: result.transactionProcessed,
        transactionValid: result.transactionValid ?? null,
        exactTransactionMatched: result.exactTransactionMatched,
        openOrderMatched: result.openOrderMatched,
        fillMatched: result.fillMatched,
        sync: result.sync
      }
    };
  }
}
