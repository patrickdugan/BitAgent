# Lifecycle Contract

## Stage order

Use the following monotonic stage order:

1. `wallet_connected`
2. `deposit_confirmed`
3. `collateral_mapped`
4. `reserve_simulated`
5. `reserve_approved`
6. `reserve_submitted`
7. `reserve_verified`
8. `signal_verified`
9. `order_simulated`
10. `order_approved`
11. `order_submitted`
12. `order_verified`
13. `pnl_settled`
14. `pnl_released`
15. `withdrawal_simulated`
16. `withdrawal_approved`
17. `withdrawal_submitted`
18. `withdrawal_verified`

Persist cancellations, rejected signatures, stale simulations, pending
verification, and recovery instructions without advancing the stage.

Track wallet-owned execution as a substate without changing the monotonic
stage order:

- `prepared`: public candidate exists; raw PSBT remains wallet-private;
- `executing`: one-time grant consumption or signing is in progress;
- `submitted`: a public txid/submission receipt exists and needs observation;
- `failed`: a terminal broker error is recorded, but retry still needs host
  reconciliation;
- `reconciliation_required`: submission outcome is ambiguous. Preserve locks
  and do not retry from absence alone.

## Receipt

Emit one JSON object with:

- `schema`: `bitagent_tradelayer_collateral_lifecycle_v2`
- `mode`: `simulated`, `testnet`, or `production`
- `lifecycleId`
- `network`
- `walletSessionId`: opaque public reference
- `deposit`
- `collateral`
- `reserveIntake`
- `signal`
- `order`
- `pnl`
- `pnlRelease`
- `withdrawal`

Validate the receipt with the bundled script. The checker enforces:

- canonical hashes and integer strings;
- confirmed deposit and matching funding roots;
- one separately approved reserve-intake transaction whose vout 0 is the
  recorded reserve outpoint;
- a plan-hash-bound preflight with exactly nine passing candidate-9 gates;
- exact tx11 release ID, code hash, and deployment commit, with `deployed`
  required outside simulated mode;
- verified signal provenance;
- complete order approval/execution/verification gates;
- closed or filled order state before PnL settlement;
- positive PnL bound to the order transaction;
- verified PnL release no greater than settled PnL;
- verified withdrawal no greater than released PnL;
- separate approvals for order, release, and withdrawal;
- no secret-like field names;
- no scripted evidence in production mode.

## Gated action shape

Use this shape for `reserveIntake`, `order`, `pnlRelease`, and `withdrawal`:

```json
{
  "status": "verified",
  "simulationHash": "<64 hex>",
  "effectsHash": "<64 hex>",
  "feesHash": "<64 hex>",
  "approval": {
    "id": "<opaque>",
    "status": "approved",
    "simulationHash": "<same 64 hex>"
  },
  "execution": {
    "id": "<opaque>",
    "status": "submitted",
    "simulationHash": "<same 64 hex>",
    "txids": ["<64 hex>"]
  },
  "verification": {
    "status": "verified",
    "txids": ["<64 hex>"],
    "source": "<independent public source>"
  }
}
```

Store exact effects and fee details in the underlying workflow state. The
lifecycle receipt stores their hashes to remain compact.

Wallet candidate commitments may be stored as public evidence. Approval
tokens, broker grants, raw PSBTs, signed transactions, and signatures must not
be stored in the lifecycle receipt or model-visible workflow projection.

## PnL recognition

Require `tradelayer_balance_delta_pnl_v1` evidence and include:

- its evidence hash;
- positive settled PnL in sats;
- every settlement transaction ID;
- an independent valuation source;
- an order state of `filled` or `closed`.

Do not classify an open order, mark-to-model projection, quoted spread, or
unconfirmed balance delta as settled PnL.

## Production completion

Production completion requires non-scripted sources for:

- deposit/UTXO observation;
- reserve-intake verification and chain-derived tx11 activation;
- order verification;
- PnL settlement;
- PnL release;
- withdrawal verification.

The repository currently lacks the PnL-release broker. Production receipts
must therefore fail validation until that seam is implemented and configured.
