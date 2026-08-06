---
name: agent-financial-survival
description: "Evaluate a proposed BitAgent infrastructure expense against the deterministic treasury-survival policy and emit an unsigned policy decision. Use for compute, network, storage, security, or recovery costs; reserve/runway checks; fee and rail caps; interrupted expense reviews; or audits of whether a candidate may proceed to an external capability broker. Do not use this skill to approve, sign, broadcast, trade, or spend funds."
---

# Agent Financial Survival

## Objective

Turn one essential-expense request into a deterministic, evidence-bound
`SpendIntent` and `PolicyDecision`. The model may classify the request and
collect missing public parameters. The host owns treasury truth, policy
evaluation, approval, signing, broadcast, settlement, and reconciliation.

Read [references/policy-contract.md](references/policy-contract.md) before
changing policy behavior or claiming that an expense is authorized.

## Authority boundary

- Never request or retain seed phrases, private keys, WIFs, raw PSBTs,
  signatures, API secrets, or wallet approval tokens.
- Never invent balances, observers, quotes, fees, runway, or settlement state.
- `authorized` means the deterministic policy permits staging the named
  capability. It is not wallet approval and does not execute anything.
- `manual_required` must remain pending until a separate human/wallet approval
  is observed. The model cannot convert it to `authorized`.
- `denied` has no next capability and must not be retried with changed effects
  under the same idempotency key.
- Strategy capital and reserve spending are outside this skill's autonomous
  mandate.

## Run the workflow

1. Load the current `SurvivalPolicy` and a fresh host-produced
   `TreasurySnapshot`. Require the configured observer quorum and observation
   freshness before reasoning about spendability.
2. Classify only `compute`, `network`, `storage`, `security`, or `recovery` as
   potentially essential. Preserve the requested rail, asset, amount, fee cap,
   destination, quote hash, expiry, policy ID, and idempotency key exactly.
3. Collect missing public fields. Do not substitute a destination, quote,
   amount, rail, or policy value.
4. Call `bitagent.survival.assess` and `bitagent.survival.evaluate` through the
   deterministic `FinancialSurvivalToolRegistry`. The host supplies the bound
   policy, treasury snapshot, evidence receipt, and clock. Do not reproduce
   their arithmetic in a model answer or pass raw observations as arguments.
5. Explain the exact decision, reason codes, intent hash, constraints hash,
   expiry, and the named next capability, if any.
6. Stage only the returned unsigned capability. A broker must independently
   validate the same intent and constraints before any later approval or
   execution step.
7. Append hash-linked assessment, intent, and policy-decision events. On
   interruption, verify the journal and resume the same intent rather than
   creating a replacement.

## MCP-intensive 12k mode

Use [references/mcp-12k-resource-manifest.json](references/mcp-12k-resource-manifest.json)
as the resource-selection contract:

- keep the inclusive context at or below 12,000 tokens;
- expose at most the phase-specific deterministic entrypoints;
- keep raw treasury observations and transcripts external by URI and SHA-256;
- carry only the task card, compact snapshot facts, policy identifiers,
  typed input schema, current evidence ledger, and one matching recovery hint;
- compact after each tool result and stop after three rounds or six calls;
- use `bitagent.survival.journal.verify` for recovery; the host resolves the
  journal URI and returns only its integrity result, length, and head hash;
- fail closed if the deterministic survival-policy registry or any requested
  host evidence binding is unavailable.

This mode changes retrieval and packet size only. It grants no financial
authority.

## Verify locally

Run:

```powershell
npm run demo:survival
npm run test:sovereign
npm run test:skills
```

The demo emits an unsigned policy decision and hash-linked journal records. It
does not prove payment, settlement, or production wallet integration.
