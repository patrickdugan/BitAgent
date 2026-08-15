# AGENTS.md

## Mission
Build the smallest viable path from **EVM-side ETH/USDC liquidity** into **TradeLayer-native UTXO-linked positions**, using the starter repo in this directory as the orchestration shell and treating the existing local repos **`UTXO-Ref`**, **`tradelayer.js`**, and **`tradelayer-wallet`** as sources of truth for UTXO ingestion, transaction encoding, wallet UX, and DLC-related integration.

This file is written for Codex / coding agents. Favor concrete progress over abstraction. Ship a vertical slice first.

---

## Product objective
Create a demo and code path that does all of the following:

1. Accepts ETH or USDC on an EVM chain.
2. Obtains a THORChain quote and executes the EVM-side router flow.
3. Produces a **BTC/LTC UTXO-oriented receipt** that can be mapped into the TradeLayer domain.
4. Hands off that receipt into **UTXO-Ref** and/or the existing TradeLayer absorb/inbound transaction machinery.
5. Exposes enough wallet/UI state that `tradelayer-wallet` can present the lifecycle clearly.
6. Leaves a clean seam for DLC/VTXO integration through the wallet and related relayer code.

The immediate win condition is **working onboarding**, not a full production bridge.

---

## Repos to use
Assume this repo sits beside the following sibling repos on disk:

- `../UTXO-Ref`
- `../tradelayer.js`
- `../tradelayer-wallet`

If names differ, discover them with `ls ..` and update imports/scripts accordingly.

### How to treat each repo

#### 1) `UTXO-Ref`
Use this as the source of truth for:
- UTXO reference types
- txid/vout/value/address ownership representations
- proof / witness / state transition helpers, if present
- any existing “absorb UTXO into protocol” semantics

Do **not** re-invent the UTXO reference model in this starter unless forced.

#### 2) `tradelayer.js`
Use this as the source of truth for:
- TradeLayer transaction encoding/decoding
- tx-type builders
- RPC/API wiring to TradeLayer endpoints
- property IDs, contract IDs, and protocol serialization rules
- any existing absorb/deposit/commit/send/transfer builder relevant to UTXO intake

If an absorb-style tx builder already exists there, call it rather than recreating it locally.

#### 3) `tradelayer-wallet`
Use this as the source of truth for:
- wallet state management
- Electron / frontend integration
- RPC connection patterns
- UX for balances, pending actions, and confirmations
- integration points for `tl-rpc`, relayer, explorer, and orderbook services
- DLC / VTXO related UX and relayer adjacency where present

If the wallet already has a path for external event ingestion or pending swap/bridge status, plug into that instead of creating a parallel UI architecture.

---

## Known public context
The public TradeLayer docs say the wallet architecture supports an Electron wallet today and contemplates broader API-mode and web/browser integrations using JavaScript Bitcoin/Litecoin libraries. The docs also describe a cross-chain direction involving NEAR-based chain signatures, and the public `tradelayer-wallet` GitHub org currently includes `tradelayer-wallet`, `tl-rpc`, `tl-relayer`, `tl-orderbook-server`, `TL-Extension`, and `Ark-TradeLayer` (described there as a **VTXO-DLC Wrapper/Relayer**). Treat those public surfaces as clues, but prefer the actual local checkout contents over assumptions. [1][2][3][4]

---

## Ground rules

1. **Local code wins over guesswork.** Read the sibling repos before writing adapters.
2. **No broad rewrites.** Add thin adapters first.
3. **Keep THORChain integration current.** Use fresh quote/inbound-address lookups at execution time; do not hardcode Asgard vaults or memos.
4. **Preserve domain boundaries.**
   - EVM repo: deposit + router call + event capture
   - UTXO-Ref: canonical UTXO object / proof semantics
   - tradelayer.js: TradeLayer message construction
   - tradelayer-wallet: UX / signing / user state / DLC adjacency
5. **Stub where necessary, document every stub.**
6. **Everything important emits structured events.**

---

## Architecture target

```text
EVM deposit (ETH/USDC)
  -> THORChain quote
  -> EVM router execution
  -> swap status / tx receipt
  -> normalized UTXO receipt object
  -> UTXO-Ref mapping
  -> TradeLayer absorb/intake tx builder (via tradelayer.js)
  -> wallet-visible pending state (via tradelayer-wallet)
  -> DLC/VTXO follow-on hooks
```

