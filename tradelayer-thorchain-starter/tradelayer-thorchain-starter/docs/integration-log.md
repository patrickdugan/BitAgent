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
- A read-only call through the pinned candidate-10 encoder produced the exact
  type-11 activation payload
  `tl011,4ypfnlsyfm5zcuiw52ts92ccg3p388tdfwjya7w5d0frwpb6eh` (56 bytes).
  The corrected decoder round-trips it to only tx11 and code hash
  `c72b3ce9101743c59c05ee3b115100ec229055e21f9e17851ff694002b2d9e29`.
  No transaction or PSBT was constructed.
- The upstream legacy `TxUtils.activationTransaction()` helper is prohibited
  for BitAgent because it calls Bitcoin Core `dumpprivkey`. Real activation
  must instead use the existing external wallet candidate/simulation/approval
  boundary after full synchronization, with exact fees and effects displayed,
  followed by independent chain verification.

## Candidate-only tx11 activation broker - 2026-08-07

- Added a typed Bitcoin Core simulation broker dedicated to the candidate-10
  tx0 activation. It builds the exact tx11-only payload locally from the
  allowlisted 64-hex consensus hash and reproduces the pinned 56-byte wire
  payload exactly.
- Preparation requires a fully synchronized testnet4 node, an owned non-watch
  sender, one confirmed safe input, a source-verification hash, the exact
  release ID/commit/status, and a positive fee cap. It requests exactly one
  OP_RETURN at vout 0 and positive wallet change at vout 1, then verifies the
  decoded PSBT input, output order, payload, change ownership, fee, and unsigned
  txid.
- The public candidate contains the exact input, data output, change, fee,
  unsigned txid/PSBT hash, and approval hash, but never the PSBT. The broker has
  no signing or broadcast method. Cancellation revalidates the approval-bound
  candidate, releases its exact input, and proves signing/broadcast remained
  false.
- Eight focused tests cover exact candidate-10 wire bytes, normal cancellation,
  wrong payload, swapped outputs, foreign change, excessive fee, stale/tampered
  requests, unsynchronized nodes, and tampered cancellation. TypeScript passes.
- The complete candidate-10 release gate now passes 133/133 launch tests, all
  24 scripted trajectories, and 50/50 focused agent cases; release status,
  deployment verification, executability, and funded execution remain false.
- The live nodes currently contain no loaded or stored wallet, so no candidate,
  address, PSBT, approval, signature, or transaction was produced. A separate
  wallet-owned execution provider and funded testnet4 wallet remain required.

## Wallet-hosted tx11 activation execution broker - 2026-08-07

- Added a host-private activation envelope that binds the raw unsigned PSBT to
  the already public candidate and approval hash. Public candidate responses
  and receipts still contain no PSBT or signing material.
- The separate execution broker accepts only that byte-bound envelope and the
  exact user approval hash. It rechecks full testnet4 synchronization, decodes
  and revalidates the unsigned PSBT, asks the external Bitcoin Core wallet to
  sign, decodes the finalized transaction, and revalidates txid, input, output
  order, payload, change, and fee before `testmempoolaccept` and broadcast.
- Rejected signatures, finalized-transaction mutation, and mempool rejection
  are definite non-broadcast failures and release the exact input. A failed or
  mismatched `sendrawtransaction` response retains the input and requires
  positive txid observation; absence never authorizes retry.
- Seven focused execution cases cover exact approved execution, wrong approval,
  rejected signature, signed-transaction mutation, mempool rejection,
  ambiguous submission with positive-only reconciliation, and private-envelope
  tampering. Together with candidate simulation, 15/15 activation broker cases
  and TypeScript pass.
- The complete release gate now passes 140/140 launch tests, all 24 scripted
  trajectories, and 50/50 focused agent cases while release promotion and
  funded execution remain false.
- This code remains operator/wallet-hosted and is not registered as an agent
  tool. No live wallet exists on the syncing nodes, so none of these RPCs were
  invoked against live funds.

## Durable tx11 activation approval and recovery - 2026-08-07

- Added an atomic, integrity-checked host-private candidate store. It persists
  the raw unsigned PSBT only inside the wallet-host file and returns a separate
  public approval view containing the exact input, tx11 payload, change, fee,
  unsigned txid/PSBT hash, and approval hash.
- Added explicit durable states for pending approval, cancellation, submission,
  write-ahead execution, ambiguous submission, positive mempool/confirmation
  observation, definite released-input failure, and manual recovery. Corrupt records and invalid
  transitions fail closed; an interrupted process can resume by approval hash.
- Execution errors now state whether the exact input lock was retained,
  released, or cannot safely be classified. Definite failures are recorded only
  after release; ambiguous broadcast retains the input and permits only positive
  reconciliation. Absence never authorizes retry.
- Added `operator:tradelayer-activation` with separate prepare, status, cancel,
  approve-execute, and reconcile actions. Preparation and submission each have
  an environment interlock, and execution requires the operator to repeat the
  exact displayed approval hash. Public CLI output rejects private PSBT fields.
- Seven focused operator cases cover restart recovery, write-ahead interruption,
  exact approved execution,
  rejected signatures, ambiguous submission, corrupt storage, and persistence
  failure cleanup. No live wallet RPC was invoked; synchronization and wallet
  funding remain external runtime gates.
- The release-aware launch gate selects the exact clean candidate10 checkout
  and passes 147/147 tests. The evaluation suite remains 24/24 scripted
  trajectories and 50/50 focused agent cases with all safety scores at 1.

