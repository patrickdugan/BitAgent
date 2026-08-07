# Integration Log

## Committed Signal Execution Receipt (2026-07-26)

- Inspected both candidate algorithm locations. `C:\projects\trading-algos`
  contains only an empty `index.json`; `C:\projects\Trading Algos` contains
  the substantive source but is not a Git repository.
- Added a deterministic source-tree commitment mode so an operator can pin
  the latter without trusting a self-declared signal hash. The current
  14-file digest is
  `42546a6e14e9309b248bae6a80ac60206a9d5301060932976a5c3906a0ce6fad`.
- Added `src/signals/` with strict signal validation, Ed25519 producer
  authentication, exact codebase verification, wallet snapshot fingerprints, bounded risk checks,
  deterministic confirmed-UTXO selection, UTXO-Ref V2 funding roots, real
  TradeLayer tx5 encoding, atomic workflow persistence, typed tools, opaque
  approval, idempotent execution, and order/position verification.
- The supported action is deliberately narrow: a post-only TLBTC/TLUSD limit
  order. The algorithm may propose buy/sell, amount, and price only within the
  operator policy. It never receives wallet or exchange signing authority.
- Added `hash:signal-codebase`, `demo:signals`, and `test:signals`.
- Added 26 committed-signal cases covering the complete flow, buy/sell
  encoding, codebase mismatch/mutation, signal tampering/expiry, strategy
  mismatch, secret fields, insufficient balances, risk caps, unconfirmed
  UTXOs, missing/cancelled/rejected approval, wallet/fee drift, duplicate
  execution, pending verification, file-store recovery, UTXO reservation
  conflicts, forged/unapproved producers, state tampering, and failed
  verification.
- All 26 committed-signal cases pass. The existing launch kernel remains
  separate and unchanged in scope.
- Unresolved: the local TradeLayer wallet still lacks a production-safe,
  authenticated opaque approval/sign/broadcast/order-verification broker.
  `BITAGENT_PRODUCTION=true` therefore uses the unavailable broker and cannot
  move funds.

## Launch Kernel Implementation Receipt (2026-07-23)

- Added `src/launch/` with the constrained intent parser, deterministic tool
  registry, UTXO-Ref mapping, TradeLayer type-5 simulator, wallet broker
  boundary, persistent workflow state machine, conversation planner, and HTTP
  launch surface.
- Added a referral-first browser experience under `launch-ui/` and a D1-backed
  hosted implementation under `web/`.
- Added 24 end-to-end trajectories, 50 focused agent cases, HTTP and hosted
  Worker tests, machine-readable scoring, and sanitized failure traces.
- The latest deterministic run passes all launch tests and all eight evaluation
  dimensions with a score of `1.0`.
- Production mode remains deliberately unavailable: the host selects
  `UnavailableWalletBroker` unless a real wallet-owned execution broker is
  supplied. This closes the unsafe WIF/internal-signing seams found during repo
  mapping.
- Generated social preview asset:
  `web/public/og.png`, created with the built-in image generation workflow from
  the same acid-green, orange, near-black editorial direction as the hosted UI.
- Deployed owner-only Sites version 2 from commit
  `a9b90227a86608c967ab8e32a492e0e2051627f2` at
  `https://bitagent-launch-kernel.duganist875063.chatgpt.site`.
- The production smoke completed referral capture, deposit, strategy approval,
  execution, verification, withdrawal approval, withdrawal verification, and
  durable D1 resume. The post-deploy Worker error query returned no events.
- Remaining production blockers and operator exit criteria are recorded in
  `docs/launch-readiness.md`.

## Launch Kernel Decisions (2026-07-23)

- Scope is frozen to three intents:
  `deposit_bitcoin`, `starter_strategy`, and `withdraw_bitcoin`.
- The starter strategy is one post-only tlBTC-for-tlUSD type-5 limit order.
  There is no autonomous parameter selection; amount and limit price must be
  present in the user's request or collected explicitly.
- The language-model boundary ends at typed deterministic tools. It can plan,
  explain, and call tools, but cannot read keys, sign, mint state, or mark a
  transaction verified without a provider result.
- Every mutation is modeled as
  `explain -> simulate -> display effects and fees -> request approval ->
  execute -> verify`.
- Simulations have an immutable hash and expiry. Approvals bind the workflow,
  action, simulation hash, exact effects, fees, and expiry.
- A cancellation or rejected signature clears only the active approval and
  preserves the simulation and recovery instructions.
- An interrupted workflow resumes from persisted state. Re-execution is
  idempotent by action id; duplicate calls return the recorded execution.
- Referral attribution remains `pending` until the starter strategy has a
  verified successful result. Deposit and wallet connection alone do not
  activate attribution.
- The browser launch surface may display only public wallet metadata. Seed
  phrases, mnemonics, WIFs, private keys, and raw signing secrets are prohibited
  tool arguments and are redacted from failure traces.
- Production execution is fail-closed until a wallet-owned broker can issue
  and consume opaque approval tokens. The scripted broker is evaluation/demo
  infrastructure and never claims to broadcast a real transaction.

## Launch Kernel Unresolved Seams

- The local TradeLayer wallet creates/restores keys from mnemonic material in
  its frontend/server path. A production BitAgent connection needs a public
  wallet-session API that returns addresses/capabilities without exposing that
  material.
- `tradelayer.js#tokenTradeTransaction` signs internally via
  `dumpprivkey`; it is a protocol precedent, not an acceptable BitAgent
  execution boundary.
- The production wallet broker still needs:
  fee estimation, PSBT construction, human approval, signature rejection
  reporting, broadcast, order lookup, UTXO lookup, and transaction confirmation
  lookup as authenticated opaque-session operations.
- Bitcoin mainnet property IDs, supported tlBTC/tlUSD market configuration,
  minimum order size, and final fee policy must come from a live operator
  configuration before production enablement.
- The hosted D1 store and the local atomic JSON store share a state model, but
  cross-device wallet identity/session recovery still requires the external
  wallet.

## Assumptions

- `C:\projects\UTXORef\UTXO-Ref\bitvm3\utxo_referee\index.js#v2.settlement.buildFundingSetV2` is the current safe source of truth for deterministic funding-outpoint mapping.
- `C:\projects\tradelayer.js\src\txUtils.js#createGrantManagedTokenTransaction` is the closest existing local intake builder for a vertical slice from inbound collateral to wallet-visible receipt state.
- There is no local `tlweb` checkout, so Phantom/TLWeb integration must be emitted as a local browser-oriented intent payload in this sprint.
- `C:\projects\Ark-TradeLayer\tl-vtxo-handshake-optimized\ark-tradelayer-handshake.js` is the narrowest DLC/VTXO follow-on seam worth preserving.
- IronClaw Reborn's `default deny -> exact grant/lease -> dispatch -> consume` model is the authority pattern for financial capabilities.
- Hermes skills remain declarative procedural memory; a skill never receives signing authority merely because it is local or trusted.
- "Totally decentralized" is treated as a recovery and trust-minimization target, not a literal property. Each non-Bitcoin rail has an explicit cap, dependency, and exit path.
- Harness adaptation changes typed configuration candidates, never model-owned authority. A candidate is promotable only after the complete benchmark suite reports zero unsafe authorizations and improves the baseline score.
- Self-model continuity belongs to host-owned structured state. Model-proposed memories, goals, skills, and policy changes are evidence inputs only.
- AIRIS and DAS are integration shapes in this sprint: causal surprise rows and content-addressed atom events. They are not represented as production-complete AIRIS learning or a deployed distributed AtomSpace.
- NEAR Chain Signatures are an optional external signing backend. Preparing a request is not authorization, signing, broadcasting, or proof that the MPC network accepted it.
- TradeLayer testnet mock trading reuses `broadcastBtctestVwapTrades.js --dry-run`; its generated plans are real local protocol artifacts, while unset txids make the lack of settlement explicit.
- Economic viability is reported as a projection with a coverage ratio. Only independently observed transaction settlement can move profit into spendable treasury.
- Filecoin Calibration and Akash are infrastructure markets behind separate storage/compute intents and capability leases. Neither provider receives a private key from the agent process.
- A TradeLayer tx5 pair is matched only when the actual maker/taker OP_RETURN payloads decode through the sibling `txDecoder.js` into reciprocal property and amount fields. Artifact labels alone are insufficient evidence.
- Bitcoin Core wallet signing is isolated behind a two-phase PSBT broker. Preparation produces an approval hash; signing requires that exact hash plus the configured policy fingerprint in a separate process.
- Treasury accounting is append-only double entry. Projected revenue enters `unrealized`; only settlement evidence can move it to `settled`, and only an explicit release can move it to `available`.

## Resolved

- 2026-08-01 multichain wallet authority now has two explicit browser
  providers: Phantom first and MetaMask second. Phantom uses the official
  injected Browser SDK for Ethereum and Solana; MetaMask uses one CAIP-25
  multichain session. Only public Sepolia/devnet account metadata is persisted.
- `chainsig.js` now has narrow TradeLayer-side adapters for Ethereum and
  Solana in addition to Bitcoin. Local deterministic preparation produced a
  valid EIP-1559 Sepolia envelope and a serialized Solana devnet native-transfer
  envelope, both tied to NEAR testnet derivation paths, exact fees, expiry, and
  simulation hashes. No signature or broadcast was requested.
- The local Bitcoin testnet4 broker was exercised again on 2026-08-01. It
  prepared a fresh unsigned tx5 PSBT against a confirmed taproot UTXO and
  reported a 296 sat fee. The result stopped at `awaiting_wallet_approval`;
  signing and broadcasting remained false.
- The browser dependency pass upgraded Next.js to the current 16.2.12 release
  and pins patched Axios 1.19.0 and ws 8.21.1 overrides. This reduced the new
  wallet surface's production audit from 11 high findings to 3; no critical
  advisory remains.

- 2026-07-29 local Bitcoin testnet4 preflight found an existing synchronized
  `utxoref-testnet` descriptor wallet with confirmed test funds. The live CLI
  broker and receipt observer now accept explicit `BTCTEST_RPC_CONNECT` and
  `BTCTEST_RPC_PORT` values so non-default local RPC bindings do not silently
  fall back to the Bitcoin Core default.
- Repo discovery required searching outside the immediate parent directory because the expected sibling repos are located under different root folders in `C:\projects`.
- The starter repo already has fresh-quote/fresh-inbound THORChain helpers, so those are reused directly instead of rewritten.
- `tradelayer-wallet` exposes PSBT build/sign routes and a BitVM status/watchtower service. The status service is reusable; raw-WIF signing routes are outside the agent trust boundary.
- The TradeLayer sibling repo already has a validated BTC testnet4 VWAP trade-plan generator, so the starter wraps it instead of duplicating protocol encoding.
- The cross-chain default is now NEAR Intents. The official 1Click SDK is the
  swap quote/status boundary and `chainsig.js` is the native account/signature
  boundary. These are separate responsibilities.
- The official live token endpoint and a dry-run Base USDC to native BTC quote
  were exercised on 2026-07-23. No hardcoded solver, vault, token address, or
  quote was added.
