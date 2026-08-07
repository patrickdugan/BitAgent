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
The authenticated BitAgent client, wallet-owned public sessions, exact
withdrawal and reserve candidates, durable one-time approvals, reserve
preflight, and independent reserve-verification boundary are implemented.
Reserve signing/broadcast, deployed tx11 consensus support, synchronized live
verification providers, and the funded tx5 path remain release blockers.

## Passed checks

| Check | Result |
| --- | --- |
| End-to-end trajectories | 24/24 passed |
| Focused agent cases | 50/50 passed |
| Local launch test process | 91/91 tests passed |
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
| Reserve intake and tx5 order approval boundaries | Separate and hash-bound |
| Reserve candidate tampering and cancellation recovery | Passed |

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

1. **Reserve execution and deployed tx11 support.** Public wallet sessions,
   exact reserve candidates, durable approval grants, rejection cleanup, and
   preflight gating are implemented. Reserve signing/broadcast remains
   deliberately disabled, and the exact candidate-8 tx11 source is not
   deployed or active on synchronized TradeLayer listeners. Hosted demo
   workflow IDs remain unowned demo identifiers, not production authorization.
2. **Live Bitcoin intake.** The launch UI uses a deterministic confirmed UTXO
   event. A production chain source must prove address ownership, outpoint,
   value, network, block height, confirmation count, and reorg handling.
3. **Live strategy quote/configuration.** The quote, property IDs, order
   minimums, and fee policy are scripted. They must come from live,
   operator-approved TradeLayer configuration.
4. **Safe wallet execution.** The local wallet's testnet4 withdrawal path is
   exact-candidate and release-gated, but reserve and live tx5 execution are
   not complete. Legacy WIF/internal-signing paths remain prohibited; any new
   executor must consume only the wallet-held approval grant and revalidate the
   exact simulation before signing.
5. **Independent verification.** Deterministic reserve, TradeLayer order, and
   Bitcoin withdrawal verifier boundaries exist, but production still needs
   stable synchronized providers for transaction, order/position, fill,
   balance, PnL, and withdrawal truth. Provider results, never the language
   model or submitting wallet, must drive state.
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
- TradeLayer commit `c80f703` selects block 1 for BTCTEST/testnet4 replay
  instead of the legacy Bitcoin testnet height above the current testnet4 tip.
- TradeLayer commit `4657e62` exposes a challenge-bound, read-only launch
  attestation carrying live synchronization, explicit node/instance identity,
  the exact release commit, and the tx11/property/procedural registry view.
- BitAgent derives a unique per-workflow contract ID and requires the activated
  tx11 code hash to be explicitly allowlisted in preflight evidence.
- The new real unsigned testnet4 candidate was cancelled at a 776-sat fee; no
  signing or broadcast occurred and its input remains unlocked and unspent.
- The observed node runs an older activation hash and cannot satisfy this gate.

Candidate release hash
`6b2f30c4b845b7ea7dee70efb30b2a4361ec4d8031a417fb76b8d9865880ea19` is
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
- the wallet UI now offers positive-proof reconciliation for ambiguous
  submissions and can promote an exact wallet-observed transaction to
  `submitted`; absence or conflict remains locked and cannot authorize retry;
- the durable JSON authority store assumes a single wallet-server process and
  does not provide a cross-process transaction lock;
- independent Bitcoin confirmation remains separate from the wallet receipt;
  funded launch also remains blocked by tx11 deployment, independent listener
  parity, starter-strategy position/fill proof, and end-to-end PnL withdrawal.

## Short-context skill and candidate-launch checkpoint (2026-08-06)

Decision: **ready for a supervised, candidate-only referral demo and funded
testnet4 deposit observation; not ready for a funded TradeLayer strategy or
live withdrawal broadcast**.

Passed:

- both local BitAgent skills are complete, skill-creator validation passes,
  and their machine-readable MCP resource contracts fit the inclusive 12k
  window while exposing at most three tools per phase;
