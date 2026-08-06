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

Keep the scripted broker and demo D1 site visibly labeled and isolated from any
funded wallet until every remaining item in `docs/launch-readiness.md` is
closed.
