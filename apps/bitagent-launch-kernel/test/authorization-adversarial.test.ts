import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  AuthorizationError,
  canonicalJson,
  receiptIdForGrant,
  signRevocation,
  type AuthorizationReceipt
} from "../src/authorization/index.js";
import {
  ATTACKER_ADDRESS,
  ATTACKER_MERCHANT,
  ATTACKER_PAYEE,
  DEST_ADDRESS,
  MERCHANT,
  METER_ID,
  OTHER_KEY_ID,
  OTHER_METER_ID,
  OTHER_METER_SECRET,
  PAYEE,
  PRINCIPAL,
  PRINCIPAL_KEY_ID,
  REGISTRY,
  at,
  authorizeAndClaim,
  cardAction,
  createWorld,
  lightningAction,
  minutes,
  onchainAction,
  type World
} from "./authorization-fixtures.js";

const ATTACKER_SECRET = "attacker-guessed-webhook-secret-0123456789";

function meteredReceipt(world: World, maxValue = "1000") {
  return world.issue("card", { usage: { kind: "metered", meterId: METER_ID }, maxAmount: { asset: "USD", unit: "minor", value: maxValue } });
}

function window(index: number) {
  return { windowStart: at(-minutes(58 - index * 5)), windowEnd: at(-minutes(54 - index * 5)) };
}

async function rejectsTool(world: World, name: string, args: unknown, code: string) {
  await assert.rejects(world.tools.call(name, args), (error) => error instanceof AuthorizationError && error.code === code);
}

// =============================================================================================
// A. Forged payment receipts
// =============================================================================================

test("forged authorization receipts: attacker key, borrowed key, tampered fields, re-derived id, unprefixed signature", async () => {
  const world = createWorld();
  const attacker = crypto.generateKeyPairSync("ed25519");
  const deny = async (receipt: unknown) => (await world.gate.authorize({ receipt, action: cardAction() })).reasons;

  assert.deepEqual(await deny(world.issue("card", {}, attacker.privateKey)), ["signature_invalid"]);
  assert.deepEqual(await deny(world.issue("card", { principal: { id: PRINCIPAL, keyId: "attacker-key" } }, attacker.privateKey)), ["unknown_signing_key"]);
  assert.deepEqual(await deny(world.issue("card", { principal: { id: PRINCIPAL, keyId: OTHER_KEY_ID } }, world.otherKey)), ["principal_key_mismatch"]);

  const genuine = world.issue("card");
  const inflated = structuredClone(genuine);
  inflated.grant.maxAmount.value = "500000";
  assert.deepEqual(await deny(inflated), ["receipt_id_mismatch"]);
  inflated.receiptId = receiptIdForGrant(inflated.grant);
  assert.deepEqual(await deny(inflated), ["signature_invalid"]);

  const redirected = structuredClone(genuine);
  redirected.grant.destination = { rail: "card", merchantId: ATTACKER_MERCHANT, mccs: ["7372"] };
  redirected.receiptId = receiptIdForGrant(redirected.grant);
  assert.deepEqual(await deny(redirected), ["signature_invalid"]);

  const extended = structuredClone(genuine);
  extended.grant.expiresAt = at(minutes(60 * 24 * 29));
  assert.deepEqual(await deny(extended), ["receipt_id_mismatch"]);

  // A real principal signature over the bare grant (no domain prefix) must not verify as a receipt.
  const unprefixed = structuredClone(genuine);
  unprefixed.signature.value = crypto.sign(null, Buffer.from(canonicalJson(genuine.grant)), world.principalKey).toString("base64url");
  assert.deepEqual(await deny(unprefixed), ["signature_invalid"]);

  const padded = structuredClone(genuine);
  padded.signature.value = Buffer.from(genuine.signature.value, "base64url").toString("base64");
  assert.deepEqual(await deny(padded), ["receipt_malformed"]);

  const status = await world.gate.inspect(genuine);
  assert.equal(status.valid, true);
  assert.equal(status.spent, "0");
  assert.equal(status.held, "0");
});

test("a compromised principal key stops authorizing once the host revokes it, and cannot revoke on its own behalf", async () => {
  const world = createWorld();
  const receipt = world.issue("card");
  world.keys.revokeKey(PRINCIPAL_KEY_ID);
  assert.deepEqual((await world.gate.authorize({ receipt, action: cardAction() })).reasons, ["signing_key_revoked"]);
  const revocation = signRevocation(
    { registryId: REGISTRY, principalId: PRINCIPAL, keyId: PRINCIPAL_KEY_ID, serial: "victim-serial", signedAt: world.clock.now.toISOString(), reason: "attacker" },
    world.principalKey
  );
  assert.deepEqual(world.registry.revoke(revocation, world.clock.now).reasons, ["signing_key_revoked"]);
});