## Candidate10 full-testnet4 recovery - 2026-08-07

- Bitcoin node A reached the bounded full target, but its candidate10 listener
  had been allowed to fall behind while peer networking advanced. The pruned
  data horizon overtook its checkpoint and the listener failed closed with
  `Block not available (pruned data)`. Node A networking is disabled and this
  listener/state root is retained as failure evidence; it is not eligible for
  launch proof.
- Candidate10 listener B remains error-free and is advancing with its own
  Bitcoin Core under the 20/100-block bounded throttle. No wallet is loaded and
  the controller has no approval, signing, or broadcast authority.
- An interrupted PowerShell wrapper demonstrated that piping the throttle
  through another process can strand Bitcoin peer networking active before a
  terminal receipt is written. Networking was independently disabled and zero
  peers verified before recovery continued. The controller now supports
  `BITAGENT_SYNC_QUIET=1`, and the runbook requires direct supervision plus an
  independent network-state check after abnormal exit.
- The recovery plan preserves both prior listener roots. After B reaches exact
  paused parity, take two quiescent, hash-sealed snapshots from B and deploy a
  fresh candidate10 pair on unused ports and new state/log roots, one against
  each independent Bitcoin Core. Only the fresh pair can enter activation
  preflight.
- TypeScript and all 15 focused throttle-policy cases pass. The release-aware
  launch gate still selects commit
  `fad7f4bb3955559a05ea9b0c82eb7ea34e46aafd` with code hash
  `c72b3ce9101743c59c05ee3b115100ec229055e21f9e17851ff694002b2d9e29`
  and passes 148/148 tests after binding the repo-shipped lifecycle skill and
  example to the current manifest. Deployment and funded execution remain
  false.

## Release-bound tx11 activation request - 2026-08-07

- Added a read-only public request generator between release verification and
  wallet-hosted activation preparation. It reads the pinned manifest plus the
  fresh launch-source receipt and cannot access Bitcoin RPC or wallet state.
- The generated `sourceVerificationHash` commits to the release ID/status,
  deployment commit, code hash, and the clean exact verified source checkout.
  Commit/hash drift, false source verification, unsupported execution claims,
  future timestamps, and receipts older than 15 minutes fail closed.
- This step writes only a public broker request. Input selection, fee
  simulation, lock reservation, approval, signing, broadcast, and verification
  remain separate downstream boundaries.
- Five focused cases cover the valid binding, malformed testnet4 sender,
  mismatched policy, mismatched source commit, and stale evidence. The complete
  release-aware gate now passes 155/155 tests;
  release status, deployment verification, executability, and funded execution
  remain false.
- Validated ignored operator plans now name two unique quiescent snapshots, a
  bounded B-to-A paused-tip alignment, and fresh candidate10-r2 listener ports,
  identities, state roots, and log roots. They are plans only and have not been
  executed while listener B is still synchronizing.

## Windows atomic status contention recovery - 2026-08-07

- The long-running candidate10 B throttle encountered a transient Windows
  `EPERM` while replacing its atomic JSON status receipt. The controller failed
  closed, disabled peer networking, and preserved the terminal failure receipt.
  An independent RPC check proved `networkactive=false`, zero peers, and exact
  Bitcoin/listener parity before a fresh controller was started.
- Atomic status replacement now retries only transient `EPERM`, `EBUSY`, and
  `EACCES` rename contention eight times with bounded backoff. Non-transient or
  exhausted failures still propagate to the controller's peer-pause cleanup.
- Deterministic tests prove transient recovery seals the exact new receipt and
  exhausted contention preserves the prior receipt while removing temporary
  state. The status-specific cases remain included in the complete release
  gate.
- The public activation policy fingerprint is now deterministically derived
  from the exact release/code, network, wallet, normalized sender, fee cap,
  one-input/output-order rules, external-wallet authority, and model-execution
  denial. A manually supplied mismatch fails before wallet RPC.
- A read-only CLI smoke test generated the exact public request for the known
  wallet address with no wallet access. Because npm 10.9.4 did not forward CLI
  flags in this Windows environment, the operator runbook now uses the direct
  local `tsx.cmd` path for every argument-bearing activation command.

## Candidate11 decoded-block recovery - 2026-08-07

- Candidate10 listener B failed closed at Bitcoin height 132,733 after
  `TxIndex.processTransaction` attempted a txid-only raw-transaction lookup on
  a pruned node and then dereferenced unavailable outputs. Peer networking was
  independently verified off with zero connections; candidate10 state and logs
  were preserved.
- Bitcoin Core verbosity 3 for the exact failing block exposes decoded outputs
  plus first-input `prevout` address/value. TradeLayer now derives sender and
  reference metadata from that block object, requests verbosity 3 in decoded
  mode, rejects incomplete decoded metadata, and never calls the legacy
  transaction RPC on that path.
- Replay also exposed an unused duplicate async decode, tx11 empty-reference
  fallback, and malformed synthetic contract metadata exception. These now
  fail deterministically without unhandled validation or txid-only lookup.
- The exact candidate10 descendant is candidate11 commit
  `b3423bf7f72a4e8bfad3fbc61f757505553b9d4c`, ordered consensus hash
  `8f8e83ae0bac5b578087af7c2dd00c63d3ca87952be72e6e70c4a6acdfffd623`.
  An accidentally tested older-lineage worktree was preserved as rejected
  evidence and never selected.
