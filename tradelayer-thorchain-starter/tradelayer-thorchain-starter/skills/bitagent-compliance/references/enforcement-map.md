# BitAgent Compliance Enforcement Map

| Concern | Source / export | Status |
|---|---|---|
| Signed jurisdiction lookup | `src/compliance/policy.ts#getJurisdictionPolicy` | Stable interface; production provider/signature verifier required |
| Typed compliance decision | `src/compliance/policy.ts#evaluateComplianceDecision` | Deterministic local implementation |
| Fresh end-to-end evaluation | `src/compliance/policy.ts#evaluateCompliance` | Deterministic local implementation |
| Model-facing tool schemas | `src/compliance/tools.ts#complianceToolSchemas` | Read-only; no approval or execution |
| Leverage minimum | `src/compliance/policy.ts#calculateEffectiveLeverageCap` | Deterministic |
| Policy/context invalidation | `src/compliance/policy.ts#requiresComplianceReevaluation` | Deterministic |
| Promotion/disclosure checks | `src/compliance/marketing.ts` | Deterministic English controls; translated copy must preserve assertions |
| Vulnerability session state | `src/compliance/marketing.ts#vulnerabilitySessionState` | Session-only by default |
| Role capabilities | `src/compliance/capabilities.ts` | Deterministic allowlists |
| Immutable audit events | `src/compliance/audit.ts` | In-memory reference; durable append-only sink is provisional |
| Propagation review | `src/compliance/monitoring.ts#evaluatePropagationReview` | Aggregate deterministic trigger; thresholds are external config |
| Referral fee split | `src/referral/economics.ts` | Existing deterministic source of truth |
| One-hop registry and expiry | `src/referral/registry.ts` | Existing deterministic source of truth |
| Canonical signed referral link | `src/referral/links.ts#ReferralLinkService` | Existing HMAC reference implementation |
| Contact locality | `src/referral/contacts.ts` | Existing local-only picker/projection controls |
| Contact ranking | `src/referral/ranking.ts#DeterministicLabelRanker` | Existing deterministic product-fit ranking |
| Native share and disclosure | `src/referral/messaging.ts` | Existing human-action-only surface |
| Channel/API consent plan | `src/referral/channelPolicy.ts#evaluateOutreachChannelPlan` | Deterministic candidate-only plan; no provider send |
| Marketing tool invocation | `src/referral/marketingTools.ts#MarketingToolRegistry` | Closed arguments and effect-free results; provider verification remains external |
| Marketing cue trajectory matrix | `eval/marketing-cue-trajectories.ts` | Synthetic train/validation/held-out source |
| Marketing cue hard scorer | `eval/marketing-cue-harness.ts` | Deterministic local evaluator; not model evidence |
| Singular-adapter training export | `scripts/export-marketing-trajectory-data.ts` | Hash-bound SFT, preference, reward, tool, and adapter contracts |
| Marketing coaching procedure | `skills/bitagent-marketing-coach` | Skill package; no contact, send, wallet, or execution authority |
| Growth/trading isolation | `src/referral/control.ts` | Existing disjoint context constructors |

## Missing production seams

- Signed jurisdiction policy service deployment and key rotation.
- Legal/compliance ownership of the country/product table and expiry cadence.
- Durable immutable audit storage and retention policy.
- Wallet/harness integration that requires a fresh decision hash before each
  gated state change.
- Localized disclosure corpus beyond the currently validated English/Spanish
  referral copy.
- Production WhatsApp/SMS/email provider adapters plus independently verified
  opt-in and approved-template receipts. The local channel plan does not send.
- Configured propagation thresholds and a human review queue.

Do not represent these seams as live merely because local tests pass.
