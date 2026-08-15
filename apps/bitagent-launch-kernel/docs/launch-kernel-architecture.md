# BitAgent Launch Kernel Architecture

## Scope

The launch kernel implements one observable Bitcoin-to-TradeLayer journey and
only three intents: deposit Bitcoin, use a user-selected amount in one starter
strategy, and withdraw Bitcoin. It does not expose autonomous trading, other
strategies, other assets, portfolio optimization, or protocol expansion.

The starter strategy is one post-only TradeLayer transaction-type-5
tlBTC-for-tlUSD limit order. The exact amount comes from the user. The quote,
fees, payload, balance change, and expiry are captured in an immutable
simulation.

## Request path

The diagram's UTXO-Ref funding step now expands into an exact reserve/tx11
simulation, a separate wallet approval and submission, and independent reserve
output plus tlBTC verification. Only then can the later tx5 order be simulated.

```text
referral URL
  → intent-scoped conversation
  → public wallet session
  → wallet-owned Bitcoin address
  → observed UTXO + confirmation gate
  → UTXO-Ref V2 funding root
  → TradeLayer type-5 simulation
  → exact-effects approval
  → opaque wallet execution broker
  → independent synchronized tx/order verification
  → referral activation
  → exact Bitcoin withdrawal simulation and approval
  → independent Bitcoin Core withdrawal verification
```

`src/launch/kernel.ts` is the deterministic workflow coordinator.
`src/launch/agent.ts` turns one of the three natural-language requests into a
structured plan and a typed tool call. `src/launch/tools.ts` defines the ten
closed JSON-schema tools. Provider state can enter the workflow only through
typed wallet, quote, deposit-observation, execution, and verification results.

## Source-of-truth integrations

- Deposit confirmations use
  `UTXO-Ref/bitvm3/utxo_referee/m1_deposit_indexer.js`.
- The canonical UTXO commitment uses
  `v2.settlement.buildFundingSetV2()` from the UTXO-Ref safe namespace.
- The starter order payload uses
  `tradelayer.js/src/txEncoder.js#encodeOnChainTokenForToken`.
- Wallet UX and future execution should attach to the wallet balance, tx,
  deposit/withdraw, and BitVM runtime services identified in
  `docs/repo-map.md`.

The kernel does not call the sibling wallet's WIF-based signing routes or
`tradelayer.js#tokenTradeTransaction`, because those paths cross the
non-custodial boundary.

## State and recovery

The authoritative state contains funnel stage, public wallet metadata, deposit
status, selected strategy, simulation, approval, execution, verification,
recovery instructions, referral attribution, and a structured event journal.

- Local Node launch: atomic JSON through `FileWorkflowStore`.
- Tests: in-memory repository implementing the same contract.
- Hosted launch surface: Cloudflare D1 keyed by an opaque workflow ID.
- Browser storage: workflow ID and referral key only, never signing material.

Repeated start and execute operations are idempotent. Rejected or cancelled
approval preserves the simulation and recovery instructions. A submitted
action resumes at verification and cannot silently become a replacement
execution.

## Approval and truth boundaries

Every state-changing action follows:

```text
explain → simulate → display exact effects and fees → request approval → execute → verify
```

Approvals bind to the exact simulation hash. A changed amount, destination,
fee, payload, quote, or expiry requires a new simulation and approval. The
model cannot sign, broadcast, mint balances, change a transaction state, or
activate a referral. Public API responses redact the opaque wallet approval
token.

Production mode uses `UnavailableWalletBroker` and fails closed. The scripted
broker is for deterministic evaluation and the hosted demo; it does not
broadcast a transaction.

`RemoteWalletExecutionBroker` is the production client seam. It uses HTTPS or
loopback HTTP plus bearer authentication, binds every request to the public
wallet session and workflow, supports durable wallet-owned pending approvals,
and sends a deterministic idempotency key on execution. Response validation
rejects secret-key fields, PSBT/raw signed transaction material, insecure
transport, incomplete capabilities, and receipts that do not match the exact
action and simulation hash. Its `verify()` method always fails closed; only the
independent wrappers below may verify execution.

When an authenticated external broker is supplied with a
`StrategyFundingReadSource` and reserve public-key configuration, pending
strategy funding produces a wallet-owned candidate rather than a fictional
tlBTC balance. The candidate binds one input, reserve vout 0, tx11 payload
vout 1, change vout 2, exact fee, expiry, wallet session, plan hash, and
simulation hash. Approval and any later execution remain wallet-owned.
Independent verification requires the submitted txid at reserve outpoint
vout 0, the same plan/manifest hash, adequate confirmations, and matching
tlBTC intake before the later tx5 order can be simulated. Reserve verification
does not activate referral attribution.

When an authenticated external broker is also supplied with a
`TradeLayerOrderReadSource`, `IndependentlyVerifyingWalletBroker` delegates
connect, fee, approval, and execution to the wallet boundary but replaces its
starter-strategy verification result. The independent path requires
`tl_getsyncstatus`, an exact valid `tl_gettransaction`, and the complete txid
in either the open orderbook or address trade history. A stale or temporarily
offline listener persists `pending` and can be retried; it cannot activate a
referral or debit the workflow balance.

