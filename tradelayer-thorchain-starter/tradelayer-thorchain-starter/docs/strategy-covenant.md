# Strategy Covenant

Status: candidate-only testnet vertical slice, 2026-08-05.

## Outcome

The Strategy Covenant is a wallet-approved, versioned policy that converts a
fixed set of committed strategy proposals into one deterministic portfolio
candidate. It does not give Bonsai 8, Hermes Lite, an adapter, or the allocator
a signing key.

```text
voice/text mandate change
  -> canonical covenant
  -> wallet approval of exact covenant hash
  -> committed strategy proposals (effect: none)
  -> deterministic weighting and risk projection
  -> exact transaction manifest (effect: none)
  -> deterministic verifier
  -> replay receipt
  -> unsigned committed-signal draft
  -> approved external signal producer
  -> existing signal simulation / wallet approval / broker / verification
```

The current implementation stops before signal-producer signing. Channel-key,
TEE, wallet signing, broadcasting, counterparty cosigning, and settlement are
not exposed by this module.

## Authority contract

The policy approval and transaction approval are intentionally separate.

1. The user approves the exact `covenantHash`. This activates limits and
   strategy weights only.
2. Strategy adapters emit finite, hash-bound proposals. They cannot generate
   calldata, sign, broadcast, or change the covenant.
3. The host-owned allocator builds a candidate and a human-readable manifest.
4. The verifier recomputes the complete candidate from the same covenant,
   approval, proposals, market snapshot, portfolio root, fee, and timestamp.
5. A non-hold candidate sets `nextAuthority: wallet_user`. The covenant is not
   treated as blanket approval for a future transaction.
6. The bridge emits an unsigned `bitagent_tradelayer_signal_v1` input. The
   existing approved signal producer is the next authority and must use its
   pinned codebase/key policy.

This preserves:

```text
explain -> simulate -> display exact effects and fees -> wallet approval
  -> host execution -> deterministic verification
```

## Covenant fields

`src/mandates/types.ts` defines the canonical object. Important bindings are:

- mandate ID and monotonically increasing version;
- public wallet account/provider;
- tlUSD capital ceiling;
- exact channel allowlist;
- strategy IDs, versions, weights, and adapter SHA-256 hashes;
- drift, leverage, delta, order-size, loss, drawdown, slippage, and fee caps;
- one supported instrument: `TLBTC/TLUSD`;
- permitted TradeLayer action classes;
- order TTL, market freshness, oracle policy, and counterparty policy;
- base-model, allocator, and verifier hashes;
- activation and expiry times;
- canonical SHA-256 covenant hash.

Weights must total exactly 10,000 basis points. Unknown or secret-bearing
fields are rejected before persistence.

## Allocation and risk projection

Each strategy proposal supplies a target net-delta value in basis points. For
strategy `j`, weight `w_j`, and target `x_j,t`, the host computes:

```text
x*_t = trunc_toward_zero(sum(w_j * x_j,t) / 10000)
```

The result is projected into the covenant's net-delta interval. Gross
leverage, daily-loss, or drawdown circuit breakers force the target to neutral.
The trade delta is:

```text
delta_bps = projected_target_bps - current_net_delta_bps
```

No transaction is proposed inside the declared drift corridor. Outside it,
notional is capped by both scoped capital and `maxOrderFractionNavBps`, then
converted to integer satoshis using the committed mark price. Integer
rounding remains visible in `projectedNetDeltaBps`; the allocator does not
pretend the exact mathematical target was reached.

Normal changes produce a post-only limit-order candidate. Circuit-breaker
changes produce `reduce_position`. If the required action is absent from the
covenant, the flow fails closed.

## Exact manifest

Every non-hold candidate includes:

- wallet, channel, and Bitcoin testnet4 rail;
- locked asset and exact integer amount;
- TradeLayer tx5 contract class;
- side, limit price, and route;
- exact network fee and protocol fee;
- slippage ceiling;
- expected full-fill delta, with an explicit no-fill guarantee warning;
- permission class and expiration;
- covenant, proposal, market, portfolio, candidate, allocator, and verifier
  hashes.

The candidate always reports `effect: none`, `signingPerformed: false`, and
`broadcastPerformed: false`.

## Existing committed-signal bridge

`src/mandates/signalBridge.ts` converts only a verified, non-hold candidate to
an unsigned signal input. It binds:

```text
H(covenant, candidate, proposal root, market root, portfolio root)
```

into the signal's `inputSnapshotHash`. Amount, side, limit price, creation
time, and expiry are copied exactly. No payload hash or signature is produced.
The external signal producer and the existing `CommittedSignalKernel` remain
responsible for codebase authentication, tx5 encoding, UTXO funding,
simulation, exact wallet approval, broker execution, and verification.

## Replay receipt

The decision receipt contains the covenant, model, adapter, allocator,
verifier, market, proposal, candidate, and verifier-attestation hashes. It
records the target and projected delta and explicitly records that no signing
or broadcast occurred.

`FileStrategyReceiptStore` writes one content-addressed receipt per file and
verifies each file when it is reloaded. It is suitable for local single-host
evaluation. A production runtime still needs durable append-only storage,
access control, retention policy, and external attestation.

## Latency benchmark

The local benchmark compares:

| Mode | Local path | Execution eligible |
| --- | --- | --- |
| Direct baseline | proposals -> allocator | No; lower-bound timing only |
| Single enclave | proposals -> allocator -> one verifier | Candidate-only |
| Sharded verification | proposals -> allocator -> three verifier passes | Candidate-only; only one implementation today |
| Hybrid fast path | proposals -> allocator -> local verifier -> local audit | Candidate-only |

It reports p50, p95, and p99 for proposal validation, allocation, policy
verification, audit, and total local-process time. It does not measure TEE
transitions, network queues, a channel signature, counterparty cosign, Bitcoin
confirmation, or TradeLayer state update. Therefore the report supports only
directional local-overhead comparisons, not a production latency claim.

Run:

```powershell
npm run test:covenant
npm run eval:covenant
npm run demo:covenant
npm run bench:covenant -- --iterations=1000
```

Artifacts are written under `.runtime/strategy-covenant/` and are ignored by
Git.

## Production blockers

- The covenant wallet approval is a scripted opaque reference in the demo.
- The bridge has no configured approved signal producer or policy allowlist.
- No channel signer, TEE attestation, or capability lease is implemented.
- Repeated verifier passes are not independent verifier implementations.
- No live market/oracle/channel provider feeds this module.
- No candidate is currently signed, broadcast, cosigned, filled, or settled.
- Per-candidate wallet approval is still required; delegated unattended
  execution is deliberately not enabled.

The smallest safe next step is a shadow-mode adapter that feeds live,
read-only TradeLayer state into this exact covenant and compares proposed
orders with the current committed-signal lane without authorizing execution.
