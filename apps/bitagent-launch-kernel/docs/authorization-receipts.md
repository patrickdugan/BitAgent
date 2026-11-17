# Authorization receipts (card, Lightning, on-chain)

One receipt format authorizes an agent to spend on any of three rails. Code:
`src/authorization/`. Tests: `npm run test:authorization`.

## The receipt

A principal signs a **grant**. The receipt is the grant plus its id, the
signature and a revocation snapshot.

| Field | Grant key | Notes |
|---|---|---|
| Principal | `principal {id, keyId}` | `keyId` must belong to `id` in the host's `PrincipalKeyStore` |
| Agent | `agentId` | the gate refuses receipts granted to another agent |
| Instrument | `instrument` | card token + network + currency; Lightning payer node + network; on-chain chain + network + wallet |
| Destination | `destination` | card merchant (+ optional MCC list); Lightning payee node (+ optional pinned payment hash); on-chain address |
| Maximum amount | `maxAmount {asset, unit, value}` | cumulative over the receipt's life; unit is fixed by the rail: card `minor`, Lightning `msat`, on-chain `sat` |
| Expiry | `notBefore`, `expiresAt` | canonical ISO UTC; lifetime capped by the gate (30 days by default) |
| Revocation | `revocationHandle {registryId, serial}` + `receipt.revocation` | the handle is signed; the snapshot is not and is never trusted |

`usage` is `one_shot`, `multi_use` or `metered {meterId}`. `nonce` makes each
grant unique.

`receiptId` is `sha256("bitagent/authorization-grant/v1\n" || canonicalJson(grant))`
and the Ed25519 signature covers the same bytes. The domain prefix stops a
signature over another document from verifying as a grant. Canonical JSON
sorts keys by code unit and accepts only plain objects, strings, booleans and
safe integers. A presented grant must already be canonical (bech32 lowercase,
MCCs sorted), because the signature covers that form; `issueAuthorizationReceipt`
normalizes before signing. Card instruments that look like a card number are
refused, so a PAN never enters a signed receipt.

## Lifecycle

```text
agent tool --authorize(receipt, action)--> gate --ticket--> host --> executor
                                              |                       |
                                              |<------claim(ticket)---|  (single use; returns the gate's own order)
                                              |<------fail(ticket)----|  (rail refused; hold released)
                                              |<-recordBroadcast------|  (on-chain: each txid the executor sent)
                                              |<-closeCapture---------|  (card: processor released the remainder)
agent tool --settle(attemptId, evidence)-->   |   verifies the rail's own proof, then records spend
provider   --chargeMeter(receipt, event)-->   |   metered receipts only
principal  --signed revocation--> RevocationRegistry (append-only; read by the gate on every call)
```

- **authorize** checks the receipt (id, signature, key status and validity,
  principal binding, agent, validity window, lifetime, live revocation, frozen
  flag), then the action against the grant, then holds `amount + maxFee`
  against `maxAmount - spent - held`. Idempotency keys are per receipt: the
  same key with the same action replays the original decision without a new
  hold; with a different action it is `idempotency_conflict`.
- **claim** re-checks the receipt. A receipt revoked or frozen after
  authorization cancels the attempt and releases the hold. Holds otherwise
  stay until the executor claims (then settles or fails) or the host cancels.
- **settle** accepts evidence only for a claimed attempt, and each settlement
  reference (card event id, payment hash, txid) settles one attempt across all
  receipts.
- **recordBroadcast** (host, on-chain): the executor reports each txid it
  broadcast for the attempt, including fee bumps. Only recorded txids settle
  it, and a txid belongs to one attempt.
- **closeCapture** (host, card): after a partial capture the uncaptured
  remainder stays held, because the processor can still capture it. The
  executor calls this once the processor has released it (final capture, void
  or expiry).

## Rail evidence

| Rail | Evidence from the tool | What the gate checks itself | Amount recorded |
|---|---|---|---|
| Card | processor capture webhook | processor HMAC, `reference == attemptId` | captured amount; the uncaptured remainder stays held |
| Lightning | `paymentHash`, `preimage` | `sha256(preimage) == paymentHash` of the invoice the host node decoded | invoice amount + the full fee allowance |
| On-chain | `txid` only | recorded by the executor for this attempt; host chain observer: outputs to the destination, fee, wallet net debit, confirmations | wallet net debit |