test("revocations are bound to the principal, the registry and the signature", () => {
  const world = createWorld();
  const receipt = world.issue("card");
  const serial = receipt.grant.revocationHandle.serial;
  const base = { registryId: REGISTRY, principalId: PRINCIPAL, keyId: PRINCIPAL_KEY_ID, serial, signedAt: world.clock.now.toISOString(), reason: "test" };

  const byBob = signRevocation({ ...base, principalId: "principal-bob", keyId: OTHER_KEY_ID }, world.otherKey);
  assert.equal(world.registry.revoke(byBob, world.clock.now).accepted, true);
  assert.equal(world.registry.status(PRINCIPAL, serial, world.clock.now).status, "active", "Bob revoked his own serial, not Alice's");

  assert.deepEqual(world.registry.revoke(signRevocation({ ...base, keyId: OTHER_KEY_ID }, world.otherKey), world.clock.now).reasons, ["principal_key_mismatch"]);
  assert.deepEqual(world.registry.revoke(signRevocation({ ...base, registryId: "other-registry" }, world.principalKey), world.clock.now).reasons, ["revocation_registry_mismatch"]);
  const tampered = { ...signRevocation(base, world.principalKey), serial: "another-serial" };
  assert.deepEqual(world.registry.revoke(tampered, world.clock.now).reasons, ["signature_invalid"]);
  assert.deepEqual(world.registry.revoke({ ...base, signature: "x" }, world.clock.now).reasons, ["revocation_malformed"]);
});

test("forged card capture receipts are refused; authentic double capture is recorded and freezes the receipt", async () => {
  const world = createWorld();
  const receipt = world.issue("card", { usage: { kind: "multi_use" } });
  const { attemptId } = await authorizeAndClaim(world, receipt, cardAction({ amountMinor: "1200" }));
  const settle = (evidence: unknown) => world.gate.settle({ attemptId, evidence });

  assert.deepEqual((await settle(world.capture(attemptId, {}, ATTACKER_SECRET))).reasons, ["card_signature_invalid"]);
  const genuine = world.capture(attemptId, { amountMinor: "1200" });
  assert.deepEqual((await settle({ ...genuine, amountMinor: "1" })).reasons, ["card_signature_invalid"], "under-reporting breaks the MAC");
  assert.deepEqual((await settle({ ...genuine, signature: undefined })).reasons, ["evidence_malformed"]);

  const other = await authorizeAndClaim(world, receipt, cardAction({ amountMinor: "500" }));
  const otherCapture = world.capture(other.attemptId, { amountMinor: "500" });
  assert.deepEqual((await settle(otherCapture)).reasons, ["card_reference_mismatch"]);

  const settled = await settle(genuine);
  assert.equal(settled.status, "settled");
  const replay = await settle(genuine);
  assert.equal(replay.replayed, true);
  assert.equal(replay.spent, "1200");

  const doubleCapture = await settle(world.capture(attemptId, { amountMinor: "1200" }));
  assert.equal(doubleCapture.status, "settled");
  assert.deepEqual(doubleCapture.breaches, ["duplicate_capture"]);
  assert.equal(doubleCapture.spent, "2400");

  // Money that already moved is still recorded on a frozen receipt; new spending is not allowed.
  assert.equal((await world.gate.settle({ attemptId: other.attemptId, evidence: otherCapture })).status, "settled");
  assert.deepEqual((await world.gate.authorize({ receipt, action: cardAction({ amountMinor: "1" }) })).reasons, ["receipt_frozen"]);
  const status = await world.gate.inspect(receipt);
  assert.equal(status.frozen, true);
  assert.equal(status.spent, "2900");
});

test("authentic card captures that disagree with the authorization freeze the receipt", async () => {
  const over = createWorld();
  const overReceipt = over.issue("card", { usage: { kind: "multi_use" } });
  const a = await authorizeAndClaim(over, overReceipt, cardAction({ amountMinor: "1200" }));
  const overcapture = await over.gate.settle({ attemptId: a.attemptId, evidence: over.capture(a.attemptId, { amountMinor: "1300" }) });
  assert.deepEqual(overcapture.breaches, ["card_overcapture"]);
  assert.equal(overcapture.settledAmount, "1300");
  assert.equal((await over.gate.inspect(overReceipt)).frozen, true);

  const wrong = createWorld();
  const wrongReceipt = wrong.issue("card");
  const b = await authorizeAndClaim(wrong, wrongReceipt, cardAction());
  const mismatch = await wrong.gate.settle({ attemptId: b.attemptId, evidence: wrong.capture(b.attemptId, { merchantId: ATTACKER_MERCHANT }) });
  assert.deepEqual(mismatch.reasons, ["card_capture_mismatch"]);
  assert.equal((await wrong.gate.inspect(wrongReceipt)).frozen, true);
});

