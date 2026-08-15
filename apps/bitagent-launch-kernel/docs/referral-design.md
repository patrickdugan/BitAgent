# Phone-first one-hop referral design

## Scope and invariants

This slice adds one sponsor beneficiary per referee, never a referral tree.
Every principal starts with a self binding. A signed human referral may replace
that binding before the first eligible settled trade. The first such trade
activates the binding for `REFERRAL_TERM_BLOCKS`; at the exclusive expiry height
the registry creates a self binding before settling further trades.

Fee settlement uses atomic integer values only:

```text
total 50 ppm = maker 25 ppm + sponsor 5 ppm + protocol 20 ppm
```

The registry tracks cumulative notional per fee asset and calculates cumulative
component entitlements, then records the delta for each trade. This carries
rounding remainders deterministically while preserving exact fee equality on
every accrual. Sponsor value at accrual is immutable and powers the $1/$5/$10
progress display; token-price estimates are separate.

Account creation, invitation issuance, link opening, onboarding, and account
count never produce an accrual. Reverted or reorganized trades create reversing
vesting entries and cannot leave permanent credit.

## Components

1. `src/referral/types.ts` defines closed enums and registry records.
2. `src/referral/economics.ts` owns ppm constants, cumulative rounding, and goal
   calculations.
3. `src/referral/links.ts` is a host-only invitation issuer/verifier. The URL
   allowlist is exactly `invitation`, `policy`, and `sig`; token bytes come from
   the host cryptographic RNG.
4. `src/referral/registry.ts` owns self bindings, pre-activation replacement,
   activation/expiry, one-hop settlement, reorg reversal, and audited recovery.
5. `src/referral/store.ts` follows the existing in-memory/atomic-file repository
   pattern. It contains no contact records.
6. `src/referral/vesting.ts` records principal-controlled token assignments and
   exposes a typed sink for the sibling TradeLayer vesting-token path. No agent
   spending capability is created.
7. `src/referral/contacts.ts`, `ranking.ts`, and `messaging.ts` run locally.
   Hosted-model packets contain pseudonyms and approved product-fit features,
   never names, addresses, photos, or address-book membership.
8. `src/referral/growthAgent.ts` exposes candidate-only tools for explanation,
   goals, ranking, drafting, translation, share preparation, local response
   state, approved follow-up reminders, and aggregate display. There is no send
   tool.
9. `src/referral/control.ts` builds separate Growth, Trading, and fresh recipient
   contexts. Referral data is never transaction material.
10. `launch-ui/referrals.html` and `referrals.js` provide the phone-first local
    flow. The only outbound action is a user gesture calling the native share
    contract.

## Authority and data flow

```text
trusted host issues signed invitation
  -> human selects contacts on phone
  -> local vault hashes/labels/ranks
  -> optional hosted model sees Contact A + approved features only
  -> local name insertion and disclosure validation
  -> human taps Share and completes send in an installed app
  -> recipient onboarding verifies opaque invitation
  -> independently verified settled trade activates/accrues
  -> host-owned vesting sink assigns principal-controlled tokens
  -> wallet/debug activity feed shows aggregate state
```

Initial sending is outside model and backend authority. A native share proposal
has `effect: none`, `requiresHumanOsAction: true`, and contains no channel API
credential. Administrative recovery similarly requires a signed,
operator-reviewed recovery record; the Growth Agent cannot invoke it.

## Mobile permission ladder

- Level 0 copies a canonical link and requests no contact capability.
- Level 1 asks the OS/browser picker for individual records.
- Level 2 asks for multiple user-selected records and ranks them locally.
- Level 3 is an explicit native-only broad scan with field disclosure,
  revocation, and deletion. The browser slice reports it unavailable.

Android-native adapters must prefer Android 17 Contact Picker, otherwise
`ACTION_PICK`; broad `READ_CONTACTS` is an optional Level 3 adapter only. iOS
adapters must use limited authorization and the system selection UI. No design
path requests call logs, SMS read/send, accessibility, notification scraping,
default-SMS status, arbitrary contact notes, or message history.

## Deployment seams

The live TradeLayer checkout's reward code is number-based. This slice fails
closed at the typed integer vesting sink until a production adapter proves the
fee-asset/token conversion, property identifier, rounding rule, chain rollback,
and principal-control mapping. The browser Contact Picker and native share APIs
also require a secure-context phone runtime; native Android/iOS shells are not
present in this repository. The full jurisdiction, platform, and production
gate list is maintained in `docs/referral-deployment-flags.md`.