- NEAR deposit state is durable and approval-safe:
  `quoteHash -> approval -> origin deposit tx -> provider status`. Preview and
  stale quotes fail closed; rejected approvals remain resumable; `REFUNDED`
  never becomes `completed`.

## Bonsai 8B / Hermes Lite Role-Adapter Seam — 2026-07-26

- Added `scripts/export-bonsai-role-data.ts` and `npm run export:bonsai-data`.
  It exports only the checked-in agent cases, typed tool schemas, and sanitized
  launch/committed-signal failure traces. Raw chat sessions are excluded.
- The current deterministic seed corpus has 83 examples:
  50 intent-planner, 10 UTXO/TradeLayer specialist, 11 approval-risk guard,
  and 12 recovery-operator rows. Each role has isolated train, validation, and
  test examples.
- Every model row is candidate-only. No role is allowed to request approval,
  resolve approval, execute, sign, broadcast, read a private key, or invent
  wallet/chain state.
- Hermes Lite owns deterministic role routing and 12k context management:
  5k target, 6k working maximum, 6k summary lane, and at most one matching
  failure replay. The model cannot select its own financial role.
- The QLoRA training base is pinned to
  `prism-ml/Bonsai-8B-unpacked@376f381570d6115bc03f82adcfa4af0c7672ae54`.
  The low-end Q1 runtime is pinned separately to
  `prism-ml/Bonsai-8B-gguf@48516770dd04643643e9f9019a2a349cf26c5dbd`.
- Actual 8B weight loading has not started. The local RTX 3050 Laptop GPU has
  4 GB VRAM and remains an inference/smoke target. The capped trainer requires
  explicit operator resource caps, checkpoint interval, chunk strategy, and
  model-download/path authorization.
- Promotion requires at least 200 independently reviewed examples per role,
  zero unauthorized effects/secret requests/fabricated state, all BitAgent
  critical tests, and an empirical PEFT-to-GGUF compatibility test against the
  pinned Q1 base.

## Unresolved

- The browser connector is not yet a live NEAR 1Click deposit builder. A
  trusted host still needs to turn the current quote's asset/deposit fields
  into an independently simulated native or token transfer before the typed
  Phantom/MetaMask execution methods may run.
- Phantom and MetaMask extension prompts cannot be automated in headless tests.
  Local tests cover emitted browser bundles, CAIP session persistence,
  secret-field rejection, exact-plan hashing, and provider/account mismatch;
  extension interaction remains a manual localhost test.
- The current npm registry audit still reports three high findings through the
  latest Next.js 16.2.12 (`next`, bundled `postcss`, and `sharp`) with no safe
  current-version fix, plus moderate no-fix findings in the official wallet and
  Solana dependency trees. This is a production deployment blocker even though
  the local testnet build and tests pass.

- `tradelayer.js` does not currently expose a dedicated inbound absorb transaction builder; tx11 grant-managed is a provisional bridge seam.
- The tx11 build-only adapter currently emits payload bytes, not a fully funded/signed TradeLayer transaction. Its `tlTxHex` name is provisional.
- Live THORChain egress detection still needs either a chain indexer or a vetted THORChain tx-status lookup path.
- `Ark-TradeLayer` contains placeholder taproot math and should not be treated as production-complete validation.
- No external policy/signing broker currently reconstructs and validates agent-proposed PSBTs.
- The wallet's current WIF-based signing endpoint is not appropriate for autonomous-agent custody.
- IronClaw Reborn is ahead of the latest tagged serving path and remains default-off; its contracts are design input, not a claim that every control is production-complete.
- Ark VTXOs have expiry/refresh liveness requirements and OOR payments add server-plus-sender non-collusion assumptions.
- Fedimint is threshold community custody, not self-custody; DLCs add oracle and refund-liveness risk; Lightning requires durable channel-monitor state and an on-chain fee reserve.
- The local Bitcoin testnet4 node and funded wallet are available, but a live
  TradeLayer transaction still requires a fresh exact PSBT simulation and
  explicit approval before the wallet broker may sign or broadcast. Akash,
  Filecoin, and NEAR live credentials remain unavailable.
- No production 1Click JWT or live quote-to-origin-transaction simulator is
  configured. Live executable NEAR deposits therefore remain fail-closed even
  when a public origin-wallet session is connected.
- `chainsig.js@1.1.16` works as a runtime package, but its public declarations
  pull unrelated chain types with strict-check failures. BitAgent isolates it
  behind a narrow local runtime interface rather than enabling project-wide
  `skipLibCheck`.
- The production dependency audit has no critical finding but reports three
  high transitive transport advisories (`axios`, `form-data`, and `ws`) through
  the official SDK dependency trees. This is a funded-release blocker, not a
  reason to bypass the typed adapter with home-grown signing code.
- The published Akash TypeScript SDK is currently `1.0.0-alpha.0`, declares Node `>=22.14.0`, and introduced deprecated cryptography warnings when trial-installed under the root Node 20 runtime. It is isolated as an uninstalled broker package pending a dedicated audit.
- A dry-run TradeLayer plan cannot establish fills, fees, rebates, or realized PnL. The demo's spread capture and provider costs are explicit scenario assumptions.
- Filecoin direct deals still require valid CAR/CommP data and a selected storage provider. Akash deployments still require bid selection, lease creation, and provider manifest delivery.
- The local Bitcoin testnet4 wallet is funded and catching up from its last
  processed block. TradeLayer activation state, token balances, and exact
  matching behavior remain unknown until a live approved tx5 is confirmed and
  independently decoded.

## Stubs Added In This Sprint

- `egress_not_found` path can be bypassed in demo mode by providing observed destination tx details explicitly.
- TradeLayer absorb submission falls back to payload build-only mode when wallet/RPC credentials are missing.
- The older Phantom/TLWeb intent remains a compatibility payload. New browser
  authority uses official Phantom and MetaMask libraries behind typed
  Ethereum/Solana plans; neither path grants the model generic wallet RPC.
- Financial survival output is a deterministic unsigned `SpendIntent` and `PolicyDecision`; signature and broadcast remain explicit external capabilities.
- Sovereign harness capability leases are process-local, one-shot test/demo records. Durable lease storage and transactional claim/consume belong in an IronClaw-style host service.
- The MeTTa snapshot and DAS-compatible atom events are export formats for the vertical slice; live MeTTa inference and remote DAS persistence remain adapters.
- Filecoin storage requests and Akash deployment orders are typed preparations. Submission adapters are deliberately absent until a capability broker can verify and sign exact provider transactions.

## Strategy Covenant candidate lane - 2026-08-05

### Resolved

- Added a strict `bitagent_strategy_covenant_v1` contract binding the public
  wallet account, tlUSD capital cap, channel allowlist, four weighted strategy
  modules, adapter hashes, action classes, risk limits, oracle/counterparty
  policies, runtime hashes, activation, expiry, and canonical covenant hash.
- Wallet approval of the covenant is a separate typed object. It activates the
  policy only; it does not pre-approve a future order.
- Added deterministic weighted-target allocation, integer-satoshi conversion,
  drift handling, capital/order caps, net-delta projection, and leverage,
  daily-loss, and drawdown circuit breakers.
- Every non-hold output includes an exact manifest and stops at
  `nextAuthority: wallet_user`. Every candidate and decision receipt records
  `effect: none`, `signingPerformed: false`, and `broadcastPerformed: false`.
- Added a verifier that recomputes the candidate from the exact covenant,
  approval, proposal set, market root, portfolio root, fee, and timestamp.
- Added content-addressed local replay receipts. Existing corrupt evidence is
  rejected and never overwritten.
- Added an unsigned bridge draft into the existing committed-signal schema.
  The draft binds the covenant, proposal, market, portfolio, candidate, and
  verifier-attestation hashes, then stops at the approved signal producer.
- Added 38 focused/adversarial cases. TypeScript and the complete focused suite
  pass.
- Repaired the existing offline chain-signature test timeout. The adapters now
  accept an optional host-constructor public-account resolver, validate its
  returned address, and otherwise retain the normal SDK derivation path. Tests
  use known public derived accounts while `chainsig.js` still constructs the
  EVM/Solana transactions; the 12-case suite fell from a stale failure after
  about 95 seconds to a pass in about 5.8 seconds.
- Added a frozen local benchmark manifest and four paths. At 250 measured plus
  50 warm-up iterations per mode, local p99 total times were approximately
  1.625 ms direct, 3.773 ms single verifier, 4.319 ms three-pass verification,
  and 3.974 ms hybrid local audit. These are local-process directional values,
  not execution latency.
- Added the Nigeria-first Operator Beta runbook with separate retail and maker
  programs, testnet missions, compensation rules, hard safety gates, legal
  workstreams, and a Philippines second-cohort gate.
- Added 14 sanitized covenant failure traces and a deterministic evaluation
  report. All eight candidate-only safety dimensions score 1.0 with no LLM
  judge. The Bonsai/Hermes seed export now contains 97 examples: 50 intent, 10
  UTXO/TradeLayer specialist, 25 risk/approval guard, and 12 recovery rows.
  Raw transcripts and secret values remain excluded. The covenant trace source
  hash is `9e6ac260423f0c78a08fb8b27ba2643d89298d8b904bb5ef5f46ac9fcd4d53ec`.

### Unresolved

- The covenant demo uses a scripted opaque wallet approval. No production
  wallet session cryptographically verifies covenant activation.
- No live TradeLayer market/oracle/channel source feeds the allocator.
- The committed-signal bridge is unsigned and its allocator codebase/producer
  is not in a production allowlist.
- There is no channel-key signer, TEE attestation, one-shot capability lease,
  counterparty cosign, fill observer, or settlement path for covenant orders.
- The three sharded verifier passes use one implementation and do not provide
  independent compromise resistance.
- T6 signature, T7 counterparty, and T8 TradeLayer update latency are
  unmeasured.
- The claimed August 27-29 Web3Lagos 2026 schedule could not be confirmed from
  an accessible official organizer source and must not be advertised as
  confirmed until the community lead obtains written verification.

## Read-only TradeLayer Covenant shadow feeder - 2026-08-05

### Resolved

- Inspected the live local listener, orderbook, tally, wallet cache, oracle,
  and sync implementations before selecting endpoints.
- Added a fixed-method HTTP source that performs six read-only calls and
  brackets the observation with sync-before/sync-after heights.
- Normalizes tlBTC/tlUSD prices from offered/expected token quantities rather
  than trusting the side-dependent raw price field.
- Added per-response hashes, one capture root, a compact feed root, and a
  non-overwriting content-addressed capture store.
- Requires a separate risk checkpoint for loss, drawdown, leverage, delta, and
  nonce, bound to the observed balance root, height, wallet, and channel.
- Added 28 integration/adversarial cases and 14 sanitized failure traces. The
  combined covenant suite is 66/66.
- Regenerated the Bonsai/Hermes seed corpus at 111 candidate-only rows: 50
  intent, 10 UTXO/TradeLayer specialist, 39 risk/approval guard, and 12
  recovery examples. The shadow trace source hash is
  `99849f916551b3743d99d8baeb5b6357c05f9bb17504c666fefe90ee113aa934`.
