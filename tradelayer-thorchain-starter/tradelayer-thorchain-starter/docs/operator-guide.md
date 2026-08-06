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

For the shortest fail-closed operator check, run:

```powershell
npm run preflight:launch
```

This runs the launch suite and focused agent evaluation, checks the 20-trajectory
and 50-agent-case floors, requires an empty generated failure-trace file, and
witnesses the exact local TradeLayer commit and consensus-source hash against
the tracked tx11 candidate release. Source verification does not prove
deployment: the receipt keeps `tx11DeploymentVerified` and `tx11Executable`
false until independent live-listener evidence exists. The command
writes a machine-readable receipt to
`.runtime/launch-preflight/latest.json`. A passing receipt means only that the
scripted candidate-only demo is ready. Its `fundedExecutionAllowed` field is
always `false`; the command never requests wallet approval, signs, finalizes,
or broadcasts a transaction.

The individual checks remain available for diagnosis:

```powershell
npm run demo:near
npm run test:near
npm run test:launch
npm run eval:launch
npm run verify:tradelayer-release
npm run demo:launch
```

On a development machine where the primary `tradelayer.js` checkout contains
tracked edits, run the candidate-8 gate instead of weakening the source check:

```powershell
npm run test:launch:candidate8
```

The command enumerates Git worktrees and accepts only a tracked-clean source at
an allowlisted full commit whose ordered consensus files produce the exact
manifest hash. It writes
`.runtime/testnet-agent/tx11-launch-source.json`, sets
`TRADELAYER_JS_REPO` only for the child launch suite, and never changes the
primary checkout. A passing source receipt still states
`candidate_not_deployed`, `deploymentVerified=false`, and `executable=false`;
it is not wallet or transaction authority.

After two separately configured testnet4 listeners are running, bind their
live synchronization and registry evidence to the prepared reserve plan:

```powershell
$env:TRADELAYER_PREFLIGHT_ENDPOINTS="http://127.0.0.1:3101;http://127.0.0.1:3102"
npm run observe:listener-preflight
```

Each listener must expose the read-only, challenge-bound launch attestation and
be configured with unique `TL_LISTENER_NODE_ID` and
`TL_LISTENER_INSTANCE_ID` values plus the exact full `TL_RELEASE_COMMIT`.
Passing this check does not request approval, sign, or broadcast.

Expected results:

- 96/96 launch tests and 24/24 end-to-end trajectories pass.
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
$env:BITAGENT_RESERVE_OPERATOR_XONLY="<32-byte public x-only key hex>"
$env:BITAGENT_RESERVE_GUARDIAN_XONLY="<independent 32-byte public x-only key hex>"
$env:BITAGENT_RESERVE_RECOVERY_XONLY="<optional 32-byte public x-only key hex>"
$env:BITAGENT_RESERVE_RECOVERY_CSV_DELAY="2016"
$env:BITAGENT_RESERVE_PROPERTY_ID="<reviewed tlBTC receipt property id>"
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
deposit-address, exact unsigned withdrawal candidates, durable approval
polling, and a wallet-owned testnet4 execution provider. Execution remains
disabled by default and returns HTTP 423 unless an operator explicitly enables
a reviewed release. Configure the wallet process before it starts:

```powershell
$env:BITAGENT_WALLET_BROKER_TOKEN="<opaque local operator token>"
$env:BITAGENT_WALLET_AUTHORITY_STATE_PATH="<durable authority JSON path>"
$env:BITAGENT_WALLET_BITCOIN_CLI="<full path to bitcoin-cli>"
$env:BITAGENT_WALLET_BITCOIN_DATADIR="<Bitcoin testnet4 data directory>"
$env:BITAGENT_WALLET_BITCOIN_RPC_CONNECT="127.0.0.1"
$env:BITAGENT_WALLET_BITCOIN_RPC_PORT="<testnet4 RPC port>"
$env:BITAGENT_WALLET_BITCOIN_WALLET="utxoref-testnet"
$env:BITAGENT_WALLET_TESTNET_STRATEGY_FEE_SATS="<reviewed candidate fee>"
$env:BITAGENT_WALLET_TESTNET_MAX_RESERVE_FEE_SATS="3000"
$env:BITAGENT_WALLET_TESTNET_MAX_WITHDRAWAL_FEE_SATS="3000"
$env:BITAGENT_WALLET_TESTNET_FEE_RATE_SAT_VB="2"
$env:BITAGENT_WALLET_CANDIDATE_TTL_MS="120000"
```

Only for a separately reviewed testnet4 release, after explicit operator
authorization, enable withdrawal execution with its own release digest:

```powershell
$env:BITAGENT_WALLET_TESTNET_EXECUTION_ENABLED="true"
$env:BITAGENT_WALLET_TESTNET_EXECUTION_RELEASE_ID="<reviewed 64-hex release digest>"
```

Reserve intake has a separate release gate and digest. Enable it only after the
exact tx11 release is deployed and fresh independent preflight passes every
gate:

```powershell
$env:BITAGENT_WALLET_TESTNET_RESERVE_EXECUTION_ENABLED="true"
$env:BITAGENT_WALLET_TESTNET_RESERVE_EXECUTION_RELEASE_ID="<reviewed 64-hex reserve release digest>"
```

The execution provider refuses any network other than testnet4. It consumes
the exact approval grant before signing, re-decodes and compares the finalized
transaction, requires `testmempoolaccept`, and returns only a public txid and
hash-bound receipt. A submission RPC error is treated as an ambiguous outcome:
the input remains reserved and an operator must reconcile it before retrying.
The BitVM page shows these records under **Wallet execution and recovery**.
Choose **Check exact transaction** to perform read-only, positive-proof
reconciliation. If the wallet cannot observe the exact transaction, the state
remains locked; do not retry or manually unlock the selected input.

Point BitAgent at `http://127.0.0.1:1986` with the same process-secret bearer
token. Open the wallet's BitVM page to refresh the public Bitcoin session and
review pending exact effects. Rejecting is always available. A starter
strategy with unverified funding first creates a separate exact reserve
candidate. It cannot be approved until reserve preflight and the deployed tx11
release pass. Rejection releases its selected input; a preflight outage
preserves the candidate and lock for recovery. Reserve signing and broadcast
remain disabled unless the separate reserve release gate is enabled; enabling
withdrawal alone has no effect. The wallet re-fetches fresh plan-specific
preflight immediately before reserve signing, then consumes the one-time grant
before calling Bitcoin Core. With either execution action left at its default,
approval records only a scoped grant. Never put the bearer token in the
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
