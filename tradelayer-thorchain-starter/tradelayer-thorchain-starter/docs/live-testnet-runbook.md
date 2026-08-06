# Live Testnet Agent Runbook

## Authority Boundary

The agent process may construct TradeLayer tx5 payloads, market proposals, infrastructure intents, and broker requests. It cannot select wallet inputs, sign, or broadcast.

The Bitcoin Core broker is a separate process. It accepts only Bitcoin testnet4 requests whose request hash, policy fingerprint, expiry, sender address, payloads, and aggregate fee cap validate. Every PSBT input and change output must use the approved TradeLayer sender address. Signing additionally requires the exact approval hash emitted during preparation.

Confirmed TradeLayer transactions are not PnL evidence. Revenue becomes settled only when:

1. Both tx5 legs are confirmed at the configured depth.
2. Their observed OP_RETURN bytes match the approved payloads.
3. `tradelayer.js/src/txDecoder.js` decodes reciprocal property and amount fields.
4. A TradeLayer before/after balance receipt proves a positive address-level PnL delta and references every broadcast txid.

## Prerequisites

- Synchronized Bitcoin Core with testnet4 enabled.
- Loaded wallet named by `BTCTEST_WALLET`.
- At least six confirmed UTXOs owned by the TradeLayer sender address, sufficient for the six tx5 transactions and fees.
- TradeLayer testnet state with tx5 active and the sender funded with the required tlBTC/tlUSD inventory.
- Running TradeLayer wallet listener exposing `tl_getAllBalancesForAddress`.

No private key, WIF, mnemonic, or seed belongs in this repository or its `.env` file.

## 1. Prepare The Agent Request

```powershell
npm run demo:live-testnet-agent
```

Inspect:

- `.runtime/testnet-agent/live-latest/summary.json`
- `.runtime/testnet-agent/live-latest/broker-request.json`
- The printed `policyFingerprint`
- Sender address, six payloads, expiry, and `maxTotalFeeSats`

The request expires after 15 minutes. Generate a new request if preparation cannot complete within that window.

## 2. Capture The Pre-Trade Balance

```powershell
$env:TRADELAYER_AGENT_ADDRESS="<approved sender address>"
$env:TRADELAYER_API_URL="http://127.0.0.1:3000"
npm run observe:pnl -- --action=snapshot --output=.runtime/testnet-agent/balance-before.json
```

## 3. Prepare Funded PSBTs

```powershell
$env:TESTNET_BROKER_POLICY_FINGERPRINT="<policyFingerprint>"
$env:BITCOIN_BIN="<directory containing bitcoin-cli>"
$env:BTCTEST_DATADIR="<Bitcoin testnet data directory>"
$env:BTCTEST_WALLET="utxoref-testnet"
$env:BTCTEST_RPC_CONNECT="127.0.0.1"
$env:BTCTEST_RPC_PORT="<configured testnet4 RPC port, if non-default>"
npm run broker:testnet -- --action=prepare --input=.runtime/testnet-agent/live-latest/broker-request.json --output=.runtime/testnet-agent/prepared-batch.json
```

The launch kernel can reuse that node as a read-only withdrawal verifier when
running with an authenticated wallet broker:

```powershell
$env:BITAGENT_BITCOIN_WITHDRAWAL_VERIFY="true"
$env:BITAGENT_WITHDRAWAL_CONFIRMATIONS="1"
```

These flags do not enable preparation, signing, or broadcast. They only allow
the kernel to verify the exact approved withdrawal txid, destination output,
network fee, wallet debit, and confirmation depth before updating its balance.

Inspect `prepared-batch.json`, especially input addresses, change addresses, each fee, total fee, payloads, and `approvalHash`.

If approval is rejected or the session is abandoned, release only that batch's
reserved inputs with the same broker configuration and policy fingerprint:

```powershell
npm run broker:testnet -- --action=cancel --input=.runtime/testnet-agent/prepared-batch.json --output=.runtime/testnet-agent/cancellation-receipt.json
```

Cancellation validates the request and prepared-batch fingerprints, remains
available after request expiry, never signs or broadcasts, and verifies the
exact inputs are no longer locked.

For the smallest single-transaction local preflight, use the same environment
with:

```powershell
npm run prepare:local-testnet-tx
```

This chooses one confirmed safe wallet UTXO deterministically, constructs one
TradeLayer tx5 OP_RETURN through the sibling planner, maps the funding outpoint
through UTXORef v2, and stops with
`.runtime/testnet-agent/local-testnet4/simulation.json` in
`awaiting_wallet_approval`. It never signs or broadcasts.

If the user rejects approval, the request expires, or the local process is
interrupted after preparation, run:

```powershell
npm run release:local-testnet-tx
```

The command accepts only the local single-step testnet4 batch whose wallet,
policy fingerprint, approval hash, and input list match the persisted unsigned
simulation. It calls `lockunspent true` for those exact outpoints, verifies none
remain in `listlockunspent`, and writes
`.runtime/testnet-agent/local-testnet4/cancellation-receipt.json`. It is safe to
repeat and remains available after the approval request expires. A successful
receipt must say `inputLockReleased: true`, `signingPerformed: false`, and
`broadcastPerformed: false`.

## 4. Sign And Broadcast

Only after inspecting the prepared batch:

```powershell
$env:TL_TESTNET_SUBMIT="true"
$env:TESTNET_BROKER_APPROVAL_HASH="<approvalHash>"
npm run broker:testnet -- --action=broadcast --input=.runtime/testnet-agent/prepared-batch.json --output=.runtime/testnet-agent/broadcast-receipt.json
```

The receipt contains txids, fees, payload bindings, and a receipt hash. It contains no key material.

## 5. Observe TradeLayer Balances

First verify that the synchronized TradeLayer listener exposes the exact valid
tx5 as either a full-txid open order or an address trade-history fill:

```powershell
npm run observe:order -- --endpoint=http://127.0.0.1:3000 --txid=<broadcast-txid> --address=<approved-sender> --offered-property=1 --desired-property=2 --amount-offered=<exact-decimal> --amount-expected=<exact-decimal> --output=.runtime/testnet-agent/order-observation.json
```

The command queries `tl_getsyncstatus`, `tl_gettransaction`,
`tl_getorderbook`, and `tl_tokentradehistoryforaddress` through the local
relayer. It exits nonzero for pending or failed observations. A shortened
order ID is never accepted as proof; current TradeLayer orderbook entries keep
their legacy display ID and also expose `fullTxid` for this verifier.

After exact order/fill verification, capture the post-trade balance:

```powershell
npm run observe:pnl -- --action=snapshot --output=.runtime/testnet-agent/balance-after.json
npm run observe:pnl -- --action=evidence --before=.runtime/testnet-agent/balance-before.json --after=.runtime/testnet-agent/balance-after.json --receipt=.runtime/testnet-agent/broadcast-receipt.json --price=65000 --price-source=independent-oracle-receipt-id --output=.runtime/testnet-agent/pnl-evidence.json
```

The valuation price must come from an independently accepted market/oracle
observation and `--price-source` must identify that observation. The starter
does not infer it from the agent's own orders. The observer uses exact decimal
arithmetic, verifies both balance-snapshot hashes and the broker receipt hash,
requires the after-snapshot to be newer than the before-snapshot, and binds the
evidence to unique canonical txids. A changed snapshot, receipt, address,
source, timestamp order, fee, valuation, or transaction list fails closed.

## 6. Reconcile

```powershell
$env:BROKER_REQUEST_PATH=".runtime/testnet-agent/live-latest/broker-request.json"
$env:BROKER_RECEIPT_PATH=".runtime/testnet-agent/broadcast-receipt.json"
$env:TRADELAYER_PNL_EVIDENCE_PATH=".runtime/testnet-agent/pnl-evidence.json"
npm run demo:live-testnet-agent
```

The acceptance object in `live-latest/summary.json` must be entirely true. Any missing transaction, payload mismatch, insufficient confirmation, reorg, invalid PnL receipt, fee-cap violation, expired request, or policy mismatch leaves PnL unrealized.

## Deterministic Failure Demo

```powershell
npm run demo:live-testnet-agent:simulated
npm run test:live
```

Simulation exercises matching and accounting without asserting that a wallet was funded or that transactions were signed.

## Candidate-only UTXORef reserve drill

This command derives public keys from the loaded wallet, prepares the combined
reserve-vout0/tx11-vout1/change-vout2 PSBT, validates exact effects, discards
the raw PSBT, and immediately releases its input lock:

```powershell
$env:BITCOIN_BIN="<directory containing bitcoin-cli>"
$env:BTCTEST_DATADIR="<Bitcoin testnet data directory>"
$env:BTCTEST_RPC_PORT="<local testnet4 RPC port>"
$env:BTCTEST_WALLET="<loaded funded wallet>"
$env:TESTNET_TLBTC_PROPERTY_ID="<candidate property id>"
npm run prepare:local-testnet-reserve
```

The summary is written to
`.runtime/testnet-agent/reserve-intake-candidate/summary.json`. A successful
drill must report `inputLockReleased=true`, `signingPerformed=false`, and
`broadcastPerformed=false`. This does not prove tx11 activation, registry
identity, independent guardian availability, or data-carrier relay policy.

Run the read-only TradeLayer registry gate after candidate construction:

```powershell
$env:TRADELAYER_PREFLIGHT_DB_PATHS="<node-a-db-path>;<node-b-db-path>"
$env:TRADELAYER_PREFLIGHT_NODE_IDS="listener-a;listener-b"
$env:TRADELAYER_PREFLIGHT_BLOCK_HEIGHTS="<height-a>;<height-b>"
$env:TRADELAYER_ACCEPTED_TX11_CODE_HASHES="<audited-32-byte-release-hash>"
npm run observe:reserve-preflight
```

The command reads only `activations.db`, `propertyList.db`, and
`procedural.db`. A launchable result requires `status=verified` and every gate
true. Do not duplicate one database under two node IDs: duplicate or divergent
node identities fail the parity requirement. File freshness is a local-snapshot
check; production must additionally authenticate each node and independently
observe its synchronization height.

Never populate `TRADELAYER_ACCEPTED_TX11_CODE_HASHES` from whatever value a
node happens to report. It is an operator release allowlist and must be fixed
from the audited deployment artifact before observing node results.

## Akash Broker Isolation

The current `@akashnetwork/chain-sdk@1.0.0-alpha.0` package requires Node 22.14. It is isolated under `brokers/akash` and is not installed in the root agent runtime. Install and audit it in a disposable Node 22 broker environment before running `validate-sdl.mjs`. The broker should use scoped AuthZ or fee grants and return lifecycle receipts; it must not expose its mnemonic to the agent.
