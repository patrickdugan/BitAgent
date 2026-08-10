# Wallet-Owned Broker Contract

## Purpose and trust boundary

`RemoteWalletExecutionBroker` is the production-side BitAgent client for a
separate wallet-owned service. It transports public wallet state, immutable
simulations, approval identifiers, opaque one-time grants, and public
submission receipts. It never transports a mnemonic, seed, WIF, private key,
PSBT, raw signed transaction, or signature back into BitAgent.

The current `tradelayer-wallet` `sign-tx`, `sign-psbt`, and mnemonic-derived
address routes do not implement this contract and must not be proxied. A new
wallet-owned surface must implement the five endpoints below and keep all key
access, transaction construction, signing, and broadcast inside the wallet
process.

## Transport requirements

- HTTPS is required except for loopback HTTP during local integration.
- BitAgent sends `Authorization: Bearer <operator-configured token>` on every
  call. The wallet must compare it in constant time and bind every later call
  to the returned public `walletSessionId`.
- Requests and responses use JSON, `cache-control: no-store`, a 64 KiB maximum
  response, no redirects, and idempotent handling where specified.
- The bearer token belongs in process secret storage. It must never enter a
  workflow record, model prompt, event, error body, URL, or browser response.
- Unknown fields should be rejected. Every amount is a canonical decimal
  satoshi string and every transaction identity is a complete 64-hex txid.

## Endpoints

| Route | Request schema | Required result |
| --- | --- | --- |
| `POST /v1/wallet/connect` | `bitagent_wallet_connect_v1` | Connected network, opaque session ID, public address, confirmed sats, all four capabilities, timestamp |
| `POST /v1/wallet/deposit-address` | `bitagent_wallet_deposit_address_v1` | Wallet-owned address and its exact scriptPubKey |
| `POST /v1/wallet/fee-estimate` | `bitagent_wallet_fee_estimate_v1` | Exact sanitized starter-order carrier, Bitcoin withdrawal, or reserve-intake candidate |
| `POST /v1/wallet/approvals` | `bitagent_wallet_approval_v1` | `pending` plus stable request ID, `rejected`, or `approved` plus an opaque one-time grant |
| `POST /v1/wallet/executions` | `bitagent_wallet_execution_v1` | Exact action/simulation binding, full txid, public submission time, optional order ID |

The approval request includes the complete immutable `TransactionSimulation`,
its hash, workflow ID, wallet session, and approval ID. A second call with the
same `walletApprovalRequestId` polls the same wallet prompt; it must not create
a replacement transaction or silently change any effect. A resumed connection
must return the requested wallet session, and every approval poll must echo the
same wallet approval request ID; BitAgent rejects either identity changing.

For `withdraw_bitcoin`, the fee request includes the normalized destination.
The wallet selects and locks one confirmed input, calls Bitcoin Core
`walletcreatefundedpsbt`, decodes the result, and verifies input ownership,
destination at vout 0, positive wallet-owned change at vout 1, fee cap, and
satoshi arithmetic. The response exposes the public input/output material,
unsigned txid, and hash of the unsigned PSBT, but never the PSBT. BitAgent
validates that public candidate and includes it in the simulation hash. Reject,
expiry, supersession, or the default-disabled execution route cancels the
candidate and verifies that its input lock was released.

The execution request includes a deterministic `idempotencyKey`, the same
simulation and identifiers, and the opaque approval grant. The wallet must
atomically consume the grant, reconstruct and compare the exact effects and
fees shown to the user, and echo the idempotency key, approval ID, and wallet
approval request ID in the receipt. Duplicate calls return the original receipt.
A grant must be scoped to one wallet session, approval ID, simulation hash,
action, and expiry.

The current wallet implementation gives withdrawal and reserve intake separate
default-disabled release gates. Withdrawal requires
`BITAGENT_WALLET_TESTNET_EXECUTION_ENABLED=true`; reserve intake requires
`BITAGENT_WALLET_TESTNET_RESERVE_EXECUTION_ENABLED=true`. Each action also
requires its own explicit 64-hex release digest. Enabling one action never
enables the other. Both providers accept only Bitcoin testnet4. They require
the selected inputs to remain locked, sign inside Bitcoin Core, finalize and
decode the transaction, recheck every approved input and output, verify the
decoded fee through `testmempoolaccept`, and only then call
`sendrawtransaction`. Neither provider returns a PSBT, signed transaction, or
signature. A send error or mismatched returned txid is persisted as
`reconciliation_required`, and automatic retry is refused.

## Status and recovery

- `pending`: preserve the current simulation and approval request. No signing
  or broadcast has occurred. The user can refresh, approve in the wallet, and
  choose **Check wallet approval**.
- `rejected`: persist the rejection and state clearly that no transaction was
  executed. A new approval requires an explicit user action.
- `approved`: store the one-time grant internally and redact it as
  `[wallet-held]` from public workflow responses.
- `submitted`: persist the txid before independent verification. Duplicate
  execute calls return the same receipt.
- `reconciliation_required`: preserve the candidate and input reservation.
  A send may have occurred, so do not retry or unlock automatically. The
  wallet operator route may promote the record only after `gettransaction`
  returns the exact non-conflicted transaction and its decoded inputs and
  outputs match the approved candidate.

