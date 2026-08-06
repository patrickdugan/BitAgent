# BitAgent Operator Guide

## Run the scripted launch journey

Requirements: Node.js 20 or newer, npm, and the sibling `UTXO-Ref` and
`tradelayer.js` checkouts listed in `docs/repo-map.md`.

From this repository:

```powershell
npm install
npm run launch
```

Open `http://127.0.0.1:8790/`.

An owner-only hosted copy is deployed at
`https://bitagent-launch-kernel.duganist875063.chatgpt.site`. It is the same
scripted, non-broadcasting demo and requires the configured Sites identity.

For a referral entry directly into the strategy conversation, open:

```text
http://127.0.0.1:8790/?ref=demo-referrer&campaign=launch&workflow=starter_strategy&strategy=starter-v1
```

Referral fields are:

- `ref`: referrer identifier.
- `campaign`: campaign identifier.
- `workflow`: `deposit_bitcoin`, `starter_strategy`, or `withdraw_bitcoin`.
- `strategy`: optional and accepted only for `starter_strategy`.

## Complete the journey

1. Choose **Create demo wallet** or **Connect demo wallet**. BitAgent receives
   only the public testnet session and address.
2. Choose **Generate deposit address**.
3. In this scripted launch environment, choose **Record confirmed demo UTXO**.
   The real integration must replace this control with Bitcoin chain
   observation.
4. Enter: `Use 100000 sats in the starter TradeLayer strategy.`
5. Inspect the exact tlBTC/tlUSD effects, TradeLayer payload, network fee,
   remaining balance, quote, expiry, and simulation hash.
6. Request wallet approval, then approve or reject in the demo wallet prompt.
7. Execute only after approval, then choose **Verify result**.
8. Enter:
   `Withdraw 50000 sats to tb1qaq2r94k56d0p3jfelkwf8e4ec3cf826fc32fx7.`
9. Inspect the destination, amount, fee, and remainder; approve, execute, and
   verify the withdrawal.

Refreshing at any stage restores the persisted workflow. If a signature is
rejected, the page displays that no transaction was executed; choose
**Request wallet approval again** from the saved simulation. Refreshing the
same referral URL resumes its bound workflow, while opening a referral with a
different referrer, campaign, workflow, or strategy starts a separate flow. If
a quote is stale, create a fresh simulation and review its changed values. If
an action was submitted, verify the recorded txid before considering any
replacement.

Never enter a seed phrase, mnemonic, private key, or WIF. BitAgent will refuse
those inputs.

## Verify the build

```powershell
npm run demo:near
npm run test:near
npm run test:launch
npm run eval:launch
npm run demo:launch
```

Expected results:

- 24/24 end-to-end trajectories pass.
- 50/50 focused agent cases pass.
- Every evaluation score is `1`.
- `eval/artifacts/failure-traces.jsonl` is empty on a clean run.
- Sanitized seed failures remain in
  `eval/fixtures/failure-traces.seed.jsonl`.

## Preview the NEAR Intents entry rail

The default `npm run demo:near` path is deterministic and writes resumable
state to `.runtime/near-intents-workflows.json`. Its `scripted://` deposit
address is deliberately non-routable.

For a current, non-funding live quote:

```powershell
$env:NEAR_INTENTS_MODE="live"
$env:SOURCE_CHAIN_NAME="base"
$env:SOURCE_ASSET_SYMBOL="USDC"
$env:DEST_BTC_ADDRESS="<wallet-controlled Bitcoin address>"
$env:NEAR_INTENTS_REFUND_ADDRESS="<wallet-controlled Base address>"
npm run quote:near
```

Pass `-- --executable` only after setting `NEAR_INTENTS_JWT`. Do not fund its
deposit address until an authenticated origin-wallet broker is installed;
`FailClosedOriginWalletBroker` deliberately blocks approval and execution.
Use `CROSS_CHAIN_RAIL=thorchain` only when intentionally exercising the legacy
adapter.

The hosted UI under `web/` requires Node.js 22.13 or newer:

```powershell
cd web
npm install
npm test
npm run lint
```

## Production enablement

Do not enable real funds merely by setting `BITAGENT_PRODUCTION=true`. That
mode intentionally disables the scripted execution broker and fails closed.

Production launch requires an authenticated wallet-owned broker that can:

- create/connect a public wallet session without returning secrets;
- derive wallet-owned deposit addresses;
- estimate fees and build unsigned PSBT/order requests;
- display and authorize the exact simulation hash in wallet UI;
- return a one-time opaque approval token;
- sign and broadcast entirely inside the wallet boundary;
- query Bitcoin confirmations and the TradeLayer order/position;
- make execution idempotent; and
- prove workflow ownership for every read and mutation.

