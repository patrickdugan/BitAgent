# Lifecycle Contract

## Stage order

Use the following monotonic stage order:

1. `wallet_connected`
2. `deposit_confirmed`
3. `collateral_mapped`
4. `signal_verified`
5. `order_simulated`
6. `order_approved`
7. `order_submitted`
8. `order_verified`
9. `pnl_settled`
10. `pnl_released`
11. `withdrawal_simulated`
12. `withdrawal_approved`
13. `withdrawal_submitted`
14. `withdrawal_verified`

Persist cancellations, rejected signatures, stale simulations, pending
verification, and recovery instructions without advancing the stage.

## Receipt

Emit one JSON object with:

- `schema`: `bitagent_tradelayer_collateral_lifecycle_v1`
- `mode`: `simulated`, `testnet`, or `production`
- `lifecycleId`
- `network`
- `walletSessionId`: opaque public reference
- `deposit`
- `collateral`
- `signal`
- `order`
- `pnl`
- `pnlRelease`
- `withdrawal`

Validate the receipt with the bundled script. The checker enforces:

- canonical hashes and integer strings;
- confirmed deposit and matching funding roots;
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

Use this shape for `order`, `pnlRelease`, and `withdrawal`:

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
- order verification;
- PnL settlement;
- PnL release;
- withdrawal verification.

The repository currently lacks the PnL-release broker. Production receipts
must therefore fail validation until that seam is implemented and configured.
