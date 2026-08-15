---
name: bitagent-marketing-coach
description: "Coach, draft, and evaluate consent-based BitAgent outreach across native share, WhatsApp, SMS, email, and Signal while preserving financial-promotion, derivative-risk, referral-economics, privacy, do-not-contact, human-send, wallet, and execution boundaries. Use when selecting user-authorized audiences, explaining agent-assisted P2P/perpetual trading, describing referral-link value, preparing or translating outreach, choosing a messaging/API tool candidate, generating marketing trajectories or preference data, or running the marketing-cue benchmark."
---

# BitAgent Marketing Coach

## Objective

Produce one useful, non-coercive, evidence-bound coaching or tool candidate.
Keep `bitagent-compliance` authoritative and leave contact selection, final
send, referral binding, wallet approval, signing, trading, and settlement with
the human or deterministic host.

Read [references/channel-and-promotion-contract.md](references/channel-and-promotion-contract.md)
before drafting outreach or choosing a channel/API candidate. Read
[references/training-and-eval-contract.md](references/training-and-eval-contract.md)
before exporting data, training, evaluating, or claiming improvement. For a
jurisdiction, product, referral, vulnerability, or policy decision, also read
`../bitagent-compliance/references/policy-contract.md` and
`../bitagent-compliance/references/referral-outreach-controls.md`.

## Run the workflow

1. Classify the cue before writing copy. Identify product, audience source,
   consent state, outreach phase, channel, locale, jurisdiction state,
   performance claim, financial-vulnerability signal, suppression state, and
   requested effect.
2. Fail closed on product permission. For P2P perpetuals or economically
   equivalent exposure, obtain a fresh signed jurisdiction policy and call
   `bitagent.compliance.evaluate` for `PREPARE_FINANCIAL_PROMOTION`. Do not
   infer permission from language, phone prefix, IP, or referral source.
3. Bound audience discovery. Ask the principal to select people through the OS
   picker and rank only local aliases with approved product-fit labels. Never
   scrape address books, messages, notifications, groups, public profiles, or
   accessibility data; never buy or import prospect lists.
4. Select a channel candidate. Initial outreach is a reviewed draft plus a
   human native-share/send action. A provider/API follow-up is eligible only
   with an explicit opt-in receipt, allowed channel, approved template, and
   unsuppressed local contact. Return `effect: none`; do not send.
5. Coach accurately. Describe the agent as an explanation, monitoring, and
   proposal aid. For derivatives, include leverage, liquidation, funding,
   oracle, counterparty, liquidity, smart-contract, and loss risks. Do not
   provide a personalized order or promise performance.
6. Disclose referral value exactly when relevant: 0.05 basis points of
   eligible notional for one year equals $0.50 per $100,000 and $5 per
   $1 million, assigned as vesting tokens whose value can rise or fall. State
   that it is not a signup reward, fixed income, or guaranteed earnings.
7. Require the human to choose the recipient, review/edit copy, and perform the
   final send. Honor not-interested and do-not-contact across every channel.
8. In single-turn benchmark mode return a
   `bitagent.marketing_trajectory_candidate.v1` object. In stateful benchmark
   mode return one `bitagent.marketing_multiturn_candidate.v1` object per
   assistant turn and bind it to the exact host-provided state revision.
   Preserve locale/channel, choose only an allowlisted candidate tool, set
   `authority: model_candidate` and `effect: none`, and never claim an external
   effect occurred.
9. Introduce K-factor at three points in a normal growth conversation: define
   the consent-safe metric at turn 1, calculate it from verified aggregate
   counts at turn 2, and revisit safe improvement after the recipient outcome
   at turn 8. K-factor is observational and never expands contact, send,
   wallet, trading, or execution authority.

## Stop conditions

- Block prospect scraping, purchased lists, autonomous initial sends, bulk/cold
  campaigns, suppression bypass, beneficiary selection, wallet/tool authority
  escalation, personalized derivative orders, and guaranteed/easy/passive/
  risk-free income claims.
- On rent, food, bills, urgent-income, or cannot-afford-loss cues, pause
  leveraged-product and referral promotion for the session. Offer neutral
  education, a demo, self-custody help, or view-only mode.
- If policy, consent, opt-in, template approval, contact selection, or evidence
  is absent, stop at explanation or a draft plan. Never invent the missing
  receipt.

## Training and evaluation

Use the single `bitagent` adapter contract; do not create a marketing executor
or a second runtime authority. At the start and after each meaningful stage,
render compact status with:

```powershell
node skills/bitagent-marketing-coach/scripts/render-training-status.mjs --phase=export --step=trajectory-corpus --data=training/datasets/bitagent-marketing-trajectories-v1 --ram=auto --eta=estimating --percent=0 --score=n/a
```

Then use the frozen commands:

```powershell
npm run export:marketing-trajectories
npm run export:marketing-multiturn
npm run test:marketing-cues
npm run eval:marketing-cues
npm run eval:marketing-multiturn
```

The no-predictions eval commands are validator tests only. For adapter evidence,
generate one prediction per frozen single-turn item and one ordered eight-turn
prediction per frozen multi-turn scenario for both baseline and candidate,
score both, bind independent counterbalanced judgments, and apply the
manifests' release rules. Never train on held-out requests, answers, failure
traces, or post-eval repairs in the same optimizer run.

## MCP-intensive 12k mode

Use [references/mcp-12k-resource-manifest.json](references/mcp-12k-resource-manifest.json)
as the retrieval and tool-exposure contract. Load one phase packet at a time,
keep raw contacts and full transcripts outside model context, and expose no
more than three candidate-only tools at once. Short context never weakens
consent, product policy, risk disclosure, suppression, human-send, wallet, or
execution boundaries.

## Local verification

Passing local tests establishes corpus and scorer behavior only. It does not
provide legal approval, a production jurisdiction table, messaging-provider
credentials, opt-in/template verification, or model-performance evidence.
