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

For the launch gate, configure each TradeLayer process with a durable public
identity and the exact deployed release commit before starting it:

```powershell
$env:CHAIN="BTCTEST"
$env:TL_LISTENER_NODE_ID="listener-a"
$env:TL_LISTENER_INSTANCE_ID="<durable-unique-instance-id>"
$env:TL_RELEASE_COMMIT="<full-40-character-deployed-commit>"
```

For a parallel candidate upgrade that preserves the currently running listener
pair, use `npm run deploy:tradelayer-listeners` with
`BITAGENT_TRADELAYER_LISTENER_DEPLOYMENT_JSON`. The operator-only script accepts
exactly two targets, verifies a tracked-clean release source, copies immutable
listener snapshots into new non-overlapping state roots, starts hidden listener
processes on new loopback ports, and records only the new owned PIDs. It rejects
existing target state, occupied ports, implicit `.env` loading, duplicate
identity/backend fields, and source/hash drift. It never reads a wallet,
requests approval, signs, or broadcasts. A `candidate_pair_started_unverified`
receipt is deployment evidence only; rerun the challenge-bound listener
preflight against the new ports before changing any release status.

After each HTTP process is reachable, the deployer sends an empty JSON body to
`POST /tl_initmain` and requires `tl_getSyncStatus` to report
`initialized=true`, a non-idle phase, and a positive `trackHeight`. A timed-out
initialization request may continue inside the listener, but startup does not
succeed unless the subsequent bounded status check proves initialization. No
wallet address, PSBT, approval, signature, or transaction body is sent.

If every existing listener state is on the wrong fork, build one clean state
from genesis with `npm run replay:tradelayer-listener`. The replay command is
candidate-only and accepts exactly one tracked-clean source, one fresh state
root, and one loopback Bitcoin backend. The backend must be testnet4,
unpruned, fully synchronized, and already paused with zero peers. The command
checks that invariant every minute, records its owned PID atomically, and
stops the listener on a typed error or timeout. It never calls a wallet,
requests approval, signs, or broadcasts.

```powershell
$env:BITAGENT_TRADELAYER_LISTENER_REPLAY_JSON = @{
  schema="bitagent_tradelayer_listener_replay_config_v1"
  runtimeRoot="D:\bitagent-testnet4"
  sourceRepo="D:\bitagent-testnet4\tradelayer-candidate"
  sourceCommit="<full-40-character-candidate-commit>"
  rpcPort=49392
  rpcCookieFile="D:\bitagent-testnet4\node-full\testnet4\.cookie"
  listenerPort=3163
  nodeId="listener-full-replay"
  instanceId="candidate-full-replay-YYYYMMDD"
  nedbRoot="D:\bitagent-testnet4\candidate-full-replay-state"
  logDir="D:\bitagent-testnet4\candidate-full-replay-logs"
  startupTimeoutMs=30000
  replayTimeoutMs=7200000
} | ConvertTo-Json -Compress
npm run replay:tradelayer-listener
```

Success is only `replay_complete_unpromoted` at exact Bitcoin/listener parity.
The listener remains running solely so the operator can create stable snapshots.
Promotion still requires two isolated listener/backend deployments, live
challenge-bound preflight, and release-manifest review.

To replace a listener whose backend pruned ahead of its checkpoint, first
bring one healthy listener to an exact paused backend height above the failed
backend's `pruneheight`. Seal two non-overlapping immutable copies with
`npm run snapshot:tradelayer-listener` and an exact
`BITAGENT_TRADELAYER_SNAPSHOT_JSON` object. The command requires testnet4,
`phase=realtime`, no listener error, zero peers, `networkactive=false`, exact
Bitcoin/listener height parity, and a safe prune horizon. It hashes the source
and copy, refuses an existing target, and writes a no-wallet-effect receipt.
Before copying, it uses the loopback-only `POST /tl_pause` control, waits 12
seconds for the listener's ten-second realtime loop to drain, and requires
three identical source inventories. It resumes only a pause that it initiated,
then verifies `phase=realtime` and exact unchanged Bitcoin/listener heights.
The receipt is sealed only when the stable source and copied inventories are
identical and resume verification succeeds. Deploy the replacement pair only
from sealed copies; never edit `trackHeight` or skip the missing range.

Use different node IDs, instance IDs, ports, Bitcoin Core backends, and data
directories for the second listener. Then run the challenge-bound live check:

