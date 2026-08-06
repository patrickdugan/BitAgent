---
name: tradelayer-collateral-lifecycle
description: "Run, resume, or audit BitAgent's bounded Bitcoin-to-TradeLayer lifecycle: connect a wallet, confirm a Bitcoin deposit through UTXORef, bind collateral to an operator-approved hashed algorithmic signal, simulate and approve a TradeLayer order, verify settlement and positive PnL, release PnL into spendable Bitcoin, and withdraw it. Use for scripted demos, testnet rehearsals, lifecycle receipts, recovery, or production-readiness reviews involving UTXORef, TradeLayer, committed signal codebases, PnL, and Bitcoin withdrawals."
---

# TradeLayer Collateral Lifecycle

## Objective

Complete or audit one evidence-linked lifecycle without giving the model custody:

```text
wallet -> Bitcoin deposit -> confirmed UTXORef -> approved tx11 reserve intake
  -> committed signal -> TradeLayer simulation -> wallet approval -> order verification
  -> PnL settlement -> PnL release -> Bitcoin withdrawal
```

Treat the model and algorithm as candidate producers. Keep wallet truth, chain
truth, approval, signing, broadcast, PnL recognition, and withdrawal authority
in deterministic host or wallet services.

## Select the operating mode

Choose exactly one mode before taking action:

- `simulated`: Use scripted brokers and label every receipt as simulated.
- `testnet`: Use Bitcoin testnet4 and independently observed TradeLayer state.
- `production`: Fail closed unless wallet-owned approval/signing, TradeLayer
  settlement observation, PnL release, and Bitcoin withdrawal brokers are all
  configured and return verifiable receipts.

Never upgrade a simulated or dry-run artifact into a production claim.

## Inspect the local seams

Read [references/tool-map.md](references/tool-map.md) before changing the
implementation or claiming a live capability. Prefer the exact local exports
listed there over copied protocol logic.

Read [references/lifecycle-contract.md](references/lifecycle-contract.md) when
constructing, resuming, or auditing a lifecycle receipt.

For Hermes Lite or another small model, read
[references/mcp-12k-resource-manifest.json](references/mcp-12k-resource-manifest.json)
and select only the current phase packet. The manifest is a retrieval contract,
not authorization.

## MCP-intensive 12k mode

Keep the inclusive model window at or below 12,000 tokens. The deterministic
host selects the role and supplies no more than the phase-specific candidate
tools in the manifest (normally three). Keep raw transcripts, raw tool
results, raw PSBTs, signed transactions, signatures, and wallet grants outside
the packet. Carry only resource handles and hashes for durable evidence.

Compact each tool result into an evidence ledger, allow at most three rounds
and six calls, and use at most one matching failure replay. If the packet still
exceeds its lane after compaction, reject it; do not drop authority or approval
constraints. Short context changes retrieval only and never grants approval,
signing, broadcast, retry, or execution authority.

## Execute the lifecycle

### 1. Start or resume

Load the persisted launch and signal workflows. Reuse their workflow IDs.
Never start a replacement after an ambiguous submission until the recorded
transaction or order has been reconciled.

Record the operating mode, network, wallet session reference, signal codebase
commitment, producer key ID, strategy ID, and policy fingerprint.

### 2. Connect the wallet

Use only public wallet metadata and opaque session references. Reject seed
phrases, mnemonics, WIFs, private keys, API secrets, or signing material.

Require wallet capabilities for deposit, exact-action approval, TradeLayer
orders, PnL release, and Bitcoin withdrawal. A missing capability blocks the
corresponding stage.

### 3. Confirm the Bitcoin deposit

Prepare a wallet-owned Bitcoin address, then observe the actual txid, vout,
amount, script, block height, and confirmation count.

Do not continue until UTXORef confirms the deposit and
`v2.settlement.buildFundingSetV2(...)` returns the canonical `fundingRoot`.
Persist the exact outpoint and funding root.

An unconfirmed, reorged, malformed, already-reserved, or wallet-mismatched
outpoint is not collateral.

### 4. Map collateral and complete reserve intake

Treat the deposit UTXORef mapping and the tx11 reserve transaction as distinct
events. Mapping proves the observed deposit; it does not lock Bitcoin into the
TradeLayer reserve.

Build the exact `bitagent_reserve_intake_plan_v1`, then let the wallet build a
public `bitagent_wallet_reserve_intake_candidate_v1` while retaining the raw
PSBT. Display the selected input, P2TR reserve at vout 0, tx11 payload at vout
1, wallet change at vout 2, exact miner fee, plan/binding hashes, and expiry.

Before approval, `bitagent.operator.reserve_intake` may read only sanitized
candidate, preflight, and release evidence. Require all nine gates:

- independent listeners and fresh snapshots;
- tx11 active and chain-derived from an indexed Bitcoin transaction;
- exact tx11 code hash and intended tlBTC property;
- template, contract, and reserve-redeem-address parity.

Testnet or production execution also requires the exact release status
`deployed` and its deployment commit. A local database activation seed,
`legacy_unknown` provenance, an allowlisted historical commit, or
`candidate_not_deployed` status cannot authorize reserve intake.

Apply a separate explain/simulate/display/approval/execute/verify sequence.
After independent verification, persist the intake txid, reserve outpoint
`txid:0`, plan hash, binding hash, release ID/code hash/deployment commit, and
preflight evidence hash. Do not reuse this approval for the tx5 order.

### 5. Verify the algorithmic signal

Accept only the narrow `bitagent_tradelayer_signal_v1` contract:

- operator-approved codebase ID and exact Git/source-tree digest;
- operator-approved Ed25519 producer key;
- approved strategy ID and version;
- `TLBTC/TLUSD`;
- post-only limit order;
- bounded side, amount, price, generation time, and expiry;
- input snapshot hash, canonical payload hash, and producer signature.

Recompute the codebase commitment at execution time. Never import or execute
the legacy algorithm code inside BitAgent.

### 6. Bind verified reserve collateral and simulate the order

Require the signal workflow's selected UTXO funding root to match the confirmed
deposit funding root for the single-deposit starter flow. Also require the
verified reserve outpoint and locked amount to match the independently observed
strategy-funding evidence before constructing the tx5 order.

Build the TradeLayer tx5 payload through the local encoder. Display:

- offered and desired properties;
- amount and limit price;
- post-only behavior;
- locked collateral;
- selected outpoints and funding root;
- network and protocol fees;
- balance and exposure before/after;
- signal, codebase, portfolio, and policy hashes;
- expiry and recovery warnings.

Do not treat a funding-root match as a signature or authorization.

### 7. Request approval, execute, and verify the order

Follow this sequence exactly:

```text
explain -> simulate -> display effects and fees
  -> request wallet approval -> execute -> verify
```

Bind approval to the exact simulation hash, effects, fees, expiry, wallet
snapshot, codebase digest, signal hash, risk policy, and selected outpoints.

The model stops at a candidate. The host requests wallet approval and the
wallet resolves it. Signing and broadcast consume a one-time opaque grant in a
separate broker; neither the grant nor transaction material enters the model
packet.

After submission, verify the actual txid and TradeLayer order/position state
through an independent observer. An `open` order is verified placement, not
realized PnL.

While execution is `executing`, `failed`, or `reconciliation_required`, the
model may only propose reading the persisted workflow. Once it is `submitted`,
it may propose independent verification. Absence from one observer is not
positive proof of failure and does not authorize retry or input release.

### 8. Settle PnL

Capture authoritative TradeLayer balances before and after the complete
trade/close sequence. Require every settlement transaction to be confirmed and
decoded against its expected payload.

Use an independently accepted valuation price. Deduct observed network and
protocol fees. Create and verify `tradelayer_balance_delta_pnl_v1`.

Continue only when:

- the position is closed or the relevant order sequence is filled and settled;
- the evidence hash is valid;
- every required transaction ID is present;
- `settledPnlSats` is positive.

Projected, unrealized, open-order, self-priced, or unconfirmed PnL cannot be
withdrawn.

### 9. Release PnL into spendable Bitcoin

Require a wallet/TradeLayer-owned release operation that proves the settled
PnL was converted or released into spendable Bitcoin controlled by the same
wallet session.

Apply the full approval sequence to the release. Bind its receipt to the PnL
evidence hash, exact amount, fees, destination wallet session, and release
transaction IDs.

The current local checkout does not provide a production-safe PnL-release
broker. In production mode, stop here with `pnl_release_unavailable` until that
broker exists. A simulated release may be used only in simulated mode.

### 10. Withdraw

Accept a normal Bitcoin destination address and an amount no greater than the
verified released PnL balance. Simulate destination, amount, fee, change, and
remaining balance.

Request a new wallet approval for the exact withdrawal simulation. Execute
through the wallet-owned broker and verify the resulting txid and confirmation
state.

On Bitcoin testnet4 the current wallet service can prepare a public candidate
containing input outpoints, destination, change, fee, unsigned txid, and
commitment hashes while retaining the raw PSBT privately. A prepared candidate
is not approved. Execution remains disabled by default and, when explicitly
enabled by an operator release, stays wallet-owned and testnet4-only.

Never reuse the order approval or PnL-release approval for withdrawal.

### 11. Seal the receipt

Emit `bitagent_tradelayer_collateral_lifecycle_v2`. Validate it with:

```powershell
node skills/tradelayer-collateral-lifecycle/scripts/validate-lifecycle-receipt.mjs <receipt.json>
```

Keep approval tokens and secrets out of the receipt. Include hashes and public
identifiers sufficient to reconstruct every decision.

## Recovery rules

- Preserve confirmed deposits across refreshes and wallet reconnects.
- Preserve simulations after cancellation or rejected signatures; clear only
  the active approval.
- Re-simulate after quote, fee, wallet, codebase, signal, UTXO, exposure, or
  policy drift.
- Treat an ambiguous execute response as submitted until reconciled.
- Never retry with different effects under the same idempotency key.
- On failed order or PnL verification, do not release or withdraw.
- On failed PnL release, preserve settlement evidence and do not manufacture a
  spendable balance.
- On failed withdrawal verification, reconcile the recorded txid before
  preparing a replacement.
- Preserve `prepared`, `executing`, `submitted`, `failed`, and
  `reconciliation_required` wallet substates. Only positive wallet or chain
  observation may resolve ambiguous submission.
- Never interpret a missing mempool or wallet observation as permission to
  retry, unlock inputs, or rebroadcast.

## Required checks

Before declaring completion, require:

- deposit confirmation and canonical UTXORef;
- matching collateral funding root;
- separately approved and verified reserve intake with all nine candidate-9
  gates and exact deployed release provenance;
- approved codebase and valid signal signature;
- exact simulation and separate wallet approval;
- independently verified order/position state;
- positive settled PnL evidence;
- verified PnL release into spendable BTC;
- separately approved and verified Bitcoin withdrawal;
- no secret material in prompts, tools, state, logs, or receipts.

Report each missing capability or failed stage. Never collapse partial success
into an end-to-end pass.
