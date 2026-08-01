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
| Native cross-chain account control | `chainsig.js` | Derive NEAR-controlled Bitcoin, Ethereum, and Solana accounts; prepare exact unsigned transactions; request wallet-approved MPC signatures; finalize/relay |
| Phantom browser authority | `@phantom/browser-sdk` | Injected wallet only; public Ethereum/Solana accounts; Sepolia/devnet switching; exact-plan submission |
| MetaMask browser authority | `@metamask/connect-multichain` | CAIP-25 session for Sepolia and Solana devnet; exact typed method submission |
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
- The browser surface can persist a public Phantom or MetaMask multichain
  session. Live deposits remain fail-closed until an executable 1Click quote is
  converted into a chain-specific transaction simulation by a trusted host.
  Merely connecting a wallet never authorizes a deposit.
- `CROSS_CHAIN_RAIL=thorchain` enables the older quote path for compatibility.

## Wallet authority matrix

| Provider | Ethereum | Solana | Mode | Constraint |
| --- | --- | --- | --- | --- |
| Phantom | Sepolia | Devnet | Injected extension | No embedded EVM and no auto-confirm |
| MetaMask | Sepolia | Devnet | Multichain CAIP session | Only `eth_sendTransaction` or Solana `signAndSendTransaction` for an exact approved plan |
| NEAR Chain Signatures | Sepolia | Devnet | `v1.signer-prod.testnet` | A NEAR wallet approves the MPC contract action; BitAgent never holds its key |

The direct-wallet and NEAR-controlled account paths are different custody
paths. A Phantom or MetaMask account is not silently treated as a NEAR account,
and a NEAR-derived Ethereum/Solana address is not silently replaced by a
connected origin-wallet address.

The browser connector exposes no generic `request()` or `invokeMethod()` handle
to the model. It accepts only a typed `DirectWalletActionPlan`; the provider,
network, source account, destination, value, serialized bytes, fee ceiling,
expiry, and simulation hash must still match at execution time. Solana native
transfer bytes are decoded again immediately before the wallet prompt.

## Chain Signatures

`ChainsigBitcoinAdapter`, `ChainsigEvmAdapter`, and
`ChainsigSolanaAdapter` use the current `chainsig.js` contract API. The MPC
contract request accepts a public `accountId` and a wallet-provided
`signAndSendTransactions` callback. BitAgent refuses secret-bearing fields,
prepares the exact PSBT or transaction and fee first, requires explicit
approval, checks the simulation hash, expiry, and account identity, then
optionally broadcasts. EVM uses ECDSA; Solana uses the signer contract's
Ed25519 domain.

The `chainsig.js` 1.1.16 declaration bundle currently fails strict checking
because unrelated Cosmos/Aptos/Sui declarations are inconsistent or have
missing transitive types. The runtime SDK is isolated behind a narrow local
interface instead of disabling TypeScript checks for the project.

## Commands

```powershell
npm run demo:near
npm run test:near
npm run prepare:multichain-testnet
npx tsc --noEmit
```

The demo persists to `.runtime/near-intents-workflows.json` and redacts the
wallet approval token from public output.

`prepare:multichain-testnet` writes deterministic unsigned Sepolia and Solana
devnet transaction plans to `.runtime/multichain-testnet-plans.json`. It uses
local RPC fixtures so it is reproducible; fees, nonce, quote, and blockhash must
be refreshed from live RPCs before approval. The artifact explicitly records
that no signature or broadcast was requested.
