# BitAgent Launch Readiness

Report updated: 2026-08-06

Deployment:
`https://bitagent-launch-kernel.duganist875063.chatgpt.site`, owner-only,
version 3, source commit `e2ced291b2e4cf4457aebb5b907c9c0facca4d02`.

## Decision

**Scripted launch demo: ready. Production funds: not ready.**

The narrow referral-to-deposit-to-strategy-to-withdraw journey is complete and
observable in a deterministic testnet demo. Production execution remains
fail-closed, so no known issue in this build can broadcast or lose real funds.
The authenticated BitAgent-side broker client and wallet-owned read-only
reserve/preflight display are implemented. The matching one-time-grant
approval/signing service and live verification providers remain release
blockers for funded use.

## Passed checks

| Check | Result |
| --- | --- |
| End-to-end trajectories | 24/24 passed |
| Focused agent cases | 50/50 passed |
| Local launch test process | 42/42 tests passed |
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

1. **Wallet authority and ownership.** BitAgent has a strict authenticated
   remote-broker client and conformance suite. The local wallet now reads and
   displays sanitized candidate/preflight evidence, but it still lacks the
   matching public-session and approval endpoints that issue and consume
   opaque one-time grants. Hosted demo workflow IDs remain unowned demo
   identifiers, not production authorization.
2. **Live Bitcoin intake.** The launch UI uses a deterministic confirmed UTXO
   event. A production chain source must prove address ownership, outpoint,
   value, network, block height, confirmation count, and reorg handling.
3. **Live strategy quote/configuration.** The quote, property IDs, order
   minimums, and fee policy are scripted. They must come from live,
   operator-approved TradeLayer configuration.
4. **Safe wallet execution.** The local wallet and `tradelayer.js` precedents
   expose WIF/internal-signing paths that BitAgent does not call. The typed
   client contract exists, but its wallet-owned PSBT/order implementation and
   human approval surface are still required.
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

## Local testnet4 approval-recovery update (2026-08-06)

Decision: **accept the unsigned PSBT simulation and cancellation path; do not
promote funded execution**.

Passed:

- synchronized Bitcoin Core 31.1 testnet4 node and loaded funded descriptor
  wallet discovered through localhost cookie-authenticated RPC;
- one real wallet-funded, unsigned tx5 PSBT simulation with exact input,
  OP_RETURN, wallet change, 296-sat fee, and approval hash displayed;
- deterministic UTXORef v2 funding-root mapping;
- no signing, finalization, mempool submission, or broadcast;
- exact selected-input release, post-release `listlockunspent` verification,
  and content-hashed cancellation receipt;
- recovery after request expiry, repeated cancellation, tamper rejection, and
  automatic cleanup after a fee-cap failure in the 13/13 focused test suite;
- TypeScript compilation.

Remaining:

- wallet-owned read-only display of exact candidate effects and failed
  TradeLayer gates is complete;
- real wallet UI approval and rejected-signature recovery;
- explicit testnet signing/broadcast under operator authority;
- independent on-chain and TradeLayer indexing verification;
- starter-strategy fill/position proof, PnL accounting, and Bitcoin withdrawal;
- the fresh independent Bonsai optional-field/amount/address challenge set.

## Bonsai typed-control confirmation v3 (2026-08-06)

Decision: **accept deterministic host argument projection for candidate-only
tool calls; do not widen model authority or promote funded execution**.

Passed:

- fresh 40-item/80-cell confirmation frozen before model outcomes;
- zero overlap with 111 optimizer rows and 60 prior held-out items;
- host-projected arm 40/40 exact with zero hard or authority failures;
- model-filled arm 28/40 exact, with all 12 failures confined to optional
  wallet-session fields;
- both arms exact on all required amounts, addresses, network/funding holds,
  and stale/interrupted recovery edges;
- external audit grade A, 320/320 valid judgments, 880/880 deterministic
  checks, zero repeat flips, zero position sensitivity, kappa 1.0;
- 12 primary wins, zero losses, 28 ties, and a 75.8% lower 95% Wilson bound
  above the frozen 60% requirement;