---

## Deliverables Codex should produce

### A. Repo mapping memo
Create `docs/repo-map.md` summarizing:
- where UTXO reference structures live
- where TradeLayer tx builders live
- where wallet state and pending-activity UI live
- where DLC / Ark / relayer hooks live
- what is missing and must be stubbed

This should be the first artifact.

### B. Integration shim package
Create a small local package or module such as:

- `src/adapters/utxoRefAdapter.ts`
- `src/adapters/tradelayerAdapter.ts`
- `src/adapters/walletAdapter.ts`
- `src/adapters/dlcAdapter.ts`

These should be thin wrappers over the sibling repos, not substitutes.

### C. Canonical receipt type
Define a single normalized onboarding object, e.g.:

```ts
export type InboundUtxoReceipt = {
  sourceChain: 'ethereum' | 'base' | 'arbitrum' | 'optimism';
  sourceAsset: 'ETH' | 'USDC';
  thorchainSwapTx?: string;
  thorchainMemo?: string;
  destinationChain: 'bitcoin' | 'litecoin';
  destinationTxid?: string;
  destinationVout?: number;
  destinationAddress?: string;
  valueSats?: string;
  valueAtoms?: string;
  confirmations?: number;
  status:
    | 'quote_obtained'
    | 'submitted'
    | 'egress_detected'
    | 'utxo_confirmed'
    | 'mapped'
    | 'absorbed'
    | 'failed';
  raw?: unknown;
};
```

Use the real UTXO-Ref types if available.

### D. TradeLayer intake path
Implement one explicit function:

```ts
async function absorbInboundUtxo(receipt: InboundUtxoReceipt): Promise<{
  tlTxHex?: string;
  tlTxid?: string;
  status: 'built' | 'submitted' | 'confirmed';
}>;
```

This function should:
- validate the receipt
- map it into UTXO-Ref semantics
- call the correct `tradelayer.js` builder / RPC path
- persist state so the wallet can render it

### E. Wallet status surface
Expose a minimal wallet-consumable activity model:

```ts
export type OnboardingActivity = {
  id: string;
  phase:
    | 'deposit'
    | 'thorchain_swap'
    | 'utxo_detection'
    | 'tradelayer_absorb'
    | 'dlc_ready';
  status: 'pending' | 'success' | 'error';
  label: string;
  txid?: string;
  meta?: Record<string, unknown>;
};
```

Add a simple feed or state endpoint rather than a full UI rewrite.

### F. DLC / wallet hook
Add a narrow hook for follow-on DLC/VTXO work:

```ts
export interface DlcPreparationHook {
  prepareFromAbsorbedUtxo(input: {
    tlTxid: string;
    utxoRef: string;
    walletAccount?: string;
  }): Promise<{
    dlcCandidateId?: string;
    relayPayload?: unknown;
    status: 'prepared' | 'stub';
  }>;
}
```

If `Ark-TradeLayer` or another local relayer package already defines a better abstraction, use that.

---

## Execution order

### Phase 1 — inspect and map
1. Inspect sibling repos.
2. Generate `docs/repo-map.md`.
3. Identify exact modules/functions to reuse.
4. Note all unresolved seams.

### Phase 2 — normalize inbound data
1. Keep the current THORChain quote/router flow.
2. Add event listeners / polling for swap lifecycle.
3. Normalize output into `InboundUtxoReceipt`.
4. Prefer live chain data over mocks where feasible.

### Phase 3 — connect UTXO-Ref
1. Import real UTXO reference types/helpers.
2. Replace local mock registry assumptions where possible.
3. Implement deterministic mapping from egress tx -> utxo ref.

### Phase 4 — connect TradeLayer
1. Locate absorb/inbound tx builder in `tradelayer.js`.
2. Build and, if possible, submit the TradeLayer transaction.
3. Persist tx hex / txid / status.

### Phase 5 — connect wallet
1. Surface activity in a wallet-readable way.
2. Add minimal UI/state feed for onboarding lifecycle.
3. Ensure error states are legible.