Historical replay on a pruned Bitcoin Core node does not require `txindex=1`.
The listener passes the containing block hash to `getrawtransaction` and writes
a partial `MaxHeight` checkpoint every 100 processed blocks. During replay,
`indexExists` must remain absent and `tl_getSyncStatus` must report
`phase=indexing`; after an interruption, the startup log must show the saved
`max Indexed Block` instead of returning to the configured genesis boundary.
Do not reuse a database from a pre-checkpoint build for launch evidence.

For a reviewed Bitcoin Core backend that supports numeric `getblock`
verbosity, set `TL_DECODE_BLOCK_TRANSACTIONS=1` before listener startup. This
uses one decoded block response instead of separate raw/decode RPC calls for
every transaction. Leave it unset for legacy backends; the block-scoped raw
lookup remains supported.

```powershell
$env:TRADELAYER_PREFLIGHT_ENDPOINTS="http://127.0.0.1:3101;http://127.0.0.1:3102"
$env:TRADELAYER_PREFLIGHT_BITCOIN_RPCS_JSON = @(
  @{ listenerEndpoint="http://127.0.0.1:3101"; rpcUrl="http://127.0.0.1:49372"; cookieFile="D:\bitcoin-a\testnet4\.cookie" }
  @{ listenerEndpoint="http://127.0.0.1:3102"; rpcUrl="http://127.0.0.1:49382"; cookieFile="D:\bitcoin-b\testnet4\.cookie" }
) | ConvertTo-Json -Compress
npm run observe:listener-preflight
```

The command calls `POST /tl_getLaunchAttestation`, then independently calls
`getblockchaininfo`, `getblockhash`, `getblockheader`, and block-scoped
`getrawtransaction` on the Bitcoin Core backend bound to each listener. RPC
cookies are read locally for each call and never enter the receipt. A launchable result requires
`status=verified` and every gate true: unique listener and Bitcoin RPC
endpoints; node IDs, instance IDs, and challenges; fresh realtime
synchronization; bounded block lag; an allowlisted release commit and tx11
code hash; one canonical tx0 OP_RETURN that activates tx11 at the listener's
exact txid/block; and exact property, template, contract, and reserve-address
parity. The v2 receipt is hash-bound and declares `read_only_observer` /
`effect=none`. Legacy v1 listener evidence cannot satisfy `tx11ChainDerived`.

`synchronizedTestnet4` also requires the Bitcoin backend itself to report
`chain=testnet4`, `initialblockdownload=false`, equal block and header heights,
verification progress of at least 0.999999, active networking, at least one
peer, the same tip used by the TradeLayer status, and identical best-block
hashes across listeners. A locally caught-up index over a paused, stale,
fork-divergent, or still-IBD node is not launch evidence.

During realtime operation, compare the Bitcoin tip with `trackHeight`.
`indexedHeight` is the completed historical replay boundary and need not move
on every new block; `processedHeight` may trail when blocks contain no
TradeLayer transaction. Both must remain at or below durable `trackHeight`,
and `trackHeight` must be within the configured lag of the Bitcoin tip.

For small prune targets, throttle initial block download in reviewed chunks:
pause Bitcoin peer networking before the retained block window reaches the
listener, let TradeLayer consume the already-downloaded range, then resume the
next chunk. Peerless local catch-up is operational recovery only and cannot
pass `synchronizedTestnet4`. If Bitcoin Core already reports a `pruneheight`
above `trackHeight + 1`, that backend cannot supply the missing history; use a
fresh/sufficiently retained backend instead of skipping blocks.

After each fresh backend has downloaded beyond the persisted listener
checkpoint, use the lag-driven throttle instead of fixed-height watchdogs. The
controller accepts only unauthenticated loopback URLs, reads Bitcoin RPC
cookies locally, changes only Bitcoin peer-networking state, and pauses every
backend on error or completion:

```powershell
$env:BITAGENT_TESTNET4_SYNC_PAIRS_JSON='[{"name":"a","listenerUrl":"http://127.0.0.1:3101","rpcUrl":"http://127.0.0.1:49372","cookieFile":"D:\\bitagent-testnet4\\node-e-prune2048\\testnet4\\.cookie"},{"name":"b","listenerUrl":"http://127.0.0.1:3102","rpcUrl":"http://127.0.0.1:49382","cookieFile":"D:\\bitagent-testnet4\\node-f-prune2048\\testnet4\\.cookie"}]'
# Optional: use outbound peer metadata from an independent synchronized,
# wallet-opaque loopback Bitcoin node before falling back to target addrman.
$env:BITAGENT_TESTNET4_SYNC_PEER_SOURCES_JSON='[{"name":"a","rpcUrl":"http://127.0.0.1:48332","cookieFile":"D:\\BitcoinTestnet\\testnet4\\.cookie"}]'
$env:BITAGENT_SYNC_LOW_WATERMARK="25"
$env:BITAGENT_SYNC_HIGH_WATERMARK="100"
$env:BITAGENT_SYNC_STOP_HEIGHT="65000"
$env:BITAGENT_SYNC_MIN_FREE_BYTES="786432000"
$env:BITAGENT_SYNC_REQUEST_TIMEOUT_MS="45000"
$env:BITAGENT_SYNC_PEER_STALL_MS="120000"
node .\node_modules\tsx\dist\cli.mjs scripts\throttle-testnet4-sync.ts
```

The controller fails closed if a listener reports an error, a persisted
checkpoint is ahead of its Bitcoin backend, or `pruneheight` advances beyond
`trackHeight + 1`. It also reads free space on the filesystem containing each
target RPC cookie and fails peer-off below the configured byte floor (750 MiB
by default). It also fails if peer delivery overshoots the configured
stop height; `bitcoinHeight >= stopHeight` is not accepted as exact parity. A
bounded success leaves peer networking disabled so the operator can inspect
both listeners before selecting the next target.

For a long supervised run, set `BITAGENT_SYNC_QUIET=1` and launch the
controller directly. This suppresses per-poll stdout while preserving the
atomic status receipt and terminal message. Do not pipe the controller through
another process: an interrupt delivered only to that wrapper can prevent the
controller from running its peer-pause cleanup. After any abnormal supervisor
exit, independently call `getnetworkinfo` and require `networkactive=false`
with zero connections before restarting.
On the current 2 GiB-pruned recovery nodes, a 750-block corridor allowed an
automatic prune jump to overtake a listener. The replacement pair completed a
real prune transition with a 100-block high watermark. Treat 100 as the
reviewed ceiling for these specific nodes unless new retained-tail evidence
justifies a different value.
Run recovery nodes with `maxconnections=1` so an already-requested block
pipeline cannot greatly overshoot the lag watermark. On each resume, the
controller selects at most one one-shot peer. If a matching optional peer
source is configured, it reads only `getblockchaininfo`, `getnetworkinfo`, and
`getpeerinfo` from that synchronized testnet4 node and reuses one sanitized
outbound IPv4/IPv6 peer. It never calls a source wallet RPC or records the peer
endpoint. If the source is unavailable, in IBD, on another chain, or has no
suitable peer, the controller falls back to the target Bitcoin Core address
manager; no public peer is hardcoded. Source URLs must be credential-free
loopback HTTP endpoints and source names must match selected pair names. The
status receipt records only source/addrman attempt counts and the source mode.
If Bitcoin Core briefly reports more than one connection, the controller keeps
the best synchronized outbound peer and disconnects the remaining peer IDs;
only the aggregate `peerTrimAttempts` count is persisted.
Its latest atomic status receipt is
`.runtime/testnet-agent/sync-throttle-status.json`. For interruption recovery,
do not rely on Ctrl+C through `npm run`: an npm parent can exit before the child
finishes asynchronous cleanup. Prefer the direct Node command above (or a
service supervisor with an explicit stop hook), then verify every backend has
`networkactive=false` and zero connections. If the controller or host was
terminated, explicitly call `setnetworkactive false` on each reviewed backend
before restarting or inspecting the listeners. A hard kill cannot itself
provide an automatic peer-pause guarantee.

Current receipts include `status=running|completed|failed`. Terminal receipts
also record `endedAt`, the final observations, and a per-backend
`networkPauseResults` outcome. Still perform the independent Bitcoin RPC check;
the terminal receipt proves the attempted RPC result, not future process state.

When a connected recovery peer delivers no Bitcoin height progress for
`BITAGENT_SYNC_PEER_STALL_MS`, the controller inspects `getpeerinfo` only while
the listener lag is below the low watermark. It disconnects only peers whose
reported synchronized header or block height is behind the local checkpoint,
excludes those exact addresses from the immediate addrman retry, and records
`peerDisconnectAttempts`. It never disconnects a synchronized peer merely
because throughput is low. The stall interval must be 30-600 seconds; use the
120-second default outside a focused recovery drill.