- the lifecycle contract now covers wallet candidate execution and ambiguous
  reconciliation without granting the model approval, signing, broadcast,
  retry, or execution authority;
- 58/58 launch checks pass, including 24 end-to-end trajectories, the 50-case
  agent floor, referral activation, stale/cancelled/rejected paths, recovery,
  exact fee/effect binding, independent verification, and secret refusal;
- a synchronized local Bitcoin Core 31.1 testnet4 node and funded descriptor
  wallet returned 317176 confirmed sats at height 147212;
- live read-only wallet authority, exact unsigned 50000-sat withdrawal
  construction, cancellation, post-cancellation balance, and empty input-lock
  checks passed;
- a second funded drill constructed and cancelled the real UTXORef-bound
  TradeLayer tx5 candidate with a 296-sat fee. Neither drill signed or
  broadcast a transaction.

Remaining launch blockers:

- the Bonsai runtime still reports `adapter_artifacts_not_trained`; current
  base-model screening is benchmark evidence, not a promoted adapter runtime;
- the financial-survival skill now has three deterministic, effect-free typed
  tools and a bounded 12k manifest; adapter promotion and any external payment
  broker remain unavailable;
- tx11 release remains `candidate_not_deployed`, and two independent current
  TradeLayer listeners have not passed the reserve/intake preflight;
- there is no independently verified funded tx5 placement/fill, closed
  position, positive settled PnL, PnL release into wallet-owned Bitcoin, or
  separately approved withdrawal confirmation;
- live wallet execution is testnet4-only, disabled by default, and requires a
  fresh explicit user approval plus an operator-reviewed release digest;
- the JSON authority store is single-process and is not a production custody
  boundary.

Until those blockers close, the launch mode must display `simulation` or
`candidate-only testnet4` labels and must not imply that the starter strategy,
PnL release, or Bitcoin withdrawal completed on chain.

## Referral-to-withdrawal browser regression (2026-08-06)

Decision: **the scripted launch journey passes in the rendered local product;
funded execution remains blocked**.

Passed:

- a fresh referral deep link opened directly in the starter-strategy
  conversation with attribution pending;
- the user-created demo wallet recorded a 250000-sat confirmed testnet4 UTXO,
  natural language selected exactly 50000 sats, and the UI displayed the exact
  tx5 payload, 900-sat carrier fee, conditional effects, simulation hash, and
  199100-sat projected remainder;
- a launch-blocking truthfulness defect was fixed: simulation and approval no
  longer replace the persisted 250000-sat confirmed balance with projected
  post-reserve spendable Bitcoin before execution is independently verified;
- refresh at the pending-approval boundary restored the same simulation and
  approval state without execution;
- scripted approval, execution, and verification changed the confirmed wallet
  balance to 199100 sats and activated referral attribution only after the
  starter order verified;
- a 50000-sat withdrawal simulation displayed its normal testnet address,
  600-sat fee, and 148500-sat remainder; rejection preserved funds and the
  saved simulation, refresh restored recovery, and a new scripted approval
  completed with a verified withdrawal receipt;
- the 58-check launch suite passes with explicit assertions that simulation,
  cancellation, rejected authorization, interrupted-session resume, and
  pending independent verification do not mutate confirmed wallet balance.

Boundaries:

- all browser execution and verification in this regression were scripted;
  no real transaction was signed, finalized, or broadcast;
- the funded TradeLayer and PnL claims listed above remain launch blockers.

## Financial-survival MCP closure (2026-08-06)

Decision: **accept the deterministic short-context wrapper; do not interpret a
policy decision as wallet approval or payment.**

Passed:

- `bitagent.survival.assess`, `bitagent.survival.evaluate`, and
  `bitagent.survival.journal.verify` are registered as typed tools with
  `additionalProperties=false` and `effect=none`;