BitAgent now includes the strict client side of that boundary. Configure the
wallet-owned endpoint and its operator secret together:

```powershell
$env:BITAGENT_WALLET_BROKER_URL="https://<wallet-owned-service>"
$env:BITAGENT_WALLET_BROKER_TOKEN="<opaque operator secret>"
$env:BITAGENT_WALLET_BROKER_TIMEOUT_MS="10000"
```

Loopback HTTP is accepted for local testnet integration; non-loopback endpoints
must use HTTPS. Never place the bearer token in a referral, workflow record,
browser setting, log, or model prompt. The wallet-side implementation must
follow `docs/wallet-broker-contract.md`. The legacy WIF/mnemonic wallet routes
are incompatible and remain prohibited.

Configure `TRADELAYER_RELAYER_URL` to the synchronized local relayer base URL
when composing that broker in production. The launch factory then installs the
read-only TradeLayer verifier around the wallet broker. This setting does not
enable signing: without an authenticated wallet broker, production mode still
uses `UnavailableWalletBroker` and fails before approval or execution.

For testnet4 withdrawal verification through the already loaded Bitcoin Core
wallet, configure the same broker RPC settings used by the testnet runbook:

```powershell
$env:BITAGENT_BITCOIN_WITHDRAWAL_VERIFY="true"
$env:BITAGENT_WITHDRAWAL_CONFIRMATIONS="1"
$env:BITCOIN_BIN="<directory containing bitcoin-cli>"
$env:BTCTEST_DATADIR="<Bitcoin testnet data directory>"
$env:BTCTEST_WALLET="utxoref-testnet"
$env:BTCTEST_RPC_CONNECT="127.0.0.1"
$env:BTCTEST_RPC_PORT="<configured testnet4 RPC port>"
```

This adds only a read-only verification source. It requires the exact decoded
destination output, wallet-reported network fee and net debit, and confirmation
depth before updating workflow balance. It does not enable wallet approval,
signing, or broadcast.

Production construction refuses a configured remote wallet broker unless both
the synchronized TradeLayer source and the Bitcoin withdrawal source are also
present. The wallet can submit; it cannot self-verify the result.

### Local testnet4 wallet-authority preview

The current `tradelayer-wallet` implementation supports public session,
deposit-address, fee-candidate, and durable exact-approval polling. Execution
is deliberately locked with HTTP 423. Configure the wallet process before it
starts:

```powershell
$env:BITAGENT_WALLET_BROKER_TOKEN="<opaque local operator token>"
$env:BITAGENT_WALLET_AUTHORITY_STATE_PATH="<durable authority JSON path>"
$env:BITAGENT_WALLET_BITCOIN_CLI="<full path to bitcoin-cli>"
$env:BITAGENT_WALLET_BITCOIN_DATADIR="<Bitcoin testnet4 data directory>"
$env:BITAGENT_WALLET_BITCOIN_RPC_CONNECT="127.0.0.1"
$env:BITAGENT_WALLET_BITCOIN_RPC_PORT="<testnet4 RPC port>"
$env:BITAGENT_WALLET_BITCOIN_WALLET="utxoref-testnet"
$env:BITAGENT_WALLET_TESTNET_STRATEGY_FEE_SATS="<reviewed candidate fee>"
$env:BITAGENT_WALLET_TESTNET_MAX_WITHDRAWAL_FEE_SATS="3000"
$env:BITAGENT_WALLET_TESTNET_FEE_RATE_SAT_VB="2"
$env:BITAGENT_WALLET_CANDIDATE_TTL_MS="120000"
```

Point BitAgent at `http://127.0.0.1:1986` with the same process-secret bearer
token. Open the wallet's BitVM page to refresh the public Bitcoin session and
review pending exact effects. Rejecting is always available. A starter
strategy cannot be approved until both reserve preflight and the deployed tx11
release pass; approving a withdrawal only records a scoped grant, because the
execution endpoint remains disabled. Never put the bearer token in the
browser, a referral link, model context, or the authority JSON.

The withdrawal fee is not an operator guess. The wallet prepares and decodes
an unsigned Bitcoin Core candidate, retains its raw PSBT privately, and shows
the exact selected input, destination, change, fee/rate, unsigned txid, and
commitment in the BitVM page. To run the funded prepare/decode/cancel check:

```powershell
npm run test:bitagent-withdrawal-candidate:live
```

This command requires the Bitcoin Core variables above. It never signs or
broadcasts and must finish with `inputLockReleased: true`.

Keep the scripted broker and demo D1 site visibly labeled and isolated from any
funded wallet until every remaining item in `docs/launch-readiness.md` is
closed.
