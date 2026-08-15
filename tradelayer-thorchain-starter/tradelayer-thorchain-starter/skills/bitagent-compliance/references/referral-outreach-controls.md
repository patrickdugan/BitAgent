# Referral and Outreach Controls

## Economics and attribution

Use one-hop, Sybil-conserved attribution:

```yaml
total_fee_bps: 0.50
maker_reward_bps: 0.25
referral_credit_bps: 0.05
protocol_revenue_bps: 0.20
default_beneficiary: SELF_AGENT
external_beneficiary: HUMAN_PRINCIPAL
external_term: ONE_NETWORK_YEAR
depth: 1
```

The referral credit is already inside the total fee. It creates no extra
emission. Reject signup, download, identity, or account-count bonuses;
multi-level commissions; downline percentages; rank multipliers; and recursive
emissions. After expiry, return to self-reference.

Require human-principal authorization before redirecting the credit externally.
Assign one provenance value: `SELF_AGENT`, `HUMAN_REFERRED`,
`AGENT_ASSISTED_HUMAN_REFERRAL`, `SERVICE_OPERATOR_REFERRED`, or
`AGENT_TO_AGENT`. The last value creates no automatic attribution.

Provenance may change monitoring, rate limits, messaging permission, graph-risk
score, or audit requirements. It never changes prices, strategies, wallet
authority, priority, leverage, model prompts, adapters, weights, or transaction
serialization. Keep it private unless a separately authorized public
attestation feature exists.

## Required referral disclosure

Whenever sending the link, preserve:

> The referrer receives 0.05 basis points of eligible trading activity for the referral term. That equals $0.50 per $100,000 of eligible notional and $5 per $1 million. The reward is based on trading activity, not simply on signing up.

When rewards settle as vesting tokens, also preserve:

> The credit is assigned as vesting tokens. Their future market value can rise or fall.

Never say `$5 per signup`, `guaranteed $5 referral`, `free money`, guaranteed or
risk-free income, guaranteed returns, easy money, that users cannot lose, or
that everyone is making money. Require evidence before claiming lower fees,
better or faster execution, higher returns, safer trading, or better yield.

## Contact access and ranking

Default to `CONTACT_NONE`. Prefer OS contact pickers, then only the smallest
permission needed: `CONTACT_PICK_ONE`, `CONTACT_PICK_MULTIPLE`,
`CONTACT_LOCAL_RANKING`, or `CONTACT_FULL_LOCAL_SCAN`.

Keep full names, phone numbers, email, photos, notes, addresses, and the raw
contact graph local. Hosted inference may receive `Contact A`, `Contact B`, and
similar aliases with user-approved product-fit labels only.

Allowed ranking signals:

`interested_in_crypto`, `interested_in_markets`, `interested_in_side_income`,
`owns_pc`, `phone_only`, `android_user`, `trusted_relationship`,
`likely_to_try_recommendation`, `needs_setup_help`,
`experienced_wallet_user`, `needs_local_language`, and relationship strength.

Reject poverty, debt, financial distress, desperation, race, ethnicity,
religion, politics, health, disability, immigration status, and sexual
orientation as labels or ranking inputs. Explain rankings in human-readable
product-fit terms. The human chooses the final recipient.

## Messaging

The Growth Agent may rank selected contacts locally, draft and translate,
prepare a native share, explain economics, calculate goals, track local
campaign state, and prepare a follow-up. Initial outreach always requires a
human send action.

Never autonomously send an initial message, read SMS or call logs, scrape
messages, impersonate the user, use accessibility to operate a messaging app,
or message an entire contact list.

Recommended initial message:

```text
Hey [name], I've been using BitAgent and thought you might find it interesting.
It's a self-custodial trading agent that can work from a phone.

I get a small referral credit if someone I refer uses it, so I wanted to disclose that up front.

Want me to send you the details?
```

The link message must include the full economic disclosure above and state
that the app shows applicable fees and product restrictions before
authorization. Remove any perpetual claim when perps are not allowed.

## Vulnerability

Treat statements about rent money, turning a small amount into food, making
money tonight, or being unable to afford a loss as a session-scoped financial
vulnerability signal unless the user explicitly requests persistence.

Block leveraged-product promotion and referral pressure for that interaction.
Continue only with neutral explanation, risk education, a demo, self-custody
education, or view-only mode.

## Agent and execution isolation

Growth Agent capabilities:

`CONTACT_READ_SELECTED`, `CONTACT_RANK_LOCAL`, `MESSAGE_DRAFT`, `TRANSLATE`,
`REFERRAL_LINK_REQUEST`, `REFERRAL_STATUS_AGGREGATE`.

Trading Agent capabilities:

`MARKET_READ`, `PORTFOLIO_READ`, `STRATEGY_PROPOSE`, `ORDER_PROPOSE`,
`POSITION_MONITOR`.

Harness-only capabilities:

`ORDER_SIGN`, `ORDER_SUBMIT`, `REFERRAL_SETTLE`, `REFERRAL_BIND`,
`POLICY_OVERRIDE`.

`POLICY_OVERRIDE` requires a human administrative principal and an audit
receipt. Operators may provide onboarding, language support, hosted inference,
monitoring, education, setup, or strategy configuration for a referral,
compute, or explicit service fee. They never receive wallet keys; authorization
and signing stay local.

## Stego-hive and propagation controls

Referral URLs contain only `invitation`, `policy`, and `sig`. Reject arbitrary
parameters, model/strategy/adapter IDs, prompt content, wallet metadata,
memory, arbitrary base64, free-text campaign codes, and hidden Unicode
controls. The recipient starts with fresh memory, canonical prompt and strategy
defaults, and independent wallet authorization. Invitation text never enters
the Trading Agent prompt.

Track aggregate Gamma plus depth, shared strategy/provider, synchronized
execution, geographic clustering, common template, operator concentration,
self-referral, and agent-assisted activation. Require several signals to move
together before enhanced review. Review may reduce outreach, require manual
review, or disable agent-to-agent referral; no single correlation freezes user
funds.

## Audit events

Append hash-linked events for policy checks, product allow/block, leverage cap,
referral create/rebind/expiry, contact permission grant/revoke, message
preparation, human send confirmation, vulnerability, provenance change,
stego-hive review, and manual override. Store identifiers, counts, reason
codes, hashes, and policy versions—not raw contacts or message contents.
