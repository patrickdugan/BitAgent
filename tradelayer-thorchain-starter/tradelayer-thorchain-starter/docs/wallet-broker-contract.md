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
| `POST /v1/wallet/fee-estimate` | `bitagent_wallet_fee_estimate_v1` | Exact network fee in sats and public source label |
| `POST /v1/wallet/approvals` | `bitagent_wallet_approval_v1` | `pending` plus stable request ID, `rejected`, or `approved` plus an opaque one-time grant |
| `POST /v1/wallet/executions` | `bitagent_wallet_execution_v1` | Exact action/simulation binding, full txid, public submission time, optional order ID |

The approval request includes the complete immutable `TransactionSimulation`,
its hash, workflow ID, wallet session, and approval ID. A second call with the
same `walletApprovalRequestId` polls the same wallet prompt; it must not create
a replacement transaction or silently change any effect. A resumed connection
must return the requested wallet session, and every approval poll must echo the
same wallet approval request ID; BitAgent rejects either identity changing.

The execution request includes a deterministic `idempotencyKey`, the same
simulation and identifiers, and the opaque approval grant. The wallet must
atomically consume the grant, reconstruct and compare the exact effects and
fees shown to the user, and echo the idempotency key, approval ID, and wallet
approval request ID in the receipt. Duplicate calls return the original receipt.
A grant must be scoped to one wallet session, approval ID, simulation hash,
action, and expiry.

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

The remote wallet is never accepted as the verifier. Production factory setup
requires both an independent synchronized TradeLayer order source and an
independent Bitcoin withdrawal source before it will install this broker.

## Local configuration

```powershell
$env:BITAGENT_PRODUCTION="true"
$env:BITAGENT_WALLET_BROKER_URL="http://127.0.0.1:<wallet-owned-port>"
$env:BITAGENT_WALLET_BROKER_TOKEN="<opaque operator secret>"
$env:BITAGENT_WALLET_BROKER_TIMEOUT_MS="10000"
```

The conformance fixture in `test/remote-wallet-broker.test.ts` covers bearer
authentication, pending-to-approved recovery, exact simulation binding,
idempotency, secret-bearing response rejection, mismatched receipts, and the
independent-verifier production gate.