- policy, treasury snapshot, clock, and raw journal records stay inside a
  host-owned provider; model arguments carry only exact evidence hashes,
  public identifiers, and the typed spend intent;
- changed evidence bindings, unexpected/secret-bearing intent fields, corrupt
  journals, and unresolved journal URIs fail closed;
- the new v2 Bonsai tool bundle contains the three contracts and 114
  deterministic seed examples, with no detected secret values or raw
  transcripts; frozen v1 remains unchanged at 111 rows;
- the skill packet contract remains capped at three tools, three rounds, six
  calls, and the inclusive 12,000-token window.

Boundaries:

- `authorized` means only that deterministic policy permits staging the named
  unsigned capability; it does not request approval, sign, broadcast, spend,
  settle, or prove a payment;
- these three new seed rows are contract coverage, not an independently
  reviewed promotion corpus or evidence that a Bonsai adapter was trained.

## Fail-closed operator preflight and rejection recovery (2026-08-06)

Decision: **the one-command scripted launch preflight passes; funded execution
remains disabled.**

Passed:

- `npm run preflight:launch` ran 70/70 launch checks, found all 24 named
  end-to-end trajectories, passed 50/50 focused agent cases with every score
  equal to 1, and found zero generated failure traces;
- the command emits `.runtime/launch-preflight/latest.json` with command-output
  hashes, counted evidence, the `read_only_no_sign_or_broadcast` authority
  boundary, and a decision that keeps `fundedExecutionAllowed` false;
- the same command recomputed the canonical TradeLayer consensus source hash,
  bound it to commit `4657e62`, and verified candidate source integrity while
  separately retaining `deploymentVerified=false` and `executable=false`;
- the rendered local referral flow again passed wallet rejection and refresh
  recovery: the exact 50000-sat simulation, 900-sat fee, 199100-sat projected
  remainder, payload, quote, expiry, and simulation hash survived refresh;
- rejection explicitly reported that no transaction executed and offered a
  new approval request from the saved simulation; the browser recorded zero
  console errors.

Boundaries:

- the browser deposit and wallet are scripted testnet4 fixtures;
- no approval was granted and no transaction was signed, finalized, or
  broadcast in this regression;
- the funded blockers in the preceding checkpoint remain unchanged.

## Live listener attestation gate (2026-08-06)

Decision: **accept the read-only verifier contract; deployment evidence is not
yet available.**

Passed:

- each listener can expose one challenge-bound response containing only
  synchronization, release, activation, property, template, and contract
  evidence;
- BitAgent requires unique endpoints, node IDs, instance IDs, and challenges,
  rejects credentials in endpoint URLs and secret-bearing response fields,
  and enforces fresh realtime testnet4 state within the configured block lag;
- release commit and tx11 code-hash allowlists come from the tracked release
  manifest, not from listener claims;
- seven focused cases cover valid parity, duplicate identities, stale/lagged
  listeners, unallowlisted releases, challenge substitution, secret-bearing
  responses, and evidence tampering;
- the full launch suite passes 70/70 and the current consensus source hash is
  unchanged.

Boundaries:

- the independence claim is limited to distinct live endpoints and
  operator-declared node instances; it is not remote code attestation or proof
  that two endpoints cannot proxy one backend;
- no two listener processes are currently running, so no deployment or parity
  receipt has been promoted and funded execution remains disabled.

## Live pruned replay checkpoint (2026-08-06)

Decision: **accept the pruned-node transport and interruption-recovery fixes;
do not promote the candidate while replay and protocol-state gates are
incomplete.**

Passed:

- two separate Bitcoin Core 31.1 testnet4 backends are running walletless with
  `blocksonly=1`, `prune=2048`, separate data directories, cookie credentials,
  and RPC ports;
- two separately identified TradeLayer listener processes use separate NeDB
  roots and report exact commit
  `dabbaf485dda99b2b0626120942190b5873fd2f3`;
- block-scoped `getrawtransaction` calls removed the need for Bitcoin Core
  `txindex` during historical replay;
