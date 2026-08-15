# TradeLayer Covenant Shadow Feeder

Status: live-capable, read-only, candidate-only testnet4 adapter, 2026-08-05.

## Outcome

The shadow feeder captures a coherent public TradeLayer state bundle and turns
it into the existing `StrategyMarketSnapshot` and `StrategyPortfolioState`.
The resulting feed can enter the deterministic Strategy Covenant allocator,
but it cannot request approval, sign, submit, broadcast, or report a fill.

```text
TradeLayer wallet listener (read only)
  -> sync-before
  -> Bitcoin network + spot book + address balances + oracle list
  -> sync-after
  -> exact response hashes + capture root
  -> independent risk checkpoint
  -> freshness, height, balance, pair, and oracle checks
  -> market snapshot + portfolio state
  -> Strategy Covenant allocator (effect: none)
  -> exact candidate manifest
  -> wallet user remains the next transaction authority
```

## Local source-of-truth seams

The adapter calls only endpoints already implemented by
`C:\projects\tradelayer.js\src\walletListener.js`:

- `POST /tl_getSyncStatus`
- `POST /tl_allocatedRpc` with hardcoded method `getblockchaininfo`
- `POST /tl_getOrderbook`
- `POST /tl_getAllBalancesForAddress`
- `POST /tl_listOracles`

It does not expose the generic allocated-RPC method to a model. It does not
call any create, send, sign, submit, or broadcast endpoint. A sync observation
both before and after the other reads prevents mixed-height captures.

Spot prices are reconstructed from exact offered and expected quantities:

- buy: offered tlUSD atoms / expected tlBTC sats;
- sell: expected tlUSD atoms / offered tlBTC sats.

This avoids trusting the sibling order book's side-dependent `price` field.
Both property IDs and their orientation are checked against operator config.

## Required risk checkpoint

A point-in-time balance response cannot truthfully establish daily loss,
drawdown, leverage, or a portfolio nonce. The feeder therefore requires a
separate `bitagent_tradelayer_risk_checkpoint_v1` object containing those
values. Its hash binds:

- testnet4, wallet address, and declared channel;
- the normalized tlBTC/tlUSD balance snapshot hash;
- listener source height and observation time;
- current net delta, gross leverage, daily loss, drawdown, and nonce;
- public risk-ledger source ID.

The checkpoint is content-bound but not yet cryptographically authenticated.
Production requires an allowlisted risk service with a verifiable signature
or attestation and channel-specific accounting. Until then, this is suitable
for shadow comparisons only.

## Fail-closed checks

Candidate generation stops on:

- mainnet or unknown network identity;
- listener not initialized, not realtime, errored, or beyond block-lag limits;
- stale/future source timestamps or a height change during capture;
- duplicate, missing, negative, or internally inconsistent balance rows;
- risk checkpoint hash, wallet, channel, balance, time, or height mismatch;
- empty, misoriented, locked, or crossed order books;
- missing, stale, future-height, or spread-inconsistent oracle observations;
- secret-bearing fields, oversized HTTP responses, source errors, or an
  individual evidence-hash mismatch.

Raw response bundles are stored by `captureHash`. A corrupt existing file is
never replaced. Recovery reloads and revalidates the capture, but stale source
or risk evidence must be refreshed.

## Live command

Set public/read-only source configuration and the path to a separately
generated risk checkpoint:

```powershell
$env:TL_SHADOW_ENDPOINT = "http://127.0.0.1:3000"
$env:TL_SHADOW_PROVIDER_NODE_ID = "testnet4-observer-1"
$env:TL_SHADOW_WALLET_ADDRESS = "<public testnet4 wallet address>"
$env:TL_SHADOW_CHANNEL_ID = "<isolated shadow channel id>"
$env:TL_SHADOW_TLBTC_PROPERTY_ID = "<configured id>"
$env:TL_SHADOW_TLUSD_PROPERTY_ID = "<configured id>"
$env:TL_SHADOW_ORACLE_ID = "<configured id>"
$env:TL_SHADOW_ORACLE_POLICY = "<covenant oracle policy>"
$env:TL_SHADOW_RISK_CHECKPOINT = "C:\path\to\risk-checkpoint.json"
npm run observe:covenant-shadow
```

The command prints the compact feed and evidence hashes, not raw responses.
It persists the raw capture under `.runtime/strategy-covenant/shadow-captures`.
No credential is accepted in the endpoint URL or public schema.

## Verification

```powershell
npm run test:covenant
npm run eval:covenant
npm run export:bonsai-data
```

The focused suite covers fixed endpoint selection, correct materialization,
candidate-only integration, wrong network, idle/lagging/racing listeners,
stale evidence, risk/balance conflicts, malformed or crossed books, oracle
conflicts, secret fields, evidence tampering, and interrupted-session resume.

## Remaining blockers

- No authenticated, channel-specific risk-checkpoint issuer exists.
- The listener balance endpoint is address-wide. Channel isolation is asserted
  by the external checkpoint, not independently proven by this adapter.
- No independent second market/oracle provider is compared.
- No channel signer, capability lease, counterparty, fill observer, or
  settlement verifier is connected.
- The live command requires an already synchronized local listener and public
  allocated-RPC provider; this workspace does not fabricate those services.
