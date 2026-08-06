import { formatUnits } from "./canonical.js";
import { validateBitcoinAddress } from "./bitcoin.js";
import type {
  ActionVerification,
  StrategyFundingReadSource,
  WalletExecutionBroker
} from "./types.js";
import { verifyStrategyFundingEvidence } from "./strategyFunding.js";
import {
  observeBitcoinWithdrawal,
  type BitcoinWithdrawalVerification
} from "../settlement/bitcoinWithdrawalVerifier.js";
import type { BitcoinWithdrawalReadSource } from "../settlement/types.js";
import {
  observeStarterTradeLayerOrder,
  type TradeLayerOrderObservation,
  type TradeLayerOrderReadSource
} from "../settlement/tradelayerOrderVerifier.js";

export class IndependentlyVerifyingWalletBroker implements WalletExecutionBroker {
  constructor(
    private readonly wallet: WalletExecutionBroker,
    private readonly strategyFunding?: StrategyFundingReadSource,
    private readonly tradeLayer?: TradeLayerOrderReadSource,
    private readonly bitcoin?: BitcoinWithdrawalReadSource,
    private readonly withdrawalConfirmations = 1
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
    if (input.simulation.action === "fund_starter_strategy") {
      return this.strategyFunding ? this.verifyStrategyFunding(input) : this.wallet.verify(input);
    }
    if (input.simulation.action === "withdraw_bitcoin") {
      return this.bitcoin ? this.verifyWithdrawal(input) : this.wallet.verify(input);
    }
    if (!this.tradeLayer) return this.wallet.verify(input);
    const strategy = input.simulation.strategy;
    const txid = String(input.execution.txid || "").toLowerCase();
    const address = String(input.state.wallet.bitcoinAddress || "");
    const expectedTlUsdAtoms = strategy?.expectedTlUsdAtoms;
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

  private async verifyStrategyFunding(
    input: Parameters<WalletExecutionBroker["verify"]>[0]
  ): Promise<ActionVerification> {
    const source = this.strategyFunding!;
    const txid = String(input.execution.txid || "").toLowerCase();
    const plan = input.simulation.reservePlan;
    const lockEffects = input.simulation.effects.filter((effect) =>
      effect.asset === "BTC"
      && effect.direction === "lock"
      && effect.unit === "sats"
      && effect.destination === plan?.reserve.address
    );
    if (!plan || lockEffects.length !== 1 || lockEffects[0]!.amount !== plan.amountSats
      || !/^[a-f0-9]{64}$/.test(txid)) {
      return {
        action: "fund_starter_strategy",
        status: "failed",
        checkedAt: input.now.toISOString(),
        txid: input.execution.txid,
        evidence: {
          source: source.source,
          reason: "Submitted reserve intake lacks the exact public fields required for independent verification"
        }
      };
    }
    try {
      const evidence = await source.observe({
        state: input.state,
        requestedAmountSats: plan.amountSats,
        now: input.now
      });
      if (evidence.status === "pending") {
        return {
          action: "fund_starter_strategy",
          status: "pending",
          checkedAt: input.now.toISOString(),
          txid,
          confirmations: evidence.confirmations,
          evidence: { ...evidence, source: evidence.source }
        };
      }
      const exactEvidence = verifyStrategyFundingEvidence(evidence, input.state, plan.amountSats)
        && evidence.intakeTxid === txid
        && evidence.reserveOutpoint === `${txid}:0`
        && evidence.reserveManifestHash === plan.planHash;
      return {
        action: "fund_starter_strategy",
        status: exactEvidence ? "verified" : "failed",
        checkedAt: input.now.toISOString(),
        txid,
        confirmations: evidence.confirmations,
        evidence: {
          ...evidence,
          source: evidence.source,
          reason: exactEvidence
            ? evidence.reason || "Independent reserve output and TradeLayer tlBTC intake match the submitted transaction"
            : evidence.reason || "Independent reserve or TradeLayer funding evidence differs from the submitted intake"
        }
      };
    } catch (error) {
      return {
        action: "fund_starter_strategy",
        status: "pending",
        checkedAt: input.now.toISOString(),
        txid,
        evidence: {
          source: source.source,
          reason: error instanceof Error
            ? `Independent reserve funding observation is temporarily unavailable: ${error.message}`
            : "Independent reserve funding observation is temporarily unavailable"
        }
      };
    }
  }

  private async verifyWithdrawal(
    input: Parameters<WalletExecutionBroker["verify"]>[0]
  ): Promise<ActionVerification> {
    const txid = String(input.execution.txid || "").toLowerCase();
    const destinationAddress = String(input.simulation.destinationAddress || "");
    const debitEffects = input.simulation.effects.filter((effect) =>
      effect.asset === "BTC"
      && effect.direction === "debit"
      && effect.unit === "sats"
      && effect.destination === destinationAddress
    );
    let destinationScriptPubKeyHex = "";
    let walletNetDebitSats = "";
    try {
      destinationScriptPubKeyHex = validateBitcoinAddress(
        destinationAddress,
        input.state.wallet.network
      ).scriptPubKeyHex;
      walletNetDebitSats = (
        BigInt(input.simulation.balanceBeforeSats) - BigInt(input.simulation.balanceAfterSats)
      ).toString();
    } catch {
      // The failed exact-field check below is safer than delegating verification.
    }
    if (
      debitEffects.length !== 1
      || !/^[a-f0-9]{64}$/.test(txid)
      || !destinationScriptPubKeyHex
      || input.simulation.fees.protocolFeeSats !== "0"
      || this.bitcoin!.network !== input.state.wallet.network
    ) {
      return {
        action: "withdraw_bitcoin",
        status: "failed",
        checkedAt: input.now.toISOString(),
        txid: input.execution.txid,
        evidence: {
          source: this.bitcoin!.source,
          reason: "Submitted withdrawal lacks the exact public fields required for independent verification"
        }
      };
    }

    let result: BitcoinWithdrawalVerification;
    try {
      result = await observeBitcoinWithdrawal({
        source: this.bitcoin!,
        now: input.now,
        minimumConfirmations: this.withdrawalConfirmations,
        expected: {
          txid,
          network: input.state.wallet.network,
          destinationScriptPubKeyHex,
          amountSats: debitEffects[0]!.amount,
          feeSats: input.simulation.fees.networkFeeSats,
          walletNetDebitSats
        }
      });
    } catch (error) {
      return {
        action: "withdraw_bitcoin",
        status: "pending",
        checkedAt: input.now.toISOString(),
        txid,
        evidence: {
          source: this.bitcoin!.source,
          reason: error instanceof Error
            ? `Independent Bitcoin observation is temporarily unavailable: ${error.message}`
            : "Independent Bitcoin observation is temporarily unavailable"
        }
      };
    }
    return {
      action: "withdraw_bitcoin",
      status: result.status,
      checkedAt: result.checkedAt,
      txid: result.txid,
      confirmations: result.confirmations,
      evidence: {
        source: result.source,
        evidenceHash: result.evidenceHash,
        evidenceDigest: result.evidenceDigest,
        reason: result.reason,
        chainState: result.chainState,
        destinationVout: result.destinationVout ?? null,
        exactTransactionMatched: result.exactTransactionMatched,
        exactDestinationMatched: result.exactDestinationMatched,
        exactFeeMatched: result.exactFeeMatched,
        exactWalletDebitMatched: result.exactWalletDebitMatched
      }
    };
  }
}