test("forged Lightning payment proofs: random preimage, another invoice's preimage, swapped hash", async () => {
  const world = createWorld();
  const receipt = world.issue("lightning");
  const a = world.invoice({ amountMsat: "1000000" });
  const b = world.invoice({ amountMsat: "1000000" });
  const attemptA = await authorizeAndClaim(world, receipt, lightningAction(a.invoice));
  const settleA = (evidence: unknown) => world.gate.settle({ attemptId: attemptA.attemptId, evidence });

  assert.deepEqual((await settleA({ rail: "lightning", paymentHash: a.paymentHash, preimage: crypto.randomBytes(32).toString("hex") })).reasons, ["preimage_mismatch"]);
  assert.deepEqual((await settleA({ rail: "lightning", paymentHash: a.paymentHash, preimage: b.preimage })).reasons, ["preimage_mismatch"]);
  assert.deepEqual((await settleA({ rail: "lightning", paymentHash: b.paymentHash, preimage: b.preimage })).reasons, ["payment_hash_mismatch"]);
  assert.deepEqual((await settleA({ rail: "lightning", paymentHash: a.paymentHash, preimage: a.preimage.toUpperCase() })).reasons, ["evidence_malformed"]);
  assert.deepEqual((await settleA({ rail: "card", txid: a.paymentHash })).reasons, ["evidence_malformed"]);
  assert.deepEqual((await settleA({ rail: "onchain", txid: a.paymentHash })).reasons, ["evidence_rail_mismatch"]);
  assert.equal((await settleA({ rail: "lightning", paymentHash: a.paymentHash, preimage: a.preimage })).status, "settled");

  const attemptB = await authorizeAndClaim(world, receipt, lightningAction(b.invoice));
  const reuse = await world.gate.settle({ attemptId: attemptB.attemptId, evidence: { rail: "lightning", paymentHash: a.paymentHash, preimage: a.preimage } });
  assert.deepEqual(reuse.reasons, ["payment_hash_mismatch"]);
  assert.equal((await world.gate.inspect(receipt)).spent, "1005000");
});

test("forged on-chain payment receipts: unknown txid, wrong address, underpayment, a stranger's tx, reorg, reused txid", async () => {
  const world = createWorld();
  const receipt = world.issue("onchain", { usage: { kind: "multi_use" }, maxAmount: { asset: "BTC", unit: "sat", value: "400000" } });
  const first = await authorizeAndClaim(world, receipt, onchainAction({ amountSats: "150000" }));
  const settle = (attemptId: string, txid: string) => world.gate.settle({ attemptId, evidence: { rail: "onchain", txid } });
  const ours = (outputs: Array<{ vout: number; valueSats: string; address?: string }>, extra = {}) =>
    world.tx({ outputs, feeSats: "500", walletNetDebitSats: String(outputs.reduce((sum, item) => sum + Number(item.valueSats), 0) + 500), ...extra });

  assert.deepEqual((await settle(first.attemptId, crypto.randomBytes(32).toString("hex"))).reasons, ["tx_not_found"]);
  assert.deepEqual((await settle(first.attemptId, ours([{ vout: 0, valueSats: "150000", address: ATTACKER_ADDRESS }]))).reasons, ["tx_output_missing"]);
  assert.deepEqual((await settle(first.attemptId, ours([{ vout: 0, valueSats: "149999", address: DEST_ADDRESS }]))).reasons, ["tx_output_missing"]);
  const stranger = world.tx({ outputs: [{ vout: 0, valueSats: "150000", address: DEST_ADDRESS }], feeSats: "300" });
  assert.deepEqual((await settle(first.attemptId, stranger)).reasons, ["tx_not_from_wallet"]);
  const strangerWithDebit = world.tx({ outputs: [{ vout: 0, valueSats: "150000", address: DEST_ADDRESS }], feeSats: "300", walletNetDebitSats: "0" });
  assert.deepEqual((await settle(first.attemptId, strangerWithDebit)).reasons, ["tx_not_from_wallet"]);
  assert.deepEqual((await settle(first.attemptId, ours([{ vout: 0, valueSats: "150000", address: DEST_ADDRESS }], { state: "reorged" }))).reasons, ["tx_not_found"]);
  assert.deepEqual((await settle(first.attemptId, ours([{ vout: 0, valueSats: "150000", address: DEST_ADDRESS }], { feeSats: undefined }))).reasons, ["fee_unobservable"]);

  const good = ours([{ vout: 0, valueSats: "150000", address: DEST_ADDRESS.toUpperCase() }]);
  assert.equal((await settle(first.attemptId, good)).status, "settled");

  const second = await authorizeAndClaim(world, receipt, onchainAction({ amountSats: "150000" }));
  assert.deepEqual((await settle(second.attemptId, good)).reasons, ["settlement_reference_reused"]);
  const status = await world.gate.inspect(receipt);
  assert.equal(status.spent, "150500");
  assert.equal(status.held, "151000");
});