- A second fresh-state replay reached exact paused tip 132,733 with
  `phase=realtime`, `error=null`, zero forbidden error signatures, and the
  formerly fatal tx indexed as chain-derived invalid for its protocol reason.
  The release-aware gate selects only the clean candidate11 worktree and passes
  155/155 tests. Release status remains `candidate_not_deployed`; no wallet,
  approval, signing, broadcast, or funded action occurred.

## Candidate11 full-tip deployment - 2026-08-07

- A directly supervised 20/100-block fail-closed throttle advanced candidate11
  from 132,733 to the then-current testnet4 tip 147,370. The terminal receipt
  proves exact Bitcoin/listener parity, `initialBlockDownload=false`, paused
  networking, zero peers, `phase=realtime`, and `error=null`; the candidate10
  failure signatures remain absent from the candidate11 logs.
- Node A was one block onto a stale fork at height 147,363. The paused-node tip
  aligner now permits a fork only when both nodes prove an identical bounded
  common ancestor. It relayed eight exact source-chain blocks without
  invalidating either branch and required node A to independently select the
  exact 147,370 source tip. Verified `duplicate` or `inconclusive` block
  submissions are accepted only after the target returns the exact full block
  hash and height; invalid or unrecognized results still fail closed.
- Three quiescent snapshots exposed an append-only NeDB serialization detail:
  each parser pause/resume appends identical `TrackHeight=147370` records to
  `consensus.db`, changing physical hashes without changing effective state.
  The fresh pair uses the second and third sealed snapshots; each source/copy
  hash matches exactly, and both listeners independently report processed and
  tracked height 147,370.
- Candidate11 listeners are deployed on ports 3161/3162 with PIDs 22464/8804,
  unique node/instance identities, isolated state/log roots, exact source
  commit `b3423bf7f72a4e8bfad3fbc61f757505553b9d4c`, and code hash
  `8f8e83ae0bac5b578087af7c2dd00c63d3ca87952be72e6e70c4a6acdfffd623`.
- The model-free release gate passes 157/157 tests, all 24 scripted
  trajectories, and 50/50 focused cases. Live preflight passes independent
  listener, freshness, and exact-release-commit gates but correctly remains
  non-executable because peer networking was paused for evidence capture and
  the required candidate11 tx11 hash is not yet chain-activated. No wallet,
  approval, signature, or broadcast action occurred.

## Candidate11 funded activation simulation - 2026-08-07

- The separate `D:\BitcoinTestnet` wallet node reports testnet4 tip 147,370,
  IBD false, three peers, and a loaded `utxoref-testnet` descriptor wallet with
  317,176 trusted sats. Public inspection found seven confirmed safe spendable
  UTXOs; no secret-key RPC was called.
- Bitcoin Core rejected a redundant CLI chain selector because this datadir
  already selects its chain in configuration. `BitcoinCliBrokerRpc` now omits
  `-chain=testnet4` only when an explicit datadir is supplied; effectful
  brokers still require live `getblockchaininfo.chain=testnet4` and exact
  block/header synchronization before touching wallet state. Twenty-three
  focused broker/live cases and TypeScript pass.
- The release-bound request pins candidate11 code hash
  `8f8e83ae0bac5b578087af7c2dd00c63d3ca87952be72e6e70c4a6acdfffd623`,
  exact tx11-only 56-byte payload, 2,000-sat fee cap, and deterministic policy
  fingerprint. Candidate-only simulation reserved input
  `4623e25a03cee2ab0ad5169c70675280d1bd37db859c34d81a17a4b4c94b61e1:1`
  (302,443 sats), produced 302,085 sats change and a 358-sat fee, and is
  pending exact approval hash
  `d4349f54db77cf354897c3e1a2ff72a70e7f3a503b2d7618e46e51f16a3da1a3`.
  Signing and broadcast remain false; cancellation will release the input.
- A cooled 54 C Bonsai v5 attempt stopped before model load because the frozen
  registration expects the pre-provenance v7 config hash. The current config
  is intentionally different, so no checkpoint or benchmark claim was
  changed and no GPU memory was allocated.

## Candidate11 expired-approval recovery - 2026-08-07

- The persisted activation request expired without approval, signing, or
  broadcast while its exact input lock remained intentionally retained.
- The public approval view now exposes the request expiry, an `expired` flag,
  and `decisionStatus=expired` rather than presenting the stale hash as an
  approvable pending request.
- Expired approval fails before loading private candidate material or calling
  any signing RPC. Recovery instructions explicitly require cancellation of
  the exact hash, release of the reserved input, and a fresh simulation before
  any replacement approval.
- Cancellation remains wallet-user controlled and valid for the expired
  pending record; status inspection never cancels, signs, broadcasts, or
  mutates durable state.
- Eight focused operator cases and TypeScript pass. A read-only live status
  check against candidate11 returned `expired=true`, `signingPerformed=false`,
  `broadcastStatus=not_performed`, and no PSBT bytes.

## Candidate12 fail-closed reorg recovery - 2026-08-07

- A fresh read-only preflight exposed a real fork mismatch between the sealed
  candidate11 listener state at height 147,370 and the current active testnet4
  chain. The existing listener logged a reorg but remained in
  `phase=realtime`, `error=null` because the no-snapshot path returned numeric
  zero and the caller treated that value as false.
- TradeLayer candidate12 commit
  `8544512bda290f040a112b94f0a4bc6b556101d7` replaces that ambiguous return
  with `REORG_FULL_REPLAY_REQUIRED` and carries structured recovery metadata
  into the public sync status. Its ordered consensus source hash is
  `57b3a04ddbb8f8698e993fdc38419e1685f86505b18812cfda5ca687b7687dfb`.