- Added `npm run observe:covenant-shadow`; it displays no raw source payloads
  and has no signing or broadcast method.

### Unresolved

- The risk checkpoint is hashed but not signed or attested.
- `tl_getAllBalancesForAddress` is address-wide; this adapter cannot
  independently prove that its balance belongs only to the declared channel.
- A synchronized listener, allocated public testnet4 RPC provider, configured
  properties/oracle, and current risk checkpoint were not running together in
  this workspace. HTTP behavior is verifier-tested with deterministic
  responses, but no live capture is claimed.
- No second market observer, channel signer, counterparty cosign, fill, or
  settlement authority is introduced.

## Production tool-contract export and Hermes typed control — 2026-08-06

### Resolved

- The Bonsai corpus exporter now derives a closed tool-contract bundle from
  the production launch and committed-signal schemas instead of maintaining a
  hand-copied evaluator schema.
- The bundle contains 18 source-bound contracts. Nine effect-free tools are
  model-callable; all nine effect-bearing approval/execution/host-state tools
  are explicitly non-model-callable.
- The corpus manifest binds the emitted file hash
  `ac3cb1d4d8c943a4157e5cf3104db335d6624904adfa60e74b46827fcd3f3876`
  and canonical bundle hash
  `fb69b3e586f7ffa22e941978b960a57ce0d7f1766f97787f5c9a652207d38ab3`.
- A parity test fails if the exported argument schema drifts from production or
  an effectful contract becomes model-callable.
- Hermes Lite now uses the bundle for a host-owned LDT and deterministic
  argument projection from named workflow-state sources. Its frozen Bonsai
  confirmation produced 30/30 exact host-projected candidates with zero hard
  failures. The independent audit classifies improvement over the 29/30
  model-filled baseline as directional because only one pair was decisive.
- Current regressions pass: 24 launch trajectories, at least 50 focused agent
  cases, 26 committed-signal cases, 10 deterministic live-testnet cases, the
  contract parity test, and TypeScript compilation.

### Unresolved

- The comparative model claim needs a fresh independent challenge set; the
  current held-out result is not statistically decisive and its one failure
  remains excluded from optimization.
- No local `bitcoin-cli` or running `bitcoind` was present, so the funded
  testnet4 PSBT preflight could not run. The simulated settlement demo records
  `fundedTestnetWallet=false` and `signedTradeLayerTransactions=false`.
- Candidate exactness does not validate wallet ownership, signing, broadcast,
  TradeLayer fills, PnL, or funded launch readiness.

## Local Bitcoin testnet4 unsigned approval drill — 2026-08-06

### Resolved

- Installed Bitcoin Core 31.1 under the ignored local runtime from the official
  Windows archive. Its SHA-256 matched the published checksum and the three
  used executables passed Windows Authenticode validation.
- Reused the existing `D:\BitcoinTestnet` data directory without copying or
  reading wallet backup material. The localhost-only node reached testnet4
  height 147173 with matching headers, `initialblockdownload=false`, and six
  peers or more during the drill.
- The loaded descriptor wallet exposed seven confirmed safe spendable UTXOs.
  A single candidate-only TradeLayer tx5 PSBT simulation selected one input,
  bound the UTXORef v2 funding root, displayed one exact OP_RETURN, one
  wallet-owned change output, and a 296-sat fee.
- The user-approval path stopped at `awaiting_wallet_approval`. No PSBT was
  processed or finalized and no raw transaction was broadcast.
- Added an integrity-checked, idempotent cancellation receipt and exact-input
  unlock command. It works after request expiry, verifies the selected outpoint
  is absent from `listlockunspent`, and records signing/broadcast as false.
- Preparation now releases already-reserved inputs if a later validation or
  aggregate fee-cap check fails. Focused live/broker tests pass 13/13 and
  TypeScript compilation passes.

### Unresolved

- This was deliberately an unsigned local test. It does not prove wallet
  approval UX, signature rejection from a real wallet UI, mempool acceptance,
  broadcast, TradeLayer indexing, a fill, position verification, PnL, or
  withdrawal.
- The local wallet has private-key capability, so any future signing drill must
  use an explicit operator-held approval hash and the submit opt-in. The model
  remains unable to call either signing or broadcast tools.
- A synchronized TradeLayer listener, funded protocol balances, and independent
  position/PnL verifier still need to be exercised together before funded
  launch readiness can be claimed.

## Browser referral and approval-recovery drill — 2026-08-06

### Resolved

- Exercised the actual local launch UI from a starter-strategy referral through
  wallet connect, confirmed demo UTXO/UTXORef, exact strategy simulation,
  rejection, refresh, retry approval, execution, verification, referral
  activation, withdrawal simulation, and verified withdrawal.
- Repaired rejected/cancelled approvals so the saved simulation renders an
  explicit `No transaction was executed` recovery message and an approval
  retry button.
- Tool-route errors now include the latest persisted public workflow state.
  This lets a broker-thrown wallet rejection update the browser immediately
  instead of leaving a stale pending prompt.
- Same-referral refresh now resumes the stored workflow. The storage binding
  includes referrer, campaign, intended workflow, and strategy so a different
  referral starts a separate workflow.
- Added an HTTP regression that forces the scripted wallet broker to reject
  authorization and proves there is no execution object. Launch tests pass
  28/28 and TypeScript compilation passes.

### Unresolved

- This is scripted browser and broker evidence, not a production-wallet UI
  signature rejection or a broadcast/fill/withdrawal proof.
- Browser storage is a demo resume mechanism and is not authentication or
  workflow ownership. Production APIs still require an authenticated owner
  binding for every workflow read and mutation.

## Exact TradeLayer balance/PnL evidence — 2026-08-06

### Resolved

- Replaced `Number`-based tlBTC/tlUSD valuation with exact decimal-to-integer
  conversion at eight-decimal protocol precision.
- Added canonical, hash-bound balance snapshots with deterministic property
  ordering and duplicate-property rejection.
- PnL evidence now embeds and re-verifies the before/after snapshots, enforces
  same address/source and monotonic observation time, identifies the external
  valuation source, and independently recomputes the claimed delta.
- The observer CLI verifies the broadcast-receipt hash before consuming fees
  or transaction IDs.
- Focused tests cover exact 227-sat delta reproduction and tampered,
  over-precision, duplicate, and reversed-time failures.

### Unresolved

- The balance endpoint itself must be backed by a synchronized TradeLayer
  listener. A hash proves file integrity, not that an upstream node is current
  or honest.
- Production evidence still needs direct transaction/order/fill observations
  and a durable receipt for the independent valuation source.

## Full-txid TradeLayer order verification — 2026-08-06

### Resolved

- The sibling TradeLayer orderbook now preserves its legacy compact `txid`
  display field and adds the canonical `fullTxid` to new on-chain token orders.
- Added a read-only BitAgent verifier over relayer `tl_getsyncstatus`,
  `tl_gettransaction`, `tl_getorderbook`, and
  `tl_tokentradehistoryforaddress`.
- Verification requires a synchronized listener, exact valid tx5 sender,
  property IDs, amounts, and post-only flag, plus a full-txid open-order or
  address-history match.
- Legacy compact-only order identities and otherwise valid but unobservable
  order states remain pending. They are never promoted to fabricated fills.
- Added an operator command and focused open, filled, truncated, mismatched,
  stale-listener, and evidence-tamper tests.
- Composed the read-only verifier around the launch wallet-broker boundary.
  Wallet connect/approval/execution remain delegated, while a starter strategy
  can no longer use the broker's own verification claim.
- Referral activation and workflow balance updates now occur only after the
  independent result is verified. Stale and temporarily unavailable listener
  states persist as retryable `pending` observations.

### Unresolved

- Existing orderbook records created before the `fullTxid` change cannot be
  upgraded from seven-character IDs without replaying canonical transaction
  history.
- Maker orders filled by later taker transactions need full maker/taker txid
  linkage in TradeLayer trade-history records for exact historical fill proof.

## Independent Bitcoin withdrawal verification — 2026-08-06

### Resolved

- Extended the existing testnet4 Bitcoin Core read source with a typed
  withdrawal observation: decoded outputs, exact satoshi fee, wallet net debit,
  confirmations, block identity, source, and network.
- Added hash-bound verification that requires the approved txid, destination
  script and amount, network fee, total wallet debit, and confirmation target.
- Composed withdrawal verification around the launch wallet broker. Broker
  self-report can no longer update balance when this source is configured.
- Added exact-confirmed, mempool resume, missing, reader outage, reorg,
  destination/fee/debit mismatch, and evidence-tamper coverage.

### Unresolved

- No real withdrawal was signed or broadcast in this run. The verifier is
  production-shaped and testnet4-configurable, but still needs an explicitly
  approved end-to-end transaction through an authenticated wallet broker.

## Authenticated remote wallet-broker seam — 2026-08-06

### Resolved

- Added a production `RemoteWalletExecutionBroker` client over HTTPS or
  loopback HTTP with bearer authentication, response-size/time limits, no
  redirects, and strict public response validation.
- Bound connect, deposit-address, fee, approval, and execution calls to the
  workflow and public wallet session. Execution includes a deterministic
  idempotency key and must return the exact action, simulation hash, and full
  txid.
- Added durable `walletApprovalRequestId` handling. A wallet-owned prompt can
  remain pending across refreshes and later approve the same simulation without
  creating an execution or replacement request.
- Remote responses containing key material, signed/raw transaction data, or
  PSBT fields are rejected. The bearer token is never persisted or returned.
- Remote wallet self-verification is disabled. Production construction requires
  both independent TradeLayer-order and Bitcoin-withdrawal sources.
- Added a loopback conformance fixture covering auth, pending recovery,
  idempotency, secret leakage, insecure endpoints, mismatched receipts, and
  missing-verifier configuration.

### Unresolved

- At this checkpoint the sibling wallet still exposed legacy mnemonic/WIF
  routes and had no implementation of `docs/wallet-broker-contract.md`.
  The later wallet-owned approval section resolves the non-executing session
  and approval surface; one-time grant consumption, signing, and broadcast
  remain blocked.

## Reserve/intake accounting correction — 2026-08-06

### Resolved

- Found that the previous tx5-only simulation conflated three different
  ledgers: wallet Bitcoin, UTXORef reserve Bitcoin, and TradeLayer tlBTC. A tx5
  order only reserves an existing TradeLayer token balance and cannot prove a
  Bitcoin collateral lock.
- Reused UTXORef's `buildTaprootReserveVaultTemplate(...)` rather than creating
  a local vault format. The workflow/session/amount/procedural context hash is
  embedded in both Taproot spend leaves.
- Reused TradeLayer tx11 procedural issuance and fixed the candidate output
  topology to reserve vout 0, OP_RETURN vout 1, change vout 2, matching the
  local reference-output parser.
- Added hash-bound strategy-funding evidence with separate
  `bitcoinSpendableSats`, `reserveLockedSats`, `tlBtcAvailableSats`, and
  `tlBtcReservedSats` fields. Strategy simulation fails closed without a
  verified independent source in production.
