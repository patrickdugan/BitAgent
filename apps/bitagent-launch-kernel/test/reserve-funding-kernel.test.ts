import assert from "node:assert/strict";
import test from "node:test";
import { ScriptedWalletBroker } from "../src/launch/broker.js";
import { validateBitcoinAddress } from "../src/launch/bitcoin.js";
import { hashObject } from "../src/launch/canonical.js";
import { createScriptedReferralLinkService, createTestLaunchKernel } from "../src/launch/factory.js";
import { AcquisitionMode, InvitationActor } from "../src/referral/types.js";
import type {
  BitAgentWorkflowState,
  StrategyFundingEvidence,
  StrategyFundingReadSource,
  TransactionSimulation,
  WalletExecutionBroker,
  WalletReserveIntakeCandidate
} from "../src/launch/types.js";

const NOW = new Date("2026-08-06T14:00:00.000Z");
const OPERATOR = "04d7f4188a5cbc5335aee6600ad8e327730d73de961534e23b4b91b7d64b6ae4";
const GUARDIAN = "d1517d4cbf81891b1c360554cb5352f1d9e307cfb08d493125450147ad01260c";

class ReserveCandidateWallet extends ScriptedWalletBroker {
  override async estimateFee(input: Parameters<WalletExecutionBroker["estimateFee"]>[0]) {
    if (input.action !== "fund_starter_strategy") return super.estimateFee(input);
    const plan = input.reservePlan!;
    const feeSats = "900";
    const inputValueSats = input.state.wallet.confirmedBalanceSats;
    const walletAddress = input.state.wallet.bitcoinAddress!;
    const walletScript = validateBitcoinAddress(walletAddress, "bitcoin-testnet4").scriptPubKeyHex;
    const core = {
      schema: "bitagent_wallet_reserve_intake_candidate_v1" as const,
      workflowId: input.state.id,
      walletSessionId: input.state.wallet.walletSessionId!,
      network: "bitcoin-testnet4" as const,
      preparedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
      planHash: plan.planHash,
      bindingHash: plan.bindingHash,
      unsignedTxid: "31".repeat(32),
      unsignedPsbtHash: "32".repeat(32),
      inputUtxos: [{
        txid: input.state.deposit.txid!,
        vout: input.state.deposit.vout!,
        valueSats: inputValueSats,
        address: walletAddress,
        scriptPubKeyHex: walletScript
      }],
      reserveOutput: {
        vout: 0 as const,
        address: plan.reserve.address,
        scriptPubKeyHex: plan.reserve.scriptPubKeyHex,
        valueSats: plan.amountSats
      },
      dataOutput: {
        vout: 1 as const,
        payloadHex: plan.tradeLayer.payloadHex,
        payloadBytes: plan.tradeLayer.payloadBytes
      },
      changeOutput: {
        vout: 2 as const,
        address: walletAddress,
        scriptPubKeyHex: walletScript,
        valueSats: (BigInt(inputValueSats) - BigInt(plan.amountSats) - BigInt(feeSats)).toString()
      },
      feeSats,
      feeRateSatVb: 2,
      signingPerformed: false as const,
      broadcastPerformed: false as const
    };
    const candidateHash = hashObject(core);
    const reserveCandidate: WalletReserveIntakeCandidate = {
      candidateId: `reserve_candidate_${candidateHash.slice(0, 32)}`,
      candidateHash,
      ...core
    };
    return { networkFeeSats: feeSats, source: "wallet-owned-reserve-fixture", reserveCandidate };
  }
}

class TransitioningFundingSource implements StrategyFundingReadSource {
  readonly source = "independent-reserve-funding-fixture";
  private binding?: { txid: string; planHash: string; spendableSats: string };

  bind(txid: string, simulation: TransactionSimulation) {
    this.binding = {
      txid,
      planHash: simulation.reservePlan!.planHash,
      spendableSats: simulation.balanceAfterSats
    };
  }

  mismatchManifest() {
    if (!this.binding) throw new Error("Funding fixture is not bound");
    this.binding.planHash = "ff".repeat(32);
  }

  async observe(input: {
    state: BitAgentWorkflowState;
    requestedAmountSats: string;
    now: Date;
  }): Promise<StrategyFundingEvidence> {
    const verified = Boolean(this.binding);
    const core = {
      schema: "bitagent_strategy_funding_evidence_v1" as const,
      status: verified ? "verified" as const : "pending" as const,
      network: input.state.wallet.network,
      walletSessionId: input.state.wallet.walletSessionId!,
      bitcoinSpendableSats: this.binding?.spendableSats || input.state.wallet.confirmedBalanceSats,
      reserveLockedSats: verified ? input.requestedAmountSats : "0",
      tlBtcAvailableSats: verified ? input.requestedAmountSats : "0",
      tlBtcReservedSats: "0",
      reserveOutpoint: verified ? `${this.binding!.txid}:0` : undefined,
      reserveManifestHash: this.binding?.planHash,
      intakeTxid: this.binding?.txid,
      confirmations: verified ? 2 : 0,
      observedAt: input.now.toISOString(),
      source: this.source,
      reason: verified
        ? "Independent reserve output and tx11 tlBTC intake are confirmed"
        : "No matching reserve intake has been observed"
    };
    return { ...core, evidenceHash: hashObject(core) };
  }
}