- Six focused suites pass 14/14 tests, covering behavioral no-snapshot reorg
  rejection, realtime error propagation, listener attestation, RPC recovery,
  offline catch-up, empty-consensus protection, and persistence adjacency.
- A live, no-wallet probe used an isolated copy of sealed state and a paused
  testnet4 backend at height 147,388. Candidate12 reported `phase=error`, last
  local height 147,370, common ancestor 147,362, and the exact canonical block
  hash at the divergent height. No signing, wallet-processing, private-key, or
  broadcast RPC appeared in its logs.
- Only the owned probe PID 7396 was stopped after evidence capture; port 3163
  was released and the Bitcoin backend independently remained
  `networkactive=false`, `connections=0`. Candidate11 remains the selected
  undeployed release, candidate12 is not promoted, and the expired approval
  candidate remains untouched.

## Candidate12 streamed replay and recovery corpus isolation - 2026-08-07

- The clean candidate12 replay is running from genesis against a dedicated,
  wallet-disabled Bitcoin Core testnet4 backend. A single bounded controller
  alternates peer download and listener catch-up with peer networking disabled
  above the configured lag corridor. It refuses a corridor that is not
  strictly smaller than the node's retained prune margin.
- The run has already exercised three fail-closed recoveries: an unpruned-node
  disk floor, an RPC-cookie rotation after node restart, and a prune margin
  smaller than the requested lag ceiling. Each recovery paused peer networking,
  preserved state, and performed no wallet, approval, signing, or broadcast
  action. Sanitized rows are recorded in the failure-trace seed dataset.
- The corpus export now targets `bonsai-role-corpus-v3`. It contains 124
  deterministic candidate-only examples, including 22 recovery-operator rows,
  while forbidding secret access, approval, signing, broadcast, fabricated
  state, and silent strategy changes.
- The existing v2 corpus is byte-for-byte unchanged because Hermes adapter
  versions v9 through v15 hash-bind it as sealed evidence. Candidate12 data may
  not mutate that lane; a dedicated test verifies every current failure trace
  has a propose-only, non-executing v3 recovery example.
- Replay completion, two-listener deployment, challenge-bound preflight, and
  explicit release-manifest review remain unresolved. Candidate12 is still
  unpromoted and the expired candidate11 approval remains untouched.

## Candidate12 unattended peer recovery - 2026-08-07

- The bounded testnet4 controller can optionally reuse one sanitized outbound
  peer observed by an independent synchronized loopback Bitcoin node. The
  source surface is read-only (`getblockchaininfo`, `getnetworkinfo`, and
  `getpeerinfo`); it exposes no wallet, signing, or broadcast authority.
- Peer-source configuration is name-bound to an existing target pair, accepts
  only credential-free loopback HTTP RPC, and never persists or prints the
  selected peer endpoint. A source that is unavailable, in IBD, on another
  chain, or lacks a synchronized IPv4/IPv6 peer falls back to the target's own
  address manager.
- Peer endpoints are validated as real IP literals with bounded ports before a
  single target `addnode ... onetry` call. Receipts contain only aggregate
  attempt/fallback counters and `independent_loopback_bitcoin` mode.
- The active replay was paused at target block 98,494 as free space approached
  the 750 MiB reserve floor. Peer networking was independently set false with
  zero connections; listener catch-up and automatic prune recovery are being
  observed before a source-assisted restart.
- A live peer-source configuration smoke test completed at exact target/listener
  parity with networking disabled, zero connections, `error=null`, and only
  `independent_loopback_bitcoin` aggregate mode in the receipt. No endpoint or
  credential was emitted. The release-aware gate passes 169/169.
- A proposed 500-block exact relay made no target change because the independent
  source had already pruned the target's historical height. This was a truthful
  source-data limitation, not a consensus or listener failure; the raw-block
  relay remains reserved for a suffix retained by the synchronized source.
- Four inactive, task-owned node A-D debug logs were hash-verified and moved to
  `.runtime/archived-testnet4-logs` to preserve recovery evidence while adding
  about 51 MiB of D: headroom. No chainstate, wallet data, listener state, or
  active-node log moved.
- The 5/25-block controller crossed a real automatic prune transition without
  losing the listener: prune height advanced from 86,496 to 95,254 and free
  space recovered to about 1.48 GiB. The controller now measures the filesystem
  containing each target cookie and fails peer-off below a configurable 750 MiB
  default floor. Focused throttle tests pass 19/19 and the release-aware gate
  passes 170/170.
- Under concurrent local evaluation load, a 15-second listener status request
  timed out at Bitcoin height 101,153. The controller failed closed, recorded
  its terminal error, and independently paused Bitcoin networking with zero
  connections; the listener then reached exact parity with `error=null`.
- One receipt observed three transient peer connections before the timeout.
  The controller now deterministically keeps the best synchronized outbound
  peer and disconnects every extra peer ID, recording only an aggregate trim
  count. Focused throttle tests pass 20/20 and the release-aware gate passes
  171/171.
- The real listener-observation timeout and pruned-node disk-floor stop are now
  sanitized failure traces. Corpus v3 remains byte-for-byte sealed; a new v4
  lane contains 126 candidate-only examples, including 24 recovery-operator
  rows. It contains no raw transcript or detected secret and grants no approval,
  signing, broadcast, execution, fabrication, or parameter-mutation authority.

## Candidate12 bounded 200-block replay corridor - 2026-08-07

