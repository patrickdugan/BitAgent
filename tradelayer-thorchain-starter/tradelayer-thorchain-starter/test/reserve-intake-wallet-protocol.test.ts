import assert from "node:assert/strict";
import test from "node:test";
import { buildReserveIntakePlan } from "../src/launch/reserveIntake.js";
import { encodeSegwitAddress, validateBitcoinAddress } from "../src/launch/bitcoin.js";
import { hashObject } from "../src/launch/canonical.js";
import { validatedReserveIntakeCandidate } from "../src/launch/remoteWalletProtocol.js";
import { simulateReserveIntake } from "../src/launch/tradelayerTool.js";

const NOW = new Date("2026-08-06T17:30:00.000Z");
const WORKFLOW = "workflow-reserve-protocol-0001";
const SESSION = "wallet-session-reserve-protocol-0001";
const WALLET = encodeSegwitAddress(Buffer.alloc(20, 71), "bitcoin-testnet4");
const WALLET_SCRIPT = validateBitcoinAddress(WALLET, "bitcoin-testnet4").scriptPubKeyHex;
const OPERATOR = "04d7f4188a5cbc5335aee6600ad8e327730d73de961534e23b4b91b7d64b6ae4";
const GUARDIAN = "d1517d4cbf81891b1c360554cb5352f1d9e307cfb08d493125450147ad01260c";

function fixture() {
  const plan = buildReserveIntakePlan({
    workflowId: WORKFLOW,
    walletSessionId: SESSION,
    walletAddress: WALLET,
    amountSats: "100000",
    operatorXonly: OPERATOR,
    guardianXonly: GUARDIAN,
    propertyId: 1,
    dlcTemplateId: "starter-utxoref-v1",
    dlcContractId: "starter-utxoref-contract-0001",
    settlementState: "FUNDED",
    dlcHash: "ab".repeat(32)
  });
  const core = {
    schema: "bitagent_wallet_reserve_intake_candidate_v1" as const,
    workflowId: WORKFLOW,
    walletSessionId: SESSION,
    network: "bitcoin-testnet4" as const,
    preparedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
    planHash: plan.planHash,
    bindingHash: plan.bindingHash,
    unsignedTxid: "cd".repeat(32),
    unsignedPsbtHash: "ef".repeat(32),
    inputUtxos: [{
      txid: "ab".repeat(32),
      vout: 1,
      valueSats: "250000",
      address: WALLET,
      scriptPubKeyHex: WALLET_SCRIPT
    }],
    reserveOutput: {
      vout: 0 as const,
      address: plan.reserve.address,
      scriptPubKeyHex: plan.reserve.scriptPubKeyHex,
      valueSats: "100000"
    },
    dataOutput: {
      vout: 1 as const,
      payloadHex: plan.tradeLayer.payloadHex,
      payloadBytes: plan.tradeLayer.payloadBytes
    },
    changeOutput: {
      vout: 2 as const,
      address: WALLET,
      scriptPubKeyHex: WALLET_SCRIPT,
      valueSats: "149400"
    },
    feeSats: "600",
    feeRateSatVb: 2,
    signingPerformed: false as const,
    broadcastPerformed: false as const
  };
  const candidateHash = hashObject(core);
  return {
    plan,
    candidate: {
      candidateId: `reserve_candidate_${candidateHash.slice(0, 32)}`,
      candidateHash,
      ...core
    }
  };
}

test("remote wallet protocol accepts only the exact public reserve candidate", () => {
  const { plan, candidate } = fixture();
  const validated = validatedReserveIntakeCandidate({
    value: candidate,
    plan,
    workflowId: WORKFLOW,
    walletSessionId: SESSION,
    network: "bitcoin-testnet4",
    walletAddress: WALLET,
    amountSats: "100000",
    networkFeeSats: "600"
  });
  assert.deepEqual(validated, candidate);
  assert.equal((validated as any).rawPsbt, undefined);

  assert.throws(() => validatedReserveIntakeCandidate({
    value: {
      ...candidate,
      dataOutput: { ...candidate.dataOutput, payloadHex: "00" }
    },
    plan,
    workflowId: WORKFLOW,
    walletSessionId: SESSION,
    network: "bitcoin-testnet4",
    walletAddress: WALLET,
    amountSats: "100000",
    networkFeeSats: "600"
  }), /tx11 plan/i);
});

test("reserve intake simulation displays exact Bitcoin lock, fee, payload, and later order boundary", () => {
  const { plan, candidate } = fixture();
  const simulation = simulateReserveIntake({
    plan,
    balanceSats: "250000",
    networkFeeSats: "600",
    walletCandidate: candidate,
    now: NOW,
    ttlMs: 300_000
  });
  assert.equal(simulation.action, "fund_starter_strategy");
  assert.equal(simulation.balanceAfterSats, "149400");
  assert.equal(simulation.effects.length, 1);
  assert.deepEqual(simulation.effects[0], {
    asset: "BTC",
    direction: "lock",
    amount: "100000",
    unit: "sats",
    destination: plan.reserve.address,
    condition: "immediate"
  });
  assert.equal(simulation.payloadHex, plan.tradeLayer.payloadHex);
  assert.equal(simulation.walletCandidate?.candidateHash, candidate.candidateHash);
  assert.equal(simulation.warnings.some((warning) => /later, separately simulated/i.test(warning)), true);

  const tampered = structuredClone(candidate);
  tampered.changeOutput.valueSats = "149401";
  const { candidateId: _candidateId, candidateHash: _candidateHash, ...tamperedCore } = tampered;
  tampered.candidateHash = hashObject(tamperedCore);
  tampered.candidateId = `reserve_candidate_${tampered.candidateHash.slice(0, 32)}`;
  assert.throws(() => simulateReserveIntake({
    plan,
    balanceSats: "250000",
    networkFeeSats: "600",
    walletCandidate: tampered,
    now: NOW,
    ttlMs: 300_000
  }), /candidate differs/i);
});