Lightning is charged the whole fee allowance because a preimage proves payment
but not the routing fee, and a tool could under-report it. An on-chain txid
must have been recorded by the executor for this attempt, so an older wallet
payment to the same address cannot settle it, and the observer must still show
a wallet net debit, so a stranger's payment cannot be claimed either.

**Breaches.** Authentic evidence for this attempt that breaks the
authorization is not ignored, because the money moved: captures above the
authorized amount (`card_overcapture`), a capture naming a different merchant,
instrument or currency (`card_capture_mismatch`), a capture after the attempt
was fully captured (`duplicate_capture`) or after the remainder was closed
(`capture_after_close`), on-chain overpayment, a second confirmed transaction
for one on-chain attempt (`duplicate_payment`), a fee over the cap, and proof of
payment for an attempt the executor reported as failed. The spend is recorded,
the breach is reported, and the receipt is **frozen**: no further
authorizations or meter charges. Settlements of attempts already in flight are
still recorded. Unfreezing is not implemented; the principal issues a new
receipt.

## Metering

Meter charges carry `receiptId`, `meterId`, `eventId`, `sequence`, a usage
window, `quantity × unitPrice = amount`, and the provider's HMAC. Per meter,
across all receipts:

- the same event delivered again (same receipt, same content) returns
  `duplicate` without a debit, even after revocation;
- a reused `eventId` with different content, or the same event sent to
  another receipt, is `meter_event_conflict`;
- a reused `sequence` is `duplicate_meter_sequence`;
- a window overlapping an already billed window is `overlapping_usage_window`;
- the window must lie inside the receipt's validity and not in the future.

## Trust boundaries

Trusted host components: `PrincipalKeyStore`, `RevocationRegistry`, the
Lightning invoice decoder (the host's node, e.g. `decodepay`), the on-chain
observer (structurally compatible with `BitcoinWithdrawalReadSource`), the
card and meter HMAC verifiers, the ticket key, and the executor.

Untrusted: everything arriving through `AuthorizationToolRegistry`. It exposes
inspect, card charge, Lightning pay, on-chain send, settlement submit and
meter submit. It has no claim, fail, cancel, recordBroadcast, closeCapture or
revoke tool, and decisions it
returns never contain the executor ticket. All input is parsed into fresh
objects with exact key sets, so later mutation by the caller has no effect,
and `__proto__` keys are rejected.

Revocation must be signed by an active key of the receipt's own principal;
revocations are keyed by (principal, serial), so one principal cannot revoke
another's receipts. There is no un-revoke.

## Not implemented

- State (ledgers, attempts, meter records, revocations, event log) is in
  memory. The event log is a verifiable hash chain (`verifyAuthorizationEventLog`)
  but is not persisted.
- No production adapters: card processor webhook intake, a Lightning node
  decoder, and the chain observer wiring are interfaces with test doubles.
- Settlement of accrued meter charges to the provider happens outside the gate.
- Lightning node ids are format-checked only; invoice signatures are the
  decoder's job.

## Tests

`test/authorization-receipt.test.ts` covers issuance and the full lifecycle on
each rail. `test/authorization-adversarial.test.ts` covers:

- **forged payment receipts:** grants signed by attacker or borrowed keys,
  tampered fields with and without a re-derived id, signatures without the
  domain prefix, re-encoded signatures, revoked principal keys; forged card
  captures, replayed captures for another attempt, double captures; wrong,
  swapped or reused Lightning preimages; on-chain txids the executor did not
  record (including an older genuine wallet payment to the same address),
  and recorded ones that are unknown, pay the wrong address, underpay, come
  from a stranger, were reorged, or belong to another attempt; captures that
  disagree with the grant, partial captures, captures after close; forged and
  replayed executor tickets;
- **duplicated metering charges:** redelivery, concurrent bursts, reused
  event ids, reused sequences, overlapping windows, cross-receipt replay,
  retries after revocation;
- **compromised agent tools:** redirected destinations on all three rails, cap
  overruns, currency and rail switching, self-minted, foreign-agent, expired,
  not-yet-valid, over-long and resurrected receipts, idempotency smuggling,
  mutation after authorization, missing host-only tools, smuggled fields and
  prototype pollution, Lightning invoice abuse, settling before the executor
  runs, and racing requests against one-shot receipts and caps.