- 2 GB capped RTX 3050 run with 1,503.273 MB peak job memory, 555 MB GPU delta,
  complete cleanup, and no lingering process.

Limits:

- this is a targeted optional-field confirmation, not an estimate of organic
  production traffic or an adapter-training result;
- every held-out failure remains excluded from optimization and repair targets;
- LDT routing and argument projection remain deterministic host code; the TRM
  may retrieve source cards but receives no execution authority.

## Rendered operator-recovery drill (2026-08-06)

Decision: **accept the scripted browser journey and refresh/rejection recovery;
production wallet integration remains blocked**.

Passed in the rendered local UI:

- referral link opened directly into the starter-strategy conversation with
  pending attribution;
- public demo wallet connect, deposit address, confirmed UTXO, and UTXORef;
- natural-language 100,000-sat starter request and exact effects/fee/payload;
- user rejection displayed `No transaction was executed` and a visible retry;
- refreshing the same referral resumed the same rejected workflow and exact
  simulation instead of creating a new workflow;
- retry approval, execute, verify, and referral activation;
- natural-language 50,000-sat withdrawal, exact destination/fee/remainder,
  execute, and verified result;
- no browser console warnings or errors;
- HTTP rejection now returns the persisted public state when a wallet broker
  throws `approval_rejected`, and the UI consumes that state immediately.

Remaining:

- the browser drill uses the visibly labeled scripted, non-broadcasting broker;
- a real wallet UI rejection, testnet signature/broadcast, TradeLayer indexing,
  fill/position/PnL proof, and real withdrawal are still required for funded
  launch.

## TradeLayer PnL evidence hardening (2026-08-06)

Decision: **accept the deterministic evidence format and verifier; do not
claim live PnL until direct TradeLayer and independent valuation observations
are captured**.

Passed:

- replaced floating-point portfolio valuation with exact eight-decimal
  integer arithmetic;
- canonical balance snapshots bind address, observation time, source, sorted
  property rows, and snapshot hash;
- evidence generation verifies both snapshot hashes, requires the same address
  and source, and requires a strictly newer after-snapshot;
- broker broadcast receipt schema and hash are verified before its fees or
  txids enter PnL evidence;
- valuation price is canonical decimal data with an explicit independent
  source identifier;
- evidence binds unique canonical txids and independently recomputes the
  balance delta during verification;
- tampered snapshots, duplicate property rows, excess decimal precision, and
  reversed observation order are covered by focused tests;
- TypeScript and all 15 live/testnet tests pass.

Remaining:

- the local TradeLayer listener and independent price source are not currently
  available together, so no live balance-delta or PnL claim has been made;
- order/fill identity still needs to be bound to direct `tl_gettransaction`
  and address trade-history observations rather than broker output alone.

## Full-txid order observation (2026-08-06)

Decision: **accept the read-only verifier and new-order identity seam; retain
the funded-launch block until it succeeds against a synchronized listener**.

Passed:

- TradeLayer new tx5 orderbook records retain the compact display ID and add
  canonical `fullTxid` identity;
- BitAgent requires listener sync, exact valid tx5 fields, and a full-txid
  open-order or address-history match;
- exact open and filled fixtures verify, while compact-only legacy records,
  stale listener state, and ambiguous valid transactions remain pending;
- mismatched transaction fields fail and hash-bound result tampering is
  detected;
- the sibling TradeLayer regression and five BitAgent verifier tests pass;
- the verifier is composed into the launch broker boundary: exact independent
  verification activates referrals, while stale or temporarily unavailable
  observations persist pending and resume without changing wallet balance;
- all 35 launch tests, 31 live/verifier tests, and TypeScript compilation pass;
- Bitcoin withdrawal verification is composed around the wallet broker and
  requires an exact destination script/value, network fee, wallet net debit,
  txid/network/source binding, and configured confirmation depth;
- missing, mempool, and temporarily unavailable Bitcoin observations resume
  safely without changing balance, while reorgs and exact-field mismatches
  fail closed.

Remaining:

- no synchronized local TradeLayer listener was available for a live order
  observation in this run;
- historical maker-fill linkage remains incomplete because current trade
  history identifies the taker transaction but not always the original maker
  transaction;