For the final approach to a reviewed height, stop the throttle with enough
headroom for its observed peer pipeline, explicitly disable target peer
networking, and wait for exact listener parity. Then use the wallet-free exact
height relay rather than hoping a P2P burst lands on the requested block:

```powershell
$env:BITAGENT_TESTNET4_EXACT_HEIGHT_RELAY_JSON = @{
  schema="bitagent_testnet4_exact_height_relay_config_v1"
  runtimeRoot="D:\"
  sourceRpcUrl="http://127.0.0.1:48332"
  sourceCookieFile="D:\BitcoinTestnet\testnet4\.cookie"
  targetRpcUrl="http://127.0.0.1:49392"
  targetCookieFile="D:\bitagent-testnet4\node-g-full-candidate12\testnet4\.cookie"
  targetHeight=147389
  maxBlocks=1024
} | ConvertTo-Json -Compress
npm run relay:testnet4:exact-height
```

The source must be a fully synchronized independent testnet4 node and already
contain the target height. The target must be peer-off, on the source active
chain, not past the target, and within the configured suffix bound. Every raw
block is validated by target Bitcoin Core, followed by an exact height/hash
check. The source's hash at the reviewed height must remain unchanged through
the run. The receipt contains no raw blocks, RPC cookies, wallet calls,
signatures, transaction broadcast, or financial authority. After relay,
restart only the listener catch-up path and require exact error-free parity
before snapshotting.

If two paused, independent testnet4 nodes finish a bounded recovery only a few
blocks apart, do not repeatedly enable peers to chase an exact tip. Use
`npm run align:testnet4-tip` with an exact
`BITAGENT_TESTNET4_TIP_ALIGNMENT_JSON` object. The operator tool requires two
unique loopback RPC endpoints and cookie files, both peer networks disabled
with zero connections, the target tip on the source node's active chain, and a
suffix of at most the configured `maxBlocks` (hard limit 128). It obtains each
public raw block from the source and calls `submitblock` on the target; the
target Bitcoin Core independently validates the suffix. Success requires exact
height and best-block-hash parity while both networks remain paused. The
receipt records block hashes but never RPC cookies, wallet data, signatures, or
transaction authority. Repeating the command on an already aligned pair is a
verified no-op.

This proves two distinct live endpoints with distinct operator-declared
instances. It is not a TEE, remote-code-attestation, or Byzantine-independence
proof; operators must still ensure the endpoints do not proxy the same process
or Bitcoin Core backend. `npm run observe:reserve-preflight` remains available
as an offline NeDB diagnostic, but it is not sufficient for launch promotion.

The live observer obtains both allowlists from the tracked release manifest,
never from listener responses. Review that manifest before deployment.

The tracked candidate manifest is
`config/tradelayer-tx11-release.json`. Its current hash is
`8f8e83ae0bac5b578087af7c2dd00c63d3ca87952be72e6e70c4a6acdfffd623`, pinned
to TradeLayer commit `b3423bf7f72a4e8bfad3fbc61f757505553b9d4c`, but
the manifest status is `candidate_not_deployed`. Do not place that hash in the
runtime allowlist until the exact source bundle has been deployed and tx11 has
been activated with it on the independent listeners being observed.

Before deployment, verify that the local candidate has not drifted:

```powershell
npm run verify:tradelayer-release
```

This check is read-only. It binds the ordered consensus-source list, recomputed
source hash, and current full TradeLayer commit to the manifest, but it always
reports the undeployed candidate as non-executable.

Candidate listeners launched from a clean worktree resolve dependencies only
from that selected worktree or the primary TradeLayer checkout's installed
`node_modules`. The launcher does not inherit arbitrary `NODE_PATH` entries and
does not download packages during deployment.

While `npm run launch` is running, the wallet may read the sanitized operator
view at `GET /api/operator/reserve-intake`. The response contains only public
candidate effects and hashes, preflight gates, and release metadata. It
deliberately strips raw PSBTs and signing material and always reports
`approvalAvailable=false`; it is not an execution endpoint.

## Akash Broker Isolation

The current `@akashnetwork/chain-sdk@1.0.0-alpha.0` package requires Node 22.14. It is isolated under `brokers/akash` and is not installed in the root agent runtime. Install and audit it in a disposable Node 22 broker environment before running `validate-sdl.mjs`. The broker should use scoped AuthZ or fee grants and return lifecycle receipts; it must not expose its mnemonic to the agent.
