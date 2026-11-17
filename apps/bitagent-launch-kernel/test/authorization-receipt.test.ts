import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  AuthorizationError,
  encodeSegwitAddress,
  normalizeOnchainAddress,
  verifyAuthorizationEventLog
} from "../src/authorization/index.js";
import {
  CARD_TOKEN,
  DEST_ADDRESS,
  MERCHANT,
  PAYEE,
  PRINCIPAL,
  REGISTRY,
  at,
  authorizeAndClaim,
  cardAction,
  createWorld,
  grantFor,
  lightningAction,
  minutes,
  onchainAction
} from "./authorization-fixtures.js";

test("one receipt shape carries principal, instrument, destination, max amount, expiry and revocation state on all three rails", async () => {
  const world = createWorld();
  for (const rail of ["card", "lightning", "onchain"] as const) {
    const receipt = world.issue(rail);
    assert.equal(receipt.schema, "bitagent_authorization_receipt_v1");
    assert.equal(receipt.grant.principal.id, PRINCIPAL);
    assert.equal(receipt.grant.instrument.rail, rail);
    assert.equal(receipt.grant.destination.rail, rail);
    assert.match(receipt.grant.maxAmount.value, /^[1-9][0-9]*$/);
    assert.ok(Date.parse(receipt.grant.expiresAt) > world.clock.now.getTime());
    assert.deepEqual(receipt.revocation, {
      status: "active",
      registryId: REGISTRY,
      serial: receipt.grant.revocationHandle.serial,
      checkedAt: world.clock.now.toISOString()
    });
    const status = await world.gate.inspect(JSON.parse(JSON.stringify(receipt)));
    assert.equal(status.valid, true, `${rail}: ${status.reasons.join(",")}`);
    assert.equal(status.revocation?.status, "active");
    assert.equal(status.remaining, receipt.grant.maxAmount.value);
  }
});

test("card: authorize, claim, settle with a processor-signed capture, then the one-shot receipt is consumed", async () => {
  const world = createWorld();
  const receipt = world.issue("card");
  const { order, attemptId } = await authorizeAndClaim(world, receipt, cardAction({ amountMinor: "1200" }));
  assert.equal(order.rail, "card");
  assert.equal(order.rail === "card" && order.merchantId, MERCHANT);

  const settled = await world.gate.settle({ attemptId, evidence: world.capture(attemptId, { amountMinor: "1150" }) });
  assert.equal(settled.status, "settled");
  assert.equal(settled.settledAmount, "1150");
  assert.deepEqual(settled.breaches, []);
  assert.equal(settled.remaining, "3850");

  const again = await world.gate.authorize({ receipt, action: cardAction({ amountMinor: "100" }) });
  assert.deepEqual(again.reasons, ["receipt_consumed"]);
});

test("lightning: the host node decodes the invoice and the preimage settles it at amount plus the fee allowance", async () => {
  const world = createWorld();
  const receipt = world.issue("lightning");
  const { invoice, preimage, paymentHash } = world.invoice({ amountMsat: "2500000" });
  const { order, attemptId, decision } = await authorizeAndClaim(world, receipt, lightningAction(invoice, { maxFeeMsat: "5000" }));
  assert.equal(decision.holdAmount, "2505000");
  assert.equal(order.rail === "lightning" && order.paymentHash, paymentHash);

  const settled = await world.gate.settle({ attemptId, evidence: { rail: "lightning", paymentHash, preimage } });
  assert.equal(settled.status, "settled");
  assert.equal(settled.settledAmount, "2505000");
  assert.equal(settled.remaining, String(100_000_000 - 2_505_000));
});