async function fundedKernel(referral = false) {
  const funding = new TransitioningFundingSource();
  const kernel = createTestLaunchKernel({
    now: () => NOW,
    walletBroker: new ReserveCandidateWallet(),
    strategyFundingSource: funding,
    reserveIntake: { operatorXonly: OPERATOR, guardianXonly: GUARDIAN, propertyId: 1 }
  });
  const workflowId = referral ? "reserve-kernel-referral" : "reserve-kernel-cancel";
  const referralLink = referral
    ? createScriptedReferralLinkService().issue({
      referrerPrincipalId: "alice",
      acquisitionMode: AcquisitionMode.HUMAN_MANUAL_SHARE,
      invitationActor: InvitationActor.HUMAN
    }).url
    : undefined;
  await kernel.start({
    workflowId,
    referralLink
  });
  await kernel.connectWallet(workflowId, { mode: "create" });
  await kernel.prepareDeposit(workflowId);
  await kernel.observeDeposit(workflowId, {
    txid: "41".repeat(32),
    vout: 0,
    amountSats: "250000",
    blockHeight: 100,
    currentHeight: 101
  });
  return { kernel, funding, workflowId };
}

test("pending strategy funding becomes an exact separate reserve simulation and verifies independently", async () => {
  const { kernel, funding, workflowId } = await fundedKernel(true);
  const reserve = await kernel.simulateStrategy(workflowId, { amountSats: "100000" });
  assert.equal(reserve.action, "fund_starter_strategy");
  assert.equal(reserve.effects[0]?.direction, "lock");
  assert.equal(reserve.walletCandidate?.signingPerformed, false);
  assert.equal((await kernel.get(workflowId)).stage, "strategy_funding_simulated");

  await kernel.requestApproval(workflowId);
  assert.equal((await kernel.get(workflowId)).stage, "strategy_funding_approval_pending");
  await kernel.resolveApproval(workflowId, "approve");
  assert.equal((await kernel.get(workflowId)).stage, "strategy_funding_approved");
  const execution = await kernel.execute(workflowId);
  assert.equal((await kernel.verify(workflowId)).status, "pending");
  assert.equal((await kernel.get(workflowId)).wallet.confirmedBalanceSats, "250000");

  funding.bind(execution.txid!, reserve);
  const verified = await kernel.verify(workflowId);
  const verifiedState = await kernel.get(workflowId);
  assert.equal(verified.status, "verified");
  assert.equal(verifiedState.stage, "strategy_funding_verified");
  assert.equal(verifiedState.wallet.confirmedBalanceSats, "149100");
  assert.equal(verifiedState.referral?.status, "pending");

  const order = await kernel.simulateStrategy(workflowId, { amountSats: "100000" });
  assert.equal(order.action, "starter_strategy");
  assert.equal(order.balanceBeforeSats, "149100");
  assert.equal((await kernel.get(workflowId)).referral?.status, "pending");
});

test("rejecting reserve funding preserves wallet balance and referral attribution", async () => {
  const { kernel, workflowId } = await fundedKernel(true);
  await kernel.simulateStrategy(workflowId, { amountSats: "100000" });
  await kernel.requestApproval(workflowId);
  const approval = await kernel.resolveApproval(workflowId, "reject");
  const state = await kernel.get(workflowId);
  assert.equal(approval.status, "rejected");
  assert.equal(state.stage, "strategy_funding_simulated");
  assert.equal(state.wallet.confirmedBalanceSats, "250000");
  assert.equal(state.execution, undefined);
  assert.equal(state.referral?.status, "pending");
});

test("independent reserve manifest mismatch fails without debiting workflow balance", async () => {
  const { kernel, funding, workflowId } = await fundedKernel(true);
  const reserve = await kernel.simulateStrategy(workflowId, { amountSats: "100000" });
  await kernel.requestApproval(workflowId);
  await kernel.resolveApproval(workflowId, "approve");
  const execution = await kernel.execute(workflowId);
  funding.bind(execution.txid!, reserve);
  funding.mismatchManifest();

  const verification = await kernel.verify(workflowId);
  const state = await kernel.get(workflowId);
  assert.equal(verification.status, "failed");
  assert.equal(state.stage, "error");
  assert.equal(state.wallet.confirmedBalanceSats, "250000");
  assert.equal(state.referral?.status, "pending");
});

test("partial reserve environment configuration fails closed", () => {
  const keys = [
    "BITAGENT_RESERVE_OPERATOR_XONLY",
    "BITAGENT_RESERVE_GUARDIAN_XONLY",
    "BITAGENT_RESERVE_RECOVERY_XONLY",
    "BITAGENT_RESERVE_RECOVERY_CSV_DELAY",
    "BITAGENT_RESERVE_PROPERTY_ID"
  ] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.BITAGENT_RESERVE_RECOVERY_CSV_DELAY = "2016";
    assert.throws(
      () => createTestLaunchKernel(),
      /OPERATOR_XONLY and BITAGENT_RESERVE_GUARDIAN_XONLY must be configured together/
    );
  } finally {
    for (const key of keys) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