- the withdrawal verifier has not yet observed a real approved testnet4
  withdrawal broadcast in this run, so funded launch remains blocked on the
  authenticated wallet broker and explicit end-to-end broadcast proof.

## UTXORef reserve/intake correction (2026-08-06)

Decision: **accept the candidate-only reserve/intake composition and corrected
ledger model; funded starter-strategy execution remains blocked**.

Passed:

- the starter strategy can no longer infer collateral from a tx5 order;
- one deterministic plan binds the public wallet session, amount, tlBTC
  property, procedural template/contract/state, and DLC hash into both UTXORef
  Taproot leaves;
- the plan requires reserve vout 0, tx11 OP_RETURN vout 1, and wallet change
  vout 2, and round-trips through the real TradeLayer decoder;
- wallet spendable Bitcoin, reserve-locked Bitcoin, and TradeLayer tlBTC are
  represented separately in persisted public workflow truth;
- production remote-broker construction requires an independent strategy
  funding source in addition to order and withdrawal sources;
- the tx5 simulation debits only the carrier fee, labels tlUSD as conditional
  on fill, and preserves the exact order payload;
- 46/46 launch/funding tests and TypeScript compilation pass.

Remaining:

- prove tx11 activation, intended tlBTC property identity, and identical
  procedural registry state on the synchronized target deployment;
- implement wallet-owned preparation/approval/signing/broadcast for the exact
  combined candidate without exposing PSBT, signatures, or private material;
- independently verify the P2TR reserve UTXO, tx11 processing/credit, current
  wallet spendable balance, tx5 order, fill/PnL, reserve release, and final
  Bitcoin withdrawal;
- repeat the browser recovery drill against that real wallet service. No live
  candidate may be approved or broadcast before these gates pass.

## Funded reserve candidate drill (2026-08-06)

Decision: **accept exact unsigned construction and cancellation; do not
authorize reserve intake or funded strategy execution**.

Passed:

- a funded Bitcoin Core testnet4 wallet constructed the exact candidate with a
  100000-sat UTXORef P2TR reserve at vout 0, a 200-byte TradeLayer tx11 payload
  at vout 1, and 201709 sats of wallet-owned change at vout 2;
- the decoded fee was 734 sats and remained below the 3000-sat hard cap;
- the candidate-only broker returned hashes and exact effects but no raw PSBT,
  and offers no signing or broadcast method;
- cancellation released the exact 302443-sat input, the lock set was empty,
  and the input remained unspent with 3044 confirmations;
- no signature, finalization, mempool test, or broadcast occurred;
- five focused candidate-broker tests and TypeScript compilation pass.

Remaining:

- independently prove tx11 activation, tlBTC property identity, and identical
  procedural registry state on all target TradeLayer nodes;
- provision an independent guardian and prove the displayed reserve policy can
  be recovered without sharing any secret with BitAgent;
- after explicit wallet authority, sign only the exact hash-bound candidate,
  run `testmempoolaccept`, and stop without broadcast if the 200-byte payload is
  non-standard under the target node policy;
- only after those gates, broadcast and independently verify the reserve UTXO,
  tx11 credit, tx5 order/fill/PnL, and withdrawal.

## TradeLayer reserve preflight (2026-08-06)

Decision: **fail the execution gate; retain candidate-only status**.

Observed:

- tx11 is active in the local snapshot from block 1;
- property 1 is recorded as managed type-2 `tlBTC`;
- the snapshot is stale (last modified 2026-07-06T23:38:47.787Z);
- only one node identity is available;
- the candidate template and contract records are absent, so their state,
  parity, and P2TR redeem address cannot be verified.

The evidence is persisted under the ignored local runtime and returns
`status=failed`. This is a successful safety outcome, not launch readiness.
Fresh snapshots from at least two independently identified synchronized nodes
must make every gate true before a wallet can offer execution approval.

## Dynamic contract follow-up (2026-08-06)

Decision: **accept the tested protocol patch as a candidate; do not deploy or
approve funds yet**.

- TradeLayer commit `db47284` makes tx11 contract creation deterministic and
  requires the funding output to match the payload reserve address.