- partial replay height is durably checkpointed every 100 blocks without
  claiming index completion;
- an intentional listener-B stop/restart resumed from durable height 400;
- 14 focused TradeLayer tests pass for block-scoped RPC arguments, replay
  checkpoint semantics, testnet4 profile selection, and launch attestation.
- the attestation and BitAgent verifier additionally bind Bitcoin Core chain,
  blocks, headers, IBD state, verification progress, networking state, and peer
  count; focused tests reject IBD, header lag, paused networking, and zero-peer
  backends.
- both backend attestations must carry the same validated Bitcoin best-block
  hash; equal heights on different tips fail synchronization parity.
- candidate 4 supports an explicit decoded-block replay mode for reviewed
  Bitcoin Core backends; it removes per-transaction RPC round trips without
  changing marker parsing or transaction authority.
- candidate 5 closes the zero-transaction consensus transition: an empty
  indexed history must durably align indexed, processed, and track heights
  before the listener may enter realtime. The combined focused TradeLayer set
  passes 20/20.
- realtime launch lag is now bound to durable `trackHeight`; focused tests
  accept a caught-up track over an older historical index and reject lagged or
  impossible above-tip tracking.
- candidate 6 preserves a newer realtime checkpoint across listener and
  Bitcoin Core restarts, while rejecting persisted heights ahead of the active
  chain tip. RPC cookie rotation still requires a listener restart and is
  surfaced as a fail-closed provider error before that restart.
- the 550 MiB live drill then reproduced a pruning race. Candidate 7 permits
  bounded catch-up from locally downloaded blocks while P2P networking is
  paused, but still enters recovery when Bitcoin RPC itself is unavailable.
  A fresh or sufficiently retained backend is required after a block has
  already been pruned; missing history is never skipped or synthesized.
- the complete launch preflight passes 85/85 launch checks, 24 scripted
  trajectories, and 50/50 focused agent cases with every score equal to 1 and
  no generated failure trace.
- a lag-driven pruned-node throttle now fail-closes on listener errors,
  above-tip checkpoints, and prune-horizon overruns while bounding Bitcoin
  download lead to a 250-block default; its 12 focused policy cases include
  recovery-phase rejection and bounded IPv4/IPv6 addrman selection.
- candidate 8 (`dabbaf485dda99b2b0626120942190b5873fd2f3`)
  retries only transient block-count RPC failures with capped backoff and binds
  the retry module into consensus hash
  `fee1c7c5de3b33e1facb1dc95a60e54e243169a5d7a2aa8b982785f478be7b1c`.
  Two listeners running from a clean detached worktree resumed their durable
  databases and completed bounded sync receipts at exact local tips 63,588
  and 60,019 with networking off, zero peers, realtime phase, and no error.
  The slower pair advanced 696 blocks in the latest direct-controller segment
  while remaining behind its retained prune horizon.

Boundaries:

- the current 2 GiB-pruned backends are paused at blocks 63,588 and 60,019
  with prune heights 58,223 and 58,227. Their preserved listeners are at those
  exact tips and report realtime/100%/no error. The live gate nevertheless
  keeps `synchronizedTestnet4=false` because both backends are still in IBD
  with networking disabled and zero peers;
- tx11 is not chain-activated with candidate 8, and the required property,
  procedural template, contract, and reserve-address parity gates are false;
- normal controller completion and handled errors disable peer networking, but
  a hard process/host kill or npm-wrapper interruption cannot guarantee async
  cleanup. Recovery nodes therefore remain limited to one peer and require an
  explicit post-interruption network-state check and pause;
- the nodes are operationally separate local processes, not Byzantine-
  independent or remotely attested operators;
- funded execution remains disabled and no wallet, signing, or broadcast
  action occurred.

## Wallet-owned reserve execution checkpoint (2026-08-06)

Decision: **accept the default-disabled reserve execution implementation and
recovery tests; do not enable or claim a funded launch.**