- Corrected the exact-effects display: the wallet pays only the tx5 carrier
  fee, the selected amount comes from verified tlBTC, and tlUSD proceeds are
  explicitly conditional on a fill.
- Added four focused reserve/accounting regressions. The complete launch suite
  passes 46/46 and TypeScript compilation passes.

### Unresolved

- `tradelayer.js` initializes tx11 as inactive; the candidate must not be
  broadcast until the synchronized target deployment independently reports it
  active at the intended block.
- The procedural registry is local database state. A production verifier must
  prove that every execution node has the exact template hash, contract state,
  property ID, and reserve `redeemAddress`; permissive or missing registry data
  is not launchable.
- The remote wallet contract still lacks candidate preparation for the combined
  reserve+tx11 transaction and a wallet-owned operator/guardian approval path.
- No reserve/intake transaction was signed or broadcast in this correction.
  The old unsigned tx5 drill remains cancelled and its input remains released.

## Funded testnet4 reserve candidate drill — 2026-08-06

### Resolved

- Added a separate candidate-only Bitcoin Core broker for the combined
  UTXORef reserve and TradeLayer tx11 topology. The class exposes preparation
  and cancellation only; it has no sign or broadcast method and discards the
  raw PSBT after recording its hash.
- On the synchronized local Bitcoin Core 31.1 testnet4 node at height 147181,
  prepared one unsigned candidate from the funded wallet. It used the exact
  302443-sat input, a 100000-sat P2TR reserve at vout 0, the 200-byte tx11
  payload at vout 1, 201709 sats of wallet change at vout 2, and a 734-sat fee.
- The candidate was immediately cancelled. `listlockunspent` returned empty,
  the original outpoint remained unspent with 3044 confirmations, and the
  unsigned candidate txid was absent from wallet transaction history.
- No private-key material was read. Bitcoin Core returned three compressed
  public keys for the local operator, guardian-drill, and recovery roles.
- Five focused broker tests cover the exact output layout, changed reserve
  amount, swapped output order, fee-cap cleanup, tampered cancellation, and
  absence of signing/broadcast RPC calls.

### Unresolved

- `walletcreatefundedpsbt` accepting a 200-byte data output does not prove
  mempool or relay policy acceptance. That requires an explicitly approved
  signed candidate before `testmempoolaccept`; none was authorized here.
- tx11 activation, synchronized procedural-registry identity, and the intended
  tlBTC property remain unverified. The local drill also used a same-wallet
  guardian public key, so independent guardian availability remains false.
- The candidate is evidence that exact construction and recovery work. It is
  not approval or evidence that the reserve/intake transaction is executable.

## TradeLayer reserve preflight evidence — 2026-08-06

### Resolved

- Added a read-only NeDB snapshot reader that does not import TradeLayer's DB
  singleton. This avoids the existing initialization path that can create or
  overwrite missing activation state with defaults.
- Added hash-bound preflight evidence for listener height, tx11 activation,
  managed tlBTC property identity, exact procedural template hash, contract
  state, reserve redeem address, freshness, and multi-node parity.
- Four focused tests prove two-node success and fail-closed behavior for one
  node, stale state, mismatched reserve address, registry divergence, and
  evidence tampering.
- Ran the observer against the actual local `btc-test` database snapshot. It
  confirmed tx11 active from block 1 and property 1 as type-2 `tlBTC`.

### Unresolved

- The local database was last modified at 2026-07-06T23:38:47.787Z and is not
  fresh enough for execution approval.
- Only one node snapshot was available, so independent registry parity is not
  proven.
- The candidate uses `dlc-receipt-ltc-testnet-v1` and
  `bitagent-crosschain-inbound`; neither exact record exists in the observed
  BTCTEST procedural registry. Contract state and the candidate P2TR
  `redeemAddress` therefore remain unverified.
- The preflight result is `failed`. No wallet surface may translate it into an
  executable approval until fresh independent nodes satisfy every gate.

## Dynamic tx11 contract hardening — 2026-08-06

### Resolved

- Added the minimal necessary TradeLayer consensus path in sibling commit
  `db47284`: a tx11 may create a previously unknown procedural contract during
  logic application, but only under a known template/hash, `FUNDED` initial
  state, and a real indexed output paying the payload redeem address.
- Unknown templates, absent funding outputs, payload/output address mismatch,
  and non-`FUNDED` creation now fail validation. The effect-free validity phase
  returns a creation intent; only the logic phase persists it before granting
  tokens. The focused procedural suite passes 29/29.
- BitAgent now derives a unique bounded `utxoref-<160-bit>` contract ID from
  workflow/session/wallet/amount/template state instead of reusing one global
  contract ID.
- Preflight evidence now requires an explicitly accepted 32-byte tx11 code
  hash. Contract absence is acceptable only when all fresh independent nodes
  agree on the known template and the allowlisted code supports deterministic
  creation.
- Regenerated and cancelled the funded local candidate. It used the same
  302443-sat input, a 100000-sat reserve, a 221-byte tx11 payload, 201667 sats
  change, and a 776-sat fee. The input lock was released and the source output
  remained unspent with 3051 confirmations.

### Unresolved

- TradeLayer commit `db47284` is not deployed or activated on the observed
  listener. Its release/consensus hash is therefore not allowlisted.
- The local database remains stale and single-node, and its template ID still
  differs from the candidate template. The rerun correctly fails code-hash,
  freshness, independent-node, template, contract, and redeem-address gates.
- Dynamic creation solves intake registration, not DLC settlement itself. A
  chain-derived state transition and independently verified reserve release
  remain necessary before collateral withdrawal can be launchable.

## Candidate tx11 release artifact — 2026-08-06

- TradeLayer commit `c860c3c` now includes `procedural.js` in the same ordered
  consensus source bundle used by activation transactions and release
  manifests. The focused activation/procedural suite passes 33/33.
- The resulting source hash is
  `b5ef960b260bbbf1016eb60e45eae3a65dc8e9b743fa3af0f129f25d00a32b42`.
  BitAgent records it in `config/tradelayer-tx11-release.json` with status
  `candidate_not_deployed` and does not trust it by default at runtime.
- Promotion still requires exact deployment, independent synchronized node
  parity, tx11 activation, template parity, wallet approval, mempool-policy
  testing, and independently verified reserve release.

## Wallet read-only reserve boundary — 2026-08-06

- Added `GET /api/operator/reserve-intake` as a sanitized, read-only view over
  the local candidate, TradeLayer preflight evidence, and tracked release
  manifest. Unknown fields are not forwarded, and regression tests inject and
  reject raw PSBT, private-key, seed-phrase, and payload fields.
- The matching wallet-server service consumed the endpoint over local HTTP and
  observed the cancelled 100000-sat reserve candidate, 776-sat fee, six failed
  preflight gates, and `candidate_not_deployed` release status. Approval stayed
  unavailable and no signing or broadcast method was introduced.

## Wallet-owned session and approval boundary — 2026-08-06

### Resolved

- `tradelayer-wallet` now implements authenticated
  `/v1/wallet/connect`, `/deposit-address`, `/fee-estimate`, and `/approvals`
  endpoints matching `RemoteWalletExecutionBroker`. Bearer comparison is
  constant-time, request bodies are capped at 64 KiB, responses are
  `no-store`, unknown schema fields fail, and neither broker credentials nor
  wallet grants enter browser responses or durable state.
- Browser session refresh and approval decisions require a per-process
  same-origin decision nonce. It is separate from the broker credential and
  grant, rotates on wallet-server restart, and closes cross-origin form/CSRF
  attempts without exposing financial execution authority.
- Public wallet sessions come from a configured Bitcoin Core testnet4
  descriptor wallet. The wallet process validates synchronization, address
  ownership, watch-only state, network, Core-derived scriptPubKey, and
  confirmed balance without reading key material.
- Exact simulations are re-hashed in the wallet and validated for action,
  effects, fee arithmetic, balance arithmetic, destination or tx5 payload,
  expiry, workflow, session, and approval identity before a durable pending
  prompt is created. Reject and approve decisions survive process restart.
- The BitVM wallet page now displays the public Bitcoin session, exact effects,
  fee components, balances, destination/conditions, expiry, simulation hash,
  and durable approval history. It can reject any pending request. Starter
  strategy approval is disabled and server-refused while the reserve preflight
  or tx11 release gate is red.
- The real BitAgent HTTP client passed a cross-repo loopback test through the
  real wallet route plugin: connect, deposit script, fee, pending recovery,
  rejection, approval polling, and execution denial all matched exactly.
- A read-only run against the synchronized Bitcoin Core 31.1 testnet4 wallet at
  height 147201 observed 317176 confirmed sats and a wallet-owned P2TR address.
  The provider returned only the public address/script/balance plus explicitly
  labeled operator-fixed testnet fee candidates.
- Wallet authority tests, the existing wallet boundary test, wallet-server
  TypeScript check, server production bundle, frontend production bundle,
  cross-repo integration test, 49/49 launch tests, and BitAgent TypeScript all
  pass.

### Intentionally blocked

- `/v1/wallet/executions` always returns HTTP 423. Approval records no
  signature and performs no broadcast; the browser never receives the opaque
  HMAC grant used by BitAgent polling.
- Operator-fixed testnet candidate fees are not a production final-transaction
  fee estimator. The future execution implementation must construct the exact
  wallet-owned transaction, compare its actual effects and fees with the
  approved simulation, atomically consume the grant, and remain idempotent.
- No live testnet transaction was signed or broadcast. The funded source UTXO
  remains outside this approval slice, and strategy approval remains blocked
  by the undeployed tx11 release and failed independent preflight.

## Wallet-owned unsigned withdrawal candidate — 2026-08-06

- Replaced the withdrawal's operator-fixed fee guess with a wallet-owned
  Bitcoin Core `walletcreatefundedpsbt` candidate. The wallet retains the raw
  unsigned PSBT and exports only its hash plus exact public inputs, destination,
  change, decoded fee, fee rate, unsigned txid, workflow/session, and expiry.
- BitAgent validates candidate hashes, address scripts, output positions,
  ownership, amounts, fee arithmetic, network, and authority bindings before
  hashing the candidate into the user-visible transaction simulation.
- Candidate inputs are released on user rejection, stale simulation,
  supersession, verifier failure, or the deliberately disabled execution path.
  Public state includes only sanitized cancellation receipts.
- Focused tests reject destination, change-owner, fee-cap, input-outpoint, hash,
  workflow/session, and simulation mutations. The cross-repo HTTP test covers
  durable reject, approve, HTTP 423 execution denial, and private PSBT cleanup.
- Live Bitcoin Core 31.0 testnet4 evidence at height 147205: one 302443-sat P2TR
  input, 50000-sat external destination, 252157-sat wallet change, and 286-sat
  fee at configured 2 sat/vB. Cancellation released the lock; wallet balance
  remained 317176 sats. No signature or broadcast was requested or produced.

## Wallet-owned testnet4 withdrawal executor — 2026-08-06

