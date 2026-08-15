---
name: bitagent-compliance
description: "Apply BitAgent's fail-closed jurisdiction, product, leverage, referral, contact-ranking, financial-promotion, operator-service, agent-assisted outreach, vulnerability, provenance, and human-review policy. Use before enabling or changing trading products or leverage; creating or rebinding referrals; ranking contacts; drafting or translating referral promotions; enabling operators; starting agent-assisted outreach; or changing country, current location, user type, product, policy version, or referral beneficiary."
---

# BitAgent Compliance

## Objective

Return one typed, evidence-bound `ComplianceDecision` while leaving legal
permission, fees, referral settlement, wallet authorization, signing, and
execution with deterministic services. Treat `bitagent_compliance` as the
policy/invocation identifier and `bitagent-compliance` as the skill package.

Read [references/policy-contract.md](references/policy-contract.md) before
making a product, jurisdiction, leverage, or suitability decision. Read
[references/referral-outreach-controls.md](references/referral-outreach-controls.md)
before referral, contact, promotion, translation, operator, or outreach work.
Use [references/enforcement-map.md](references/enforcement-map.md) when changing
code or claiming that a control is implemented. Use
`../bitagent-marketing-coach/SKILL.md` for the bounded cue-classification,
channel-planning, derivatives-coaching, referral-copy, trajectory-export, and
evaluation workflow; that skill may not reinterpret this skill's decision.

## Authority boundary

- Interpret policy, explain outcomes, and collect only the minimum facts.
- Never invent a jurisdiction permission, leverage ceiling, disclosure, policy
  version, signature result, or human authorization.
- Never relabel a perpetual as spot, synthetic exposure, or a tokenized
  position to bypass a restriction.
- Never recommend VPNs, alternate addresses, proxy accounts, nominees, or
  other geographic-circumvention methods.
- Never approve, sign, submit, settle, bind, override, or execute. Only the
  deterministic harness may hold those capabilities.
- Keep Growth Agent and Trading Agent contexts disjoint. Referral content and
  provenance never enter strategy prompts or transaction serialization.

## Run the workflow

1. Identify the requested action and product category. Classify perpetuals as
   derivatives based on economic exposure, even when marketing language uses
   another label.
2. Collect the minimum facts directly or from verified account data:
   `country_of_residence`, `current_location_country`, `age_eligibility`,
   `product_requested`, `custody_model`, and `user_type`. Do not infer them
   from language, name, ethnicity, referral source, phone prefix, or IP alone.
3. Call `get_jurisdiction_policy(residence_country,
   current_location_country, user_type)`. Require a fresh, signature-verified,
   query-bound policy receipt.
4. Call `bitagent.compliance.evaluate` with the exact facts and action. For a
   leverage change, also supply jurisdiction, user, strategy, and protocol
   caps; the deterministic result uses their minimum.
5. Return the host-produced `ComplianceDecision` without upgrading or
   reinterpreting it. Explain `status`, allowed products, leverage cap,
   referral/outreach mode, disclosures, reason codes, policy version, and
   escalation.
6. Stop before the next authority whenever the decision is
   `REQUIRE_HUMAN_AUTH`, `REQUIRE_REVIEW`, or `BLOCK`.
7. Append the applicable immutable audit event without raw contact data or
   message contents.

## Default and failure state

Start every unresolved session with:

```text
compliance_state: UNKNOWN
trading_permission: NONE
referral_permission: LINK_ONLY
leverage_permission: NONE
```

If lookup returns `UNKNOWN`, `ERROR`, an invalid signature, a query mismatch,
or an expired policy, fail closed and say:

> I can keep the account in view-only or setup mode while the product policy is unresolved.

No model reasoning may convert that result into permission.

## Referral and outreach minimums

- Keep referral attribution one hop and redirect only the existing 0.05 bp
  credit. Account creation, identity count, depth, rank, or downloads create
  no reward.
- Require human-principal authorization for an external beneficiary.
  `AGENT_TO_AGENT` provenance creates no automatic economic attribution.
- Keep raw contacts local. Prefer OS contact pickers and send hosted inference
  only aliases plus user-approved product-fit labels.
- Require a human OS action for every initial send. Do not scrape messages,
  read SMS/call history, impersonate the user, or operate messaging apps
  through accessibility.
- Preserve the exact economic and variable-token disclosures through
  translation. Reject prohibited or unsupported performance claims.
- On a financial-vulnerability signal, block leveraged-product promotion and
  referral pressure for the session while keeping explanation, demo,
  self-custody education, and view-only mode available.

## MCP-intensive 12k mode

Use [references/mcp-12k-resource-manifest.json](references/mcp-12k-resource-manifest.json)
as the retrieval contract. Load only the current phase packet, expose at most
the listed read-only policy tools, keep signed policy bodies and audit records
external by URI/hash after evaluation, and fail if the inclusive packet would
exceed 12,000 tokens. Short context never weakens policy, disclosure, privacy,
human-send, wallet, or execution boundaries.

## Verify locally

Run:

```powershell
npm run test:compliance
npm run test:referral
npm run test:skills
python C:\Users\patri\.codex\skills\.system\skill-creator\scripts\quick_validate.py skills\bitagent-compliance
```

Passing tests establish local deterministic behavior only. They do not supply
a production jurisdiction table, production signature verifier, legal review,
or wallet authorization.
