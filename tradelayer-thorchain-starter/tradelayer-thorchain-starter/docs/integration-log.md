# Integration Log

## Assumptions

- `C:\projects\UTXORef\UTXO-Ref\bitvm3\utxo_referee\index.js` is the best available local source of truth for UTXO-linked receipt semantics even though it models payout proofs more strongly than simple UTXO references.
- `C:\projects\tradelayer.js\src\txUtils.js#createGrantManagedTokenTransaction` is the closest existing local intake builder for a vertical slice from inbound collateral to wallet-visible receipt state.
- There is no local `tlweb` checkout, so Phantom/TLWeb integration must be emitted as a local browser-oriented intent payload in this sprint.
- `C:\projects\Ark-TradeLayer\tl-vtxo-handshake-optimized\ark-tradelayer-handshake.js` is the narrowest DLC/VTXO follow-on seam worth preserving.

## Resolved

- Repo discovery required searching outside the immediate parent directory because the expected sibling repos are located under different root folders in `C:\projects`.
- The starter repo already has fresh-quote/fresh-inbound THORChain helpers, so those are reused directly instead of rewritten.

## Unresolved

- `UTXO-Ref` does not expose a clean TypeScript `UTXORef` record containing `txid`, `vout`, `value`, and ownership metadata.
- `tradelayer.js` does not currently expose a dedicated inbound absorb transaction builder; tx11 grant-managed is a provisional bridge seam.
- Live THORChain egress detection still needs either a chain indexer or a vetted THORChain tx-status lookup path.
- `Ark-TradeLayer` contains placeholder taproot math and should not be treated as production-complete validation.

## Stubs Added In This Sprint

- `egress_not_found` path can be bypassed in demo mode by providing observed destination tx details explicitly.
- TradeLayer absorb submission falls back to payload build-only mode when wallet/RPC credentials are missing.
- Phantom/TLWeb integration is emitted as a typed signing intent plus procedural template metadata.
