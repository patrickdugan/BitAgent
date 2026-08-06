import { validateBitcoinAddress } from "./bitcoin.js";
import { BitAgentLaunchKernel } from "./kernel.js";
import {
  containsSecretMaterial,
  extractAmountSats,
  extractBitcoinAddress,
  identifyIntent
} from "./intent.js";
import type { BitAgentWorkflowState, StructuredPlan, SupportedIntent } from "./types.js";

function status(
  condition: boolean,
  current: boolean
): "complete" | "current" | "pending" | "blocked" {
  if (condition) return "complete";
  return current ? "current" : "pending";
}

function basePlan(state: BitAgentWorkflowState, intent: SupportedIntent | "unsupported"): StructuredPlan {
  const connected = state.wallet.status === "connected";
  const confirmed = state.deposit.status === "confirmed";
  const verifiedStrategy = state.stage === "strategy_verified"
    || state.events.some((event) => event.type === "starter_strategy.verification_verified");
  const verifiedWithdrawal = state.stage === "withdrawal_verified";
  return {
    intent,
    summary: "",
    steps: [
      { sequence: 1, label: "Connect a wallet", status: status(connected, !connected) },
      { sequence: 2, label: "Receive confirmed Bitcoin", status: status(confirmed, connected && !confirmed) },
      {
        sequence: 3,
        label: "Simulate and approve the starter strategy",
        status: status(verifiedStrategy, confirmed && intent === "starter_strategy")
      },
      {
        sequence: 4,
        label: "Verify the action",
        status: status(
          intent === "withdraw_bitcoin" ? verifiedWithdrawal : verifiedStrategy,
          Boolean(state.execution)
        )
      }
    ],
    missingParameters: [],
    walletTruth: {
      connected,
      confirmedBalanceSats: state.wallet.confirmedBalanceSats,
      reserveLockedSats: state.strategyFunding?.reserveLockedSats || "0",
      tlBtcAvailableSats: state.strategyFunding?.tlBtcAvailableSats || "0",
      strategyFundingSource: state.strategyFunding?.source,
      depositConfirmations: state.deposit.confirmations,
      depositRequiredConfirmations: state.deposit.requiredConfirmations
    },
    prohibitedRequestDetected: false
  };
}

export class BitAgentConversation {
  constructor(private readonly kernel: BitAgentLaunchKernel) {}

  async plan(workflowId: string, message: string): Promise<StructuredPlan> {
    const state = await this.kernel.get(workflowId);
    if (containsSecretMaterial(message)) {
      const plan = basePlan(state, "unsupported");
      plan.summary = "Do not share seed phrases, private keys, mnemonics, or WIFs. BitAgent only uses public wallet sessions.";
      plan.prohibitedRequestDetected = true;
      return plan;
    }

    const intent = identifyIntent(message);
    const plan = basePlan(state, intent);
    if (intent === "unsupported") {
      plan.summary = "BitAgent currently supports only Bitcoin deposit, the starter TradeLayer strategy, and Bitcoin withdrawal.";
      return plan;
    }

    await this.kernel.selectIntent(workflowId, intent);
    if (state.wallet.status !== "connected") {
      plan.summary = "Connect or create a TradeLayer wallet before continuing. BitAgent will never request its recovery phrase.";
      plan.missingParameters = ["wallet_connection_choice"];
      plan.suggestedTool = {
        name: "bitagent.wallet.connect",
        arguments: { workflowId, mode: "connect" }
      };
      return plan;
    }

    if (intent === "deposit_bitcoin") {
      if (state.deposit.status === "not_started") {
        plan.summary = "Your public wallet session is connected. Generate its Bitcoin deposit address next.";
        plan.suggestedTool = {
          name: "bitagent.deposit.prepare",
          arguments: { workflowId }
        };
      } else if (state.deposit.status === "confirmed") {
        plan.summary = `Deposit confirmed with ${state.deposit.confirmations} confirmations.`;
      } else {
        plan.summary = `Waiting for Bitcoin confirmations: ${state.deposit.confirmations}/${state.deposit.requiredConfirmations}.`;
        plan.missingParameters = ["confirmed_deposit"];
      }
      return plan;
    }

    if (intent === "starter_strategy") {
      if (state.deposit.status !== "confirmed") {
        plan.summary = `The starter strategy is blocked until the deposit is confirmed (${state.deposit.confirmations}/${state.deposit.requiredConfirmations}).`;
        plan.missingParameters = ["confirmed_deposit"];
        if (state.deposit.status === "not_started") {
          plan.suggestedTool = {
            name: "bitagent.deposit.prepare",
            arguments: { workflowId }
          };
        }
        return plan;
      }
      const amountSats = extractAmountSats(message);
      if (!amountSats) {
        plan.summary = state.strategyFunding?.status === "verified"
          ? `Wallet spendable: ${state.wallet.confirmedBalanceSats} sats; UTXORef reserve: ${state.strategyFunding.reserveLockedSats} sats; verified tlBTC available: ${state.strategyFunding.tlBtcAvailableSats} sats.`
          : `You have ${state.wallet.confirmedBalanceSats} confirmed wallet sats. Choose an amount; BitAgent will require independent UTXORef reserve and tlBTC funding evidence before simulation.`;
        plan.missingParameters = ["amountSats"];
        return plan;
      }
      plan.summary = `Simulate an order using exactly ${amountSats} sats. No wallet action occurs during simulation.`;
      plan.suggestedTool = {
        name: "bitagent.strategy.simulate",
        arguments: { workflowId, amountSats }
      };
      return plan;
    }

    const amountSats = extractAmountSats(message);
    const destinationAddress = extractBitcoinAddress(message);
    if (!amountSats) plan.missingParameters.push("amountSats");
    if (!destinationAddress) plan.missingParameters.push("destinationAddress");
    if (destinationAddress) {
      try {
        validateBitcoinAddress(destinationAddress, state.wallet.network);
      } catch {
        plan.summary = "The destination is not a valid address for the connected Bitcoin network.";
        plan.missingParameters = ["validDestinationAddress"];
        return plan;
      }
    }
    if (plan.missingParameters.length) {
      plan.summary = `Provide a Bitcoin destination address and exact amount. Available balance: ${state.wallet.confirmedBalanceSats} sats.`;
      return plan;
    }
    plan.summary = `Simulate a withdrawal of exactly ${amountSats} sats to ${destinationAddress}.`;
    plan.suggestedTool = {
      name: "bitagent.withdraw.simulate",
      arguments: { workflowId, amountSats, destinationAddress }
    };
    return plan;
  }
}
