# Financial Survival Policy Contract

## Source of truth

- Types: `src/survival/types.ts`
- Canonical hashing and policy evaluation: `src/survival/policy.ts`
- Default policy and demo harness: `src/survival/harness.ts`
- Hash-linked recovery journal: `src/survival/journal.ts`

Use these exports rather than model arithmetic:

- `assessSurvival(snapshot, policy, now)`
- `evaluateSpendIntent(intent, policy, snapshot, now)`
- `verifySurvivalJournal(records)`

## Required intent fields

One `SpendIntent` binds the ID and idempotency key, purpose, budget, rail,
asset, integer amount, policy value in sats, destination, maximum fee,
optional slippage, expiry, policy ID, quote hash when required, and source
receipt hashes.

Never silently change an intent field. A changed effect requires a new intent
and idempotency key.

## Decision meaning

- `denied`: at least one hard policy condition failed. No capability follows.
- `manual_required`: no hard condition failed, but strategy, autonomous-cap,
  or experimental-rail review is required. This is not approval.
- `authorized`: the deterministic policy permits staging the returned
  `nextCapability`. This is still unsigned and unexecuted.

The current default policy excludes `strategy` from allowed purposes and
forbids the `reserve` budget. TradeLayer strategy approval belongs to the
separate collateral-lifecycle skill.

## Evidence rules

Treasury balances, encumbrances, pending flights, spend-today totals,
protected reserve, burn rate, and observers must come from host evidence.
Observation quorum, freshness, and breaker alerts are hard gates. Quote-bound
rails must carry a quote hash. Never infer settlement from a proposal or from
the absence of a pending transaction.

## Recovery

Verify the journal chain before appending. Preserve the original intent hash,
constraints hash, and idempotency key. After an ambiguous external result,
reconcile the recorded capability request before proposing another one.