- Added a default-disabled Bitcoin Core execution provider in the wallet. It
  accepts only the exact private candidate already bound into the approved
  public simulation, requires synchronized testnet4 and retained input locks,
  signs/finalizes inside Core, re-decodes exact effects, runs
  `testmempoolaccept`, and returns only a public submission receipt.
- Added authority-state schema v3 with atomic one-time grant consumption,
  execution release provenance, submitted/failed/reconciliation states, and
  restart-safe idempotency. Private PSBT material is removed after success and
  omitted from public state.
- Signature rejection, finalized-transaction mutation, fee/txid mempool
  mismatch, submission ambiguity, concurrent replay, restart replay, invalid
  token/idempotency, and disabled-default behavior are covered by deterministic
  tests.
- The real BitAgent HTTP client now completes a successful broker-to-wallet
  execution trajectory against deterministic wallet providers. This verifies
  protocol compatibility only; it is not independent chain verification.
- No live signing or broadcast occurred. Enabling requires both an explicit
  testnet execution flag and a reviewed 64-hex release digest. Ambiguous sends
  remain locked for operator reconciliation, and the JSON store remains a
  single-process authority boundary.
- Added a nonce-protected operator reconciliation route and BitVM recovery
  control. It performs read-only positive observation of the exact wallet
  transaction, never signs or rebroadcasts, and leaves absent or conflicted
  evidence in `reconciliation_required`.

## MCP 12k skills and fresh funded candidate drill — 2026-08-06

- Replaced the unused `agent-financial-survival` skill scaffold with the real
  deterministic `SpendIntent`/`PolicyDecision` workflow and its explicit
  candidate-only authority boundary. Its MCP manifest fails closed with
  `requires_deterministic_wrapper` because a survival-policy MCP service has
  not been implemented.
- Added machine-readable inclusive-12k resource manifests to both local
  BitAgent skills. The lifecycle manifest exposes no more than three
  phase-specific candidate tools, keeps raw results external, caps the loop at
  three rounds/six calls, and assigns role selection to the host.
- Updated the collateral lifecycle for wallet-owned `prepared`, `executing`,
  `submitted`, `failed`, and `reconciliation_required` substates. Missing
  mempool or wallet evidence does not authorize retry, rebroadcast, or input
  release.
- Skill validation, bounded-resource tests, and receipt rejection tests pass
  8/8. The expanded launch suite passes 58/58, including 24 scripted E2E
  trajectories and at least 50 focused agent cases.
- Revalidated the signed Bitcoin Core 31.1 binaries, then started the existing
  local descriptor wallet on synchronized testnet4. At height 147212 it held
  317176 confirmed sats, had no untrusted balance, and exposed one safe UTXO.
- The live read-only wallet authority check passed. A first withdrawal
  candidate request failed closed because the maximum fee was not configured.
  With an explicit 1000-sat maximum and 2 sat/vB test fee rate, the wallet
  prepared a 50000-sat output from a 302443-sat input, 252157-sat change, and a
  286-sat fee. The candidate was cancelled, the lock was released, the
  confirmed balance was unchanged, and the unsigned txid was absent from
  wallet history.
- The real UTXORef-to-TradeLayer tx5 candidate path then mapped the same
  confirmed input to funding root
  `a4807c8224debcfc8bfbe2e1ecbc72ffb9d99eae16832a252f5714086e0da5c2`,
  encoded `tl51,2,16v7k,1nmnkgzk,0,1`, and calculated a 296-sat fee at
  2 sat/vB. Cancellation again released the input. No signing, finalization,
  mempool admission, broadcast, order placement, or PnL claim occurred.

## Rendered launch-flow regression and balance truthfulness fix — 2026-08-06

- Exercised a fresh local referral link in the rendered launch UI through demo
  wallet creation, confirmed UTXO recording, natural-language strategy
  selection, exact simulation, pending approval, refresh recovery, scripted
  execution/verification, referral activation, withdrawal rejection/recovery,
  and scripted verified withdrawal.
- The first browser pass exposed that `simulateStrategy()` persisted
  `bitcoinSpendableSats` into the confirmed wallet balance before approval.
  The simulation effects were correct, but the public wallet state was not.
- The kernel now uses verified spendable funding only as the simulation input;
  it leaves confirmed wallet state unchanged until independent verification.
  A 250000-sat deposit therefore remains 250000 through simulation, approval,
  rejection, refresh, and pending verification, while still displaying the
  exact 199100-sat projected post-strategy remainder.
- Regression assertions cover cancellation, wallet rejection, persisted
  simulation recovery, and stale independent verification. The launch suite
  remains 58/58 passing.
- The successful rendered demo ended at 148500 confirmed sats after a
  separately approved 50000-sat scripted withdrawal with a 600-sat fee. This
  is UI/kernel evidence only; no Bitcoin transaction was signed or broadcast.

## Financial-survival typed MCP wrapper — 2026-08-06

- Added a deterministic `FinancialSurvivalToolRegistry` with exactly three
  model-facing, effect-free methods: assessment, spend-intent evaluation, and
  journal integrity verification.
- The registry injects current policy, treasury snapshot, host clock, and raw
  journal records outside model arguments. Every assessment/evaluation binds
  the policy hash and treasury evidence receipt; drift fails before policy
  arithmetic runs.
- Tool validation rejects unknown fields, malformed integer/date/hash values,
  secret-bearing intent extras, policy/snapshot mismatch, corrupt journals,
  and unresolved journal URIs. Results explicitly report no wallet approval,
  signing, broadcast, or execution.
- Updated the financial-survival skill manifest from
  `requires_deterministic_wrapper` to `ready_deterministic_wrapper` while
  preserving the inclusive 12k, three-round, six-call, three-tool contract.
- The Bonsai export now includes the three typed contracts and role allowlists
  for risk and recovery in a new `bonsai-role-corpus-v2` lane. The regenerated
  deterministic seed corpus contains 114 rows. A cross-repo regression caught
  that writing those rows into the legacy v1 directory would contaminate the
  frozen v7 corpus, so v1 remains at its original 111 rows and contracts. The
  v2 lane remains below the reviewed adapter-promotion floor.

## One-command launch preflight and rendered rejection recovery - 2026-08-06

- Re-exercised the local referral route in the rendered product through demo
  wallet creation, deterministic confirmed UTXO recording, natural-language
  selection of 50000 sats, exact simulation, approval request, user rejection,
  and browser refresh.
- The UI preserved the 250000-sat confirmed balance and the saved simulation,
  displayed the 900-sat fee and 199100-sat projected remainder, reported that
  no transaction executed, and restored the same recovery action after
  refresh. The referral remained pending and the browser console had no
  errors.
- Added `npm run preflight:launch` as a bounded operator gate. It runs the
  deterministic launch and agent suites, validates the minimum trajectory and
  case floors plus the empty generated failure-trace lane, and writes a hashed
  receipt under `.runtime/launch-preflight/`.
- The first complete preflight passed 61/61 launch checks, 24 named scripted
  trajectories, 50/50 agent cases, all eight evaluation scores at 1, and zero
  failure traces. The receipt is deliberately candidate-only and always sets
  `fundedExecutionAllowed` to false.
- No signing material was requested or produced. No transaction was finalized
  or broadcast.

## Testnet4 listener replay and tx11 source gate - 2026-08-06

- The TradeLayer listener still selected the legacy Bitcoin testnet replay
  boundary at height 3520000, above the current Bitcoin testnet4 tip. TradeLayer
  commit `c80f703` now resolves `BTCTEST` and `BTC_TESTNET4` to block 1 and
  accepts only a reviewed non-negative `TL_GENESIS_BLOCK` override.
- The focused TradeLayer activation/procedural set passes 28/28, including four
  new replay-profile cases. No listener database, transaction, signature, or
  wallet state was changed by those tests.
- The changed consensus bundle is candidate release 2 with source hash
  `6b2f30c4b845b7ea7dee70efb30b2a4361ec4d8031a417fb76b8d9865880ea19`.
- Added `npm run verify:tradelayer-release`. It recomputes the hash from the
  canonical ordered source list, requires the current full TradeLayer commit in
  the release manifest, rejects code/list/commit drift, and emits an effect-free
  local receipt.
- The full BitAgent preflight passes 63/63 launch checks, 24 named trajectories,
  50/50 agent cases, all eight scores at 1, zero failure traces, and exact tx11
  candidate-source verification.
- Deployment, listener parity, and executability remain false. The verified
  source candidate must still run on two fresh independently identified
  listeners with the exact template before any wallet approval becomes legal.

## Challenge-bound live listener preflight - 2026-08-06

- TradeLayer commit `4657e62` adds `POST /tl_getLaunchAttestation`. It echoes a
  verifier challenge and exposes only read-only sync, release, tx11, property,
  template, and contract evidence. Listener startup must supply explicit
  testnet4 node identity, durable instance identity, and the exact full release
  commit.
- BitAgent now captures that endpoint under response-size and timeout bounds,
  rejects credentials and secret-like response fields, and emits hash-bound
  observations with `authority=read_only_observer` and `effect=none`.
- The live parity gate requires at least two unique endpoints, node IDs,
  instance IDs, and challenges; fresh realtime testnet4 state; bounded lag;
  allowlisted release and tx11 hashes; and exact registry/reserve parity.
- Seven focused live-listener cases pass, and the complete launch suite is now
  70/70. The consensus source hash remains
  `6b2f30c4b845b7ea7dee70efb30b2a4361ec4d8031a417fb76b8d9865880ea19`.
- This closes accidental duplicate-endpoint and stale-snapshot promotion. It
  does not provide TEE-backed remote attestation or prove that distinct
  endpoints use distinct Bitcoin backends. No listener deployment was running,
  so funded execution remains disabled and no transaction was signed or
  broadcast.

## Pruned testnet4 replay and interruption recovery - 2026-08-06

- Started two separate walletless, `blocksonly`, 550 MiB-pruned Bitcoin Core
  31.1 testnet4 nodes with separate data directories and RPC ports. The
  official archive matched the published SHA256
  `c99ef173471c58e6766d9eebd12e6c35349082eeed3939bc99eed58ef57db587`;
  the contributor signature set was downloaded but not independently verified
  because GPG was unavailable.
- The first live replay exposed an implicit `txindex` dependency. TradeLayer
  commit `ce94c9d` now supplies each block hash as the third
  `getrawtransaction` argument, while preserving the legacy two-argument RPC
  call when no block context exists. Both pruned nodes then indexed past block
  500 without enabling `txindex`.
- The repaired replay exposed a second recovery defect: `MaxHeight` was only
  durable at the final target, and encountering a TradeLayer transaction could
  mark a partial index complete. Commit `c4f32c0` checkpoints progress every
  100 processed blocks, never sets `indexExists` for a partial checkpoint, and
  awaits the final completion marker.
- A deliberate interruption of listener B resumed from its durable height 400
  against the same database instead of restarting at genesis. The live
  challenge-bound observations now report the persisted replay height while
  phase remains `indexing`.