- A bounded one-peer drill resumed from exact Bitcoin/listener parity at height
  104,553 and exercised additional automatic prune transitions while using a
  50-block low-water and 200-block high-water policy.
- The peer pipeline produced a maximum observed lag of 203 blocks after the
  pause decision. This is evidence that the high-water value is an operating
  trigger, not a hard ceiling. The retained prune margin remained above 2,500
  blocks and no prune overtake, listener error, peer trim, wallet RPC, signing,
  or broadcast occurred.
- The P2P target of 111,500 overshot by four blocks. The controller recorded
  `bounded_target_overshot`, disabled networking, and terminated non-zero. An
  independent RPC check then found Bitcoin and candidate12 at exact height
  111,504, listener `phase=realtime`, `error=null`, networking false, zero
  connections, prune height 108,840, and about 1.04 GiB free.
- Because the independent synchronized source retains raw blocks from height
  111,332 onward, later recovery may use the wallet-free exact-height relay for
  the final bounded suffix. Candidate12 remains unpromoted and the expired
  candidate11 approval remains untouched.
- The four-block overshoot is also a sanitized `bounded_target_overshot`
  failure trace. Corpus v4 remains byte-sealed for the registered adapter
  preflight; the next hill-climb lane is `bonsai-role-corpus-v5` with 127
  candidate-only examples and 25 recovery-operator rows. Its examples hash is
  `0322d612c49fff790d4ae17132e0b48044a7dbeec16ba8649f20f87b41cf6901`
  and manifest hash is
  `b636cc58d560077b25bd768758f02452f06c083cce58594f5b1adf40540e37b6`.
  Focused corpus tests pass 4/4 and the new row grants no execution authority.

## Candidate12 replay completion and parallel pair - 2026-08-07

- The one-peer v16 replay advanced from 111,504 to a bounded ten-block P2P
  overshoot at 145,510. It terminated non-zero, paused networking, and left
  candidate12 at exact error-free parity. No wallet, approval, signing, or
  broadcast path was called.
- The exact-height relay now enforces a target-filesystem reserve before and
  after every block and reserves twice the decoded size of the pending block.
  Focused relay tests pass 5/5 and TypeScript is clean. It relayed 1,879 source
  blocks to exact reviewed height 147,389, with final hash
  `0000000000e15b8ee3fc6fb990590792ca43f593493c73100db4ea25ac762ba7`,
  target IBD false, networking false, zero peers, and candidate12 exact.
- Bitcoin Core's configured-pruned-node RPC removed only complete target block
  files below prune height 137,004, recovering about 779 MiB. The removed
  testnet data remains recoverable from the independent source, which retains
  history from 111,332; chain tip, listener state, and wallet state were
  unchanged.
- Two quiescent snapshots were sealed at 147,389. Snapshot A internally binds
  source/copy hash
  `fa9656b109cffade91081a80248b0309ea73e2f82229c48bc6a6fff9dbaee5ba`;
  snapshot B binds
  `8e837f7f4f6cd01342e75b2f63aa99c38776219069d95f2f80c1051230283841`.
  Their differing hashes reflect the documented append-only pause/resume
  record; each 34-file copy exactly matches its own stable source inventory.
- Two existing paused Bitcoin backends independently selected the active fork,
  then all three backends and all three candidate12 listeners advanced by an
  exact 43-block suffix to height 147,432 and hash
  `00000000006c41a526e0745f171becbac265344594d06717c7b2b07a01a3354b`.
- Candidate12 listeners on ports 3171/3172 run clean commit
  `8544512bda290f040a112b94f0a4bc6b556101d7` and code hash
  `57b3a04ddbb8f8698e993fdc38419e1685f86505b18812cfda5ca687b7687dfb`.
  The deployment receipt remains `candidate_pair_started_unverified`, and the
  selected candidate11 manifest was not changed.
- A bounded live challenge passed independent-listener, freshness,
  synchronized-testnet4, and exact-release-commit gates, then returned both
  Bitcoin backends peer-off with zero connections. It truthfully failed only
  the chain-derived candidate12 activation and dependent tlBTC property,
  template, contract, and reserve gates because the existing on-chain tx11
  carries the prior release hash.
- The next state-changing step requires a fresh candidate12 activation
  simulation and exact wallet-user approval. The expired candidate11 approval
  and its input lock remain untouched; candidate12 is not promoted.
- The release-aware regression gate still selects only the tracked-clean
  candidate11 worktree and passes 172/172 tests, including 24 scripted E2E
  trajectories, at least 50 focused agent cases, the exact-relay reserve guard,
  corpus-v5 sealing, listener deployment, activation authority, and reorg
  recovery suites.

## Candidate12 activation simulation - 2026-08-08

- With explicit user authorization, the expired candidate11 approval
  `d4349f54db77cf354897c3e1a2ff72a70e7f3a503b2d7618e46e51f16a3da1a3`
  was cancelled through the typed operator. Its receipt hash is
  `e2e6c6a21e63650b9af3889ad69e396882c4b307eeb3c5c014f0f3bded187328`;
  it proves the one input lock was released and that neither signing nor
  broadcast occurred.
- The release-source gate now accepts an explicit JSON manifest under project
  `config` and a distinct runtime receipt path. This produced a fresh,
  candidate-only receipt for exact tracked-clean candidate12 commit
  `8544512bda290f040a112b94f0a4bc6b556101d7` and recomputed code hash
  `57b3a04ddbb8f8698e993fdc38419e1685f86505b18812cfda5ca687b7687dfb`
  without changing the selected candidate11 manifest or default receipt.
