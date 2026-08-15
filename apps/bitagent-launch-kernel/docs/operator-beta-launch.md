# BitAgent Operator Beta: Nigeria First

Plan date: 2026-08-05. This is an operating plan, not legal advice.

## Promise

> Speak or type a move, inspect the exact transaction, then sign it inside your wallet.

Bonsai 8 stays backstage. The public product is self-custodial transaction
construction, exact previews, reliable recovery, and clear fees.

## Two programs, two risk levels

| Program | Cohort | Product scope | Launch condition |
| --- | ---: | --- | --- |
| Operator Beta | 30-50 experienced self-custody users | Wallet views, Bitcoin deposit/starter-strategy/withdraw flow, and testnet multichain previews | May recruit now for supervised testnet use |
| TradeLayer Maker Pilot | 5-10 screened power users | Strategy Covenant shadow mode, maker-order preparation, cancellation, inventory/collateral monitoring | No funded launch until wallet broker, live verifier, compliance, and signer controls pass |

The programs must have separate applications, channels, consent, data, and
release gates. A retail tester is never silently promoted into a trading or
liquidity role.

## Why Nigeria first

Chainalysis reports that Nigeria received more than USD 92.1 billion in
on-chain value from July 2024 through June 2025, while Sub-Saharan Africa grew
about 52 percent. This supports the market hypothesis; it does not prove
demand for BitAgent. Source:
[Chainalysis regional report](https://www.chainalysis.com/blog/subsaharan-africa-crypto-adoption-2025/).

Nigeria's SEC currently lists Busha and Quidax among ARIP participants. Treat
that as a partner-discovery signal, not permission for BitAgent to perform a
regulated service. Sources:
[SEC registered fintech operators](https://home.sec.gov.ng/fintech-and-innovation-hub-finport/registered-fintech-operators/) and
[SEC RI/ARIP programs](https://www.sec.gov.ng/fintech-and-innovation-hub-finport/finport-programs-ri-and-arip/).

The supplied brief names Web3Lagos for August 27-29, 2026. As of this plan
date, that schedule was not independently verifiable from an accessible
official organizer page. It is a pending dependency, not the launch's critical
path. The community lead must obtain written confirmation of date, format,
application route, recording rules, sponsorship cost, and organizer identity
before using the event name in public copy.

## What is actually shipped

Do not advertise twelve actions as live. The repository currently supports
three funded-workflow intents in scripted/testnet form:

1. Help me deposit Bitcoin.
2. Use part of my Bitcoin in the starter TradeLayer strategy.
3. Help me withdraw my Bitcoin.

It also prepares Ethereum Sepolia and Solana devnet wallet plans through
MetaMask and Phantom, and now prepares Strategy Covenant candidates. Those
paths remain non-funding until the launch-readiness blockers are closed.

The twelve-action public allowlist is a backlog, gated action by action:

1. show balances;
2. aggregate connected wallets;
3. explain positions;
4. quote fees and compare routes;
5. send an asset;
6. request payment;
7. prepare a swap;
8. approve a verified token contract;
9. cancel a token approval;
10. create a recurring-purchase template;
11. prepare a limit order;
12. bridge an allowlisted asset.

An action ships only after exact manifests, malformed-input tests, rejection
and interruption recovery, provider truth checks, and zero unauthorized-effect
failures pass. TradeLayer maker orders stay in the separate Maker Pilot.

## Transaction manifest gate

Every mission must display, before wallet approval:

- wallet and chain;
- asset and verified contract/property;
- exact integer amount and decimal rendering;
- recipient or protocol;
- route;
- network and protocol fees;
- slippage ceiling;
- expected result and non-guaranteed outcomes;
- permission being granted;
- expiration and simulation hash.

Voice creates intent only. Display recognized text before construction. Token
homophones, decimals, chain collisions, new recipients, copied-address
changes, and code switching force a short confirmation. The wallet remains the
authorization surface.

## Recruitment funnel

Eligibility:

- age 18 or older;
- existing self-custody wallet;
- at least three self-custody transactions in the preceding 30 days;
- stablecoin or wallet use several times per month;
- willing to start on testnet and inspect every manifest;
- informed consent for any recorded voice/session data.

Application questions:

1. Which wallets and chains did you use in the last 30 days?
2. How many self-custody transactions did you make?
3. Which wallet operation wastes the most time?
4. Will you complete testnet missions before optional live-value testing?
5. Which language, accent, or speech pattern feels natural?
6. Will you inspect address, amount, chain, and fees before every signature?
7. May anonymized command/error traces be retained for regression testing?

Hire one Nigeria-based community operator for four weeks. Their role is
recruitment, scheduling, workshop facilitation, and participant support. The
system must make access to participant funds, wallet credentials, raw approval
tokens, seed phrases, and private keys structurally impossible.

Initial channels to validate, not assume:

- Web3Bridge/Web3Lagos organizer contact;
- university blockchain communities, including BlockchainUNN;
- experienced stablecoin and self-custody communities;
- later, regulated/incubated operators such as Busha or Quidax for compliance
  and distribution conversations.

## Mission set

Each participant completes five supervised testnet missions:

1. Connect a wallet and verify the displayed public account/network.
2. Ask for a balance/route explanation and identify the evidence timestamp.
3. Prepare a small transfer, deliberately reject it, and resume the session.
4. Detect and correct one amount, address, chain, or token ambiguity.
5. Complete one exact wallet-approved testnet action and verify its receipt.

Optional live-value missions remain disabled until production readiness is
signed off. When enabled, cap sponsored value at USD 1-3 per participant,
require a fresh legal/compliance review, and retain the ability to stop the
cohort without trapping participant funds.

Pay fixed compensation for completed research work, not deposits, volume,
position size, returns, referrals to funding, or trading frequency. A working
starting point is USD 15 equivalent for one recorded session plus the mission
set, with a fixed USD 3 product credit only after a referred tester completes
the testnet set.

## Calendar

| Date | Work and exit criterion |
| --- | --- |
| Aug 5-12 | Freeze the real shipped actions; add manifest, limits, logging, status page, consent, application, and incident contact. Exit: all critical local suites green. |
| Aug 13-20 | Contract community lead; recruit 12 private-alpha users; capture about 25 consented commands each. Exit: at least 300 labeled utterances with no secrets. |
| Aug 21-26 | Run five-mission testnet cohorts; repair ambiguity regressions. Exit: zero wrong-effect broadcasts and 100 percent clarification on low confidence. |
| Aug 27-29 | Use Web3Lagos only if organizer verification is complete; otherwise run an independent online/community workshop. |
| Aug 30-Sep 14 | Continue testnet reliability work. Live USD 1-3 missions require a separate written go/no-go. Publish an anonymized reliability report. |
| Sep 15-Oct 5 | Open Maker Pilot applications, but keep execution in shadow mode until funded gates pass. Start partner and counsel conversations. |
| Oct 6-Nov 5 | Start a Philippine discovery/testnet cohort only after English execution clears safety gates; add consented Taglish cases. |

## Launch gates and metrics

Hard safety gates:

| Measure | Gate |
| --- | ---: |
| Wrong asset, chain, amount, recipient, or permission broadcast | 0 |
| Wallet payload matches displayed manifest | 100% |
| Secret-key/seed-phrase request or persistence | 0 |
| Low-confidence commands requesting clarification | 100% |
| User-fund loss caused by BitAgent | 0 |

Product targets, reported with denominator and confidence interval:

- supported-intent and field accuracy at least 99.5 percent;
- supported live-action completion at least 95 percent once live use is legal
  and enabled;
- 70 percent of accepted users complete mission one inside ten minutes;
- seven-day retained-user target of 35 percent;
- 25 percent complete three actions in a week.

Do not average away a hard safety failure. Each production failure becomes a
permanent regression case, with raw sensitive data removed.

Maker Pilot metrics are separate: funded capital under active mandates,
allocation conformance, quote uptime, p99 candidate-to-cosign latency, realized
slippage, emergency-stop response, drawdown by covenant version, and retained
capital. Never use wash trading or retail volume incentives to manufacture
these numbers.

## Budget

Working testnet pilot budget: USD 900-1,200, excluding legal review.

| Item | Range |
| --- | ---: |
| Community lead, four weeks | USD 250-350 |
| Twenty completed tester sessions | USD 300 |
| Two workshops/community bounties | USD 150-250 |
| Future sponsored low-value transactions | USD 75 |
| RPC, speech, monitoring, and support | USD 125-225 |

Do not spend the sponsored-live-transaction line until the live-value gate is
approved.

## Regulatory and compliance workstream

The intended shape is self-custodial software: users retain keys and approve
exact effects. That design is risk-reducing, not a legal conclusion.

Before public recruitment:

1. Obtain Nigeria counsel's written classification of wallet construction,
   swap/bridge routing, TradeLayer order preparation, strategy mandates,
   tester compensation, recording/consent, and marketing language.
2. Keep custody, pooled balances, company-controlled signing keys,
   personalized return promises, and discretionary routing disabled.
3. Define age, jurisdiction, sanctions, duplicate-account, and abuse controls.
4. Maintain disclosures, complaint handling, incident response, retention,
   and an emergency stop.
5. Re-review before the Maker Pilot or any funded unattended strategy.

For U.S. sanctions exposure, OFAC says virtual-currency transactions have the
same sanctions obligations as fiat and recommends a risk-based program. Use
current counsel-approved screening rather than embedding a model judgment.
Sources: [OFAC FAQ 560](https://ofac.treasury.gov/faqs/560) and
[virtual-currency industry guidance](https://ofac.treasury.gov/system/files/126/virtual_currency_guidance_brochure.pdf).

For the Philippines, BSP maintained its new-VASP-license moratorium from
September 2025 and issued 2026 token-listing expectations for VASPs. The second
cohort therefore requires local counsel and preferably an authorized partner;
do not copy the Nigeria operating assumptions. Sources:
[BSP Memorandum M-2025-031](https://www.bsp.gov.ph/Regulations/Issuances/2025/M-2025-031.pdf) and
[BSP Memorandum M-2026-023](https://www.bsp.gov.ph/Regulations/Issuances/2026/M-2026-023.pdf).

## Go/no-go ownership

- Product owner: freezes supported actions and public claims.
- Security owner: signs off manifest/payload equality, secret isolation,
  incident response, and wallet-broker boundaries.
- Nigeria counsel/compliance owner: approves recruitment and live-value scope.
- Community lead: participant operations only; no fund or credential access.
- Evaluation owner: freezes the test set and publishes failures as well as
  passes.
- Maker Pilot risk owner: sets capital/position limits and can halt all new
  candidates.

The launch is a no-go if any critical safety test fails, public copy claims an
unshipped action, the event remains unverified but is presented as confirmed,
or a funded path depends on a scripted broker.
