# BitAgent Chain Abstraction

## Decision

NEAR Intents is the default cross-chain onboarding rail. THORChain is an
explicit legacy adapter. The direct Bitcoin deposit path in the three-intent
launch kernel remains available and does not depend on either network.

This is not a claim that NEAR Intents is trustless in the same way as a native
Bitcoin transaction. It is a solver-based execution network settled through
NEAR contracts. BitAgent exposes that dependency and preserves a normal
Bitcoin withdrawal path.

## Library boundaries

| Need | Library | BitAgent use |
| --- | --- | --- |
| Swap liquidity and routing | `@defuse-protocol/one-click-sdk-typescript` | Live token list, exact quote, deposit address/memo, deposit tx registration, status, refund, destination txids |
| Direct intent construction | `@defuse-protocol/intents-sdk` | Not needed for the first 1Click vertical slice |
| Native cross-chain account control | `chainsig.js` | Derive NEAR-controlled Bitcoin accounts, build PSBTs, request wallet-approved MPC signatures, finalize/relay |
| Asset transfer without a swap | `@omni-bridge/*` | Deliberately not used as a swap router |

## State-changing sequence

```text
explain
→ request current executable quote
→ display input, minimum output, fees, recipient, refund address, deposit address/memo, expiry
→ request wallet approval bound to quoteHash
→ origin wallet executes the deposit
→ register the deposit txid
→ poll 1Click status
→ require SUCCESS plus a destination-chain txid
→ independently observe BTC/LTC outpoint and confirmations
→ map through UTXO-Ref
→ build TradeLayer intake
```

`REFUNDED` is terminal but not successful. `FAILED` is terminal and not
credited. Preview-only and expired quotes cannot reach approval. A rejected or
cancelled signature preserves the quote and recovery record; an expired quote
must be replaced.

## Runtime modes

- `NEAR_INTENTS_MODE=scripted` is deterministic evaluation mode. Its addresses
  use the non-routable `scripted://` scheme and must never receive funds.
- `NEAR_INTENTS_MODE=live` calls the official 1Click API.
- A live executable quote requires `NEAR_INTENTS_JWT`.
- Live deposits remain fail-closed until an authenticated wallet-owned broker
  implements `OriginWalletBroker`. The core process never receives a key.
- `CROSS_CHAIN_RAIL=thorchain` enables the older quote path for compatibility.

## Chain Signatures

`ChainsigBitcoinAdapter` uses the current `chainsig.js` contract API. The MPC
contract request accepts a public `accountId` and a wallet-provided
`signAndSendTransactions` callback. BitAgent refuses secret-bearing fields,
prepares the exact PSBT and fee first, requires explicit approval, checks
expiry and account identity, then optionally broadcasts.

The `chainsig.js` 1.1.16 declaration bundle currently fails strict checking
because unrelated Cosmos/Aptos/Sui declarations are inconsistent or have
missing transitive types. The runtime SDK is isolated behind a narrow local
interface instead of disabling TypeScript checks for the project.

## Commands

```powershell
npm run demo:near
npm run test:near
npx tsc --noEmit
```

The demo persists to `.runtime/near-intents-workflows.json` and redacts the
wallet approval token from public output.