- The approval view no longer hardcodes candidate11. It displays the release ID
  and code hash from the integrity-checked request so parallel-candidate effects
  cannot be mislabeled. Fifteen focused activation/release tests and TypeScript
  pass after this correction.
- The fresh candidate12 simulation reserves the same owned 302,443-sat input.
  It creates only vout 0 OP_RETURN
  `tl011,26ovxc51bi0ma7ahzsoyjck6gf2fbya61g7exvuk60r8etfi0r`, returns
  302,085 sats to the same owned P2TR address at vout 1, and charges 358 sats
  under the 2,000-sat cap. Its unsigned txid is
  `b5cf09c4757ce0e62ca533c7dff4f830793d9e876506832c464e0597a76cdc5e`.
- Independent checks recomputed the source hash, round-tripped the base36 wire
  field to the exact candidate12 hash, found exactly the displayed input lock,
  and found the unsigned txid in neither chain nor mempool. Signing and
  broadcast remain false.
- The new exact approval hash is
  `4320d3a89a39ebf8e3855c88f4097db0a36664d5531ad88c25f06fc9d29338fb`
  and expires at `2026-08-08T15:41:12.077Z`. No execution is authorized. If it
  expires, it must be cancelled and replaced rather than reused.

## Candidate12 tx11 submission - 2026-08-08

- The wallet user repeated exact approval hash
  `4320d3a89a39ebf8e3855c88f4097db0a36664d5531ad88c25f06fc9d29338fb`
  while it was current. The host durably recorded execution intent, revalidated
  the candidate before and after signing, passed `testmempoolaccept`, and
  broadcast the exact reviewed transaction once.
- The resulting txid is
  `b5cf09c4757ce0e62ca533c7dff4f830793d9e876506832c464e0597a76cdc5e`.
  Submission receipt hash
  `c2a8a1006585bf7ad85da89302d8ebb7cca106dda7c79021428c3659de9f656e`
  binds the request, approval, txid, mempool admission, signing, and broadcast.
- Independent Bitcoin Core observation proves one input, exactly two outputs,
  the reviewed candidate12 OP_RETURN at vout 0, 302,085 sats back to the same
  owned address at vout 1, 179 vbytes, and a 358-sat fee. The transaction is a
  propagated trusted mempool entry (`unbroadcastcount=0`) at 2 sat/vB, above
  the node's 0.1 sat/vB mempool minimum.
- Durable reconciliation status is `mempool`, with positive-observation receipt
  hash `5024f9746f98b01fa7eab4b843b1bfcb19d1e0022330999f96dd6b84f21fcc67`.
  Retry remains unauthorized; lack of confirmation cannot trigger a second
  submission.
- While confirmation was pending, both isolated candidate12 backends accepted
  the 102-block active-chain suffix from 147,434 through 147,535 through the
  disk-reserve-guarded exact relay. Both listeners reached realtime/error-null
  parity at 147,535, and both Bitcoin peer networks remain disabled with zero
  connections.
- The transaction is not yet confirmed and candidate12 is not promoted. The
  next legal transition is positive block confirmation, exact final-block relay
  to both isolated backends, and independent two-listener activation proof.

## Candidate12 confirmed invalid activation and sender guard - 2026-08-08

- Bitcoin testnet4 positively confirmed txid
  `b5cf09c4757ce0e62ca533c7dff4f830793d9e876506832c464e0597a76cdc5e`
  in active-chain block 147,537,
  `0000000000636b836039f8eb1e04ed9f3b52629d162fbc655d726985f4c8d989`.
  A later observation reported 24 confirmations. The Bitcoin effects remain
  exactly one 302,443-sat input, a zero-value tx11 OP_RETURN, 302,085 sats back
  to the same wallet address, and a 358-sat fee. Retry is not authorized.
- The prior candidate12 listeners correctly failed closed on the intervening
  fork with `REORG_FULL_REPLAY_REQUIRED`. Two subsequent 30-second deployments
  failed before HTTP bind and stopped only their owned listener PIDs, with no
  wallet, approval, signing, or broadcast effect. A bounded post-clean probe
  measured 57,318 ms to load `walletListener.js`, proving the deploy timeout was
  too short rather than authorizing an indefinite restart loop.
- Both isolated Bitcoin backends were aligned peer-off from their durable
  147,434 checkpoint through exact height 147,560 and hash
  `00000000005d2dd3efd9255f36403d6caebd1e154c6e48588118874d107b863d`.
  Each independently accepted 126 source blocks. A single 120-second recovery
  deployment then copied both sealed 34-file snapshots byte-for-byte and
  started candidate12 commit
  `8544512bda290f040a112b94f0a4bc6b556101d7`; both listeners reached
  realtime track height 147,560 with `error=null`.
- The challenge-bound preflight passed independent listeners, freshness,
  synchronized testnet4, exact release commit, and tx11-active gates. Both
  listeners decoded the new wire payload to tx0 activating tx11 with exact
  candidate12 hash
  `57b3a04ddbb8f8698e993fdc38419e1685f86505b18812cfda5ca687b7687dfb`,
  then deterministically rejected it: sender
  `tb1pma0a7clpqfdwpy4aq80ejrxk3dtumgzqkrm5hatpmgl0qn9aqh5ss2puu0`
  did not equal protocol admin
  `tb1qpg5jvhd32vut07pvxg92dka7pttudjy570auuu`. The stored tx11 state
  therefore remains the prior height-134,066 activation; candidate12 is not
  activated or promoted, and all dependent tlBTC/template/contract/reserve
  gates remain false.
