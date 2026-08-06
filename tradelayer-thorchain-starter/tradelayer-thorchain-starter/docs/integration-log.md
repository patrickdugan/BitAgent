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
