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

When an authenticated external broker is supplied with a
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

## Evaluation artifacts

- `test/launch-kernel.e2e.test.ts`: 24 end-to-end trajectories.
- `eval/agent-cases.ts`: 50 focused agent cases.
- `eval/artifacts/agent-evaluation-latest.json`: scored result.
- `eval/artifacts/failure-traces.jsonl`: failures from the latest run.
- `eval/fixtures/failure-traces.seed.jsonl`: sanitized recovery-oriented seed
  failures, retained even when the latest run is clean.

Failure records exclude wallet secrets and are shaped for later adapter
training or hill-climbing without granting an adapter execution authority.
