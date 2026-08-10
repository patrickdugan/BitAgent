# BitAgent Launch Readiness

Report updated: 2026-08-07

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
Default-disabled wallet-host execution and durable approval recovery are now
implemented, but deployed tx11 consensus support, two synchronized live
verification providers, a separately funded testnet4 wallet, and the funded
tx5 path remain release blockers.

## Passed checks

| Check | Result |
| --- | --- |
| End-to-end trajectories | 24/24 passed |
| Focused agent cases | 50/50 passed |
| Release-aware local launch gate | 148/148 tests passed |
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

1. **Deployed tx11 support and live execution evidence.** Public wallet
   sessions, exact candidates, durable approval grants, write-ahead recovery,
   host-private execution, and preflight gating are implemented. Candidate10
   remains `candidate_not_deployed` and is not active on two synchronized
   TradeLayer listeners. All preparation/submission interlocks therefore stay
   disabled. Hosted demo workflow IDs remain unowned demo identifiers, not
   production authorization.
2. **Live Bitcoin intake.** The launch UI uses a deterministic confirmed UTXO
   event. A production chain source must prove address ownership, outpoint,
   value, network, block height, confirmation count, and reorg handling.
3. **Live strategy quote/configuration.** The quote, property IDs, order
   minimums, and fee policy are scripted. They must come from live,
   operator-approved TradeLayer configuration.
4. **Safe wallet execution validation.** The testnet4 withdrawal, reserve, and
   candidate10 activation paths are exact-candidate, release-gated, and
   default-disabled. The activation operator revalidates before and after
   signing, performs mempool admission, and permits only positive reconciliation
   after an ambiguous submission. A funded wallet and live rejection,
   interruption, and confirmation drills are still required. Legacy WIF and
   internal key-export paths remain prohibited.
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

Further bounded recovery completed at 80,000, 81,000, 85,000, and 90,000.
Current exact paused tips are A 90,011 and B 90,051, with exact listener parity
and no listener error. A connected peer with no synchronized headers or blocks
was isolated twice; exact-peer rotation restored progress. The controller now
performs that rotation automatically only after a bounded low-lag stall and
preserves synchronized peers. Fresh live preflight at the 90,000 checkpoint
passes listener independence, observation freshness, and exact candidate-9
release while correctly failing full IBD synchronization and every real
chain-derived tx11 registry gate. The complete release preflight passes 114/114
checks after the new policy tests. Full IBD completion and all chain-derived
tx11 gates remain outstanding; the idle GPU was 71 C, above the 64 C Bonsai
start gate.

Later bounded recovery completed 95,000 and 100,000, then reached 105,000 after
one truthful timeout/resume cycle. Current exact paused tips are A 105,009 and
B 105,001, with realtime/no-error listeners at identical heights, disabled
networking, and zero peers. The timeout receipt preserves partial A progress
and completed B state; the separate resume receipt proves completion. Real
prune horizons advanced safely to A 102,700 and B 102,703 only after the
listeners were beyond them. Full IBD completion and every chain-derived tx11
gate remain outstanding, wallet approval remains disabled, and no transaction
authority was exercised. The zero-utilization GPU was 80 C, so the 64 C
Bonsai gate correctly prevented a model load.

Post-105,000 continuation advanced only pair A under a 100-block lag governor
and stopped at an exact, paused Bitcoin/listener height of 107,577. Pair B
remains exact and paused at 105,001. This is an intentional asymmetric recovery
checkpoint: it does not satisfy two-listener tip parity, IBD completion, or any
tx11 chain-derived gate. The next safe chain action is a separately receipted
pair-B catch-up after chassis temperature falls; a fresh two-listener preflight
must follow. The current model-free release gate still passes all 114 tests, 24
trajectories, and 50 focused cases while keeping deployment, executability, and
funded execution false. Bonsai remains unrun because a user-owned game process
raised the shared RTX 3050 above the 64 C start gate; BitAgent did not terminate
that process or load model weights.