Passed:

- the wallet-owned reserve provider validates the retained PSBT commitment,
  synchronized testnet4 state, selected input lock, finalized transaction,
  reserve vout 0, tx11 data vout 1, wallet change vout 2, exact fee, unsigned
  identity, mempool result, and broadcast txid;
- reserve intake and withdrawal use independent enable flags and independent
  64-hex release digests;
- approval and execution are bound to the exact plan hash, all eight fresh
  independent preflight gates, and the deployed release ID/code hash;
- one-time approval consumption is persisted before signing, successful replay
  is idempotent, definite failure cleans up, and ambiguous submission remains
  locked until positive exact-transaction reconciliation;
- public state and UI expose only sanitized candidates, capabilities, exact
  effects, fees, receipts, and recovery state; no PSBT, signed transaction,
  signature, key, or bearer token is returned or persisted publicly;
- wallet server/provider/authority regressions, both TypeScript checks, the
  frontend Angular AOT compiler, and the 94/94 launch preflight pass; all 24
  trajectories and 50/50 agent cases pass with zero generated failure traces.
- the Bonsai/Hermes v2 corpus has 118 deterministic candidate-only rows and
  explicit reserve preflight, mempool-rejection, and ambiguous-submission
  recovery coverage; its tool-contract and authority tests are in the launch
  gate.

Remaining:

- candidate 8 is not deployed and the live listener preflight gates remain
  false, so reserve approval and execution must stay disabled;
- the Angular production bundle was not completed under the active low-end
  desktop load; the frontend TypeScript and Angular AOT compilers passed;
- no live user approval was granted and no testnet4 transaction was signed,
  finalized, or broadcast;
- independent reserve confirmation/tlBTC credit, tx5 placement/fill, settled
  PnL, and the separately approved withdrawal remain launch blockers.

## Reproducible candidate-8 launch-source gate (2026-08-06)

Decision: **accept the source-provenance repair for scripted launch testing;
keep funded execution disabled.**

Passed:

- an allowlisted clean detached TradeLayer worktree is discovered without
  modifying or hiding tracked user changes in the primary checkout;
- selection requires the exact full commit, clean tracked state, ordered
  consensus-file parity, and exact candidate-8 code hash;
- the emitted receipt is explicitly read-only with `effect=none`,
  `deploymentVerified=false`, and `executable=false`;
- `npm run test:launch:candidate8` passes 96/96 checks, including the two new
  discovery/selection regressions, all 24 scripted trajectories, and all 50
  focused agent cases.
- `npm run preflight:launch:candidate8` also passes the separate 50-case
  evaluation, all eight score dimensions at 1, the zero-failure-trace gate,
  and exact release-source verification. Its persisted decision is
  `scriptedLaunchReady=true` and `fundedExecutionAllowed=false`.

Remaining:

- source parity is not deployment evidence: both paused listeners still fail
  synchronization and tx11/property/template/contract/reserve activation
  gates;
- no approval, signature, transaction finalization, broadcast, tlBTC credit,
  trade fill, PnL settlement, or withdrawal was performed by this gate.

## Candidate-9 chain-activation provenance gate (2026-08-06)

Decision: **supersede candidate 8 with candidate 9 for all new launch checks;
keep funded execution disabled.**

Passed:

- TradeLayer now records whether tx11 activation came from an indexed Bitcoin
  transaction, a local database seed, or legacy state with unknown provenance;
- BitAgent and the wallet require the ninth `tx11ChainDerived` gate in addition
  to the existing independent-listener, freshness, code-hash, property,
  template, contract, and reserve-address checks;
- local database activation and activation records without a valid 64-hex txid
  plus the exact activation block fail closed even if tx11 otherwise reports
  active;
- the release-generic source gate selected clean candidate-9 commit
  `f502236e3e2b8c601c2e8576bb0bcf23b2680892` and exact ordered consensus hash
  `8ab527ac64cd21464e7911396572e971f4b8795fa59f3f472dfb3abb6c0ffed1`;