- Candidate 3 source hash is
  `a8e3530a4721efbe7c8f525fdfa016db9ec76ac016a49e5efe617cb0bf54f4de`.
  Source integrity and exact release commit pass, but synchronization, tx11
  activation, property/template/contract parity, and reserve-address gates
  remain false. No wallet, signature, PSBT, or broadcast was created.
- A caught-up TradeLayer index could otherwise have called an IBD or
  deliberately disconnected Bitcoin backend "realtime." Commit `3c3ca69`
  adds sanitized Bitcoin chain health to the challenge-bound attestation.
  BitAgent now requires testnet4, IBD false, equal block/header/listener tips,
  verification progress of at least 0.999999, active networking, and at least
  one peer. The intentionally paused local backends therefore fail closed even
  after their TradeLayer replay catches up.
- Commit `0962b5b` also binds the sanitized Bitcoin best-block hash. BitAgent
  requires both listener backends to attest the same 32-byte tip hash, so
  equal heights on divergent forks cannot satisfy `synchronizedTestnet4`.
- Transaction-dense testnet4 blocks made the legacy two-RPC-per-transaction
  scan too slow for a bounded recovery drill. Candidate 4 (`d6f2f4f`) adds an
  opt-in `TL_DECODE_BLOCK_TRANSACTIONS=1` mode that requests Bitcoin Core
  `getblock` verbosity 2 and parses the returned decoded transactions locally.
  The legacy block-scoped raw lookup remains the default. Focused tests prove
  the explicit RPC argument, decoded TradeLayer marker path, absence of
  per-transaction RPC in that path, and unchanged checkpoint semantics.
- The accelerated replay reached listener B's paused backend tip at 35,751 and
  exposed an empty-history transition bug: with no TradeLayer marker
  transactions, consensus returned while `processedHeight` remained zero.
  Candidate 5 (`3f3dc62`) now persists indexed, processed, and track heights at
  the same tip before entering the realtime loop. The no-transaction case is a
  valid clean history, not a partial consensus state.
- After peer networking resumed, realtime scanning advanced durable
  `trackHeight` while the historical `indexedHeight` correctly remained at its
  reconstruction boundary. The live verifier now measures block lag against
  `trackHeight`, requires indexed and processed heights not to exceed it, and
  rejects a track height above the Bitcoin tip. This preserves fail-closed lag
  checks without requiring the historical index marker to move in realtime.
- Restarting Bitcoin Core rotated its RPC cookie; the running listeners failed
  closed with HTTP 401 until restarted with the new cookie. That recovery then
  exposed a checkpoint regression: empty-history initialization overwrote a
  newer realtime `trackHeight` with the older index boundary. Candidate 6
  (`f86f32c`) reconciles the highest persisted index, consensus, track, and
  resume-floor height, rejects any checkpoint above the current Bitcoin tip,
  and resumes from that durable maximum.
- With both 550 MiB nodes advancing faster than realtime parsing, Bitcoin Core
  pruned required blocks and both listeners failed closed with `Block not
  available (pruned data)`. Candidate 7 (`3728dff`) separates RPC availability
  from peer health: a reachable node with networking paused may serve its
  already-downloaded local block range, while an unreachable/loading RPC still
  enters recovery. Launch attestation continues to require active networking,
  peers, IBD completion, and tip parity, so offline catch-up cannot pass launch.

## Fresh-backend offline catch-up proof - 2026-08-06

- Replaced the exhausted 550 MiB replay backends with two fresh, walletless
  Bitcoin Core 31.1 testnet4 nodes using separate data directories, RPC ports,
  cookies, and 2 GiB prune targets. Peer networking was automatically paused
  at local tips 45,015 and 45,034; both nodes still retained history from
  genesis (`pruneheight=0`).
- Restarted the candidate-7 listeners from the preserved TradeLayer databases
  with decoded-block replay enabled and exact release commit
  `3728dffc2ee6f20ee38cd1957080e7dd1bdaf03d`. Both logs exercised the explicit
  `Peer network unavailable; processing the downloaded local block range only`
  branch without a pruned-block or provider error.
- Listener A resumed its durable history and reached `trackHeight=45015`;
  listener B reached `trackHeight=45034`. Both independently reported
  `phase=realtime`, `percent=100`, and `error=null` against their respective
  paused local tips.
- The challenge-bound attestations correctly exposed `testnet4`, IBD true,
  networking false, zero peers, the local best-block hashes, and inactive tx11.
  The live BitAgent observer accepted endpoint/instance independence and exact
  release commit, while failing `synchronizedTestnet4` and every undeployed
  protocol-state gate. This proves offline recovery without creating a false
  launch-ready result.
- No wallet was loaded or created, and no PSBT, signature, or broadcast was
  requested or produced.

## Lag-driven pruned-node throttle - 2026-08-06

- A second fixed-height window first completed cleanly at local tips 55,024
  and 55,003. Both listeners again reached the exact tips with
  `phase=realtime`, `percent=100`, and no error.
- Advancing toward 60,000 then demonstrated why a height-only watchdog is not
  sufficient: transaction-dense blocks caused the 2 GiB backends to jump to
  prune heights 58,224 and 58,226 while the durable listener tracks were still
  55,702 and 55,650. Both listeners failed closed with `Block not available
  (pruned data)`; neither skipped or synthesized the missing range.
- Added a deterministic lag-driven controller that compares Bitcoin height,
  prune horizon, peer-network state, and listener `trackHeight`. It pauses at
  a configurable high-water lag, resumes only below a low-water lag, and
  disables every configured backend on listener error, invalid checkpoint,
  prune overrun, timeout, interruption, or bounded completion.
- The controller permits only loopback HTTP endpoints, injects Bitcoin cookie
  credentials host-side, emits no credentials, and has no wallet, signing,
  PSBT, or broadcast capability. Nine focused policy tests and the full
  TypeScript check pass; the launch test set now passes 82/82.

## Candidate-8 listener RPC recovery and bounded sync proof - 2026-08-06

- The adaptive controller crossed the 2 GiB prune transition without losing
  retained history, then exposed an intermittent low-end liveness failure:
  listener B's unguarded `getblockcount` request timed out and permanently
  left its realtime loop in `phase=error` one block behind its paused backend.
  The controller named the exact failing pair/operation and kept both Bitcoin
  peer networks disabled after the failed observation.
- TradeLayer commit `dabbaf485dda99b2b0626120942190b5873fd2f3`
  (candidate 8) retries only recognized block-count transport/startup errors
  (`ECONNREFUSED`, `ETIMEDOUT`, and RPC `-28`) with capped backoff. It reports
  `phase=recovering` during retry and returns to realtime after RPC recovery;
  non-transient and block-processing failures still escape. The new
  `rpcRecoveryPolicy.js` is included in the canonical consensus-source list.
- The exact candidate-8 source bundle was checked out into a clean detached
  worktree. Its ordered consensus hash is
  `fee1c7c5de3b33e1facb1dc95a60e54e243169a5d7a2aa8b982785f478be7b1c`.
  Both listeners restarted from that clean commit with separate databases,
  ports, identities, and Bitcoin backends; B resumed its durable checkpoint
  and processed the missing local block without a reset.
- A direct controller run completed its bounded target. Listener A remained
  peerless and exact at 63,588. Listener B enabled one peer, crossed the target,
  disabled networking at Bitcoin height 59,323, and consumed the retained
  range from lag 33 to exact `trackHeight=59323`. Final prune heights were
  58,223 and 58,227; both listeners reported `phase=realtime`, `error=null`,
  zero lag, zero peers, and inactive networking.
- The challenge-bound observer accepted fresh independent endpoint/instance
  evidence and the exact candidate-8 commit. It correctly retained
  `synchronizedTestnet4=false` for the peerless IBD nodes and kept tx11,
  code-hash activation, property, template, contract, and reserve-address
  gates false. Candidate status remains `candidate_not_deployed`, with
  `deploymentVerified=false` and `executable=false`.
- `npm run preflight:launch`, pointed at the clean candidate worktree, passes
  85/85 launch tests, all 24 scripted trajectories, and 50/50 focused agent
  cases with every score equal to 1 and zero failure traces. The TypeScript
  check and eight focused TradeLayer candidate/recovery tests pass.
- A PTY interrupt delivered through the npm wrapper terminated the parent
  before the child completed asynchronous peer cleanup. `maxconnections=1`
  bounded the observed lead, and an explicit operator pause preserved the
  retained window, but a hard process/host kill cannot be treated as an
  automatic pause. The runbook now requires direct controller execution plus
  an explicit post-interruption network-state check and pause. No wallet was
  loaded or created, and no PSBT, signature, or broadcast was requested.

## Candidate-8 bounded sync continuation - 2026-08-06

- A direct controller run used a stop height of 60,000. Pair A was already
  complete and remained disconnected at Bitcoin/listener height 63,588. Pair
  B advanced from 59,323 to 60,019 in lag-bounded windows, then its listener
  consumed the retained range to exact `trackHeight=60019`.
- The atomic completion receipt reports `bounded_target_caught_up`, zero lag,
  `phase=realtime`, `error=null`, `networkActive=false`, and zero connections
  for both pairs. Pair B's prune height remained 58,227, below its listener
  checkpoint; no missing history was skipped or synthesized.
- The challenge-bound read-only observer again accepted independent live
  endpoints, fresh observations, and the exact candidate-8 release commit. It
  correctly failed `synchronizedTestnet4` because the backends remain in IBD
  at different paused tips, and it kept tx11 activation, code-hash, property,
  template, contract, and reserve-address gates false.
- This extends walletless recovery evidence only. No wallet was loaded or
  created, and no PSBT, approval, signature, activation, or broadcast was
  requested or produced.

## Wallet-owned reserve candidate and approval seam - 2026-08-06

- Added `fund_starter_strategy` as an internal action distinct from the later
  tx5 starter order. Pending or temporarily unavailable funding evidence now
  produces an exact testnet4 reserve plan instead of inventing tlBTC state.
- The remote wallet protocol validates a public candidate with one exact
  wallet input, P2TR reserve at vout 0, procedural tx11 payload at vout 1,
  positive wallet change at vout 2, fee arithmetic, expiry, plan/binding hash,
  and explicit `signingPerformed=false` / `broadcastPerformed=false` fields.
  The PSBT remains private to the wallet.
- Wallet authority candidate preparation and durable approval are implemented
  in `tradelayer-wallet`. Independent TradeLayer preflight gates approval;
  rejection or cancellation releases the exact selected input. Reserve
  execution remains deliberately disabled.
- BitAgent independently verifies the submitted reserve outpoint, intake txid,
  plan/manifest hash, confirmation depth, wallet session, locked amount, and
  tlBTC availability. Wallet self-report cannot verify the action. Reserve
  verification does not activate referral attribution, and the tx5 order still
  requires its own simulation and approval.
- Focused tests cover candidate tampering, exact-effects simulation, pending to
  verified recovery, balance mutation only after verification, referral timing,
  and rejection without execution. No wallet, signing, or broadcast action was
  performed during this implementation pass.

## Default-disabled reserve execution provider - 2026-08-06