test("an authentic on-chain payment that overpays or overspends on fees is recorded and freezes the receipt", async () => {
  const world = createWorld();
  const receipt = world.issue("onchain", { usage: { kind: "multi_use" }, maxAmount: { asset: "BTC", unit: "sat", value: "400000" } });
  const { attemptId } = await authorizeAndClaim(world, receipt, onchainAction({ amountSats: "150000", maxFeeSats: "1000" }));
  const txid = world.tx({ outputs: [{ vout: 0, valueSats: "160000", address: DEST_ADDRESS }], feeSats: "4000", walletNetDebitSats: "164000" });
  const result = await world.gate.settle({ attemptId, evidence: { rail: "onchain", txid } });
  assert.equal(result.status, "settled");
  assert.deepEqual(result.breaches, ["onchain_overpayment", "fee_exceeds_max"]);
  assert.equal(result.settledAmount, "164000");
  assert.deepEqual((await world.gate.authorize({ receipt, action: onchainAction({ amountSats: "1000" }) })).reasons, ["receipt_frozen"]);
});

test("forged executor tickets are refused and a genuine ticket is single-use", async () => {
  const world = createWorld();
  const twin = createWorld();
  const receipt = world.issue("card");
  const decision = await world.gate.authorize({ receipt, action: cardAction() });
  const ticket = decision.ticket!;
  const [attemptId, mac] = ticket.split(".");

  assert.deepEqual(await world.gate.claim(`${attemptId}.${"A".repeat(mac.length)}`), { claimed: false, reasons: ["ticket_invalid"] });
  assert.deepEqual(await world.gate.claim(attemptId), { claimed: false, reasons: ["ticket_invalid"] });
  assert.deepEqual(await world.gate.claim({ ticket }), { claimed: false, reasons: ["ticket_invalid"] });
  const foreign = await twin.gate.authorize({ receipt: twin.issue("card"), action: cardAction() });
  assert.deepEqual(await world.gate.claim(foreign.ticket), { claimed: false, reasons: ["ticket_invalid"] });
  assert.deepEqual(await world.gate.fail(`${attemptId}.forged`), { released: false, reasons: ["ticket_invalid"] });

  assert.equal((await world.gate.claim(ticket)).claimed, true);
  assert.deepEqual(await world.gate.claim(ticket), { claimed: false, reasons: ["ticket_already_claimed"] });
  assert.deepEqual(await world.gate.cancel(attemptId), { released: false, reasons: ["attempt_closed"] });
});

test("proof of payment for an attempt the executor reported as failed is recorded, not dropped", async () => {
  const world = createWorld();
  const receipt = world.issue("lightning");
  const { invoice, paymentHash, preimage } = world.invoice({ amountMsat: "1000000" });
  const { attemptId, ticket } = await authorizeAndClaim(world, receipt, lightningAction(invoice));
  assert.deepEqual(await world.gate.fail(ticket), { released: true, reasons: [] });
  assert.equal((await world.gate.inspect(receipt)).held, "0");

  const forged = await world.gate.settle({ attemptId, evidence: { rail: "lightning", paymentHash, preimage: crypto.randomBytes(32).toString("hex") } });
  assert.deepEqual(forged.reasons, ["preimage_mismatch"]);
  const late = await world.gate.settle({ attemptId, evidence: { rail: "lightning", paymentHash, preimage } });
  assert.equal(late.status, "settled");
  assert.deepEqual(late.breaches, ["settled_after_failure"]);
  const status = await world.gate.inspect(receipt);
  assert.equal(status.spent, "1005000");
  assert.equal(status.held, "0");
  assert.equal(status.frozen, true);
});

// =============================================================================================
// B. Duplicated metering charges
// =============================================================================================

test("an identical meter charge delivered twice debits once", async () => {
  const world = createWorld();
  const receipt = meteredReceipt(world);
  const event = world.meterEvent(receipt);
  const first = await world.gate.chargeMeter({ receipt, event });
  const second = await world.gate.chargeMeter({ receipt, event: structuredClone(event) });
  assert.equal(first.status, "charged");
  assert.equal(second.status, "duplicate");
  assert.equal(second.amount, "250");
  assert.equal(second.spent, "250");
  assert.equal((await world.gate.inspect(receipt)).spent, "250");
});

test("a reused event id with different content is a conflict, not a second charge", async () => {
  const world = createWorld();
  const receipt = meteredReceipt(world);
  const event = world.meterEvent(receipt, { eventId: "evt-1" });
  await world.gate.chargeMeter({ receipt, event });
  const resigned = world.meterEvent(receipt, { eventId: "evt-1", sequence: 2, ...window(5), quantity: "20", amount: "500" });
  assert.deepEqual((await world.gate.chargeMeter({ receipt, event: resigned })).reasons, ["meter_event_conflict"]);
  assert.equal((await world.gate.inspect(receipt)).spent, "250");
});