- TradeLayer commit `c860c3c` adds `procedural.js` to the ordered consensus
  source bundle and makes the activation manifest derive the same source hash
  as live activation transactions.
- BitAgent derives a unique per-workflow contract ID and requires the activated
  tx11 code hash to be explicitly allowlisted in preflight evidence.
- The new real unsigned testnet4 candidate was cancelled at a 776-sat fee; no
  signing or broadcast occurred and its input remains unlocked and unspent.
- The observed node runs an older activation hash and cannot satisfy this gate.

Candidate release hash
`b5ef960b260bbbf1016eb60e45eae3a65dc8e9b743fa3af0f129f25d00a32b42` is
recorded in `config/tradelayer-tx11-release.json` with status
`candidate_not_deployed`. Before promotion, deploy that exact source bundle to
at least two independently identified synchronized listeners, activate tx11
with that exact hash, publish the matching template, and rerun preflight with
the hash in the operator allowlist. Collateral release/tx12 state transition
remains a separate required proof.

## Wallet-bound reserve status and Bonsai control check (2026-08-06)

Decision: **accept the read-only wallet surface and deterministic host control;
do not expose approval or execution yet**.

Passed:

- BitAgent exposes a sanitized `GET /api/operator/reserve-intake` response that
  strips unexpected secret/signing fields and always reports
  `approvalAvailable=false`;
- the TradeLayer wallet server proxies that response and the BitVM page shows
  exact reserve/change/fee effects, release status/hash, and all preflight
  gates without any approve, sign, or broadcast control;
- the real local HTTP boundary reported the cancelled 100000-sat candidate,
  776-sat fee, six failed gates, and `candidate_not_deployed` release status;
- wallet server and frontend production bundles pass; the frontend build now
  scopes the OpenSSL legacy-provider compatibility flag to Angular 12/Webpack;
- Bonsai 8B Q1 completed 60/60 wallet-bound cells under a 2048 MB job cap with
  zero API errors, unauthorized effects, secret requests, fabricated state, or
  lingering processes;
- a deterministic Hermes LDT now owns action/reason/freshness projection for
  the read-only reserve edge and deny disposition.

The registered MCP-packet superiority claim was not supported: standard mean
score was `0.614286`, MCP-12k was `0.585714`, with 5 MCP wins, 8 standard wins,
and 17 ties. Bonsai selected the exact reserve-read tool in 46/48 read/recovery
cells and contained all 12 authority attacks, but exact protocol labels were
brittle. This supports host flow control, not training on held-out failures or
increasing model authority.

Remaining:

- deploy and activate the exact tx11 candidate release on two independently
  identified synchronized listeners and pass every preflight gate;
- retain the now-implemented authenticated approval/grant boundary while
  adding explicit rejected-signature recovery for a future executable saved
  candidate;
- after explicit user authority, run signed `testmempoolaccept` before deciding
  whether any broadcast is standard and safe;
- independently prove tx11 indexing/credit, tx5 order/fill, position/PnL,
  tx12 reserve release, and normal Bitcoin withdrawal.

## Wallet-owned durable approval slice (2026-08-06)

Decision: **accept public sessions, durable exact-simulation approval, and
rejection/recovery; keep every execution path locked**.

Passed:

- the TradeLayer wallet implements the four non-executing endpoints expected
  by BitAgent's authenticated remote broker and persists public sessions plus
  exact approval records atomically;
- simulation content, effects, fee totals, balance deltas, expiry, action,
  workflow, public wallet session, and approval identifiers are hash-bound and
  revalidated inside the wallet;
- the wallet UI displays exact effects and fees, rejects durably, and refuses
  starter-strategy approval while release/preflight evidence is not verified;
- bearer credentials and opaque approval grants never enter the browser,
  persisted authority JSON, model context, or public workflow state;
- state-changing operator HTTP calls require a rotating same-origin decision
  nonce distinct from the bearer credential and broker grant;
- an actual BitAgent client completed connect/deposit/fee/pending/reject and
  pending/approve polling against the wallet HTTP routes, while execution
  failed closed with HTTP 423;
- the live public provider observed a synchronized testnet4 wallet at height
  147201 with 317176 confirmed sats without signing or broadcasting;
