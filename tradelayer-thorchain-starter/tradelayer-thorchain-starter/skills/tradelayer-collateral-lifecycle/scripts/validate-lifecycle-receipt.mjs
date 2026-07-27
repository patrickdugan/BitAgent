#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const HEX_64 = /^[0-9a-f]{64}$/i;
const HEX_40_OR_64 = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
const TXID = HEX_64;
const FORBIDDEN_KEY = /(?:private.?key|seed.?phrase|mnemonic|(?:^|_)wif(?:$|_)|api.?key|secret)/i;
const SCRIPTED_SOURCE = /(?:scripted|mock|simulation|dry.?run|fixture)/i;

function fail(message) {
  throw new Error(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function text(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

function hash(value, label) {
  if (!HEX_64.test(String(value || ""))) fail(`${label} must be 32-byte hex`);
  return String(value).toLowerCase();
}

function positive(value, label) {
  if (!POSITIVE_INTEGER.test(String(value || ""))) fail(`${label} must be a positive integer string`);
  return BigInt(value);
}

function txids(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((txid) => !TXID.test(String(txid)))) {
    fail(`${label} must contain at least one 32-byte transaction id`);
  }
  return value.map((txid) => String(txid).toLowerCase());
}

function rejectSecretKeys(value, location = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretKeys(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) fail(`secret-like field is prohibited at ${location}.${key}`);
    rejectSecretKeys(item, `${location}.${key}`);
  }
}

function source(value, label, production) {
  const observed = text(value, label);
  if (production && SCRIPTED_SOURCE.test(observed)) fail(`${label} cannot be scripted in production`);
  return observed;
}

function gatedAction(value, label, production) {
  const action = object(value, label);
  if (action.status !== "verified") fail(`${label}.status must be verified`);
  const simulationHash = hash(action.simulationHash, `${label}.simulationHash`);
  hash(action.effectsHash, `${label}.effectsHash`);
  hash(action.feesHash, `${label}.feesHash`);

  const approval = object(action.approval, `${label}.approval`);
  text(approval.id, `${label}.approval.id`);
  if (approval.status !== "approved") fail(`${label}.approval.status must be approved`);
  if (hash(approval.simulationHash, `${label}.approval.simulationHash`) !== simulationHash) {
    fail(`${label}.approval must bind the exact simulation`);
  }

  const execution = object(action.execution, `${label}.execution`);
  text(execution.id, `${label}.execution.id`);
  if (execution.status !== "submitted") fail(`${label}.execution.status must be submitted`);
  if (hash(execution.simulationHash, `${label}.execution.simulationHash`) !== simulationHash) {
    fail(`${label}.execution must bind the exact simulation`);
  }
  const submittedTxids = txids(execution.txids, `${label}.execution.txids`);

  const verification = object(action.verification, `${label}.verification`);
  if (verification.status !== "verified") fail(`${label}.verification.status must be verified`);
  const verifiedTxids = new Set(txids(verification.txids, `${label}.verification.txids`));
  source(verification.source, `${label}.verification.source`, production);
  if (!submittedTxids.every((txid) => verifiedTxids.has(txid))) {
    fail(`${label}.verification must include every submitted transaction`);
  }
  return { action, submittedTxids };
}

function validate(receipt) {
  rejectSecretKeys(receipt);
  object(receipt, "receipt");
  if (receipt.schema !== "bitagent_tradelayer_collateral_lifecycle_v1") {
    fail("receipt.schema is unsupported");
  }
  if (!["simulated", "testnet", "production"].includes(receipt.mode)) {
    fail("receipt.mode must be simulated, testnet, or production");
  }
  const production = receipt.mode === "production";
  text(receipt.lifecycleId, "receipt.lifecycleId");
  if (!["bitcoin-testnet4", "bitcoin"].includes(receipt.network)) {
    fail("receipt.network must be bitcoin-testnet4 or bitcoin");
  }
  text(receipt.walletSessionId, "receipt.walletSessionId");

  const deposit = object(receipt.deposit, "deposit");
  if (deposit.status !== "confirmed") fail("deposit.status must be confirmed");
  if (!TXID.test(String(deposit.txid || ""))) fail("deposit.txid must be 32-byte hex");
  if (!Number.isSafeInteger(deposit.vout) || deposit.vout < 0) fail("deposit.vout is invalid");
  positive(deposit.amountSats, "deposit.amountSats");
  if (!Number.isSafeInteger(deposit.confirmations)
    || !Number.isSafeInteger(deposit.requiredConfirmations)
    || deposit.confirmations < deposit.requiredConfirmations) {
    fail("deposit does not meet the confirmation requirement");
  }
  const utxoRef = hash(deposit.utxoRef, "deposit.utxoRef");
  source(deposit.source, "deposit.source", production);

  const collateral = object(receipt.collateral, "collateral");
  if (collateral.status !== "mapped") fail("collateral.status must be mapped");
  if (hash(collateral.fundingRoot, "collateral.fundingRoot") !== utxoRef) {
    fail("collateral funding root must match the confirmed deposit UTXORef");
  }
  positive(collateral.amountSats, "collateral.amountSats");

  const signal = object(receipt.signal, "signal");
  if (signal.status !== "verified") fail("signal.status must be verified");
  if (!HEX_40_OR_64.test(String(signal.codebaseDigest || ""))) fail("signal.codebaseDigest is invalid");
  hash(signal.payloadHash, "signal.payloadHash");
  text(signal.producerKeyId, "signal.producerKeyId");
  text(signal.strategyId, "signal.strategyId");

  const orderResult = gatedAction(receipt.order, "order", production);
  if (!["filled", "closed"].includes(receipt.order.positionOrOrderState)) {
    fail("order.positionOrOrderState must be filled or closed before settling PnL");
  }

  const pnl = object(receipt.pnl, "pnl");
  if (pnl.status !== "settled") fail("pnl.status must be settled");
  const settledPnl = positive(pnl.settledPnlSats, "pnl.settledPnlSats");
  hash(pnl.evidenceHash, "pnl.evidenceHash");
  const pnlTxids = new Set(txids(pnl.transactionIds, "pnl.transactionIds"));
  source(pnl.source, "pnl.source", production);
  text(pnl.valuationSource, "pnl.valuationSource");
  if (!orderResult.submittedTxids.some((txid) => pnlTxids.has(txid))) {
    fail("PnL evidence must reference the order transaction");
  }

  const releaseResult = gatedAction(receipt.pnlRelease, "pnlRelease", production);
  const releasedPnl = positive(receipt.pnlRelease.amountSats, "pnlRelease.amountSats");
  if (releasedPnl > settledPnl) fail("released PnL exceeds settled PnL");
  hash(receipt.pnlRelease.releaseReceiptHash, "pnlRelease.releaseReceiptHash");
  text(receipt.pnlRelease.destinationWalletSessionId, "pnlRelease.destinationWalletSessionId");
  if (receipt.pnlRelease.destinationWalletSessionId !== receipt.walletSessionId) {
    fail("PnL release must target the lifecycle wallet session");
  }

  const withdrawalResult = gatedAction(receipt.withdrawal, "withdrawal", production);
  const withdrawn = positive(receipt.withdrawal.amountSats, "withdrawal.amountSats");
  if (withdrawn > releasedPnl) fail("withdrawal exceeds released PnL");
  text(receipt.withdrawal.destinationAddress, "withdrawal.destinationAddress");

  const approvalIds = [
    receipt.order.approval.id,
    receipt.pnlRelease.approval.id,
    receipt.withdrawal.approval.id
  ];
  if (new Set(approvalIds).size !== approvalIds.length) {
    fail("order, PnL release, and withdrawal require separate approvals");
  }

  return {
    ok: true,
    schema: receipt.schema,
    mode: receipt.mode,
    lifecycleId: receipt.lifecycleId,
    depositUtxoRef: utxoRef,
    settledPnlSats: settledPnl.toString(),
    releasedPnlSats: releasedPnl.toString(),
    withdrawnPnlSats: withdrawn.toString(),
    transactionCount: new Set([
      deposit.txid.toLowerCase(),
      ...orderResult.submittedTxids,
      ...releaseResult.submittedTxids,
      ...withdrawalResult.submittedTxids
    ]).size
  };
}

const receiptPath = process.argv[2];
if (!receiptPath) {
  console.error("usage: node validate-lifecycle-receipt.mjs <receipt.json>");
  process.exit(2);
}

try {
  const absolute = path.resolve(receiptPath);
  const receipt = JSON.parse(fs.readFileSync(absolute, "utf8"));
  console.log(JSON.stringify(validate(receipt)));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  }));
  process.exit(1);
}