## Independent Bitcoin activation proof gate (2026-08-06)

Decision: **accept the read-only proof implementation and keep funded
execution disabled until a corrected TradeLayer release is deployed and live
evidence passes.**

Passed:

- listener preflight v2 requires one fresh, hash-bound Bitcoin Core proof per
  listener and unique listener/RPC endpoint pairs;
- the observer independently resolves the reported activation height to an
  active block after binding the RPC chain/tip to the listener's non-IBD
  testnet4 backend, fetches the exact transaction with that block hash,
  strictly decodes a canonical TradeLayer tx0 OP_RETURN, normalizes its base36
  code hash to 64-hex, and requires tx11 plus the allowlisted release hash;
- missing, stale, tampered, mismatched, inactive-chain, duplicate-RPC, and
  legacy v1 evidence fail `tx11ChainDerived` closed;
- RPC credentials remain host-private and no proof operation has signing or
  broadcast authority;
- TypeScript compiles cleanly; the complete release preflight passes 121/121
  launch tests, 24/24 trajectories, and 50/50 focused agent cases with all
  eight score dimensions at 1 and zero generated failure traces.

Remaining:

- candidate 9 is still `candidate_not_deployed`; deployment and funded
  execution remain false;
- candidate 9's tx0 encoder converts the 64-hex code hash to base36, but its
  decoder currently returns that base36 field without converting it back to
  64-hex. A corrected, separately reviewed release is required before a real
  activation can satisfy the listener allowlist;
- pair B remains behind pair A's preserved 107,577 checkpoint, and neither
  preserved listener has a real corrected-release activation transaction;
- no approval, signing, activation transaction, broadcast, tlBTC credit,
  trade, PnL settlement, or withdrawal occurred.

## Candidate-10 activation wire-decoder checkpoint (2026-08-06)

Decision: **supersede candidate 9 with candidate 10 for new launch checks;
keep deployment and funded execution disabled.**

Passed:

- TradeLayer commit `fad7f4bb3955559a05ea9b0c82eb7ea34e46aafd`
  converts the canonical tx0 base36 hash field back to exact padded 64-hex,
  rejects invalid characters, non-canonical leading zeroes, values above 256
  bits, extra fields, duplicate transaction types, and types outside 0-35;
- activation validation rejects any decoded code hash that is not canonical
  32-byte lowercase hex before registry mutation;
- 42/42 upstream consensus-focused tests pass, including activation payload,
  provenance, testnet profile, listener attestation, tx11 procedure, tx index,
  replay checkpoint, and empty/offline consensus guardrails;
- the manifest pins exact ordered consensus hash
  `c72b3ce9101743c59c05ee3b115100ec229055e21f9e17851ff694002b2d9e29`
  and the full candidate-10 commit;
- the release runner can reuse the primary checkout's installed dependencies
  for a clean worktree without downloading or copying packages;
- the complete release preflight selects the clean candidate-10 worktree and
  passes 121/121 launch tests, 24/24 trajectories, and 50/50 focused agent
  cases with all eight scores at 1 and zero generated failure traces.

Remaining:

- candidate 10 is `candidate_not_deployed`; deployment, executability, and
  funded execution remain false;
- the preserved listeners still run candidate 9, pair B remains behind pair
  A's 107,577 checkpoint, and no candidate-10 tx0 activation exists;
- synchronized replacement listeners, wallet-visible exact effects, approval,
  signing, broadcast, independent position verification, and withdrawal remain
  to be completed in that order.

## Candidate-10 parallel deployment and parity checkpoint (2026-08-07)

Decision: **accept candidate-10 as the running testnet recovery release, but
keep release promotion, wallet approval, and funded execution disabled.**

Passed:

- immutable candidate-9 state was copied only after explicit parser pause, a
  12-second realtime-loop drain, three identical inventories, exact copy hash
  parity, and verified parser resume;
