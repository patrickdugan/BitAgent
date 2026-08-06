# BitAgent Launch Readiness

Report date: 2026-07-23

Deployment:
`https://bitagent-launch-kernel.duganist875063.chatgpt.site`, owner-only,
version 3, source commit `e2ced291b2e4cf4457aebb5b907c9c0facca4d02`.

## Decision

**Scripted launch demo: ready. Production funds: not ready.**

The narrow referral-to-deposit-to-strategy-to-withdraw journey is complete and
observable in a deterministic testnet demo. Production execution remains
fail-closed, so no known issue in this build can broadcast or lose real funds.
The missing authenticated wallet broker and live verification providers are
release blockers for funded use.

## Passed checks

| Check | Result |
| --- | --- |
| End-to-end trajectories | 24/24 passed |
| Focused agent cases | 50/50 passed |
| Local launch test process | 27/27 tests passed |
| Hosted Worker/D1 tests | 2/2 passed |
| Intent, tool, argument, approval, truth, completion, recovery, and secret-safety scores | 1.00 each |
| Root TypeScript check | Passed |
| NEAR chain-abstraction focused cases | 8/8 passed |
| Official 1Click token discovery and live dry quote | Passed |
| Hardhat compile | Passed |
| Hardhat mock-contract test | 1/1 passed |
| Hosted vinext build | Passed |
| Hosted ESLint | Passed |
| Deployed page and generated social metadata | HTTP 200, passed |
| Deployed D1 strategy and withdrawal journey | Verified through durable resume |
| Recent production Worker errors after version 2 | None |
| Referral activation before verified strategy | Prevented |
| Execution without exact approval | Prevented |
| Stale simulation execution | Prevented |
| Secret-key requests or persistence | Prevented |
| Interrupted-session resume | Passed |
| Duplicate execution | Idempotent |
| Malformed withdrawal address | Rejected |

The end-to-end suite covers normal completion, cancellation, insufficient
funds, malformed addresses and txids, unconfirmed deposits, rejected wallet
approval, stale quotes, pending-verification retry, duplicate execution,
referral timing, prohibited secret material, unsupported scope, and recovery
after simulation, approval, and submission.

Machine-readable evidence:

- `eval/artifacts/agent-evaluation-latest.json`
- `eval/artifacts/failure-traces.jsonl`
- `eval/fixtures/failure-traces.seed.jsonl`

## Remaining release blockers

1. **Wallet authority and ownership.** There is no authenticated public-session
   API in the local wallet that issues and consumes an opaque approval token.
   The hosted demo workflow IDs are unowned demo identifiers, not production
   authorization.
2. **Live Bitcoin intake.** The launch UI uses a deterministic confirmed UTXO
   event. A production chain source must prove address ownership, outpoint,
   value, network, block height, confirmation count, and reorg handling.
3. **Live strategy quote/configuration.** The quote, property IDs, order
   minimums, and fee policy are scripted. They must come from live,
   operator-approved TradeLayer configuration.
4. **Safe wallet execution.** The local wallet and `tradelayer.js` precedents
   expose WIF/internal-signing paths that BitAgent must not call. A wallet-owned
   PSBT/order signer and broadcaster is required.
5. **Independent verification.** Production needs stable Bitcoin transaction,
   TradeLayer order/position, fill, balance, and withdrawal confirmation
   queries. Provider results, not the language model, must drive state.
6. **NEAR origin-wallet execution.** The live 1Click quote/status adapter is
   present, but a funded route still needs an authenticated wallet-owned EVM
   or NEAR broker plus a destination outpoint observer. Preview/stale quotes
   and unapproved execution already fail closed.
7. **Operational controls.** Production requires access control, rate limits,
   audit retention, provider health checks, network/market allowlists,
   observability, backup/restore drills, and incident recovery.

## Known limitations

- The strategy is always one post-only tlBTC-for-tlUSD type-5 order.
- The demo wallet and transaction evidence are scripted and labeled.
- The hosted UI accepts Bitcoin testnet addresses only.
- The local JSON store is suitable for one demo process, not multi-instance
  production.
- D1 and local state implement equivalent stages but do not yet share one
  generated schema package.
- DLC/VTXO is a typed follow-on seam only and is not a supported intent.
- ETH/USDC-to-native-BTC onboarding defaults to NEAR Intents. The hosted
  referral UI still demonstrates direct scripted Bitcoin intake and does not
  fund a live 1Click address.
- THORChain is a legacy opt-in adapter only.
- The installed `chainsig.js` runtime has broken strict declarations for
  unrelated chain modules, so it is isolated behind a local typed boundary.
- `npm audit --omit=dev` reports 16 production-tree advisories: 3 high,
  5 moderate, and 8 low, with no critical advisory. The high findings are
  transitive `axios`/`form-data`/`ws` paths pulled through the official SDK
  dependency trees. Funded release requires upgrading or isolating those
  transports after upstream fixes.

## Committed algorithmic signals (2026-07-26)

The new committed-signal lane is **ready for scripted Bitcoin testnet4
evaluation and not ready for funded execution**.

Passed:

- 26/26 focused end-to-end and adversarial signal cases;
- reproducible eight-dimension signal evaluation report with sanitized
  training traces;
- exact clean-Git or source-tree codebase pinning plus Ed25519 producer
  authentication;
- source mutation detection at execution time;
- strict signal schema, canonical signal hash, expiry, and strategy allowlist;
- confirmed UTXO selection through the real UTXO-Ref V2 funding-root builder;
- real TradeLayer tx5 payload encoding for post-only TLBTC/TLUSD buy/sell;
- wallet balance, exposure, drawdown, order, notional, and fee caps;
- exact wallet approval binding, cancellation/rejection recovery, idempotent
  execution, independent verification state, UTXO conflict prevention, and
  atomic interrupted-session resume;
- secret-bearing signal fields rejected and opaque approval tokens redacted.

Funded execution remains blocked on an authenticated wallet-owned
`SignalExecutionBroker` with live UTXO/TradeLayer truth, exact PSBT approval,
keyless signing/broadcast, and independent order/position verification. The
legacy algorithm folder is hashed as provenance only and is never executed by
BitAgent.

## Strategy Covenant update (2026-08-05)

Decision: **ready for scripted candidate-only and shadow evaluation; not ready
for delegated or funded execution**.

Passed:

- 66/66 focused and adversarial covenant/shadow cases;
- 159/159 tests across covenant, launch, committed-signal, NEAR/multichain,
  UTXO/TradeLayer smoke, sovereign, economic, and live-shadow suites;
- 28/28 sanitized covenant/shadow failure traces and a deterministic
  evaluator score of 1.0; no LLM judge was used;
- Bonsai/Hermes candidate-only seed corpus regenerated at 111 rows with no raw
  transcripts or detected secret values;
- exact covenant hash and wallet-approval binding;
- strategy weights totaling exactly 10,000 bps;
- committed adapter, market, portfolio, oracle, channel, fee, and expiry
  checks;
- deterministic capital, order-size, net-delta, loss, drawdown, and leverage
  projection;
- exact manifest plus candidate recomputation;
- effect-free, content-addressed replay receipt persistence;
- corrupt stored evidence is not overwritten;
- unsigned bridge into the existing committed-signal input schema;
- four-mode local p50/p95/p99 benchmark with direct mode explicitly
  ineligible and omitted signature/counterparty/settlement stages disclosed.
- offline `chainsig.js` Sepolia/Solana preparation no longer waits on NEAR RPC
  derivation retries; the focused 12-case suite passes in about 5.8 seconds.

The candidate lane does not alter the earlier production decision. It has no
live market source, funded channel, production covenant approval, channel
signer, independent verifier implementation, counterparty, broadcast, fill,
or settlement authority. Per-candidate wallet approval remains required.

The Nigeria-first Operator Beta may recruit for supervised testnet research
only. Public copy must describe the three currently supported launch intents,
not the planned twelve-action backlog. The TradeLayer Maker Pilot remains
shadow-only until the funded launch gates and local legal/compliance review
pass.

### Read-only shadow feeder update

- 28/28 additional TradeLayer shadow-source cases pass; the combined Covenant
  suite is 66/66.
- Six fixed read-only wallet-listener observations are hash-bound and checked
  for network, listener height/freshness, balance consistency, property
  orientation, oracle height, and cross-source conflicts.
- 14 new sanitized shadow failure traces feed the candidate-only Bonsai/Hermes
  risk-guard lane.
- A shadow feed reaches the allocator and still produces only `effect: none`,
  `signingPerformed: false`, and `broadcastPerformed: false`.

This reduces the "no live market source" blocker to a live-capable read-only
adapter, but does not close it for funded use. The risk checkpoint lacks
authentication and independent channel-balance proof, and no synchronized
live service set was available for a claimed real capture in this workspace.

## Exit criteria for funded launch

Funded launch may proceed only after all seven blockers above are implemented
and rerun against a real testnet wallet, Bitcoin observer, TradeLayer
submission path, and independent verifier. Add adversarial wallet-session
ownership tests and at least one real rejected-signature and interrupted-submit
recovery drill. Then repeat the full suite with production mode enabled and no
scripted broker in the dependency graph.

## Hermes typed-control update (2026-08-06)

Decision: **accept host-projected typed control for candidate generation; do
not promote the comparative model claim or funded execution**.

Passed:

- production-derived closed schemas for 18 BitAgent tools;
- zero model-callable effectful tools;
- 30/30 exact host-projected Bonsai candidates and zero host-arm hard failures;
- grade-A independent measurement audit with 100% deterministic coverage;
- 24 launch trajectories, at least 50 focused agent cases, 26 committed-signal
  cases, 10 deterministic live-testnet cases, and TypeScript compilation;
- 2 GB capped RTX 3050 confirmation with clean process and GPU cleanup.

Remaining:

- the comparative improvement is directional, not confirmed: the model-filled
  arm was already 29/30 exact, leaving one decisive item and 29 ties;
- a fresh independent optional-field/amount/address challenge set is required;
- no funded local testnet4 PSBT was prepared because Bitcoin Core CLI/node was
  unavailable on this host;
- this work grants no approval, signing, broadcast, fill, or PnL authority.
