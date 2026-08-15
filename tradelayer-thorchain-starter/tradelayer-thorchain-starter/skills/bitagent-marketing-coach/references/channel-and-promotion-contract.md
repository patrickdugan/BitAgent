# Channel and Promotion Contract

## Channel decision table

| Phase | Contact/consent evidence | Allowed candidate | Send authority |
| --- | --- | --- | --- |
| Initial | User selected a known person through the OS picker | Draft plus native/manual share for SMS, email, WhatsApp, Signal, or another user-chosen target | Human final action only |
| Follow-up | Local opt-in receipt, unsuppressed contact, and approved template | Provider follow-up candidate for configured WhatsApp, SMS, or email transport | No model send; host/human gate remains |
| Any | Not interested or do not contact | Record local suppression and hold | None |
| Any | Scraped, purchased, uploaded without consent, public-profile, group, message, notification, or accessibility source | Block | None |

An installed app name or configured API does not authorize discovery. Never
use WhatsApp, SMS, email, Signal, contact, group, or social APIs to enumerate
strangers or infer marketing consent. Keep names, phone numbers, emails,
photos, notes, and contact graphs local. Hosted inference receives aliases and
user-approved product-fit labels only.

## Coaching pattern

Use this order:

1. Ask whether the person requested information and whether the user knows
   them.
2. Explain the agent's bounded value: education, state monitoring, and an
   algorithmic proposal; policy and wallet authorities remain external.
3. If discussing P2P perpetuals, call them derivatives and disclose leverage,
   liquidation, funding, oracle, counterparty, liquidity, smart-contract, and
   loss risks before any call to action.
4. State that availability and leverage depend on a fresh jurisdiction policy
   and user/product state.
5. If a referral link is included, disclose the exact one-hop economics and
   variable vesting-token value.
6. End with a low-pressure choice such as asking whether the recipient wants
   details, a demo, or no further messages.

Do not claim a trading algorithm is autonomous, safer, faster, cheaper, more
profitable, or higher yielding without directly applicable evidence. Never
say guaranteed returns, passive income, easy money, risk-free, cannot lose,
or `$5 per referral/signup`.

## Tool order

- Unknown product jurisdiction: `get_jurisdiction_policy`, then
  `bitagent.compliance.evaluate`.
- Audience selection: `bitagent.growth.request_contact_selection`; rank only
  selected local hashed IDs.
- Coaching copy: `bitagent.marketing.compose_coaching`.
- Initial channel: `bitagent.marketing.plan_channel`, then a reviewed native
  share candidate.
- Opted-in follow-up: `bitagent.marketing.prepare_opted_in_follow_up` only
  with local opt-in receipt and approved template identifiers.
- Suppression: `bitagent.growth.record_response`.

All of these are candidates. A tool name does not upgrade model authority.