- candidate-10 commit `fad7f4bb3955559a05ea9b0c82eb7ea34e46aafd`
  now runs as a parallel pair on ports 3131/3132 from separate state roots and
  separate Bitcoin Core backends; candidate-9 remains on 3121/3122 for rollback;
- bounded recovery brought B from 105,001 to 107,604 and A to 107,606 while
  enforcing prune and listener-lag limits and ending with peer networking off;
- the two-block final suffix was relayed from A to B only after proving B's tip
  was on A's active chain. B's own Bitcoin Core accepted both blocks and now
  shares A's exact height 107,606 and best-block hash;
- all four TradeLayer listeners report realtime, error-free height 107,606;
- a fresh candidate-10 preflight passes endpoint/instance independence,
  observation freshness, and the exact release commit;
- TypeScript and the complete release gate pass 125/125 tests, all 24 scripted
  trajectories, and 50/50 focused agent cases.

Remaining:

- both Bitcoin backends are paused and in IBD near 107,606 versus headers near
  147,344, so `synchronizedTestnet4` correctly remains false;
- no real Bitcoin tx0 has activated tx11 with the candidate-10 code hash;
  therefore chain-derived activation, property, template, contract, and
  reserve-redeem gates all remain false;
- the manifest remains `candidate_not_deployed`, with
  `deploymentVerified=false`, `executable=false`, and
  `fundedExecutionAllowed=false`;
- the RTX 3050 reached 83 C under a user-owned game process, above the 64 C
  model start limit. No Bonsai model was loaded and no new model benchmark is
  claimed;
- no approval, PSBT, signature, activation transaction, trade, PnL release, or
  withdrawal was requested or performed.

Activation-wire preflight:

- the pinned candidate-10 encoder produces a 56-byte tx11-only payload and its
  corrected decoder recovers the exact allowlisted 64-hex code hash;
- this proves wire compatibility only. It does not select a UTXO, calculate an
  exact fee, request approval, sign, submit, or prove activation;
- do not use upstream `TxUtils.activationTransaction()` from BitAgent: that
  legacy helper calls `dumpprivkey` and violates the wallet authority boundary;
- the activation path must remain candidate-only until a deterministic host
  simulation displays the exact admin input/change/fee and OP_RETURN, the
  external wallet approves and signs that exact candidate, Bitcoin Core policy
  accepts it, and the independent preflight proves its confirmed txid/block.

Candidate-only activation simulation:

- `TradeLayerActivationCandidateBroker` now provides the deterministic first
  half of that path without using the legacy key-export helper;
- it requires full testnet4 synchronization and exact candidate-10 release
  provenance before it will call wallet funding RPCs;
- it exposes exact effects and an approval hash but no PSBT, private material,
  signing method, or broadcast method, and it releases the selected input on
  any failed validation or explicit cancellation;
- 8/8 focused activation-candidate cases and TypeScript pass;
- the expanded complete release gate passes 133/133 tests, all 24 scripted
  trajectories, and 50/50 focused agent cases;
- neither local Bitcoin node has a loaded or stored wallet, so live simulation
  and the separately reviewed wallet execution half remain blocked on a funded
  wallet rather than being silently mocked.

Activation approval and execution provider:

- `TradeLayerActivationExecutionBroker` now implements the separately gated
  wallet-host half using a private PSBT envelope and the exact public approval
  hash;
- it revalidates before signing and after finalization, requires exact
  `testmempoolaccept` identity/fee evidence before broadcast, releases inputs
  only after definite non-broadcast failure, and retains ambiguous submissions
  for positive-only reconciliation;
- 7/7 focused execution cases pass, for 15/15 combined activation broker cases,
  and the execution provider is not exposed to the language model;
- the expanded complete release gate passes 140/140 tests, all 24 scripted
  trajectories, and 50/50 focused agent cases;
- a durable host-private store and supervised operator CLI now display the
  exact effects, require the exact approval hash, resume after interruption,
  classify input-lock recovery, and keep PSBT bytes off the public surface;