test("a fresh event id cannot rebill a used sequence number or an already-billed usage window", async () => {
  const world = createWorld();
  const receipt = meteredReceipt(world);
  await world.gate.chargeMeter({ receipt, event: world.meterEvent(receipt, { sequence: 1, ...window(0) }) });
  const sameSequence = world.meterEvent(receipt, { sequence: 1, ...window(3) });
  assert.deepEqual((await world.gate.chargeMeter({ receipt, event: sameSequence })).reasons, ["duplicate_meter_sequence"]);
  const overlapping = world.meterEvent(receipt, { sequence: 2, windowStart: at(-minutes(56)), windowEnd: at(-minutes(50)) });
  assert.deepEqual((await world.gate.chargeMeter({ receipt, event: overlapping })).reasons, ["overlapping_usage_window"]);
  const contained = world.meterEvent(receipt, { sequence: 3, windowStart: at(-minutes(57)), windowEnd: at(-minutes(56)) });
  assert.deepEqual((await world.gate.chargeMeter({ receipt, event: contained })).reasons, ["overlapping_usage_window"]);
  const adjacent = world.meterEvent(receipt, { sequence: 4, ...window(1) });
  assert.equal((await world.gate.chargeMeter({ receipt, event: adjacent })).status, "charged");
  assert.equal((await world.gate.inspect(receipt)).spent, "500");
});

test("concurrent duplicate deliveries debit exactly once and concurrent distinct charges never pass the cap", async () => {
  const world = createWorld();
  const receipt = meteredReceipt(world, "1000");
  const event = world.meterEvent(receipt, { sequence: 0, ...window(0) });
  const burst = await Promise.all(Array.from({ length: 10 }, () => world.gate.chargeMeter({ receipt, event: structuredClone(event) })));
  assert.equal(burst.filter((item) => item.status === "charged").length, 1);
  assert.equal(burst.filter((item) => item.status === "duplicate").length, 9);

  const distinct = Array.from({ length: 9 }, (_, index) => world.meterEvent(receipt, { sequence: index + 1, ...window(index + 1) }));
  const results = await Promise.all(distinct.map((item) => world.gate.chargeMeter({ receipt, event: item })));
  assert.equal(results.filter((item) => item.status === "charged").length, 3);
  assert.ok(results.filter((item) => item.status === "rejected").every((item) => item.reasons[0] === "amount_exceeds_remaining"));
  const status = await world.gate.inspect(receipt);
  assert.equal(status.spent, "1000");
  assert.equal(status.remaining, "0");
});

test("the same signed charge cannot be billed to a second receipt", async () => {
  const world = createWorld();
  const first = meteredReceipt(world);
  const second = meteredReceipt(world);
  const event = world.meterEvent(first, { sequence: 7, ...window(2) });
  assert.equal((await world.gate.chargeMeter({ receipt: first, event })).status, "charged");
  assert.deepEqual((await world.gate.chargeMeter({ receipt: second, event })).reasons, ["meter_event_conflict"]);
  const rebound = world.meterEvent(second, { sequence: 7, ...window(2) });
  assert.deepEqual((await world.gate.chargeMeter({ receipt: second, event: rebound })).reasons, ["duplicate_meter_sequence"]);
  const sameWindow = world.meterEvent(second, { sequence: 8, ...window(2) });
  assert.deepEqual((await world.gate.chargeMeter({ receipt: second, event: sameWindow })).reasons, ["overlapping_usage_window"]);
  const unbound = world.meterEvent(first, { sequence: 9, ...window(4) });
  assert.deepEqual((await world.gate.chargeMeter({ receipt: second, event: unbound })).reasons, ["meter_mismatch"]);
  assert.equal((await world.gate.inspect(second)).spent, "0");
});

test("meter charges must be authentic, consistent, inside the receipt window, and on a metered receipt", async () => {
  const world = createWorld();
  const receipt = meteredReceipt(world);
  const charge = (event: unknown, target: AuthorizationReceipt = receipt) => world.gate.chargeMeter({ receipt: target, event });

  assert.deepEqual((await charge(world.meterEvent(receipt, {}, ATTACKER_SECRET))).reasons, ["meter_signature_invalid"]);
  const genuine = world.meterEvent(receipt);
  assert.deepEqual((await charge({ ...genuine, amount: "1" })).reasons, ["meter_signature_invalid"]);
  assert.deepEqual((await charge(world.meterEvent(receipt, { meterId: OTHER_METER_ID }, OTHER_METER_SECRET))).reasons, ["meter_mismatch"]);
  assert.deepEqual((await charge(world.meterEvent(receipt, { amount: "999" }))).reasons, ["meter_amount_mismatch"]);
  assert.deepEqual((await charge(world.meterEvent(receipt, { quantity: "0", amount: "0" }))).reasons, ["meter_amount_mismatch"]);
  assert.deepEqual((await charge(world.meterEvent(receipt, { windowStart: at(minutes(5)), windowEnd: at(minutes(10)) }))).reasons, ["meter_window_invalid"]);
  assert.deepEqual((await charge(world.meterEvent(receipt, { windowStart: at(-minutes(90)), windowEnd: at(-minutes(70)) }))).reasons, ["meter_window_invalid"]);
  assert.deepEqual((await charge(world.meterEvent(receipt, { windowStart: at(-minutes(10)), windowEnd: at(-minutes(20)) }))).reasons, ["meter_window_invalid"]);
  assert.deepEqual((await charge({ ...genuine, sequence: -1 })).reasons, ["meter_event_malformed"]);
  assert.deepEqual((await charge({ ...genuine, sequence: 1.5 })).reasons, ["meter_event_malformed"]);

  const payment = world.issue("card", { usage: { kind: "multi_use" } });
  assert.deepEqual((await charge(world.meterEvent(payment), payment)).reasons, ["usage_mode_mismatch"]);
  assert.deepEqual((await world.gate.authorize({ receipt, action: cardAction() })).reasons, ["usage_mode_mismatch"]);
  assert.equal((await world.gate.inspect(receipt)).spent, "0");
});