test("on-chain: settlement waits for confirmations and counts the wallet's net debit", async () => {
  const world = createWorld({ minConfirmations: 2 });
  const receipt = world.issue("onchain");
  const { attemptId } = await authorizeAndClaim(world, receipt, onchainAction({ amountSats: "150000", maxFeeSats: "1000" }));
  const txid = world.tx({
    state: "mempool",
    confirmations: 0,
    outputs: [{ vout: 0, valueSats: "150000", address: DEST_ADDRESS }, { vout: 1, valueSats: "40000", address: "tb1qchange" }],
    feeSats: "420",
    walletNetDebitSats: "150420"
  });
  const pending = await world.gate.settle({ attemptId, evidence: { rail: "onchain", txid } });
  assert.equal(pending.status, "pending");
  assert.deepEqual(pending.reasons, ["tx_not_confirmed"]);

  world.chain.set(txid, { ...world.chain.get(txid)!, state: "confirmed", confirmations: 2 });
  const settled = await world.gate.settle({ attemptId, evidence: { rail: "onchain", txid } });
  assert.equal(settled.status, "settled");
  assert.equal(settled.settledAmount, "150420");
  assert.equal(settled.remaining, String(200_000 - 150_420));
});

test("revocation is principal-signed, irreversible, idempotent, and stops new use while recorded spend stays", async () => {
  const world = createWorld();
  const receipt = world.issue("lightning");
  const first = world.invoice({ amountMsat: "1000000" });
  const { attemptId } = await authorizeAndClaim(world, receipt, lightningAction(first.invoice));
  await world.gate.settle({ attemptId, evidence: { rail: "lightning", paymentHash: first.paymentHash, preimage: first.preimage } });

  world.clock.now = new Date(world.clock.now.getTime() + minutes(5));
  const revoked = world.revoke(receipt);
  assert.equal(revoked.accepted, true);
  assert.equal(revoked.state?.status, "revoked");
  const revokedAt = revoked.state?.revokedAt;

  world.clock.now = new Date(world.clock.now.getTime() + minutes(5));
  assert.equal(world.revoke(receipt, "again").state?.revokedAt, revokedAt);

  const second = world.invoice({ amountMsat: "1000000" });
  const denied = await world.gate.authorize({ receipt, action: lightningAction(second.invoice) });
  assert.deepEqual(denied.reasons, ["receipt_revoked"]);
  assert.equal(denied.revocation?.status, "revoked");

  const status = await world.gate.inspect(receipt);
  assert.equal(status.valid, false);
  assert.equal(status.revocation?.revokedAt, revokedAt);
  assert.equal(status.spent, "1005000");
  assert.equal("unrevoke" in world.registry, false);
});

test("multi-use cap counts holds, partial captures and released failures", async () => {
  const world = createWorld();
  const receipt = world.issue("card", { usage: { kind: "multi_use" }, maxAmount: { asset: "USD", unit: "minor", value: "3000" } });
  const a = await authorizeAndClaim(world, receipt, cardAction({ amountMinor: "1500" }));
  const b = await world.gate.authorize({ receipt, action: cardAction({ amountMinor: "1500" }) });
  assert.equal(b.decision, "authorized");
  assert.equal(b.remaining, "0");
  assert.deepEqual((await world.gate.authorize({ receipt, action: cardAction({ amountMinor: "1" }) })).reasons, ["amount_exceeds_remaining"]);

  await world.gate.settle({ attemptId: a.attemptId, evidence: world.capture(a.attemptId, { amountMinor: "1000" }) });
  const claimB = await world.gate.claim(b.ticket);
  assert.equal(claimB.claimed, true);
  assert.deepEqual(await world.gate.fail(b.ticket), { released: true, reasons: [] });

  const status = await world.gate.inspect(receipt);
  assert.equal(status.spent, "1000");
  assert.equal(status.held, "0");
  assert.equal(status.remaining, "2000");
  assert.deepEqual(status.attempts.map((item) => item.status).sort(), ["failed", "settled"]);
});

