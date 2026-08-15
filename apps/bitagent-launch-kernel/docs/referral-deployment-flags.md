# Referral deployment and jurisdiction flags

The local vertical slice is suitable for deterministic testing and a phone-sized
browser demo. Production enablement remains subject to the following explicit
gates. None of these gates may be inferred as approved from a model response.

## Legal and policy review

- Review the sponsor credit, vesting-token assignment, and paid-link disclosure
  under the financial-promotion, broker/referral, securities/token, consumer,
  and tax rules of every supported jurisdiction.
- Review the human-send and one-follow-up workflow under applicable anti-spam,
  telemarketing, electronic-communications, and channel-specific consent rules,
  including TCPA, CAN-SPAM, CASL, and ePrivacy-style regimes where relevant.
- Confirm that onboarding independently enforces age eligibility, sanctions,
  AML/KYC, geographic availability, and suitability. Contact names or labels
  must never be used to infer eligibility.
- Complete a privacy impact assessment for local contact processing, device
  salts, backup behavior, retention, deletion, data-subject requests, and any
  hosted inference under applicable GDPR/UK GDPR/CCPA-style rules.
- Obtain store-policy review for paid referral disclosures and contact
  permissions before Android or iOS distribution.

## Mobile and privacy engineering gates

- This repository has no native Android or iOS shell. Production adapters must
  implement Android 17 Contact Picker, older `ACTION_PICK`, and iOS limited
  contact selection without broad access by default.
- If Level 3 `READ_CONTACTS` is shipped on older Android, it requires a separate
  prominent disclosure, explicit opt-in, revocation, local-only processing, and
  verified delete-all behavior. It must remain optional.
- Verify that crash reporting, analytics, logging, device backups, screenshots,
  clipboard handling, and OS share previews cannot export raw contact fields or
  message history.
- Use hardware-backed secure storage for the device salt and local campaign
  state where the platform supports it. Salt rotation and device migration need
  a documented behavior.
- Validate native share contracts on supported OS versions. The application
  must never obtain a channel credential, `SEND_SMS`, final-send control, or a
  messaging-app automation capability.

## Protocol and operations gates

- Provision and rotate the backend invitation-signing key outside the language
  model. Add authenticated issuance, per-principal rate limits, replay controls,
  revocation, abuse monitoring, and an audited recovery approval service.
- Connect `ReferralSettlementAdapter` only to canonical, confirmed, fee-bearing
  settlement evidence. The listener must replay rollback events newest-first and
  be tested against the production network's actual reorganization behavior.
- Replace the current non-executing TradeLayer vesting candidate with a reviewed
  integer-safe adapter. The live path must prove fee-asset conversion, token
  property ID, vesting schedule, deterministic rounding, principal-only control,
  idempotency, and reversal semantics before it can write balances.
- Decide and document the production settlement network and target block cadence
  before freezing `REFERRAL_TERM_BLOCKS`; a network change requires a referral
  policy-version change.
- Add authenticated principal and wallet ownership checks around registry APIs,
  encrypted durable storage, migrations/backup/restore procedures, and
  operational monitoring that contains aggregates only.
- Conduct abuse testing for Sybil identity farms, compromised referrer keys,
  invitation enumeration, Unicode/punycode links, share-sheet spoofing, and
  coordinated spam. Identity creation must continue to produce zero reward.

## Product release gates

- Localize the complete disclosure and have each translation reviewed. The
  numeric terms `0.05 basis points`, `one year`, and `$0.50 per $100,000` must
  retain their meaning; the product must reject “$5 per referral.”
- Define support and appeal processes for do-not-contact suppression,
  administrative recovery, disputed attribution, and reorganization reversals.
- Run accessibility, low-bandwidth, phone-only, and graceful-permission-denial
  testing on real devices. Level 0 link copying must remain usable throughout.
- Keep exact volume and earnings in the human dashboard. Any aggregate exposed
  to the Growth Agent requires a separately reviewed minimization policy.