### Phase 6 — DLC seam
1. Identify whether `tradelayer-wallet`, `tl-relayer`, or `Ark-TradeLayer` already contains the best insertion point.
2. Add a stubbed but typed `prepareFromAbsorbedUtxo()` path.
3. Do not build the full DLC system in this pass.

---

## Concrete tasks Codex should execute

### Task 1: repo discovery
- run `ls ..`
- confirm presence of `UTXO-Ref`, `tradelayer.js`, `tradelayer-wallet`
- if absent, search one level up/down

### Task 2: identify important files
Search for:
- `txid`
- `vout`
- `utxo`
- `absorb`
- `deposit`
- `builder`
- `op_return`
- `propertyId`
- `rpc`
- `wallet`
- `pending`
- `DLC`
- `Ark`
- `relayer`
- `VTXO`

### Task 3: produce import plan
For each integration, record:
- file path
- exported function/type
- why it is the right seam
- whether it is stable or provisional

### Task 4: wire adapters
Implement imports with the thinnest possible wrappers.

### Task 5: smoke tests
Add tests that prove:
- receipt normalization works
- UTXO mapping works
- TradeLayer tx build path is callable
- wallet activity serialization works

### Task 6: CLI/demo
Add a single command such as:

```bash
npm run demo:onboard
```

That command should:
- fetch a quote
- simulate or submit the EVM-side swap path
- map the resulting receipt
- build the TradeLayer intake transaction
- dump activity log JSON

---

## Coding conventions

- TypeScript first unless the sibling repo forces otherwise.
- Keep every adapter under 200 lines if possible.
- Avoid framework churn.
- Prefer named exports.
- Put chain-specific constants in one place.
- Put all externally-derived IDs/addresses in config files, never inline in multiple files.

---

## THORChain integration rules

- Obtain a fresh quote immediately before execution.
- Obtain fresh inbound addresses immediately before execution.
- Do not cache Asgard vaults.
- Use router contract calls only in the documented pattern.
- Persist memo, vault address, router tx hash, and any observed destination txid.

If the current starter repo has both a contract adapter path and a direct signer path, prefer the path that best matches THORChain’s documented live flow and keep the other path clearly labeled experimental.

---

## Error handling rules

Every failure must classify as one of:
- `quote_error`
- `router_submit_error`
- `swap_timeout`
- `egress_not_found`
- `utxo_parse_error`
- `utxo_ref_map_error`
- `tradelayer_build_error`
- `tradelayer_submit_error`
- `wallet_sync_error`
- `dlc_prepare_error`

Never throw anonymous errors from integration boundaries.

---

## Definition of done for this sprint
This sprint is done when:

1. Codex has mapped the real local repos.
2. A single command can produce a normalized inbound receipt.
3. That receipt can be converted into a UTXO reference using the real local abstractions.
4. A TradeLayer intake/absorb transaction can be built from that receipt.
5. The wallet can display the onboarding lifecycle in at least a debug/dev surface.
6. A typed DLC preparation seam exists for later work.

---

## Out of scope for now
- production bridge trust model
- full NEAR chain-signature integration
- generalized chain abstraction
- complete DLC execution engine
- automatic market making / strategy logic
- portfolio manager / Qwen orchestration
- final UX polish

---

## First message Codex should follow
When you start, do this in order and do not skip steps:

1. Inspect sibling repos and write `docs/repo-map.md`.
2. Identify the exact UTXO reference type and exact TradeLayer intake tx builder.
3. Identify the best wallet activity insertion point.
4. Only then begin wiring adapters.
5. Keep a running `docs/integration-log.md` with every assumption and unresolved issue.

---

## Notes for the implementing agent
Where local code conflicts with this file, local code wins. This document is a steering layer, not a protocol spec.

## References
[1] TradeLayer wallet integration docs: https://docs.tradelayer.org/api_reference/wallet
[2] TradeLayer cross-chain docs: https://docs.tradelayer.org/introduction/crosschain
[3] `tradelayer-wallet` GitHub org: https://github.com/tradelayer-wallet
[4] `tradelayer-wallet/tradelayer-wallet` repo: https://github.com/tradelayer-wallet/tradelayer-wallet