- 7/7 focused operator recovery cases pass in addition to the 15 broker cases;
- the release-aware complete gate passes 155/155 tests, 24/24 scripted
  trajectories, and 50/50 focused agent cases;
- a read-only request generator now binds the public tx11 activation request to
  a fresh exact release-source receipt before any wallet RPC can be reached;
- runtime readiness remains false until full node synchronization, a loaded
  funded wallet, and live positive activation/reconciliation evidence exist.

Candidate11 recovery update:

- pinned source is now TradeLayer commit
  `b3423bf7f72a4e8bfad3fbc61f757505553b9d4c` with ordered consensus hash
  `8f8e83ae0bac5b578087af7c2dd00c63d3ca87952be72e6e70c4a6acdfffd623`;
- a fresh recovery replay proved decoded-block sender/reference processing over
  the exact candidate10 failure boundary at block 132,688 and reached paused
  tip 132,733 with no listener error or forbidden log signature;
- the release-aware gate passes 155/155 and selects only the clean candidate11
  worktree, but deployment, executable release, funded execution, and tx11
  chain activation remain false.

Candidate11 full-tip deployment update:

- candidate11 replay completed at exact current testnet4 height 147,370 with
  IBD false, listener parity, networking paused, zero peers, and no error;
- a one-block stale fork on node A was reconciled by a bounded common-ancestor
  proof plus eight raw-block submissions, ending with both independent nodes
  on best block
  `00000000001abdf426cd87f33fe802ef694cf9a2e1cf376ee500b2e4fe516cd0`;
- fresh listeners on ports 3161/3162 independently start at processed/tracked
  height 147,370 from hash-sealed candidate11 snapshots and exact clean source;
- the release gate passes 157/157 tests, 24/24 scripted trajectories, and
  50/50 focused cases;
- launch remains blocked exactly where intended: candidate11 tx11 is not yet
  chain-activated, the evidence-time nodes were paused, and no funded wallet
  approval, signing, or broadcast has occurred.

Candidate11 activation simulation update:

- the funded wallet node is fully synchronized on testnet4 and the public
  candidate is persisted with one exact 302,443-sat input reserved;
- exact effects are a tx11-only OP_RETURN, 302,085 sats returned to the owned
  P2TR address, and a 358-sat fee under the 2,000-sat cap;
- approval hash is
  `d4349f54db77cf354897c3e1a2ff72a70e7f3a503b2d7618e46e51f16a3da1a3`;
- signing and broadcast are still false. Launch remains blocked on the user's
  explicit approval or cancellation, followed by confirmation and independent
  listener proof.

Expired-approval recovery update:

- the candidate11 request is now expired and may not be approved;
- the public operator status reports the exact expiry and
  `decisionStatus=expired`, while keeping PSBT bytes private;
- an expired approval is rejected before any signing RPC and cannot silently
  roll forward into execution;
- the only safe next transition is explicit cancellation of the exact stale
  hash, followed by a new simulation and a new exact approval hash;
- read-only status inspection has been verified against the persisted live
  record, with signing and broadcast both still false.

Candidate12 reorg-safety update:

- the candidate11 runtime is on a stale testnet4 fork and is not launchable;
- candidate12 commit `8544512bda290f040a112b94f0a4bc6b556101d7`
  fails closed when a fork recovery has no snapshot, and returns typed recovery
  state instead of retrying indefinitely;
- an isolated live probe reproduced the fork and returned
  `REORG_FULL_REPLAY_REQUIRED` with common ancestor 147,362; 14/14 focused
  tests pass and the probe performed no wallet, signing, or broadcast action;
- candidate12 is not yet the selected release. It still requires a clean full
  replay on the current active fork, two-listener parity, release-manifest
  promotion, and a fresh chain activation before any funded execution can be
  considered.

Candidate12 unattended-recovery update:

- the streamed replay is paused at exact Bitcoin/listener height 98,494 with
  peer networking false, zero connections, and no listener error while disk
  reserve is protected;
- the throttle may reuse one sanitized synchronized outbound peer observed by
  an independent loopback Bitcoin node, with target addrman fallback and no
  wallet, signing, broadcast, hardcoded-peer, or endpoint-disclosure surface;
- an exact-parity live smoke receipt proves the new peer-source configuration
  path terminates peer-off;
- a live automatic prune advanced the retained horizon to 95,254 while the
  listener remained healthy, and the controller now fails peer-off below its
  default 750 MiB filesystem reserve;
- a real listener-request timeout failed closed at exact recoverable state, and
  the controller now trims transient peer cardinality to one synchronized
  outbound peer. The release-aware gate passes 171/171;
- those two live recovery failures are represented in a new 126-row v4 adapter
  corpus while the 124-row v3 evidence lane remains hash-sealed;
- a one-peer 50/200 replay drill crossed further prune transitions and failed
  closed on a four-block bounded-target overshoot. Independent verification
  found Bitcoin/listener exact at 111,504, listener error null, peer networking
  false, zero connections, and about 1.04 GiB free. The observed lag briefly
  reached 203, so 200 is an operating trigger and not a hard safety ceiling;
- the overshoot recovery is represented in a 127-row corpus v5 hill-climb lane
  while registered corpus v4 remains byte-sealed. The v5 lane adds one
  propose-only recovery row and still contains no secrets, raw transcripts, or
  approval, signing, broadcast, execution, fabrication, or parameter-mutation
  authority;
- replay and parallel deployment are now complete: candidate12 reached exact
  active-chain height 147,432 on three paused Bitcoin backends, and two new
  listeners on ports 3171/3172 report realtime/error-null parity at exact
  commit `8544512bda290f040a112b94f0a4bc6b556101d7`;
- the bounded live challenge passes independent listeners, freshness,
  synchronized testnet4, and exact release commit. It correctly fails the
  chain-derived code-hash and dependent property/template/contract/reserve
  gates because on-chain tx11 still carries the prior release hash;
- candidate12 activation now requires a fresh explain/simulate/exact-effects
  approval cycle. The selected candidate11 manifest and expired approval input
  lock remain unchanged. Candidate12 release selection, chain activation, and
  the dependent reserve proof remain required;
- the release-aware gate passes 172/172 and continues to select only the clean
  candidate11 worktree. Candidate12 parallel deployment does not silently
  change that selection.

Candidate12 approval-bound activation update (2026-08-08):

- the expired candidate11 request was explicitly cancelled; its input lock was
  released and its receipt proves signing and broadcast were not performed;
- an explicit-manifest source receipt now binds exact clean candidate12 commit
  `8544512bda290f040a112b94f0a4bc6b556101d7` to code hash
  `57b3a04ddbb8f8698e993fdc38419e1685f86505b18812cfda5ca687b7687dfb`
  without replacing the selected candidate11 release;
- the fresh candidate12 simulation spends one 302,443-sat input, returns
  302,085 sats to the same owned address, and charges 358 sats. The tx11-only
  payload and the unsigned transaction are displayed exactly;
- independent source, wire, wallet-lock, chain, and mempool checks pass. The
  public approval view contains no PSBT, signing is false, and broadcast is
  `not_performed`;
- approval hash
  `4320d3a89a39ebf8e3855c88f4097db0a36664d5531ad88c25f06fc9d29338fb`
  is pending until `2026-08-08T15:41:12.077Z`. Launch remains blocked on a
  current exact wallet approval, followed by host signing/broadcast,
  confirmation, resynchronized two-listener proof, and explicit promotion.

Candidate12 activation submission update (2026-08-08):

- the exact approval was received before expiry; host revalidation,
  wallet signing, `testmempoolaccept`, and one broadcast succeeded for txid
  `b5cf09c4757ce0e62ca533c7dff4f830793d9e876506832c464e0597a76cdc5e`;