The remote wallet is never accepted as the verifier. Production factory setup
requires an independent UTXORef reserve/tlBTC funding source, an independent
synchronized TradeLayer order source, and an independent Bitcoin withdrawal
source before it will install this broker.

### Reserve-intake candidate and approval boundary

Because a tx5 order does not lock Bitcoin, BitAgent treats reserve funding as
a separate internal `fund_starter_strategy` action. The kernel builds a
hash-bound `bitagent_reserve_intake_plan_v1`; the wallet service prepares and
retains the unsigned candidate with reserve amount/script at vout 0, the exact
procedural tx11 payload at vout 1, and wallet change at vout 2. The public
response contains only candidate ID/hash/expiry, unsigned txid and PSBT hash,
public inputs/outputs/change, fee, and plan bindings. It never returns the
PSBT, signed transaction, raw transaction, signature, or key material to
BitAgent.

The wallet authority persists this candidate and binds approval to its exact
simulation hash. Independent TradeLayer preflight runs before approval; a
failed preflight preserves the candidate and input lock for safe retry, while
explicit rejection or cancellation releases the exact lock. Reserve execution
is implemented but disabled by default. It requires both the separate reserve
release switch and a reviewed reserve release digest; the withdrawal switch
does not authorize reserve signing or broadcast.

Immediately before reserve signing, the wallet fetches fresh operator evidence
and requires the exact plan hash, evidence age limit, all eight launch gates,
deployed release ID, and code hash to match the approval record. The one-time
grant is durably consumed before signing. After broadcast, BitAgent uses a
separate read-only verification boundary that joins the submitted txid's vout
0, plan hash, confirmation count, wallet session, and processed tx11 tlBTC
credit before allowing a separately simulated tx5 strategy order. It never
accepts the wallet's self-reported verification result.

### Starter-order candidate and approval boundary

For `starter_strategy`, BitAgent supplies a hash-bound
`bitagent_starter_order_plan_v1` before requesting any fee. The plan binds the
fresh quote, exact tlBTC/tlUSD properties and amounts, post-only price, complete
`tl5...` payload, workflow, session, and output order. The wallet validates that
payload through the authoritative tx5 encoding rules, selects one confirmed safe
testnet4 input, and privately constructs an unsigned carrier with the exact data
output at vout 0 and positive wallet-owned change at vout 1. Bitcoin principal
does not move; the exact miner fee is the only Bitcoin debit.

The public `bitagent_wallet_starter_order_candidate_v1` exposes only the input,
data/change outputs, fee, unsigned txid, PSBT hash, expiry, and plan bindings.
The wallet retains the raw PSBT. BitAgent revalidates the candidate and binds it
into the displayed simulation; any payload, property, amount, quote, fee, output,
session, or hash mismatch fails closed.

Starter-order signing is independently default-disabled. It requires
`BITAGENT_WALLET_TESTNET_STARTER_ORDER_EXECUTION_ENABLED=true`, a separate
64-hex release digest, and fresh `bitagent_starter_order_operator_evidence_v1`
for the exact plan both at approval and immediately before signing. The evidence
must prove two independent fresh node snapshots, chain-derived tx5 activation,
accepted code hash, intended properties, sufficient wallet tlBTC, fresh quote,
and exact post-only order parity. A broadcast receipt is still only submission
evidence; BitAgent must verify the resulting order through an independent
TradeLayer source.

## Local configuration

```powershell
$env:BITAGENT_PRODUCTION="true"
$env:BITAGENT_WALLET_BROKER_URL="http://127.0.0.1:<wallet-owned-port>"
$env:BITAGENT_WALLET_BROKER_TOKEN="<opaque operator secret>"
$env:BITAGENT_WALLET_BROKER_TIMEOUT_MS="10000"
$env:BITAGENT_RESERVE_OPERATOR_XONLY="<32-byte public x-only key hex>"
$env:BITAGENT_RESERVE_GUARDIAN_XONLY="<independent 32-byte public x-only key hex>"
$env:BITAGENT_RESERVE_RECOVERY_XONLY="<optional 32-byte public x-only key hex>"
$env:BITAGENT_RESERVE_RECOVERY_CSV_DELAY="2016"
$env:BITAGENT_RESERVE_PROPERTY_ID="<reviewed tlBTC receipt property id>"
```

The wallet-side execution switches are deliberately absent from the BitAgent
process. For a reviewed testnet4 reserve release they are configured only in
the wallet process:

```powershell
$env:BITAGENT_WALLET_TESTNET_RESERVE_EXECUTION_ENABLED="true"
$env:BITAGENT_WALLET_TESTNET_RESERVE_EXECUTION_RELEASE_ID="<reviewed 64-hex reserve release digest>"
```

The conformance fixture in `test/remote-wallet-broker.test.ts` covers bearer
authentication, pending-to-approved recovery, exact simulation binding,
unsigned-candidate tampering, idempotency, secret-bearing response rejection,
mismatched receipts, exact reserve candidates, tx11/output tampering,
funding cancellation, and the independent-verifier production gate.