test("the gate's event log is a verifiable hash chain and edits are detected", async () => {
  const world = createWorld();
  const receipt = world.issue("card");
  const { attemptId } = await authorizeAndClaim(world, receipt, cardAction());
  await world.gate.settle({ attemptId, evidence: world.capture(attemptId) });
  const events = world.gate.events();
  assert.deepEqual(events.map((event) => event.type), ["attempt_authorized", "attempt_claimed", "settlement_recorded"]);
  assert.equal(verifyAuthorizationEventLog(events), true);

  const edited = structuredClone(events);
  edited[2].payloadHash = "0".repeat(64);
  assert.equal(verifyAuthorizationEventLog(edited), false);
  assert.equal(verifyAuthorizationEventLog(events.slice(1)), false);
});

test("issuance refuses PANs, wrong-network or mixed-case addresses, unit mismatches and inverted validity", () => {
  const world = createWorld();
  const refuse = (rail: "card" | "lightning" | "onchain", overrides: Record<string, unknown>) =>
    assert.throws(() => world.issue(rail, overrides), (error) => error instanceof AuthorizationError && error.code === "receipt_malformed");

  refuse("card", { instrument: { rail: "card", instrumentId: "4111111111111111", network: "visa", currency: "USD" } });
  refuse("onchain", { destination: { rail: "onchain", address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4" } });
  refuse("onchain", { destination: { rail: "onchain", address: "tb1qW508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx" } });
  refuse("onchain", { destination: { rail: "onchain", address: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsy" } });
  refuse("lightning", { maxAmount: { asset: "BTC", unit: "sat", value: "1000" } });
  refuse("card", { maxAmount: { asset: "EUR", unit: "minor", value: "1000" } });
  refuse("card", { notBefore: at(minutes(10)), expiresAt: at(minutes(5)) });
  refuse("card", { destination: { rail: "lightning", payeeNodeId: PAYEE } });
  refuse("card", { maxAmount: { asset: "USD", unit: "minor", value: "0" } });
  refuse("card", { extra: true });

  const upper = world.issue("onchain", { destination: { rail: "onchain", address: DEST_ADDRESS.toUpperCase() } });
  assert.equal(upper.grant.destination.rail === "onchain" && upper.grant.destination.address, DEST_ADDRESS);
  const cardInstrument = world.issue("card").grant.instrument;
  assert.equal(cardInstrument.rail === "card" && cardInstrument.instrumentId, CARD_TOKEN);
});

test("address validation covers bech32m, base58 and Litecoin", () => {
  const program = crypto.randomBytes(32);
  const taproot = encodeSegwitAddress("tb", 1, program);
  assert.equal(normalizeOnchainAddress("bitcoin", "testnet4", taproot, "action_malformed"), taproot);
  assert.equal(normalizeOnchainAddress("bitcoin", "mainnet", "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0", "action_malformed").startsWith("bc1p"), true);
  assert.equal(normalizeOnchainAddress("bitcoin", "mainnet", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", "action_malformed"), "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2");
  assert.equal(normalizeOnchainAddress("bitcoin", "mainnet", "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", "action_malformed"), "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy");
  assert.throws(() => normalizeOnchainAddress("bitcoin", "testnet4", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", "action_malformed"));
  assert.throws(() => normalizeOnchainAddress("bitcoin", "mainnet", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3", "action_malformed"));
  // A witness v1 program encoded with the v0 (bech32) checksum must fail under BIP350.
  assert.throws(() => normalizeOnchainAddress("bitcoin", "mainnet", "bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7k7grplx", "action_malformed"));

  const litecoin = encodeSegwitAddress("ltc", 0, crypto.randomBytes(20));
  assert.equal(normalizeOnchainAddress("litecoin", "mainnet", litecoin, "action_malformed"), litecoin);
  assert.throws(() => normalizeOnchainAddress("bitcoin", "mainnet", litecoin, "action_malformed"));
  const receipt = createWorld().issue("onchain", {
    instrument: { rail: "onchain", chain: "litecoin", network: "mainnet", walletId: "ltc-wallet" },
    destination: { rail: "onchain", address: litecoin },
    maxAmount: { asset: "LTC", unit: "sat", value: "1000000" }
  });
  assert.equal(receipt.grant.maxAmount.asset, "LTC");
  assert.equal(grantFor("card").agentId, "agent-alpha");
});