- independent observation matches the reviewed one-input/two-output vector and
  358-sat fee. The transaction is positively observed and propagated in the
  mempool, with retry prohibited;
- both candidate12 backends and listeners have advanced through exact active
  height 147,535 and remain realtime/error-null with peer networks disabled;
- launch is still not proven: the tx requires positive confirmation, the
  activation block must be relayed and parsed independently by both candidate12
  listeners, all chain-derived candidate12 gates must pass, and promotion must
  remain an explicit operator decision.

Candidate12 confirmed-invalid activation update (2026-08-08):

- the submitted Bitcoin transaction is confirmed in active-chain block 147,537
  and was observed at 24 confirmations; its only irreversible cost is the
  previously approved 358-sat Bitcoin fee;
- two recovered candidate12 listeners independently decoded the exact tx11
  activation hash but rejected the transaction because its P2TR sender is not
  the TradeLayer testnet4 protocol admin address;
- the read-only challenge passed listener independence, freshness,
  synchronized-testnet4, exact-commit, and tx11-active checks, but correctly
  failed candidate12 chain-derived code-hash and every dependent registry and
  reserve gate. Candidate12 remains unpromoted;
- the request and broker layers now require the exact protocol admin address
  before any wallet RPC. Valid non-admin Bitcoin addresses fail closed, and
  focused activation coverage passes 30/30 with TypeScript clean. The full
  launch gate passes 174/174 when explicitly bound to the clean, sealed
  candidate11 worktree and the reviewed TradeLayer dependency tree;
- no retry or replacement is authorized. A future activation requires proof
  that a loaded wallet controls the exact protocol admin address, followed by a
  wholly new explain/simulate/effects/approval cycle and a second independent
  listener proof. Until then, starter-strategy funding remains blocked.

Testnet4 wallet recovery snapshot update (2026-08-09):

- a new sanitized operator command uses only six read-only Bitcoin Core RPCs
  and returns aggregate state with no UTXO addresses, PSBTs, keys, cookies, or
  credentials;
- Bitcoin Core 31.1 reports the wallet synchronized at exact testnet4 height
  147,594 with IBD false, 316,818 confirmed sats, and ownership of the required
  protocol-admin address;
- the protocol-admin address has zero confirmed UTXOs, while seven safe
  non-admin UTXOs total 316,818 sats;
- the wallet has zero locks and the expired funding outpoint is not locked.
  The old durable record still requires exact cancellation before a fresh
  admin-funding simulation; no signing or broadcast was performed.

Hermes/Bonsai launch-server integration update (2026-08-09):

- the launch server now emits state- and plan-bound DAG task packets for all
  three supported intents and deterministically validates Bonsai/Hermes model
  candidates;
- stale tasks, fabricated evidence, illegal transitions, unknown tools, secret
  requests, and model authority escalation fail closed;
- the endpoint is candidate-only and cannot authorize, sign, execute, or
  broadcast. Existing wallet approval and host-broker boundaries are unchanged;
- focused DAG plus HTTP coverage passes 12/12, TypeScript is clean, and the full
  release-aware launch gate passes 189/189 against the exact tracked-clean
  candidate11 source while keeping the release non-executable;
- local RTX 3050 screening is still pending because an unrelated workload owns
  the GPU and exceeds the frozen thermal/VRAM start gates. This is a benchmark
  blocker, not authority to stop that workload or relax the gates.
- `/api/dag-runtime` now gives the UI and operator a hash-frozen readiness view.
  It truthfully reports the accepted packaged adapter but keeps
  `modelAvailable=false` until every GPU, sidecar, safety, and explicit operator
  gate is recorded; tampered artifact or authority metadata fails closed.
- rejected DAG proposals are now captured as sanitized JSONL failure traces for
  later adapter hill-climbing. Messages and malformed extra fields are omitted,
  traces have no effects or optimizer eligibility, and trace-write failure
  fails closed.
