# BitAgent Compliance Policy Contract

## Source of truth

The signed jurisdiction table and deterministic harness are authoritative.
Hermes interprets the result; it does not supply legal permission.

Local enforcement exports:

- Wire types: `src/compliance/types.ts`
- Signed lookup and decision engine: `src/compliance/policy.ts`
- Model-facing read-only tools: `src/compliance/tools.ts`
- Promotion and vulnerability checks: `src/compliance/marketing.ts`
- Hash-linked audit log: `src/compliance/audit.ts`
- Role capability sets: `src/compliance/capabilities.ts`

The production host must implement `JurisdictionPolicyHost` with a real policy
service and signature verifier. A test fixture or model assertion that a policy
is signed is not production verification.

## Required facts

Before enabling a trading product, require:

```yaml
country_of_residence: ISO-3166 alpha-2
current_location_country: ISO-3166 alpha-2
age_eligibility: ELIGIBLE | INELIGIBLE | UNKNOWN
product_requested: ProductCategory
custody_model: SELF_CUSTODY | CUSTODIAL | HYBRID | UNKNOWN
user_type: retail | professional | institution | unknown
```

Use verified account facts or ask directly. Never infer residence from
language, phone prefix, ethnicity, name, IP alone, or referral source.

## Signed policy lookup

Call:

```text
get_jurisdiction_policy(
  residence_country,
  current_location_country,
  user_type
)
```

Accept only a fresh `bitagent_signed_jurisdiction_policy_v1` envelope whose
signature verifies and whose residence, current location, and user type match
the query. Reject future-issued, expired, malformed, mismatched, or unsigned
objects. Bind the decision to the envelope hash and `policy_version`.

The policy payload contains:

```yaml
supported: true | false
mode: PERPS_ALLOWED | PERPS_RESTRICTED | SPOT_ONLY | VIEW_ONLY | UNSUPPORTED
max_leverage: number | null
referral_allowed: boolean
agent_assisted_referral_allowed: boolean
local_marketing_restrictions: string[]
required_disclosures: string[]
product_restrictions: ProductCategory[]
explicitly_allowed_products: ProductCategory[] # optional, signed
review_required: boolean
policy_version: string
```

`explicitly_allowed_products` is the safe extension seam for lending,
borrowing, staking, liquidity provision, strategies, bridges, swaps, payments,
options, futures, or compute services. Do not infer those permissions from a
general crypto or DeFi label.

## Product classification

Use only:

`SPOT`, `PERPETUAL`, `FUTURE`, `OPTION`, `LENDING`, `BORROWING`, `STAKING`,
`LIQUIDITY_PROVISION`, `COPY_STRATEGY`, `AUTOMATED_STRATEGY`, `BRIDGE`, `SWAP`,
`PAYMENT`, `REFERRAL`, `COMPUTE_SERVICE`.

Perpetuals are derivatives. Classify economic exposure, not the marketing
label. A perpetual swap described as spot, synthetic, or a tokenized position
remains `PERPETUAL`. Unknown product classifications fail closed.

Mode semantics are intentionally narrow:

- `PERPS_ALLOWED`: infer only `SPOT` and `PERPETUAL` before signed additions.
- `PERPS_RESTRICTED`: infer only `SPOT`; never infer a partial perps grant.
- `SPOT_ONLY`: infer only `SPOT`.
- `VIEW_ONLY` and `UNSUPPORTED`: infer no trading products.

Always remove `product_restrictions`. `REFERRAL` is present only when the
signed policy says referrals are allowed.

## Leverage

Never infer a cap. For a leverage change require all four positive caps:

```text
effective_leverage_cap = min(
  jurisdiction_cap,
  user_cap,
  strategy_cap,
  protocol_cap
)
```

The model may recommend a lower value and may never exceed the returned cap.
If any cap is absent, invalid, or the signed jurisdiction cap is absent, leave
leverage disabled or require review.

## Typed decision

Return the deterministic `bitagent_compliance_decision_v1` with:

```yaml
status: ALLOW | ALLOW_WITH_DISCLOSURE | REQUIRE_HUMAN_AUTH | REQUIRE_REVIEW | BLOCK
compliance_state: VERIFIED | UNKNOWN | BLOCKED
trading_permission: NONE | POLICY_ALLOWED
jurisdiction_mode:
allowed_products:
max_leverage:
referral_mode: LINK_ONLY | ONE_HOP | BLOCKED
outreach_mode: HUMAN_SEND_REQUIRED | DISABLED
required_disclosures:
prohibited_claims:
reason_codes:
policy_version:
policy_receipt_hash:
evaluated_context_hash:
escalation: NONE | REQUIRED
view_only_available: true
financial_vulnerability_signal:
```

Do not edit the status or fields after host evaluation.

## Re-evaluation and failure

Re-evaluate when residence, current location, user type, requested product,
policy version, or referral beneficiary changes. A prior decision cannot be
reused after any such change.

On `UNKNOWN`, `ERROR`, expired policy, invalid signature, binding mismatch, or
missing material facts, set trading and leverage permission to none, keep only
link-only/setup or view-only behavior, and require escalation. Never route
around the result.