- BitAgent now rejects every testnet4 activation request whose sender is not
  the protocol admin address, both at deterministic policy/request generation
  and again inside candidate validation. The guard runs before any wallet RPC,
  approval, signing, or broadcast. Thirty focused activation tests pass,
  TypeScript is clean, and the full launch gate passes 174/174 when bound to
  the sealed candidate11 source plus the reviewed TradeLayer dependency tree.
  The prior confirmed transaction is retained as a sanitized failure trace,
  not training evidence for executing a replacement.
- Backends A/B were returned to networking disabled with zero peers after the
  challenge. The independent source remains network-active for positive chain
  observation. No replacement activation is simulated or authorized.

## Protocol-admin wallet authority and funding simulation - 2026-08-08

- Read-only Bitcoin Core metadata proved the already-loaded local testnet4
  descriptor wallet owns the exact protocol-admin address, is not watch-only,
  is solvable, and has private-key operations enabled. No key, seed, WIF,
  descriptor, signature, or raw PSBT was read into the public/operator surface.
- The admin address had no confirmed UTXO. The previously confirmed invalid
  activation produced a safe, spendable, unlocked 302,085-sat change outpoint
  at its non-admin P2TR sender, so direct tx11 preparation remained correctly
  blocked.
- Added a host-only admin-funding operator with deterministic prepare, status,
  cancel, approve/execute, and positive-only reconciliation. It requires one
  exact confirmed input, one exact output to the protocol-admin address, a fee
  cap, a private PSBT store, a prepare interlock, a separate submit interlock,
  write-ahead execution state, final-transaction revalidation, mempool
  admission, and no-retry ambiguous-submission recovery. Four focused tests
  cover containment, cancellation, exact execution, and rejected signatures;
  the complete launch gate passes 178/178 with TypeScript clean.
- Live preparation reserved only outpoint
  `b5cf09c4757ce0e62ca533c7dff4f830793d9e876506832c464e0597a76cdc5e:1`
  (302,085 sats). The candidate pays 200 sats at 2 sat/vB and produces one
  301,885-sat output to
  `tb1qpg5jvhd32vut07pvxg92dka7pttudjy570auuu`. Its unsigned txid is
  `2e7e6573352109592470cef49735309206a85361d3fbc725dee155bf87a86ec9`
  and its approval hash is
  `3485416d24452d16f3f00f05907a4201861d19d39f7401843529ba88a40c9e41`.
  The input is locked, the decision is pending, and no signing or broadcast
  occurred. This funding approval cannot authorize the later activation.

## Launch-server DAG adapter seam - 2026-08-09

- Added a host-side `bitagent.dag_task_packet.v2` builder for the three launch
  intents. Deposit and reserve funding route through `utxoref_settlement`, the
  starter order through `trading_risk`, and withdrawal through
  `bitcoin_rpc_txbuild`.
- The task packet binds the public persisted workflow state and deterministic
  structured plan by SHA-256, carries a compact state projection and a closed
  explain/simulate/display/approval/execute/verify graph, and is about 4.3 kB
  at entry. It therefore fits the Hermes Lite 4,000-token active-packet lane
  inside the inclusive 12k context allocation.
- Added `/api/workflows/:id/dag-task` and `/dag-candidate`. The latter rebuilds
  current bindings and applies a deterministic LDT. It rejects stale task IDs,
  fabricated evidence, unknown tools, illegal transitions, and authority or
  effect escalation, then returns the canonical normalized candidate.
- Every validation receipt fixes authorization, signing, execution, broadcast,
  and secret access to false. Even the exact approved-node
  `host.execute_approved` candidate remains a no-effect proposal and cannot call
  the wallet broker through this surface.
- DAG task generation and candidate validation use the planner's read-only
  preview mode. Repeating either endpoint against unchanged workflow state does
  not append an event and reproduces the same task binding.
- Eight focused contract tests plus three HTTP launch-server tests pass. They
  cover exact candidates, escalation/fabrication, secret refusal, approved-path
  containment, persisted-state drift, endpoint normalization, and the absence
  of an execution object.
- The RTX 3050 screening lane remained closed during this work: a foreign
  Python process occupied almost all VRAM and drove the GPU above the frozen
  64 C start threshold. No model was loaded by BitAgent and no foreign process
  was interrupted.
- The release-aware regression selects exact tracked-clean candidate11 commit
  `b3423bf7f72a4e8bfad3fbc61f757505553b9d4c`, keeps release status
  `candidate_not_deployed` and execution false, and passes 188/188 tests.
- Added `GET /api/dag-runtime` backed by a tracked manifest. It freezes the
  accepted Prime registration ID, base-model hash, source-adapter hash,
  converted-LoRA hash, and exact Hermes Lite commit `61228bd`. The loader fails
  on hash substitution, context-budget drift, contract drift, authority drift,
  or a readiness claim that lacks every promotion gate.
- The public runtime state remains
  `adapter_packaged_gpu_screening_required`, `modelAvailable=false`, and
  `candidate_only_no_wallet_authority`; reading it does not start a process or
  load model weights.
- Rejected live DAG proposals now append a sanitized
  `bitagent.dag_failure_trace.v2` row. The row contains only state/plan hashes,
  failed checks, an exact-schema proposal or `null`, and the deterministic
  repair target. Natural-language messages and unknown fields are never
  written; a secret-shaped extra field is discarded in test coverage.
- The append lane is serialized per file and a persistence error fails the
  candidate request closed. Live rows remain `optimizer_eligible=false` until
  separate review and split assignment.