When a `BitcoinWithdrawalReadSource` is also supplied, the same wrapper
replaces broker withdrawal self-reporting. It derives the approved destination
script from the validated address and requires the exact txid, network, single
destination output, network fee, wallet net debit, and configured confirmation
depth from read-only Bitcoin Core evidence. Missing, mempool, and temporarily
offline observations remain retryable `pending`; mismatches and reorgs fail
closed. This verifier never selects inputs, signs, or broadcasts.

## Hermes Lite / Bonsai DAG boundary

The launch server exposes an additive, candidate-only controller seam for the
Prime-trained `bitagent.dag_candidate.v2` contract:

- `POST /api/workflows/:id/dag-task` previews the deterministic natural-language
  planner without changing workflow state, binds the resulting plan and public
  persisted workflow state by SHA-256, and returns a compact
  `bitagent.dag_task_packet.v2` packet.
- `POST /api/workflows/:id/dag-candidate` reconstructs that packet from current
  persisted state and applies a deterministic LDT to the proposed candidate.
  A refresh or intervening wallet action changes the task ID and invalidates an
  older proposal.
- `POST /api/workflows/:id/dag-propose` is enabled only after the hash-frozen
  runtime manifest reports `modelAvailable=true`. It sends the same packet to
  an owned Hermes Lite child over shell-free stdio JSONL, verifies the
  response hash and candidate-only flags, and then applies the same
  deterministic LDT. The child receives no wallet or RPC capability.

The three product intents route to the trained control families:

| Product flow | DAG family |
|---|---|
| Deposit and reserve funding | `utxoref_settlement` |
| Starter order | `trading_risk` |
| Bitcoin withdrawal | `bitcoin_rpc_txbuild` |

Packets contain only a compact public-state projection, the closed DAG, visible
evidence IDs, and allowed candidate tools. The current entry packet is about
4.3 kB, leaving room inside Hermes Lite's 4,000-token active-packet lane and
inclusive 12,000-token context budget.

The validation receipt always reports no effects and fixes
`authorization=false`, `signing=false`, `execution=false`, `broadcast=false`,
and `secret_access=false`. On an exactly approved DAG node the model may propose
`host.execute_approved`, but only the existing wallet broker can authorize and
perform that later host transition. The DAG endpoint itself never calls it.

The Hermes client is bounded to three read-only tool rounds, six read-only
tool calls, and a 12,000-byte active task packet. It rejects illegal
transitions and any `host.execute_approved` proposal made before persisted
wallet approval. Provider errors and malformed or hash-mismatched responses
fail closed. The launch UI uses the model route only when the tracked runtime
is promoted; otherwise, or during a provider outage, it continues through the
deterministic planner.

`GET /api/dag-runtime` exposes the tracked runtime manifest used for operator
and UI readiness. The loader freezes the Prime environment registration,
Bonsai base, source adapter, converted LoRA, exact Hermes Lite commit, and
runtime/config paths, and fails closed on any substitution. The current status is
`adapter_packaged_gpu_screening_required`, `modelAvailable=false`; this route
does not probe, start, or load the model.

Runtime promotion is a two-stage exact-hash conveyor. Hermes first verifies
the frozen model/LoRA hashes, registered GPU8 sampling/resource contract,
exclusive GPU smoke and screening receipts, and explicit Hermes operator hash.
BitAgent then requires that Hermes apply receipt plus a real sidecar validation
receipt covering all three product intents. A second BitAgent operator hash
atomically changes only the tracked runtime manifest. Missing, stale, unsafe,
or mismatched evidence produces no candidate and leaves `modelAvailable=false`.

Every rejected `/dag-candidate` or `/dag-propose` proposal is serialized to
`.runtime/dag-failure-traces.jsonl` as `bitagent.dag_failure_trace.v2`. The
trace stores task/family/state/plan hashes, failed deterministic checks, the
strictly typed proposal (or `null` when malformed), and the canonical repair
target. It deliberately omits the user message and every unknown proposal
field. Failure to persist the trace fails the no-effect request closed.

## Evaluation artifacts

- `test/launch-kernel.e2e.test.ts`: 24 end-to-end trajectories.
- `eval/agent-cases.ts`: 50 focused agent cases.
- `eval/artifacts/agent-evaluation-latest.json`: scored result.
- `eval/artifacts/failure-traces.jsonl`: failures from the latest run.
- `eval/fixtures/failure-traces.seed.jsonl`: sanitized recovery-oriented seed
  failures, retained even when the latest run is clean.
- `.runtime/dag-failure-traces.jsonl`: sanitized live candidate mismatches for
  later review and corpus curation; never directly optimizer-eligible.

Failure records exclude wallet secrets and are shaped for later adapter
training or hill-climbing without granting an adapter execution authority.
