# Repo Map

## Discovery

- Starter repo: `C:\projects\BitAgent\BitAgent\tradelayer-thorchain-starter\tradelayer-thorchain-starter`
- `UTXO-Ref`: `C:\projects\UTXORef\UTXO-Ref`
- `tradelayer.js`: `C:\projects\tradelayer.js`
- `tradelayer-wallet`: `C:\projects\TLWallet\tradelayer-wallet`
- `tl-relayer`: `C:\projects\tl-relayer`
- `Ark-TradeLayer`: `C:\projects\Ark-TradeLayer`

## UTXO Reference Structures

- Primary seam: `C:\projects\UTXORef\UTXO-Ref\bitvm3\utxo_referee\index.js`
- Exported types: `CommitmentPackage`, `PayoutLeaf`, `PayoutOutput`, `ResidualOutput`, `SweepObject`, `ReceiptLedger`
- Serialization helpers: `serializeScriptPubKey`, `writeU64LE`, `readU64LE`
- Tradeoff: this repo has strong payout/receipt proof primitives, but no clean packaged `txid/vout/value/address` TypeScript model for a simple inbound UTXO receipt. The starter repo must adapt raw receipt data into a thin local record while reusing the imported UTXO referee exports where possible.

## TradeLayer Transaction Builders

- Closest live intake seam: `C:\projects\tradelayer.js\src\txUtils.js`
- Relevant functions:
- `createGrantManagedTokenTransaction(address, params)` for tx11-managed receipt mint / intake-like flow
- `createRedeemManagedTokenTransaction(address, params)` for reverse flow
- `sendTransaction(address, to, propertyId, amount, ...)` used by existing DLC tests for collateral movement
- Payload encoder: `C:\projects\tradelayer.js\src\txEncoder.js`
- Relevant function: `encodeGrantManagedToken(params)`
- Why this seam: existing TradeLayer DLC tests use tx11 grant-managed flows to mint receipt-like assets against vault/collateral movement, so this is the smallest real local path to reuse instead of inventing a new intake format.
- Gap: no explicit `absorbInboundUtxo()` export exists in `tradelayer.js`; this sprint uses tx11 grant-managed as the provisional intake builder and documents the missing native absorb API.

## TLWeb And Phantom Surface

- No local `tlweb` repo was present under `C:\projects`, so this sprint treats `tlweb` as a target integration surface rather than a sibling import.
- Phantom-facing seam is implemented locally in the starter repo as a web-friendly intent payload that can be consumed by a browser wallet flow without pulling in `tradelayer-wallet`.
- Deferred seam: `C:\projects\TLWallet\tradelayer-wallet` remains available for later reuse, but it is no longer the primary integration target for this sprint.

## DLC, Ark, And Relayer Hooks

- Ark seam: `C:\projects\Ark-TradeLayer\tl-vtxo-handshake-optimized\ark-tradelayer-handshake.js`
- Exported classes: `ArkTemplateRegistry`, `ArkDepositRecognizer`, `ArkExitRecognizer`, `ArkTradeLayerBridge`
- Relayer seam: `C:\projects\tl-relayer\src\services\tx.service.ts`
- Why this seam: `ArkTradeLayerBridge` is already the narrowest local abstraction for recognizing Ark/VTXO deposits and exits. It is still partially placeholder-based, but it is a better typed boundary than inventing a new DLC adapter in the starter repo.

## Missing Or Provisional Pieces

- Missing: clean canonical `txid/vout/value/address` UTXO reference export in `UTXO-Ref`
- Missing: explicit TradeLayer `absorb` builder for inbound UTXOs in `tradelayer.js`
- Missing: local `tlweb` checkout or existing Phantom integration package
- Missing: live THORChain egress-to-UTXO detection code in the starter repo

## Sprint Stubs

- Egress detection is stubbed through explicit observed env values when live chain indexing is unavailable.
- TradeLayer intake uses tx11 grant-managed as the provisional absorb path until a dedicated inbound absorb builder is exposed upstream.
- Phantom/TLWeb integration is exposed as a starter-local intent payload because there is no local `tlweb` package to import directly.
