# Referral threat model

## Protected assets and trust boundaries

Protected assets are contact data, human attention/relationships, invitation
signing authority, beneficiary bindings, fee value, vesting assignments, wallet
authority, and clean recipient-agent state. Raw contacts and campaign state stay
inside the phone boundary. Invitation issuance, binding verification, and
settlement run in deterministic host/protocol services. Models are untrusted
proposal generators.

## Threats and controls

| Threat | Control in this slice | Residual/deployment work |
|---|---|---|
| Sybil identity chains | Exactly one selected binding is consulted; no recursive lookup, signup reward, account reward, minimum reward, or multiplier. | Production identity recovery and organization verification policy. |
| Contact exfiltration | OS-selected records only by default; device-salted IDs; local ranking; hosted packets use pseudonyms and approved features; server schemas reject contact data. | Native secure storage, backup exclusion, crash-report redaction review. |
| Spam/harassment | Human performs initial send; one initial plus one explicitly approved follow-up; local `not_interested`/`do_not_contact` suppression. | Jurisdiction/channel-specific consent and quiet-hour policy. |
| Prompt injection in names/imports | Names are local display values, normalized, never placed in model instructions, and inserted only after draft generation. | Fuzz native bridge serialization and localization packs. |
| Misleading economics | Fixed disclosures, prohibited-claim validator, fee-at-accrual goal math, and separate token-value estimates. | Legal review of vesting-token and referral disclosures. |
| Forged or covert links | Host RNG + signature; exact query allowlist; canonical origin/path; Unicode/control stripping; no campaign/model/strategy/tool payload fields. | Key rotation, rate limits, replay/expiry policy, abuse monitoring. |
| Agent propagation / stego hive | Growth and Trading contexts are disjoint; recipient boots from a canonical image with fresh memory/authorization; invite text is discarded; only a standardized binding event remains. | Attested image distribution and runtime information-flow audit. |
| Covert transaction channel | Referral identifiers never enter memo, OP_RETURN, calldata, client order IDs, nonces, addresses, UTXO/output order, route, or fee calculation; transaction builders accept no referral input. | Property tests against every production transaction builder. |
| Reorg/double accrual | Only canonical settled trade events accrue; idempotent trade IDs; reversal entries negate vesting; first-trade activation is recomputed after rollback. | Bind to the production listener's exact confirmation/rollback event schema. |
| Compromised referrer/recovery key | Active binding is immutable except signed administrative recovery; recovery is append-only audited; stale signatures and invalid reasons fail closed. | Operator quorum/HSM and incident runbook integration. |
| Agent spends referral proceeds | Beneficiary is a principal; vesting ledger exposes balances only and grants no spend/transfer/reinvest capability to source agents. | Wallet enforcement and custody/legal review. |
| Telemetry leakage | Raw contact fields are absent from server types, activity metadata, tool traces, and network client interfaces. | Audit third-party mobile analytics and crash SDK defaults. |

## Abuse cases explicitly rejected

The system rejects automatic initial sends, WhatsApp Business API use, SMS-send
permission, scraping, impersonation, fixed signup bounties, promised income,
specific-asset outreach, essential-funds risk encouragement, downstream
commissions, model-selected link bytes, referral-derived recipient permissions,
and reuse of invitation text or hidden agent state at recipient bootstrap.
