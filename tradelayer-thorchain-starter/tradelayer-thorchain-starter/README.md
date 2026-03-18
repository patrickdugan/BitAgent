# TradeLayer × THORChain starter

Minimal starter repo for:

- taking ETH-side assets (ETH or ERC-20 like USDC)
- querying live THORChain quote + inbound routing data
- depositing into the live THORChain router with `depositWithExpiry`
- leaving a narrow mock seam for your existing UTXO-ref / TradeLayer absorb flow

This repo does **not** pretend to know your full existing codebase. Instead it gives you a thin starter around the parts that are stable enough to scaffold now.

## What is included

- `contracts/ThorchainDepositAdapter.sol`
  - optional adapter contract if you want a contract-owned path for deposits
- `contracts/TemplateBoundThorchainDepositAdapter.sol`
  - contract-owned deposit path with template-hash and destination-script commitment binding
- `scripts/quote-thorchain.ts`
  - fetches live inbound address + quote
- `scripts/deposit-erc20.ts`
  - approves the live THORChain router and calls `depositWithExpiry` for ERC-20 swaps
- `scripts/deposit-eth.ts`
  - same for native ETH
- `contracts/MockUTXORegistry.sol`
  - a placeholder UTXO registry for demo use
- `contracts/MockTradeLayerIngress.sol`
  - a placeholder for your protocol absorb call

## Template-bound deposit path

Use `TemplateBoundThorchainDepositAdapter.sol` if you want the EVM-side deposit to commit to the expected downstream DLC or BitVM receipt template before routing to THORChain.

It stores and emits:

- `templateHash`
- `destinationScriptCommitment`
- `thorMemoHash`
- destination-chain enum
- receipt and collateral property ids
- settlement-state enum
- deterministic `depositId`

This does not force THORChain itself to manufacture a specific Bitcoin or Litecoin witness structure. It does give the intake path a hard on-chain commitment that must match before a procedural receipt token is minted downstream.

## Architecture assumptions

The intended path is:

```text
USDC / ETH on EVM
→ live THORChain quote
→ live Asgard inbound vault + live router
→ THORChain executes swap to native BTC
→ your existing UTXO-ref / TradeLayer tx type absorbs that UTXO into protocol logic
```

The last step is intentionally mocked because you already have context and code here that I do not.

## Important caveats

1. **Do not cache inbound vault addresses.** THORChain vaults churn.
2. **Always query `inbound_addresses` and `quote/swap` right before sending.**
3. **Check `halted` before sending.**
4. **The direct script path is closer to production than the adapter contract path.**
   The adapter is here because you explicitly asked for ETH contracts, but for production UX you may prefer the signer calling the THORChain router directly.
5. **THORChain quote amounts are in 1e8 units, not token-native decimals.**

## Quick start

```bash
npm install
cp .env.example .env
```

Fill in:

- `PRIVATE_KEY`
- chain RPC URL
- destination BTC address
- source token address if using ERC-20

### Get a quote

```bash
npm run quote
```

### Deposit ERC-20

Example: Base USDC → BTC

```bash
npm run deposit:erc20
```

### Deposit ETH

```bash
npm run deposit:eth
```

## Environment notes

Typical examples:

- Ethereum USDC: `SOURCE_ASSET=ETH.USDC`
- Base USDC: `SOURCE_ASSET=BASE.USDC` if that pool is available live
- Native ETH: `SOURCE_ASSET=ETH.ETH`
- Destination native BTC: `DEST_ASSET=BTC.BTC`

You should verify pool availability via Midgard or the quote response before wiring product UX.

## How to plug in your existing TradeLayer absorb path

The seam is intentionally narrow. After THORChain settles native BTC out to your destination address, you can:

1. detect the UTXO using your existing watcher / indexer
2. derive your `utxoRef`
3. call your existing TradeLayer absorb tx type

If you need a demo-only local seam, a fake flow is:

```text
quote / deposit tx confirmed
→ fake observed BTC txid/vout
→ register in MockUTXORegistry
→ call MockTradeLayerIngress.absorbUtxoRef(...)
```

## Suggested next step

Replace `MockTradeLayerIngress.sol` with a tiny interface adapter to your real absorb call, and keep the THORChain scripts mostly unchanged.