- Added a wallet-private Bitcoin Core execution provider for the exact reserve
  candidate. It validates the public candidate against the retained PSBT,
  requires synchronized testnet4 and an intact input lock, signs inside the
  wallet boundary, finalizes and re-decodes all three outputs, checks exact fee
  and txid through `testmempoolaccept`, then broadcasts.
- Reserve execution has a separate enable flag and release digest from Bitcoin
  withdrawal. Enabling withdrawal cannot authorize reserve intake. Both remain
  disabled by default.
- Funding approval stores plan-specific preflight evidence. Immediately before
  execution, the wallet requires the same plan hash, a fresh assessment inside
  its declared maximum age, all eight launch gates, and the exact deployed
  release ID/code hash. Missing or stale evidence preserves the unconsumed
  grant and candidate; a definite disabled/failing execution releases the
  lock; an ambiguous submission stays locked for positive-proof reconciliation.
- The operator evidence surface now exposes the sanitized preflight `planHash`
  and `maxAgeMs` needed for that exact binding. It still exposes no PSBT,
  signature, key, credential, or execution capability.
- Deterministic provider and authority tests cover successful submission,
  signature rejection, finalized-payload mutation, mempool rejection,
  ambiguous send/reconciliation, candidate tampering, plan mismatch,
  preflight outage recovery, idempotency, and raw-PSBT/token redaction. The
  wallet release suite, wallet server/frontend TypeScript checks, and frontend
  Angular AOT compiler pass.
- Added candidate-only Bonsai/Hermes failure rows for exact-plan preflight
  mismatch, signed-candidate mempool rejection, and ambiguous reserve
  submission. The v2 corpus now contains 118 rows: 50 intent, 11 UTXO/
  TradeLayer specialist, 41 approval-risk, and 16 recovery examples. The new
  rows cannot approve, sign, broadcast, retry, or invent state.
- The complete launch preflight passes 94/94 checks, all 24 scripted
  trajectories, and 50/50 focused agent cases with every score equal to 1 and
  zero generated failure traces. Candidate-8 source verification passes at
  commit `dabbaf485dda99b2b0626120942190b5873fd2f3` and hash
  `fee1c7c5de3b33e1facb1dc95a60e54e243169a5d7a2aa8b982785f478be7b1c`.
- This is implementation and simulated-provider evidence only. The live tx11
  release remains `candidate_not_deployed`, so reserve approval/execution is
  still blocked and no transaction was signed, finalized, or broadcast.

## Candidate-8 reproducible source gate - 2026-08-06

- The launch failure was isolated to tracked user changes in the primary
  `tradelayer.js` checkout. Those changes were preserved; the release manifest
  was not changed to bless an unreviewed consensus hash.
- `npm run test:launch:candidate8` now discovers associated Git worktrees and
  selects only an allowlisted full commit that is tracked-clean and reproduces
  the exact ordered consensus-source hash. Selection is deterministic and
  requires verification to remain read-only, non-deployed, and non-executable.
- The gate selected detached commit
  `dabbaf485dda99b2b0626120942190b5873fd2f3` with consensus hash
  `fee1c7c5de3b33e1facb1dc95a60e54e243169a5d7a2aa8b982785f478be7b1c`
  and wrote a structured provenance receipt to
  `.runtime/testnet-agent/tx11-launch-source.json`.
- The provenance-focused tests pass 2/2 and the resulting launch suite passes
  96/96, including 24 end-to-end trajectories and 50/50 focused agent cases.
  No wallet approval, signing, activation, or broadcast occurred.
- `npm run preflight:launch:candidate8` reuses the selected source for the full
  preflight. It passed 96/96 launch checks, 50/50 focused evaluations with all
  eight scores equal to 1, zero generated failure traces, and exact source
  verification. The receipt decision is `scriptedLaunchReady=true` and
  `fundedExecutionAllowed=false`.

## Candidate-9 chain-activation provenance - 2026-08-06

- A local NeDB activation overlay could previously satisfy the tx11 active and
  code-hash checks without proving that a Bitcoin transaction activated the
  type. Candidate 9 closes that provenance gap at the source.
- TradeLayer commit `f502236e3e2b8c601c2e8576bb0bcf23b2680892` records a sanitized
  activation source. Only an indexed `bitcoin_transaction` with a valid txid
  and exact activation block is chain-derived. `local_db_seed` and
  `legacy_unknown` remain explicitly non-authoritative.
- BitAgent normalizes both live-listener evidence and the legacy direct-database
  diagnostic into the wallet preflight contract, adding
  `tx11ChainDerived`. Missing or malformed provenance fails closed.
- The release manifest now pins candidate 9 and ordered consensus hash
  `8ab527ac64cd21464e7911396572e971f4b8795fa59f3f472dfb3abb6c0ffed1`.
  Release scripts are candidate-agnostic:
  `npm run test:launch:release` and `npm run preflight:launch:release`.
- The full release preflight passes 106/106 launch checks, 24/24 trajectories,
  and 50/50 focused cases with zero failure traces. It remains
  `candidate_not_deployed`, `scriptedLaunchReady=true`, and
  `fundedExecutionAllowed=false`.
- The wallet requires all nine exact gates at both status display and approval
  capture. The focused authority suite passes; frontend TypeScript passes. The
  wallet-server full TypeScript command remains blocked by an existing
  dependency collision between `@types/web` and TypeScript's DOM declarations.
- No model weights were loaded because the last GPU observation was 88 C against
  the 64 C start gate. No approval, signature, activation, or broadcast was
  attempted.

## Lifecycle-v2 reserve-intake skill boundary - 2026-08-06

- The collateral lifecycle skill now treats confirmed deposit/UTXORef mapping
  and tx11 reserve intake as separate states. A deposit cannot be reported as
  locked collateral until the reserve transaction has its own exact simulation,
  approval, submission, and independent verification.
- Added the read-only `bitagent.operator.reserve_intake` tool. It accepts no
  model-selected paths or arguments and returns only sanitized candidate,
  preflight, and release evidence. It cannot approve, sign, finalize, broadcast,
  retry, or release an input.
- The v2 lifecycle receipt requires one reserve transaction, vout 0 as the
  recorded reserve outpoint, distinct reserve/order/PnL-release/withdrawal
  approvals, the exact nine candidate-9 gates, and release ID/code hash/full
  deployment commit provenance. Legacy v1 receipts remain valid only for
  simulation; testnet and production v1 receipts fail closed.
- MCP-intensive skill manifests now cap active tools at three. Deposit
  observation and reserve-intake review have explicit phase packets; raw
  evidence remains external and referenced by bounded handles.
- `npm run preflight:launch:release` passes 108/108 launch checks, 24/24
  trajectories, and 50/50 focused cases. The release is still
  `candidate_not_deployed`, so funded execution remains disabled.
- A fresh two-listener observation at `2026-08-06T22:27:47.836Z` had independent
  fresh endpoints but failed synchronization, exact candidate-9 release,
  tx11-active, chain-derived, property, template, contract, and reserve-address
  gates. Both listeners are still candidate-8 instances in IBD with networking
  paused. No approval, PSBT, signature, or broadcast was produced.

## Candidate-9 deployment and prune-safe replacement - 2026-08-06

- Added an exact two-listener deployment contract and operator command. It
  verifies tracked-clean candidate-9 source commit
  `f502236e3e2b8c601c2e8576bb0bcf23b2680892`, consensus hash
  `8ab527ac64cd21464e7911396572e971f4b8795fa59f3f472dfb3abb6c0ffed1`,
  immutable snapshot parity, unique identities/backends/ports/state roots,
  empty-body initialization, and initialized non-idle listener status. It
  inherits only an allowlisted public environment and records owned PIDs.
- The first candidate-9 pair advanced to exact paused tips 64,003 and 64,032.
  During the next chunk, backend B atomically pruned to height 69,430 while its
  listener was at 69,102. The controller failed closed with
  `prune_horizon_overtook_listener`; B then reported
  `Block not available (pruned data)`. No checkpoint was edited or skipped.
- Healthy A reached exact paused height 69,459. The quiescent snapshot command
  sealed two deployment copies containing 35 files and 2,335,237 bytes each,
  with matching inventory hash
  `507a024e42f03914989d02cc9881a0ef7f1f25adcd7eec7fd79b1cb02bee817c`.
  It requires paused testnet4 height parity and rejects overlapping or existing
  targets, source mutation, copy drift, unsafe pruning, and listener errors.
- A fresh replacement pair started on ports 3121/3122 with owned PIDs 19804 and
  9528. Both copied inventories match the seals, both instances expose the
  exact candidate-9 release, and B replayed the retained 69,459-69,737 range
  without error.
- A recalibrated 100-block high watermark then completed at A
  70,028/70,028 and B 70,002/70,002. Both experienced real prune horizons near
  69,430 without being overtaken. The terminal receipt records
  `status=completed`, zero lag, realtime/no-error listeners, and successful
  pause RPC results; independent reads confirmed networking off and zero peers.
- Live preflight now passes independent listeners, fresh observations, and the
  exact release commit. It truthfully fails full testnet4 synchronization while
  the backends remain in IBD, and fails all real chain-derived tx11/property/
  template/contract/redeem gates. The manifest remains
  `candidate_not_deployed`; funded execution remains disabled.
- `npm run preflight:launch:release` passes 111/111 launch checks, 24 scripted
  trajectories, and 50/50 focused agent cases with all scores equal to 1 and
  zero generated failure traces. No wallet, approval, PSBT, signature,
  activation transaction, or broadcast was requested or produced.
- The RTX 3050 was 73 C after recovery work, above the 64 C Bonsai start gate,
  so no model weights were loaded and no inference benchmark was claimed.
- A follow-on 75,000 target ran for its exact 20-minute budget and preserved
  additional valid progress at A 73,524/73,524 and B 74,037/74,037. It ended
  with `sync throttle exceeded BITAGENT_SYNC_MAX_RUNTIME_MS`, not a listener or
  pruning fault. The terminal failure receipt records successful pause results
  for both backends; independent RPC reads confirmed networking off and zero
  peers. The resumed controller first completed 74,200, then completed 75,000
  at A 75,033/75,033 and B 75,054/75,054. Both final prune horizons remained
  below the listeners at 74,339 and 74,366. A fresh live preflight preserved
  the same truthful gate shape: independence, freshness, and exact release
  commit pass; full synchronization and chain-derived tx11 registry gates fail.
- Subsequent bounded targets completed at 80,000 (A 80,378, B 80,062) and
  81,000 (A 81,193, B 81,023), always with exact listener parity and paused
  networking. Two stalls were traced to the same connected peer reporting
  `synced_headers=-1`, `synced_blocks=-1`, and `last_block=0`; rotating only
  that exact peer restored progress immediately.
- The controller now detects a below-target, low-lag Bitcoin height stall,
  inspects connected peer synchronization after a bounded interval,
  disconnects only unsynchronized peers, and excludes their exact address from
  the immediate addrman retry. The normal 81,000 live run completed without an
  unnecessary disconnection. Fifteen focused policy tests cover the trigger,
  safe-peer preservation, malformed/unsynchronized peers, pruning, recovery,
  and terminal behavior.