- an owned, shell-free Hermes Lite stdio provider now accepts only public
  state-bound task packets after runtime promotion. It is limited to three
  read-only tool rounds and six calls, verifies hash-bound responses, and is
  rejected by BitAgent's deterministic LDT if it proposes an illegal
  transition, invisible evidence, or authority/effect escalation;
- the launch UI calls `/dag-propose` only when `modelAvailable=true` and uses
  the deterministic planner on provider outage. The checked-in runtime remains
  false, so current launches do not start the sidecar or load the model;
- Hermes Lite sidecar and backend guardrail coverage passes 16/16. The frozen
  integration now binds exact Hermes commit
  `395d634c9505dc435221eee1223aa32cb1c19cc9` and sidecar config
  `configs/bitagent_dag_model_sidecar_v1.json`.

Deterministic runtime-promotion gate (2026-08-09):

- Hermes 1,409-test verification passes and its frozen artifact, registration,
  sampling, authority, and resource gates pass. Exclusive RTX 3050 smoke and
  screening receipts are still absent, so Hermes remains unpromoted;
- BitAgent now requires an exact Hermes apply receipt, a live sidecar receipt
  for all three supported intents, zero unsafe model behavior, and a second
  exact operator approval hash before exposing the model;
- focused BitAgent runtime-promotion, DAG, and HTTP tests pass 15/15, and
  TypeScript is clean. The release-aware gate passes 192/192 against exact,
  tracked-clean candidate11 source while keeping the release non-executable.
  The current checked-in runtime is unavailable and no financial or chain
  effect was performed;
- remaining defect: the foreign GPU workload still prevents the exclusive,
  cool-start smoke/screening evidence needed to begin live sidecar validation.
- final read-only testnet4 evidence: height 147,604, IBD false, 316,818
  confirmed sats, zero unconfirmed sats, zero locks, seven safe non-admin
  UTXOs, and zero protocol-admin UTXOs; no secrets, signing, or broadcast were
  involved. The GPU remained at 88 C with 206 MiB free VRAM and 99% foreign
  utilization, so no Bonsai load was attempted.

Prime adapter evidence and launch-preflight correction (2026-08-09):

- the Prime Intellect `moralitylab/bitagent-dag-ops-v2@0.3.1` Bonsai 8B LoRA
  run is a real accepted adapter candidate, not an untrained placeholder. Its
  independent confirmation lane records 32/32 exact adapter wins, 1,152/1,152
  deterministic authority checks, zero hard-fail selections, and zero
  post-confirmation optimizer steps;
- the sealed release-gate audit supports only the declared candidate/read-only
  DAG claim. It assigns grade A and `accept`, while retaining the medium,
  non-blocking warning that 32 independent items is below the preferred 50;
- the earlier Prime 4B pilot remains exploratory and not promoted. Its mixed
  development policy is useful training-signal evidence but is not substituted
  for the independent Bonsai confirmation lane;
- launch preflight now reads and validates the tracked DAG runtime manifest.
  It records the accepted registration
  `ee2fa077968e6313aa4ddc96751a38eb0cd43e0e5b32a25e3f191ad16ab81f8c`,
  exact Hermes commit `395d634c9505dc435221eee1223aa32cb1c19cc9`, runtime status,
  and `modelAvailable` state instead of reporting the stale
  `adapter_artifacts_not_trained` blocker;
- the regenerated release receipt passes 192/192 tests, 24/24 scripted
  trajectories, and 50/50 focused agent cases with all score dimensions at
  1.0 and zero failure traces. It reports `scriptedLaunchReady=true` and
  `fundedExecutionAllowed=false`;
- the exact funded blockers are now: adapter runtime not promoted, tx11 not
  deployed, independent TradeLayer listener parity not verified, funded
  fill/PnL-release/withdrawal not verified, and a missing fresh exact wallet
  approval. The local GPU remained ineligible at 88 C, 206 MiB free VRAM, and
  95% utilization by a foreign process, so no model load was attempted.

