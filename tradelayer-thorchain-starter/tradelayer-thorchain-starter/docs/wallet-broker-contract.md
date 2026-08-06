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
| `POST /v1/wallet/fee-estimate` | `bitagent_wallet_fee_estimate_v1` | Strategy fee, or an exact sanitized unsigned Bitcoin withdrawal candidate with decoded fee/change |
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

The current wallet implementation enables withdrawal execution only when both
`BITAGENT_WALLET_TESTNET_EXECUTION_ENABLED=true` and an explicit 64-hex release
digest are configured. The provider itself accepts only Bitcoin testnet4. It
requires the selected inputs to remain locked, signs inside Bitcoin Core,
finalizes and decodes the transaction, rechecks every input and both exact
outputs, verifies the decoded fee through `testmempoolaccept`, and only then
calls `sendrawtransaction`. It never returns a PSBT, signed transaction, or
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

### Required reserve-intake extension (not implemented)

The current fee endpoint is insufficient for the starter strategy because a
tx5 order does not lock Bitcoin. Before funded launch, the wallet service must
prepare and retain an unsigned `bitagent_reserve_intake_plan_v1` candidate with
the displayed reserve amount/script at vout 0, the exact procedural tx11
payload at vout 1, and wallet change at vout 2. Its public response may expose
only the candidate ID/hash/expiry, unsigned txid, public inputs/outputs/change,
fee, and UTXORef manifest fields; it must not return a PSBT or signed/raw
transaction to BitAgent. Approval, signing, and broadcast remain wallet-owned.

The candidate is executable only after independent preflight proves tx11 is
active and the target TradeLayer deployment has the exact property, template
hash, contract state, and reserve redeem address. After broadcast, BitAgent
must independently join the on-chain reserve output to the processed tx11
credit before allowing a tx5 strategy simulation.

## Local configuration

```powershell
$env:BITAGENT_PRODUCTION="true"
$env:BITAGENT_WALLET_BROKER_URL="http://127.0.0.1:<wallet-owned-port>"
$env:BITAGENT_WALLET_BROKER_TOKEN="<opaque operator secret>"
$env:BITAGENT_WALLET_BROKER_TIMEOUT_MS="10000"
```

The conformance fixture in `test/remote-wallet-broker.test.ts` covers bearer
authentication, pending-to-approved recovery, exact simulation binding,
unsigned-candidate tampering, idempotency, secret-bearing response rejection,
mismatched receipts, and the independent-verifier production gate.