test("a provider retry after revocation is a no-op, and new charges are refused", async () => {
  const world = createWorld();
  const receipt = meteredReceipt(world);
  const event = world.meterEvent(receipt, { sequence: 1, ...window(0) });
  await world.gate.chargeMeter({ receipt, event });
  world.revoke(receipt);
  assert.equal((await world.gate.chargeMeter({ receipt, event })).status, "duplicate");
  const fresh = world.meterEvent(receipt, { sequence: 2, ...window(1) });
  assert.deepEqual((await world.gate.chargeMeter({ receipt, event: fresh })).reasons, ["receipt_revoked"]);
  assert.equal((await world.gate.inspect(receipt)).spent, "250");
});

// =============================================================================================
// C. Compromised agent tools
// =============================================================================================

test("a compromised tool cannot redirect funds on any rail", async () => {
  const world = createWorld();
  const card = world.issue("card");
  const lightning = world.issue("lightning");
  const onchain = world.issue("onchain");
  const reasons = async (name: string, receipt: AuthorizationReceipt, action: unknown) => {
    const result = await world.tools.call(name, { receipt, action });
    return "reasons" in result ? result.reasons : [];
  };

  assert.deepEqual(await reasons("bitagent.authz.card.charge", card, cardAction({ merchantId: ATTACKER_MERCHANT })), ["destination_mismatch"]);
  assert.deepEqual(await reasons("bitagent.authz.card.charge", card, cardAction({ mcc: "7995" })), ["mcc_not_allowed"]);
  const attackerInvoice = world.invoice({ payee: ATTACKER_PAYEE });
  assert.deepEqual(await reasons("bitagent.authz.lightning.pay", lightning, lightningAction(attackerInvoice.invoice)), ["destination_mismatch"]);
  assert.deepEqual(await reasons("bitagent.authz.onchain.send", onchain, onchainAction({ address: ATTACKER_ADDRESS })), ["destination_mismatch"]);
  assert.deepEqual(
    await reasons("bitagent.authz.onchain.send", onchain, onchainAction({ address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4" })),
    ["destination_mismatch"]
  );
  assert.deepEqual(world.dispatched, []);
});

test("a compromised tool cannot exceed the cap, switch currency, or move a receipt onto another rail", async () => {
  const world = createWorld();
  const card = world.issue("card");
  const call = (name: string, action: unknown, receipt: unknown = card) => world.tools.call(name, { receipt, action });
  const reasons = async (name: string, action: unknown, receipt?: unknown) => {
    const result = await call(name, action, receipt);
    return "reasons" in result ? result.reasons : [];
  };
  assert.deepEqual(await reasons("bitagent.authz.card.charge", cardAction({ amountMinor: "5001" })), ["amount_exceeds_remaining"]);
  assert.deepEqual(await reasons("bitagent.authz.card.charge", cardAction({ currency: "EUR" })), ["currency_mismatch"]);
  const invoice = world.invoice();
  assert.deepEqual(await reasons("bitagent.authz.lightning.pay", lightningAction(invoice.invoice)), ["rail_mismatch"]);
  assert.deepEqual(await reasons("bitagent.authz.onchain.send", onchainAction()), ["rail_mismatch"]);
  await rejectsTool(world, "bitagent.authz.card.charge", { receipt: card, action: lightningAction(invoice.invoice) }, "invalid_arguments");
  assert.deepEqual(world.dispatched, []);
});

test("a compromised tool cannot mint, borrow, resurrect, or stretch a receipt", async () => {
  const world = createWorld();
  const attacker = crypto.generateKeyPairSync("ed25519");
  const charge = async (receipt: unknown) => {
    const result = await world.tools.call("bitagent.authz.card.charge", { receipt, action: cardAction() });
    return "reasons" in result ? result.reasons : [];
  };
  assert.deepEqual(await charge(world.issue("card", { principal: { id: "principal-mallory", keyId: "mallory-key" } }, attacker.privateKey)), ["unknown_signing_key"]);
  assert.deepEqual(await charge(world.issue("card", { agentId: "agent-beta" })), ["agent_mismatch"]);
  assert.deepEqual(await charge(world.issue("card", { revocationHandle: { registryId: "attacker-registry", serial: "s-1" } })), ["revocation_registry_mismatch"]);
  assert.deepEqual(await charge(world.issue("card", { expiresAt: at(minutes(60 * 24 * 60)) })), ["receipt_lifetime_exceeded"]);
  assert.deepEqual(await charge(world.issue("card", { notBefore: at(minutes(10)), expiresAt: at(minutes(60)) })), ["receipt_not_yet_valid"]);

  const revoked = world.issue("card");
  world.revoke(revoked);
  const resurrected = structuredClone(revoked);
  resurrected.revocation = { ...resurrected.revocation, status: "active", checkedAt: world.clock.now.toISOString() };
  assert.deepEqual(await charge(resurrected), ["receipt_revoked"]);

  const expiring = world.issue("card");
  world.clock.now = new Date(Date.parse(expiring.grant.expiresAt));
  assert.deepEqual(await charge(expiring), ["receipt_expired"]);
  assert.deepEqual(world.dispatched, []);
});

test("an idempotency key cannot smuggle a different action, and replays add no hold or ticket", async () => {
  const world = createWorld();
  const receipt = world.issue("card", { usage: { kind: "multi_use" } });
  const action = cardAction({ idempotencyKey: "order-42", amountMinor: "1000" });
  const first = await world.tools.call("bitagent.authz.card.charge", { receipt, action });
  const replay = await world.tools.call("bitagent.authz.card.charge", { receipt, action: { ...action } });
  assert.equal("replayed" in replay && replay.replayed, true);
  assert.equal("attemptId" in replay && "attemptId" in first && replay.attemptId === first.attemptId, true);
  assert.equal(world.dispatched.length, 1);
  assert.equal((await world.gate.inspect(receipt)).held, "1000");
  const smuggled = await world.tools.call("bitagent.authz.card.charge", { receipt, action: { ...action, amountMinor: "4000" } });
  assert.deepEqual("reasons" in smuggled && smuggled.reasons, ["idempotency_conflict"]);
  assert.equal((await world.gate.inspect(receipt)).held, "1000");
});

test("mutating the request or the receipt after authorization does not change the executor's order", async () => {
  const world = createWorld();
  const receipt = world.issue("card", { usage: { kind: "multi_use" } });
  const action = cardAction({ amountMinor: "1200" });
  const decision = await world.gate.authorize({ receipt, action });
  action.amountMinor = "4999";
  action.merchantId = ATTACKER_MERCHANT;
  (receipt.grant.destination as { merchantId: string }).merchantId = ATTACKER_MERCHANT;
  receipt.grant.maxAmount.value = "999999";
  const claim = await world.gate.claim(decision.ticket);
  assert.equal(claim.claimed, true);
  if (!claim.claimed || claim.order.rail !== "card") throw new Error("expected a card order");
  assert.equal(claim.order.merchantId, MERCHANT);
  assert.equal(claim.order.amountMinor, "1200");
  // The executor's copy is detached too: editing it cannot change what settlement checks against.
  claim.order.amountMinor = "4999";
  claim.order.merchantId = ATTACKER_MERCHANT;
  const settled = await world.gate.settle({ attemptId: decision.attemptId, evidence: world.capture(decision.attemptId!, { amountMinor: "1200" }) });
  assert.equal(settled.status, "settled");
  assert.deepEqual(settled.breaches, []);
});

test("agent tools have no route to claim, cancel, fail, revoke, or read tickets", async () => {
  const world = createWorld();
  for (const name of ["bitagent.authz.claim", "bitagent.authz.cancel", "bitagent.authz.fail", "bitagent.authz.revoke", "constructor", "__proto__", "toString", "hasOwnProperty"]) {
    await rejectsTool(world, name, {}, "unknown_tool");
  }
  const result = await world.tools.call("bitagent.authz.card.charge", { receipt: world.issue("card"), action: cardAction() });
  assert.equal("ticket" in result, false);
  assert.equal(JSON.stringify(result).includes(world.dispatched[0].split(".")[1]), false);
});

test("smuggled fields, malformed amounts and prototype pollution are refused", async () => {
  const world = createWorld();
  const receipt = world.issue("card", { usage: { kind: "multi_use" } });
  await rejectsTool(world, "bitagent.authz.card.charge", JSON.parse(`{"receipt":${JSON.stringify(receipt)},"action":${JSON.stringify(cardAction())},"__proto__":{"polluted":true}}`), "invalid_arguments");
  await rejectsTool(world, "bitagent.authz.card.charge", { receipt, action: cardAction(), overrideCap: true }, "invalid_arguments");
  await rejectsTool(world, "bitagent.authz.card.charge", null, "invalid_arguments");
  await rejectsTool(world, "bitagent.authz.card.charge", { receipt }, "invalid_arguments");

  const decide = async (action: unknown, target: unknown = receipt) => {
    const result = await world.tools.call("bitagent.authz.card.charge", { receipt: target, action });
    return "reasons" in result ? result.reasons : [];
  };
  assert.deepEqual(await decide({ ...cardAction(), overrideCap: true }), ["action_malformed"]);
  assert.deepEqual(await decide(JSON.parse(`{"__proto__":{"amountMinor":"1"},${JSON.stringify(cardAction()).slice(1)}`)), ["action_malformed"]);
  for (const amount of ["-1", "1.5", "1e3", "0x10", " 100", "１００", "01", "0", "1".repeat(31), 100]) {
    assert.deepEqual(await decide(cardAction({ amountMinor: amount })), ["action_malformed"], `amount ${JSON.stringify(amount)}`);
  }
  const grantExtra = structuredClone(receipt) as unknown as { grant: Record<string, unknown> };
  grantExtra.grant.unlimited = true;
  assert.deepEqual(await decide(cardAction(), grantExtra), ["receipt_malformed"]);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(({} as Record<string, unknown>).amountMinor, undefined);
  assert.equal((await world.gate.inspect(receipt)).held, "0");
});

test("Lightning invoice abuse: amountless, expired, wrong network, pinned hash, undecodable, double use", async () => {
  const world = createWorld();
  const receipt = world.issue("lightning");
  const pay = async (invoice: string, target: AuthorizationReceipt = receipt) => {
    const result = await world.tools.call("bitagent.authz.lightning.pay", { receipt: target, action: lightningAction(invoice) });
    return "reasons" in result ? result.reasons : [];
  };
  assert.deepEqual(await pay(world.invoice({ amountMsat: "" }).invoice), ["invoice_amount_missing"]);
  assert.deepEqual(await pay(world.invoice({ expiresAt: at(-minutes(1)) }).invoice), ["invoice_expired"]);
  assert.deepEqual(await pay(world.invoice({ network: "mainnet" }).invoice), ["invoice_network_mismatch"]);
  assert.deepEqual(await pay("lntbneverissuedbythepayee"), ["invoice_undecodable"]);
  const pinned = world.issue("lightning", { destination: { rail: "lightning", payeeNodeId: PAYEE, paymentHash: "ab".repeat(32) } });
  assert.deepEqual(await pay(world.invoice().invoice, pinned), ["payment_hash_mismatch"]);

  const shared = world.invoice({ amountMsat: "1000000" });
  assert.deepEqual(await pay(shared.invoice), ["authorized"]);
  assert.deepEqual(await pay(shared.invoice), ["invoice_already_used"]);
  assert.deepEqual(await pay(shared.invoice, world.issue("lightning")), ["invoice_already_used"]);
});

test("a tool racing the executor cannot settle an unexecuted attempt, and revocation before claim releases the hold", async () => {
  const world = createWorld();
  const receipt = world.issue("lightning");
  const { invoice, paymentHash, preimage } = world.invoice({ amountMsat: "1000000" });
  const decision = await world.tools.call("bitagent.authz.lightning.pay", { receipt, action: lightningAction(invoice) });
  assert.ok("attemptId" in decision && decision.attemptId);
  const early = await world.tools.call("bitagent.authz.settlement.submit", { attemptId: decision.attemptId, evidence: { rail: "lightning", paymentHash, preimage } });
  assert.deepEqual("reasons" in early && early.reasons, ["attempt_not_executed"]);

  world.revoke(receipt);
  const claim = await world.gate.claim(world.dispatched[0]);
  assert.deepEqual(claim, { claimed: false, reasons: ["receipt_revoked"] });
  const status = await world.gate.inspect(receipt);
  assert.equal(status.held, "0");
  assert.deepEqual(status.attempts.map((item) => item.status), ["cancelled"]);

  const unknown = await world.tools.call("bitagent.authz.settlement.submit", { attemptId: "att_does_not_exist", evidence: { rail: "lightning", paymentHash, preimage } });
  assert.deepEqual("reasons" in unknown && unknown.reasons, ["unknown_attempt"]);
});

test("racing payment requests from a compromised tool cannot double-spend a one-shot receipt or overrun a cap", async () => {
  const world = createWorld();
  const oneShot = world.issue("lightning", { usage: { kind: "one_shot" } });
  const invoices = Array.from({ length: 5 }, () => world.invoice({ amountMsat: "1000000" }));
  const raced = await Promise.all(invoices.map((item) => world.gate.authorize({ receipt: oneShot, action: lightningAction(item.invoice) })));
  assert.equal(raced.filter((item) => item.decision === "authorized").length, 1);
  assert.ok(raced.filter((item) => item.decision === "denied").every((item) => item.reasons[0] === "receipt_consumed"));

  const capped = world.issue("lightning", { maxAmount: { asset: "BTC", unit: "msat", value: "10000000" } });
  const bigInvoices = Array.from({ length: 10 }, () => world.invoice({ amountMsat: "2995000" }));
  const burst = await Promise.all(bigInvoices.map((item) => world.gate.authorize({ receipt: capped, action: lightningAction(item.invoice) })));
  assert.equal(burst.filter((item) => item.decision === "authorized").length, 3);
  const status = await world.gate.inspect(capped);
  assert.equal(status.held, "9000000");
  assert.ok(BigInt(status.held) + BigInt(status.spent) <= 10_000_000n);
});