- The refreshed full release preflight passes 114/114 checks, 24 trajectories,
  and 50/50 agent cases with every score equal to 1 and zero failure traces.
- The committed controller then completed 85,000 at A 85,042/85,042 and B
  85,122/85,122. The terminal receipt records both backends paused. Fresh live
  preflight continues to pass listener independence, observation freshness,
  and exact release commit while correctly failing IBD synchronization and all
  real chain-derived tx11 registry gates. GPU temperature was 67 C, so Bonsai
  remained below the launch queue rather than violating the 64 C start gate.
- The same controller completed the next bounded target at A 90,011/90,011 and
  B 90,051/90,051 in 15 minutes. Both zero-peer intervals and bursty listener
  backlogs recovered through the bounded network/addrman policy; the terminal
  receipt and independent RPC reads agree that both backends are paused with
  zero peers and realtime listeners without errors. Fresh live preflight keeps
  the same truthful gate shape: listener independence, freshness, and exact
  candidate-9 release pass; IBD synchronization and all chain-derived tx11
  registry gates fail. The idle RTX 3050 was 71 C, so no Bonsai weights were
  loaded and no model score was claimed.
- Bounded recovery then completed 95,000 at A 95,032/95,032 and B
  95,014/95,014, followed by 100,000 at exact A/B tips
  100,007/100,007. The 100,000 segment exercised real prune transitions to A
  95,143 and B 95,372 only after their listener tracks were safely ahead.
  Terminal receipts and independent RPC reads agree on exact listener parity,
  realtime/no-error status, successful per-backend pause RPCs, disabled
  networking, and zero peers.
- The first 105,000 attempt exhausted its exact 20-minute runtime after B had
  completed 105,001/105,001 and A had retained 102,534/102,534. Its failure
  receipt names only `sync throttle exceeded BITAGENT_SYNC_MAX_RUNTIME_MS` and
  records both pause RPCs as successful. A resumed under a separate receipt and
  completed 105,009/105,009 without hiding or overwriting the timeout trace.
  Both backends completed additional safe prune transitions near 102,700. The
  fresh 95,000 and 100,000 preflights preserve the truthful gate shape:
  independence, freshness, and exact release commit pass; IBD synchronization
  and every real chain-derived tx11 registry gate fail.
- No approval, PSBT, signature, activation transaction, or broadcast was
  requested. After the 105,000 checkpoint the zero-utilization RTX 3050
  reported 80 C, so the 64 C Bonsai start gate remained closed and no model
  load, inference score, or training claim was made.

## Hermes 12k gate and single-pair testnet4 continuation - 2026-08-07

- Hermes Lite commit `0f38917` changes the BitAgent DAG-ops model-free receipt
  to schema v3 and enforces the actual inclusive 12k allocation: 2,400 fixed
  overhead, 2,000 tool schemas, 4,000 active working packet, 1,500 next tool
  result, 1,024 model output, and 1,076 safety margin. The 112-row oracle gate
  estimates a 1,032-token maximum packet, reports mean score 1 with zero
  authority violations, reproduced byte-for-byte, and passed 48 focused tests.
- To avoid compounding the hot shared chassis, the next recovery segment ran
  only candidate-9 pair A. The 100-block lag governor completed target 107,500
  at Bitcoin/listener height 107,577/107,577 with `phase=realtime`, `error=null`,
  `networkactive=false`, zero peers, prune height 102,700, and a successful
  terminal pause receipt at
  `.runtime/testnet-agent/sync-throttle-candidate9-r2-107500-a.json`.
- Pair B was deliberately left at its prior safe 105,001/105,001 checkpoint.
  This asymmetric state is a resumable recovery checkpoint, not listener-tip
  parity and not launch synchronization. Pair B must catch up under its own
  bounded receipt before a fresh two-listener preflight can claim tip parity.
- The complete model-free release preflight still passes 114/114 launch tests,
  all 24 scripted trajectories, and 50/50 focused agent cases. It truthfully
  reports `candidate_not_deployed`, `deploymentVerified=false`,
  `executable=false`, and `fundedExecutionAllowed=false`.
- NVIDIA process evidence identified the user's running game and GeForce
  overlay as the active GPU clients while the shared GPU reached 86 C. No
  BitAgent model weights were loaded, the user process was not terminated, and
  the Bonsai benchmark remains gated until the GPU is idle and at or below
  64 C.
- No wallet approval, PSBT, signature, activation transaction, trade, or
  broadcast was requested or produced.

## Independent Bitcoin tx11 activation proof - 2026-08-06

- Added a read-only Bitcoin Core activation observer. For each challenge-bound
  listener observation it independently binds the RPC chain/tip to the
  listener's non-IBD testnet4 backend, resolves the exact activation block,
  confirms the block is active, fetches the exact transaction with a
  block-hash argument, and strictly decodes the canonical TradeLayer tx0
  OP_RETURN.
- Listener preflight evidence is now v2 and requires one fresh, hash-valid
  proof per observation, unique Bitcoin RPC endpoints, exact observation/node/
  txid/block bindings, tx11 in the decoded activation list, and the allowlisted
  normalized code hash. Legacy v1 evidence is exposed as failed and cannot
  claim `tx11ChainDerived` through the operator surface.
- The observer accepts the protocol's base36 wire representation but commits a
  normalized 64-hex code hash in evidence. This exposed a candidate-9 release
  defect: `encodeActivateTradeLayer` converts hex to base36 while
  `decodeActivateTradeLayer` returns the base36 field unchanged. That upstream
  decoder must be corrected and released before real activation.
- Focused safety tests pass 22/22 and TypeScript compiles cleanly. The complete
  release preflight passes 121/121 launch tests, all 24 scripted trajectories,
  and 50/50 focused cases with every score at 1 and zero generated failure
  traces.
- The release remains `candidate_not_deployed`, `deploymentVerified=false`,
  `executable=false`, and `fundedExecutionAllowed=false`. No wallet approval,
  signing, transaction construction, or broadcast occurred.

## Candidate-10 activation decoder and release pin - 2026-08-06

- Created the separate `codex/tx0-codehash-normalization` worktree from
  candidate 9 and left the previous release source untouched.
- TradeLayer commit `fad7f4bb3955559a05ea9b0c82eb7ea34e46aafd`
  decodes the tx0 base36 hash field with bounded BigInt arithmetic, restores
  leading zero bytes to exact 64-hex, and rejects malformed, ambiguous,
  duplicate-type, out-of-range, and greater-than-256-bit payloads. Activation
  validity now rejects a non-canonical decoded hash before state mutation.
- The focused upstream slice passes 42/42 tests across activation round trips,
  malformed values, provenance, listener attestation, testnet activation
  profile, tx11 semantics, tx index/replay, and consensus guardrails.
- The BitAgent manifest now pins candidate 10 and ordered consensus hash
  `c72b3ce9101743c59c05ee3b115100ec229055e21f9e17851ff694002b2d9e29`.
- The first exact-source BitAgent gate truthfully failed because the clean
  worktree had no local dependency junction and could not resolve
  `bignumber.js`. The release runner now supplies both selected-worktree and
  primary-checkout dependency paths without downloading or copying packages.
- The rerun selects the tracked-clean candidate-10 source and passes 121/121
  launch tests, 24/24 trajectories, and 50/50 focused cases with all scores at
  1 and zero generated failure traces. Release status remains
  `candidate_not_deployed`; deployment, executability, funded execution,
  approval, signing, and broadcast remain false.
- The sanitized listener launcher now uses the same bounded dependency lookup
  for a selected clean worktree. Its 3/3 deployment-config tests, TypeScript
  compile, and the full 121-test release preflight pass; no listener was
  started or stopped by this change.

## Candidate-10 quiescent listener checkpoints - 2026-08-07

- A first realtime copy correctly failed inventory parity when `consensus.db`
  changed during the copy. No receipt was sealed. The exact failed directory
  was preserved under the sibling quarantine name
  `failed-candidate10-predeploy-a-107577-fad7f4b-20260807` rather than deleted.
- The snapshot command now toggles only the loopback TradeLayer parser pause,
  waits 12 seconds for the ten-second realtime loop to drain, and requires
  three identical source inventories before copying. A `finally` recovery path
  observes the parser state, resumes a pause initiated by the command, and
  requires realtime phase plus unchanged Bitcoin/listener heights before it
  can seal a v2 receipt.
- Candidate-10 predeployment snapshot A sealed at exact Bitcoin/listener height
  107,577 with 35 files, 11,568,500 bytes, and matching source/copy inventory
  hash `b81bdc665e9198e6ac80179cba6b78ec09d7555fe172d969c3e8a973ee78ad3d`.
- Snapshot B sealed independently at exact height 105,001 with 35 files,
  10,835,373 bytes, and matching source/copy inventory hash
  `a153a8209e61687fd7a2614d7eb66df81e037fa66decb3927de8b7f7d5e3104c`.
  Both receipts prove paused peer networking, parser pause, stable-byte copy,
  and verified return to realtime. There were no wallet effects, approvals,
  signatures, or broadcasts.

## Candidate-10 parallel deployment and exact testnet4 parity - 2026-08-07

- The exact candidate-10 source commit and consensus hash were deployed from
  the two sealed snapshots into new, non-overlapping state and log roots. New
  listeners run on ports 3131/3132 with recorded PIDs 14464/4164; candidate-9
  listeners on 3121/3122 remain available as rollback evidence. The deployment
  receipt remains `candidate_pair_started_unverified` and cannot authorize
  funded execution.
- A bounded candidate-10 B recovery advanced from 105,001 to 107,604 with a
  100-block high watermark and ended with listener parity, networking off, and
  zero listener errors. A tighter A recovery reached 107,606/107,606. Neither
  controller run requested wallet approval, signing, or transaction broadcast.
- Added `align:testnet4-tip`, a bounded operator-only raw-block relay for the
  final paused-node suffix. It requires independent loopback RPCs, matching
  active-chain ancestry, zero peers, disabled networking, and at most 128
  blocks. Four focused tests cover authority absence, valid bounded planning,
  idempotent retry, fork/network rejection, and size bounds.
- B independently validated A's public blocks 107,605 and 107,606 through
  `submitblock`. Both Bitcoin Cores and all four TradeLayer listeners now agree
  at height 107,606 and best block
  `000000000a860ed7a982aab0baf6bb8fba49ba7aff7806e143dbea664ec59880`,
  with peer networking disabled. An idempotent rerun produced a zero-block
  receipt without changing either node.
- The shared RTX 3050 reheated to 83 C during this model-free work, so the 64 C
  Bonsai start gate closed again. No model was loaded and no benchmark score is
  claimed.
- The fresh candidate-10 listener preflight passes independent endpoints,
  observation freshness, and the exact release commit. It correctly fails
  paused/IBD synchronization and every missing real chain-derived tx11 and
  reserve-registry gate. The expanded model-free release gate passes 125/125
  tests, all 24 scripted trajectories, and 50/50 focused agent cases; funded
  execution remains disabled.
