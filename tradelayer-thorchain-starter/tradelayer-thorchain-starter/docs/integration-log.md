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