- `npm run preflight:launch:release` passes 106/106 launch checks, all 24
  trajectories, and 50/50 focused agent cases with all eight score dimensions
  at 1 and zero generated failure traces;
- the wallet authority tests reject approval when the chain-derived gate is
  false, and the frontend TypeScript compiler passes.

Remaining:

- the two preserved listeners run candidate 8 and cannot provide candidate-9
  activation provenance. New observations therefore fail
  `tx11ChainDerived`, exact release, synchronization, and registry gates;
- listener-reported activation txids are not yet independently decoded against
  Bitcoin Core by the launch observer. Production promotion requires either
  independent chain-payload verification or independently operated listeners;
- the wallet-server repository-wide TypeScript command is blocked in
  `node_modules` by duplicate `@types/web` and bundled DOM declarations. The
  executable authority suite passes and no changed-file diagnostic was emitted;
- no approval, signing, activation transaction, broadcast, tlBTC credit, trade,
  PnL settlement, or withdrawal occurred.

## Candidate-9 live replacement checkpoint (2026-08-06)

Decision: **accept the reproducible candidate-9 listener deployment, sealed
snapshot recovery, and 70,000-block bounded-sync evidence; keep funded
execution disabled.**

Passed:

- two fresh candidate-9 processes use unique ports, node IDs, instance IDs,
  Bitcoin backends, state roots, logs, and owned PIDs, with exact commit and
  consensus-source hash parity;
- a prune-horizon overrun was detected before history could be skipped, the
  affected listener failed visibly, and both Bitcoin backends were paused;
- two 69,459 snapshots were sealed with exact source/copy inventory parity and
  used to start a fresh replacement pair without changing checkpoints;
- the replacement pair completed at exact paused tips 70,028 and 70,002 using
  a reviewed 100-block high watermark, including successful operation through
  real prune jumps to 69,428 and 69,430;
- terminal sync evidence records completion, zero lag, realtime/no-error
  listener state, and successful per-backend pause outcomes; independent RPC
  reads confirmed networking disabled and zero peers;
- the complete release preflight passes 111/111 launch checks, all 24 scripted
  trajectories, and all 50 focused agent cases with every score equal to 1 and
  zero failure traces.

Remaining:

- both backends are still in IBD around height 70,000 versus header height
  147,269, so `synchronizedTestnet4=false` is correct;
- tx11 is not activated by a verified Bitcoin transaction, and property,
  template, contract, and reserve-redeem parity remain false;
- the release manifest remains `candidate_not_deployed`, therefore wallet
  approval and funded execution remain unavailable;
- the failed candidate9-B process/state is preserved as evidence and must not
  be reused; only the replacement ports 3121/3122 are eligible for continued
  recovery;
- GPU temperature was 73 C against the 64 C Bonsai start gate, so no local
  model load or benchmark was performed;
- no approval, signing, activation transaction, broadcast, tlBTC credit, trade,
  PnL settlement, or withdrawal occurred.

Post-checkpoint continuation: the first bounded 75,000 attempt exhausted its
20-minute runtime with A exact at 73,524 and B exact at 74,037. Both listeners
remained realtime/error-free and the terminal receipt recorded successful
pause RPCs. Resumed 74,200 and 75,000 targets then completed at A 75,033 and B
75,054, both with exact listener parity and networking paused. This remains
IBD recovery rather than launch synchronization.

Further bounded recovery completed at 80,000, 81,000, and 85,000. Current exact
paused tips are A 85,042 and B 85,122. A connected peer with no synchronized headers
or blocks was isolated twice; exact-peer rotation restored progress. The
controller now performs that rotation automatically only after a bounded
low-lag stall and preserves synchronized peers. The complete release preflight
passes 114/114 checks after the new policy tests. Full IBD completion and all
chain-derived tx11 gates remain outstanding.
