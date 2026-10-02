import crypto from "node:crypto";
import { hashObject } from "../launch/canonical.js";
import { LaunchKernelError } from "../launch/errors.js";
import type { BitAgentLaunchKernel } from "../launch/kernel.js";
import type { BitAgentWorkflowState, WorkflowStore } from "../launch/types.js";
import { pluginConfig } from "./config.js";
import { ChatGptPluginError } from "./errors.js";

// The read and simulate half of the launch kernel. Approval, execution, and
// verification are deliberately absent: they belong to the wallet user on the
// self-hosted BitAgent, never to ChatGPT.
export type PracticeKernel = Pick<
  BitAgentLaunchKernel,
  "start" | "connectWallet" | "prepareDeposit" | "observeDeposit" | "simulateStrategy" | "simulateWithdrawal" | "getPublic"
>;

class BoundedWorkflowStore implements WorkflowStore {
  private readonly states = new Map<string, BitAgentWorkflowState>();

  constructor(private readonly maximum: number) {}

  async get(id: string) {
    const state = this.states.get(id);
    return state ? structuredClone(state) : null;
  }

  async save(state: BitAgentWorkflowState) {
    this.states.delete(state.id);
    this.states.set(state.id, structuredClone(state));
    while (this.states.size > this.maximum) {
      this.states.delete(this.states.keys().next().value as string);
    }
  }

  async list() {
    return [...this.states.values()].map((state) => structuredClone(state));
  }
}

// The launch kernel loads the sibling UTXO-Ref and tradelayer.js checkouts at
// import time, so it is imported lazily. A host without them (for example a
// public concierge deployment) keeps every other tool and fails closed here.
export async function loadScriptedPracticeKernel(): Promise<PracticeKernel> {
  try {
    const { createTestLaunchKernel } = await import("../launch/factory.js");
    return createTestLaunchKernel({ store: new BoundedWorkflowStore(pluginConfig.practice.maxWorkflows) });
  } catch (error) {
    throw new ChatGptPluginError(
      "practice_unavailable",
      "The practice sandbox is not available on this server because it does not have the UTXO-Ref and tradelayer.js protocol libraries. It works on a self-hosted BitAgent.",
      "provider_unavailable",
      error
    );
  }
}

function view(state: BitAgentWorkflowState) {
  const simulation = state.simulation;
  const amount = simulation?.effects[0]?.amount;
  return {
    kind: "practice" as const,
    simulated: true as const,
    note: "Scripted rehearsal with made-up testnet values. No real wallet, coins, or transaction exist.",
    workflowId: state.id,
    stage: state.stage,
    network: state.wallet.network,
    wallet: { address: state.wallet.bitcoinAddress, spendableSats: state.wallet.confirmedBalanceSats },
    deposit: {
      status: state.deposit.status,
      amountSats: state.deposit.amountSats,
      confirmations: state.deposit.confirmations,
      requiredConfirmations: state.deposit.requiredConfirmations
    },
    simulation: simulation && {
      action: simulation.action,
      hash: simulation.hash,
      expiresAt: simulation.expiresAt,
      effects: simulation.effects,
      fees: simulation.fees,
      balanceBeforeSats: simulation.balanceBeforeSats,
      balanceAfterSats: simulation.balanceAfterSats,
      destinationAddress: simulation.destinationAddress,
      quote: simulation.quote && { priceUsd: simulation.quote.priceUsd, source: simulation.quote.source },
      warnings: simulation.warnings
    },
    nextAuthority: simulation ? "wallet_user_on_self_hosted_bitagent" as const : "none" as const,
    handoff: simulation && {
      where: "your self-hosted BitAgent",
      sayThis: simulation.action === "withdraw_bitcoin"
        ? `Withdraw ${amount} sats to ${simulation.destinationAddress}.`
        : `Use ${amount} sats in the starter TradeLayer strategy.`
    },
    fundedExecutionAllowed: false as const,
    authority: "deterministic_host" as const,
    effect: "practice_sandbox_state_only" as const,
    signingPerformed: false as const,
    broadcastPerformed: false as const
  };
}

export class PracticeSandbox {
  private kernel?: Promise<PracticeKernel>;

  constructor(private readonly load: () => Promise<PracticeKernel> = loadScriptedPracticeKernel) {}

  private async run<T>(action: (kernel: PracticeKernel) => Promise<T>): Promise<T> {
    this.kernel ||= this.load();
    try {
      return await action(await this.kernel);
    } catch (error) {
      if (error instanceof ChatGptPluginError) throw error;
      if (error instanceof LaunchKernelError) {
        throw new ChatGptPluginError("practice_rejected", error.message, error.code, error);
      }
      throw new ChatGptPluginError("internal_error", "The practice sandbox failed unexpectedly", undefined, error);
    }
  }

  async start(input: { practiceDepositSats: string }) {
    if (BigInt(input.practiceDepositSats) > pluginConfig.practice.maxDepositSats) {
      throw new ChatGptPluginError("invalid_arguments", "practiceDepositSats may not exceed 100000000 (1 BTC)");
    }
    return this.run(async (kernel) => {
      // Unguessable id: the kernel's default id derives from the timestamp.
      const { id } = await kernel.start({
        workflowId: `practice_${crypto.randomUUID()}`,
        intent: "starter_strategy",
        network: "bitcoin-testnet4"
      });
      await kernel.connectWallet(id, { mode: "create" });
      await kernel.prepareDeposit(id);
      // The host, not the model, scripts the confirmed deposit.
      await kernel.observeDeposit(id, {
        txid: hashObject({ kind: "scripted-practice-deposit", workflowId: id }),
        vout: 0,
        amountSats: input.practiceDepositSats,
        blockHeight: 100,
        currentHeight: 101
      });
      return view(await kernel.getPublic(id));
    });
  }

  async simulate(input: {
    workflowId: string;
    action: "starter_strategy" | "withdraw_bitcoin";
    amountSats: string;
    destinationAddress?: string;
  }) {
    return this.run(async (kernel) => {
      if (input.action === "starter_strategy") {
        await kernel.simulateStrategy(input.workflowId, { amountSats: input.amountSats });
      } else {
        if (!input.destinationAddress) {
          throw new ChatGptPluginError("invalid_arguments", "destinationAddress is required to rehearse a withdrawal");
        }
        await kernel.simulateWithdrawal(input.workflowId, {
          destinationAddress: input.destinationAddress,
          amountSats: input.amountSats
        });
      }
      return view(await kernel.getPublic(input.workflowId));
    });
  }

  async status(workflowId: string) {
    return this.run(async (kernel) => view(await kernel.getPublic(workflowId)));
  }
}
