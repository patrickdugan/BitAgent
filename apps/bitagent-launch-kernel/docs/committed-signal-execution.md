# Committed Algorithmic Signal Execution

## Scope

This module adds one bounded algorithmic execution lane beside the three-intent
launch kernel:

```text
operator-approved algorithm codebase
  -> typed post-only TLBTC/TLUSD limit-order signal
  -> codebase and signal verification
  -> wallet/TradeLayer balance truth
  -> confirmed UTXO selection and UTXO-Ref V2 funding root
  -> risk checks and real TradeLayer tx5 encoding
  -> exact simulation
  -> wallet approval
  -> broker submission
  -> independent order/position verification
```

The algorithm is a proposer. It is not loaded or executed in the BitAgent
process, cannot sign, and cannot broadcast.

Only `TLBTC/TLUSD`, `buy_tlbtc`/`sell_tlbtc`, and post-only limit orders are
accepted. Arbitrary code execution, exchange adapters, market orders,
leverage, autonomous parameter changes, unsupported assets, and secret
material are rejected.

## Codebase commitment

The operator, not the signal, owns the trust allowlist. Each approved codebase
is also bound to an Ed25519 producer public key. The external algorithm process
signs the canonical signal hash; BitAgent verifies the signature and never
receives the private key. Two codebase commitment modes are supported:

- `git_commit`: a full 40-character commit. The checkout must be at that
  commit and completely clean, including untracked files.
- `sha256_source_tree`: SHA-256 over a canonical, sorted list of source paths,
  file sizes, and per-file SHA-256 hashes. Symlinks, secret-like filenames,
  dependency directories, build outputs, and runtime logs are excluded or
  rejected.

The discovered `C:\projects\Trading Algos` directory is not a Git repository.
Its current 14-source-file commitment, observed on 2026-07-26, is:

```text
42546a6e14e9309b248bae6a80ac60206a9d5301060932976a5c3906a0ce6fad
```

This value is an observation, not a permanent trust grant. Recompute and
review it before each allowlist change:

```powershell
npm run hash:signal-codebase -- "C:\projects\Trading Algos"
```

For a clean Git repository:

```powershell
npm run hash:signal-codebase -- "C:\path\to\algorithms" --git
```

Production defaults to no approved codebase. Configure an exact pin:

```text
SIGNAL_CODEBASE_ID=operator-trading-algorithms
SIGNAL_CODEBASE_KIND=sha256_source_tree
SIGNAL_CODEBASE_DIGEST=<reviewed digest>
SIGNAL_CODEBASE_REPO=C:\projects\Trading Algos
SIGNAL_PRODUCER_KEY_ID=operator-signal-producer
SIGNAL_PRODUCER_PUBLIC_KEY_PEM_BASE64=<base64 of Ed25519 public-key PEM>
SIGNAL_STRATEGY_ID=committed-limit-signal-v1
SIGNAL_STRATEGY_VERSION=1
```

Changing any committed source file invalidates an already-approved execution.
Copying an approved digest is insufficient: a signal without the matching
approved producer signature is rejected.

## Signal contract

Signals use `bitagent_tradelayer_signal_v1` and contain:

- stable signal ID;
- exact codebase ID, commitment kind, and digest;
- exact strategy ID and version;
- fixed `TLBTC/TLUSD` market and side;
- integer satoshi amount and decimal limit price;
- `postOnly: true`;
- generated/expiry times;
- a hash of the strategy's input snapshot;
- an operator-approved producer key ID;
- a canonical payload hash over every preceding signal field;
- an Ed25519 signature over that payload hash.

`createAlgorithmicTradeSignal()` in
`src/signals/signalValidator.ts` produces the canonical payload hash and
accepts an external signing callback. In production that callback belongs in
the algorithm producer, not the BitAgent process.
Unknown fields are rejected. Fields whose names resemble private keys,
mnemonics, seed phrases, WIFs, API keys, or secrets are rejected before
persistence.

## UTXO-Ref and TradeLayer bindings

`src/signals/utxoFunding.ts` selects confirmed, wallet-observed UTXOs
deterministically and calls:

```text
UTXO-Ref/index.js
  -> v2.settlement.buildFundingSetV2(...)
```

The returned `fundingRoot` and exact outpoints enter the simulation hash.
Another active workflow cannot reserve the same outpoint.

`src/signals/tradelayerSignalAdapter.ts` calls:

```text
tradelayer.js/src/txEncoder.js
  -> encodeOnChainTokenForToken(...)
```

The simulation binds the tx5 payload, property IDs, side, amount, limit price,
expected token atoms, UTXO funding root, network fee, wallet snapshot,
codebase digest, signal hash, and risk-policy fingerprint.

## Approval and recovery

Every state change follows:

```text
explain -> simulate -> display exact effects and fees
  -> request approval -> execute -> verify
```

Execution re-checks:

- signal expiry;
- codebase commitment;
- simulation integrity;
- wallet balance/exposure/UTXO snapshot;
- network fee;
- risk-policy fingerprint;
- UTXO-Ref funding root;
- exact wallet approval binding.

Workflows persist atomically in
`.runtime/committed-signal-workflows.json`. Wallet approval tokens are opaque
and redacted from public state. Duplicate execution returns the saved
submission receipt. After an ambiguous submission, recovery instructions
require reconciling the recorded txid/order rather than submitting a
replacement.

## Commands

Run the non-funding testnet demonstration:

```powershell
npm run demo:signals
```

Run the adversarial suite:

```powershell
npm run test:signals
npm run eval:signals
```

The demo uses a scripted wallet, balances, txid, and order verifier and labels
them as such. Its Ed25519 keypair is ephemeral and test-only. It never sends
funds.

## Production boundary

Production remains fail-closed. A funded deployment still needs a
wallet-owned implementation of `SignalExecutionBroker` that:

1. reads confirmed UTXOs and TradeLayer balances from authoritative providers;
2. prepares an exact PSBT/order request and displays it in the wallet;
3. returns an opaque approval token only after the user approves;
4. signs and broadcasts without exposing WIF, seed, mnemonic, or private key;
5. independently verifies the txid plus TradeLayer order/position state.

The existing `TestnetSignerBroker` is the closest two-phase Bitcoin Core PSBT
precedent. It validates the exact OP_RETURN payload, input ownership, wallet
change, fee cap, approval hash, mempool acceptance, and broadcast receipt.
It should be wrapped by the wallet process, not called with keys by the
language-model process.

The legacy scripts in `C:\projects\Trading Algos` contain direct exchange
execution logic and secret-adjacent configuration names. They are provenance
inputs only. BitAgent does not import or run them.

The producer signature authenticates the configured signal source; it does not
cryptographically prove that an arbitrary binary executed the reviewed source.
A funded operator must build and run the producer from the pinned commit/tree
inside its own controlled build pipeline and protect the producer private key.