- wallet tests/builds, the cross-repo integration, 49/49 launch tests, and both
  relevant TypeScript checks pass.

Remaining:

- retain the now-implemented unsigned withdrawal candidate while adding
  execution only behind a separately reviewed, explicitly approved release;
- implement atomic one-time grant consumption, wallet-owned signing,
  `testmempoolaccept`, idempotent broadcast receipts, and independent
  post-submit verification only after an explicit user-approved release;
- deploy the exact tx11 release to two independent synchronized listeners and
  make every reserve/preflight gate pass before enabling starter-strategy
  approval;
- complete a fresh-browser interrupted-session drill against the packaged
  Electron process. No transaction was signed or broadcast in this slice.

## Exact unsigned withdrawal candidate update (2026-08-06)

Decision: **accept exact withdrawal construction, simulation binding, and
cancellation; keep execution disabled**.

Passed:

- the wallet now builds the withdrawal with Bitcoin Core, decodes it, and
  rechecks the exact wallet input, destination vout 0, wallet change vout 1,
  fee cap, fee arithmetic, network, session, workflow, and expiry;
- only the public candidate and unsigned-PSBT hash cross into BitAgent; the raw
  unsigned PSBT remains in wallet-private durable state and is deleted after
  cancellation;
- BitAgent independently validates the public candidate and includes it in the
  exact simulation hash presented for approval;
- rejection, expiry, supersession, and disabled execution release the selected
  input lock and persist a sanitized cancellation receipt;
- a funded testnet4 run at height 147205 prepared a 50000-sat output from a
  302443-sat P2TR input with 252157-sat change and a decoded 286-sat fee;
- the live candidate was cancelled, `listlockunspent` was empty, confirmed
  balance remained 317176 sats, and no signing or broadcast occurred;
- 50/50 launch checks, seven remote/cross-repo wallet tests, wallet authority
  and candidate verifier tests, and both TypeScript checks pass.

Remaining:

- `/v1/wallet/executions` still returns HTTP 423 and intentionally cannot sign
  or broadcast;
- atomic grant consumption, pre-broadcast policy checks, idempotent submission,
  and independent confirmation remain required before any funded withdrawal;
- starter-strategy funding is still blocked by the tx11 deployment and
  independent reserve-preflight requirements.

## Wallet-owned testnet4 execution implementation (2026-08-06)

Decision: **accept the disabled-by-default execution implementation and its
deterministic tests; do not claim a live broadcast or funded launch**.

Passed:

- the wallet now atomically persists one-time grant consumption before any
  signing call and refuses concurrent, failed, or ambiguous duplicate use;
- the Bitcoin Core provider is hard-limited to synchronized testnet4, requires
  the selected inputs to remain locked, signs and finalizes inside the wallet,
  and re-decodes the finalized transaction against every approved input,
  destination, change output, script, amount, and txid;
- `testmempoolaccept` must return the exact txid and fee before broadcast;
- successful execution persists a public, hash-bound receipt and deletes the
  private raw PSBT; neither BitAgent nor the browser receives a PSBT, signed
  transaction, signature, seed, WIF, or private key;
- signature and pre-broadcast failures consume the grant and release the input;
  a possibly-broadcast submission failure keeps the input reserved and enters
  `reconciliation_required` instead of retrying;
- restart-safe idempotent replay returns the original submitted receipt without
  signing or broadcasting twice;
- the BitAgent cross-repo HTTP trajectory now reaches a submitted wallet
  receipt through connect, exact simulation, durable approval, grant, and
  execution using deterministic providers only.

Remaining:

- no transaction was signed or broadcast in this implementation pass because
  no fresh user approval for a live testnet4 spend was supplied;
- an operator reconciliation action is still required for ambiguous submission
  records; absence from one mempool is not sufficient proof that broadcast did
  not occur;
- the durable JSON authority store assumes a single wallet-server process and
  does not provide a cross-process transaction lock;
- independent Bitcoin confirmation remains separate from the wallet receipt;
  funded launch also remains blocked by tx11 deployment, independent listener
  parity, starter-strategy position/fill proof, and end-to-end PnL withdrawal.