- Added `/api/workflows/:id/dag-propose` and an owned Hermes Lite stdio
  provider. The provider uses `shell=false`, starts only after the frozen
  BitAgent runtime reports ready, verifies canonical response hashes and exact
  no-effect flags, and never exposes wallet, RPC, approval, signing, execution,
  broadcast, or secret capabilities to the model.
- Hermes Lite commit `395d634c9505dc435221eee1223aa32cb1c19cc9`
  adds the live `bitagent.dag_task_packet.v2` client and sidecar. It limits the
  active task to 12,000 serialized bytes, three read-only tool rounds, six
  calls, and 384 completion tokens; it rejects illegal transitions and
  unapproved execution proposals before BitAgent's second deterministic LDT.
  Secret-shaped and oversized packets are rejected before runtime readiness is
  consulted, so an unpromoted runtime is not a weaker input-validation lane.
- The browser checks `/api/dag-runtime`, calls the model route only when
  `modelAvailable=true`, and truthfully falls back to the deterministic planner
  on provider outage. The present runtime remains
  `adapter_packaged_gpu_screening_required`, so no sidecar or model starts in
  normal launch operation.
- Hermes contract/transport/guardrail coverage passes 16/16. BitAgent focused
  DAG and HTTP coverage passes 12/12, including a promoted-manifest harness,
  provider bypass containment, zero workflow effects, and sanitized failure
  capture.
- The complete release-aware launch gate passes 189/189 against exact
  tracked-clean candidate11 commit
  `b3423bf7f72a4e8bfad3fbc61f757505553b9d4c` and code hash
  `8f8e83ae0bac5b578087af7c2dd00c63d3ca87952be72e6e70c4a6acdfffd623`.
  It still reports `candidate_not_deployed`, `deploymentVerified=false`, and
  `executable=false`.
- A post-gate six-RPC read-only Bitcoin Core snapshot observed synchronized
  testnet4 height 147,596, 316,818 confirmed sats, zero unconfirmed sats, zero
  wallet locks, protocol-admin ownership but zero admin UTXOs, and seven safe
  non-admin UTXOs. It read no secret material and performed no signing or
  broadcast.
- The RTX 3050 remained ineligible at 88 C with only 206 MiB free VRAM and a
  foreign Python compute process at 99% utilization. No model was loaded, the
  foreign process was not interrupted, and the frozen 64 C/exclusive-owner
  gates were not relaxed.

Deterministic DAG runtime-promotion update (2026-08-09):

- Hermes now exposes a hash-bound assess/apply conveyor at commit
  `395d634c9505dc435221eee1223aa32cb1c19cc9`; its complete 1,409-test suite
  passes, while the current no-effect assessment is blocked only on missing
  exclusive-GPU smoke and screening evidence;
- BitAgent now pins that exact commit and replaces manual manifest promotion
  with `assess:dag-runtime` and `promote:dag-runtime` commands. Exact Hermes
  report/apply bytes and sidecar-validation bytes are bound into the approval
  candidate;
- `validate:dag-sidecar` refuses to load the model before Hermes promotion and,
  afterward, checks deposit, starter-strategy, and withdrawal candidates using
  an in-memory no-effect kernel and BitAgent's deterministic LDT;
- missing receipts, a wrong approval hash, a secret request, fabricated state,
  any authorization/signing/execution/broadcast flag, duplicate gates, or
  hand-edited ready state fails closed;
- the exact release-aware gate passes 192/192 against tracked-clean candidate11
  commit `b3423bf7f72a4e8bfad3fbc61f757505553b9d4c` while retaining
  `candidate_not_deployed`, `deploymentVerified=false`, and `executable=false`;
- the checked-in assessment remains blocked, `passedGates=[]`,
  `operatorReady=false`, and `modelAvailable=false`. No model, wallet, or chain
  action occurred in this update.
- the final six-RPC read-only snapshot observed synchronized testnet4 height
  147,604, 316,818 confirmed sats, zero unconfirmed sats, zero locks, seven
  safe non-admin UTXOs, and no protocol-admin UTXO. It read no secret material
  and performed no signing or broadcast;
- the GPU remained ineligible at 88 C, 206 MiB free VRAM, and 99% utilization
  under a foreign Python process. No model load was attempted and that process
  was not interrupted.

Launch-preflight runtime-evidence update (2026-08-09):

- `scripts/preflight-launch.ts` now loads the same tracked DAG runtime manifest
  used by the launch server, validates it through the deterministic runtime
  loader, and passes only its public acceptance/readiness fields into the
  preflight receipt;
- `src/launch/preflight.ts` derives the adapter blocker from that evidence. An
  accepted packaged adapter with `modelAvailable=false` yields
  `adapter_runtime_not_promoted`; missing or invalid acceptance evidence yields
  `adapter_artifact_acceptance_not_verified`;
- tests cover both paths and explicitly reject regression to the stale
  `adapter_artifacts_not_trained` label. TypeScript and 11 focused preflight/DAG
  tests pass;
- the complete release preflight passes 192/192 tests and 50/50 agent cases.
  The receipt identifies the accepted Prime registration and exact Hermes
  commit while preserving candidate-only, read-only authority and keeping
  funded execution false;
- the sealed Bonsai confirmation audit remains the acceptance evidence: 32
  independent items, 32 adapter wins, 1,152/1,152 deterministic checks, grade
  A, no hard-fail selections, and an explicit warning that the independent
  sample remains below the preferred 50-item policy size.
