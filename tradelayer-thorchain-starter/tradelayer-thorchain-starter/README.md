# BitAgent × TradeLayer chain-abstraction starter

## BitAgent Launch Kernel

BitAgent now includes a narrow, referral-driven Bitcoin onboarding workflow
with exactly three supported natural-language intents:

- “Help me deposit Bitcoin.”
- “Use part of my Bitcoin in the starter TradeLayer strategy.”
- “Help me withdraw my Bitcoin.”

The starter strategy is one post-only tlBTC-for-tlUSD type-5 limit order. Every
state-changing path is simulation-first and follows:

```text
explain → simulate → display exact effects and fees → request approval → execute → verify
```

Run the complete scripted testnet journey:

```powershell
npm install
npm run launch
```

Open `http://127.0.0.1:8790/`, or test referral routing directly:

```text
http://127.0.0.1:8790/?ref=demo-referrer&campaign=launch&workflow=starter_strategy&strategy=starter-v1
```

The browser keeps only a workflow pointer; the workflow itself is stored
server-side and resumes after refresh. The demo never asks for or accepts seed
phrases, mnemonics, WIFs, or private keys.

Run the reliability checks:

```powershell
npm run test:launch
npm run eval:launch
npm run demo:launch
```

The launch suite currently contains 24 end-to-end trajectories, 50 focused
agent cases, an HTTP surface test, sanitized failure-trace fixtures, and a
machine-readable evaluation report under `eval/artifacts/`.

Important: the included broker and hosted browser path are deterministic
testnet simulations. `BITAGENT_PRODUCTION=true` fails closed until a real
wallet-owned opaque approval/sign/broadcast/verification broker is configured.
See [docs/operator-guide.md](docs/operator-guide.md),
[docs/launch-kernel-architecture.md](docs/launch-kernel-architecture.md), and
[docs/launch-readiness.md](docs/launch-readiness.md).

Owner-only hosted demo:
[bitagent-launch-kernel.duganist875063.chatgpt.site](https://bitagent-launch-kernel.duganist875063.chatgpt.site).

## Committed algorithmic TradeLayer signals

BitAgent also has a separate, fail-closed execution lane for signals produced
by one operator-approved hashed codebase. It accepts only post-only
TLBTC/TLUSD limit orders, maps wallet-observed confirmed UTXOs through the real
UTXO-Ref V2 funding-root builder, encodes the exact order with the real
`tradelayer.js` tx5 encoder, verifies an Ed25519 signature from the approved
signal producer, and requires wallet approval before execution.

```powershell
npm run hash:signal-codebase -- "C:\projects\Trading Algos"
npm run demo:signals
npm run test:signals
npm run eval:signals
```

The algorithm is never imported and receives no signing authority. Production
starts with an empty codebase allowlist and an unavailable execution broker,
so funded execution is disabled until the exact digest and a wallet-owned
broker are configured. See
[docs/committed-signal-execution.md](docs/committed-signal-execution.md).

The default EVM-to-Bitcoin onboarding rail is now **NEAR Intents**, not
THORChain. BitAgent uses:

- `@defuse-protocol/one-click-sdk-typescript` for current token discovery,
  exact quotes, deposit registration, status, destination txids, and refunds
- `chainsig.js` for NEAR-controlled native Bitcoin/EVM account preparation
- a persisted approval state machine that binds wallet approval to the exact
  quote hash and rejects preview-only or stale quotes
- the existing UTXO-Ref and TradeLayer adapters after native BTC/LTC arrives

THORChain remains available only as `CROSS_CHAIN_RAIL=thorchain` and through
the legacy `quote` / `deposit:*` scripts. It is not part of the default
BitAgent onboarding path.

Run the deterministic NEAR path:

```powershell
npm run demo:near
npm run test:near
```

For a live, non-funding preview quote, set `NEAR_INTENTS_MODE=live` and provide
the exact recipient/refund addresses. Executable quotes require
`NEAR_INTENTS_JWT`; funded execution still fails closed until a wallet-owned
origin-chain broker replaces the scripted broker. See
[docs/chain-abstraction.md](docs/chain-abstraction.md).

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
- `scripts/deposit-template.ts`
  - routes through `TemplateBoundThorchainDepositAdapter` so the EVM-side deposit commits the DLC template hash and destination script commitment before swap submission
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

The default path is:

```text
USDC / ETH on EVM
→ live NEAR Intents token discovery and exact quote
→ display deposit address, minimum output, fees, refund address, and expiry
→ explicit origin-wallet approval and deposit
→ solver settlement to native BTC/LTC
→ independently observed UTXO
→ UTXO-Ref mapping and TradeLayer intake
```

NEAR Intents supplies swap liquidity/settlement. Chain Signatures are a
separate account-control library and are never treated as a liquidity source.
Omni Bridge remains appropriate for transfers, not price discovery.

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

For NEAR Intents, fill in:

- destination BTC address
- origin-wallet refund address
- `NEAR_INTENTS_JWT` only when requesting an executable live quote

BitAgent does not accept a private key, seed phrase, mnemonic, or WIF.

### Optional legacy THORChain scripts

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

### Deposit Through Template-Bound Adapter

```bash
npm run deposit:template
```

Required env in addition to the normal quote/deposit fields:

- `TEMPLATE_BOUND_ADAPTER_ADDRESS`
- `TL_RECEIPT_PROPERTY_ID`
- `TL_DLC_TEMPLATE_ID`

Recommended:

- `TL_COLLATERAL_PROPERTY_ID`
- `EVM_DEPOSITOR_ADDRESS`

## Sovereign Agent Harness

The sovereign harness treats models and learned skills as untrusted proposers. It evaluates bounded policy configurations against expected financial flows, rejects candidates with unsafe authorizations, updates a host-owned self-model only after a clean promotion, and issues an exact one-shot capability lease for the selected safe action.

```powershell
npm run demo:sovereign
npm run test:sovereign
```

The demo exports hash-linked DAS-style events and a MeTTa inspection snapshot under `.runtime/sovereign-demo/latest/`. Its NEAR Chain Signature adapter prepares an unsigned request envelope only; signing and broadcast remain external capabilities. See `docs/sovereign-agent-harness.md` for the authority model and build arc.

## Testnet Economic Agent

The economic-loop demo invokes the real sibling `tradelayer.js` BTC testnet4 VWAP planner in dry-run mode, evaluates a declared mock spread against Filecoin and Akash costs, prepares provider-neutral compute fallback state, and emits non-relayable chain-abstraction envelopes.

```powershell
npm run demo:testnet-agent
npm run test:economic
```

Outputs are stored under `.runtime/testnet-agent/`. Projected profit remains separate from spendable treasury until transaction settlement is independently observed. Filecoin deal publication, Akash lease creation, NEAR signing, and TradeLayer broadcast remain external capabilities. See `docs/testnet-economic-agent.md` for the live-testnet arc.

The next-stage two-process testnet loop is available through:

```powershell
npm run demo:live-testnet-agent
npm run test:live
```

It emits an exact PSBT broker request, decodes confirmed tx5 pairs through the sibling TradeLayer decoder, requires separate address-level PnL evidence, and records balanced treasury postings. Live signing is intentionally a separate `broker:testnet` command. See `docs/live-testnet-runbook.md` before enabling `TL_TESTNET_SUBMIT`.

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