Current Hermes runtime binding (2026-08-09):

- the frozen BitAgent runtime now pins tracked-clean Hermes commit
  `7254c67f2e389cfac1e9c80477071aade5fe1008`, which contains the reviewed
  segmented live-evaluator fix and the design-only 56-case post-v1 confirmation
  lane;
- the accepted primary registration and base/adapter hashes are unchanged;
- no v2 inference result is claimed, and runtime promotion remains blocked on
  exclusive RTX 3050 smoke and screening, followed by live three-intent sidecar
  validation and exact operator approval;
- `operatorReady=false`, `modelAvailable=false`, and funded execution remains
  disabled.
- validation passes TypeScript, 14 focused tests, the complete 192/192 release
  gate, 24/24 scripted trajectories, and 50/50 agent cases;
- the RTX 3050 remains ineligible at 88 C, 206 MiB free VRAM, and 99%
  utilization under a foreign process, so no Bonsai process was started.

Referral UI and intent-isolation correction (2026-08-09):

- browser verification covers referral entry, wallet creation, deterministic
  UTXO deposit, natural-language strategy planning, exact simulation display,
  pending-approval refresh recovery, rejection recovery, and malformed-address
  handling without any wallet or chain effect;
- malformed address-like input now produces an explicit invalid-address error
  and no simulation instead of looking like an omitted parameter;
- pending approval and submitted-action states cannot be replaced by a new
  intent. Rejected/cancelled simulations may be left paused, but their approval
  controls are hidden after a legitimate intent switch;
- the release-aware gate passes 193/193 tests and the expanded agent suite
  passes 51/51 with all score dimensions at 1.0. The decision remains
  `scriptedLaunchReady=true` and `fundedExecutionAllowed=false`.

Exclusive Bonsai runtime-screening evidence (2026-08-09):

- Hermes commit `c12ddd46fb42e33c97f748957eed073349ecb773` freezes an accepted exclusive smoke plus six
  complete screening cells for the exact Bonsai 8B base and Prime v3 LoRA
  hashes already bound by BitAgent;
- all six screen cells produced exact, candidate-only DAG outputs with reward
  1.0 and no authority, schema, source, secret, fabrication, provider, or
  truncation failure. The run did not consume optimizer or held-out data;
- the reviewed RTX 3050 profile stayed inside its frozen resource envelope and
  cleaned up all owned model processes. This establishes local runtime
  compatibility and safety only; it does not expand the 32-case efficacy claim
  or establish profitability, wallet execution, or chain execution;
- the deterministic Hermes assessment now awaits exact operator hash
  `bf874bfa6c5143c691906c4195a6f99e2b4ff8a030c1bf38283136b81b7bf423`.
  It has not been applied. Live three-intent sidecar validation and the second
  BitAgent promotion gate therefore remain pending, and
  `fundedExecutionAllowed=false`.


Release-bound onboarding MVP audit (2026-08-09):

- `npm run demo:onboard` now resolves the exact clean candidate11 source and
  its reviewed dependency tree automatically; a scripted ETH-to-BTC preview
  completed through normalized UTXO receipt, UTXORef V2 funding root, tx11
  build-only payload, wallet activity feed, and typed DLC stub;
- `npm run build` and TypeScript validation pass;
- the release-aware launch and preflight gates pass 194/194 tests, including
  24/24 scripted trajectories; the focused agent harness passes 51/51 with all
  score dimensions at 1.0 and zero failure traces;
- referral and compliance suites additionally pass 38/38 and 18/18;
- scripted launch is ready. Funded execution is not launch-ready: candidate11
  remains `candidate_not_deployed`, independent listener/deployment evidence is
  absent, and the wallet-owned reserve/withdraw approval code is not
  deployment-enabled. The wallet still has no TradeLayer starter-order
  execution provider, while the live intake/DLC seams remain provisional. No
  test or demo moved funds, signed, submitted, or broadcast a transaction.
