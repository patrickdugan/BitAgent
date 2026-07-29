# Repo Map

## Committed Algorithmic Signal Seam (2026-07-26)

- Discovered algorithm folder: `C:\projects\Trading Algos`.
- Repository state: plain source directory, not a Git checkout.
- Current deterministic 14-file `sha256-source-tree-v1` commitment:
  `42546a6e14e9309b248bae6a80ac60206a9d5301060932976a5c3906a0ce6fad`.
- The directory contains direct CCXT/KuCoin/Binance/Deribit-style executors.
  They are not imported or executed by BitAgent. The only accepted output is
  the strict `bitagent_tradelayer_signal_v1` data contract.
- Provenance verifier:
  `src/signals/codebaseVerifier.ts`, supporting exact clean Git commits or
  deterministic source-tree hashes. `src/signals/signalValidator.ts` also
  requires an Ed25519 signature from the operator-approved producer key bound
  to that codebase.
- Canonical UTXO mapping:
  `src/signals/utxoFunding.ts` calls the existing
  `v2.settlement.buildFundingSetV2(...)` safe namespace.
- Exact TradeLayer order builder:
  `src/signals/tradelayerSignalAdapter.ts` calls the existing
  `encodeOnChainTokenForToken(...)` tx5 encoder.
- Wallet state, approval, execution, and verification:
  `src/signals/broker.ts` defines the keyless boundary.
  `src/signals/kernel.ts` persists and resumes the exact approved workflow.
- Stability:
  UTXO-Ref V2 and the TradeLayer encoder are the real local protocol seams.
  Source-tree provenance and the signal state machine are new stable-local
  seams. The funded wallet broker remains missing and production fails closed.

## BitAgent Launch Kernel Map (2026-07-23)

The launch kernel is a Bitcoin-first path layered beside the
ETH/USDC-to-native-BTC onboarding demo. NEAR Intents is the default
cross-chain rail and THORChain is an explicit legacy adapter. It supports only deposit, one starter
strategy, and withdrawal. The existing broader agent/economy experiments are
not part of this user journey.

### Exact deposit and UTXO seam

- Canonical deposit lifecycle:
  `C:\projects\UTXORef\UTXO-Ref\bitvm3\utxo_referee\m1_deposit_indexer.js`
- Reused exports:
  `ReceiptDepositIndexer`, `DEPOSIT_STATUSES`, and `computeConfirmations`
- Canonical confirmed-deposit shape:
  `ReceiptDepositIndexer#buildLedgerCreditEvent()` returns
  `{ depositId, accountId, amountSats, chainTxRef: { txid, vout,
  blockHeight, confirmations, network } }`.
- Deterministic outpoint commitment:
  `C:\projects\UTXORef\UTXO-Ref\bitvm3\utxo_referee\utxoref_v2.js`
- Reused safe export:
  `v2.settlement.buildFundingSetV2([{ txid, vout, amountSats,
  scriptPubKeyHex }])` from
  `C:\projects\UTXORef\UTXO-Ref\bitvm3\utxo_referee\index.js`.
- The resulting `fundingRoot` is the launch kernel's stable `utxoRef`.
- Stability: the V2 namespace is the repo's explicitly safe boundary.
  `ReceiptDepositIndexer` is mature enough for the demo lifecycle but is an
  in-memory class, so the launch kernel persists its normalized result in its
  own workflow store.

### Exact TradeLayer strategy seam

- Protocol encoder:
  `C:\projects\tradelayer.js\src\txEncoder.js`
- Reused export:
  `encodeOnChainTokenForToken({ propertyIdOffered, propertyIdDesired,
  amountOffered, amountExpected, stop, post })`, TradeLayer transaction type 5.
- Live precedent:
  `C:\projects\tradelayer.js\src\txUtils.js#tokenTradeTransaction(...)`.
- Bitcoin testnet planning precedent:
  `C:\projects\tradelayer.js\scripts\broadcastBtctestVwapTrades.js`, which
  builds and validates tlBTC/tlUSD type-5 payloads.
- Starter strategy:
  one post-only tlBTC-for-tlUSD limit order with explicit user-entered
  `amountSats` and quote price. The launch kernel creates an unsigned,
  deterministic simulation and never calls `dumpprivkey`, signs, or
  broadcasts.
- Stability: the type-5 payload encoder is the exact reusable protocol seam.
  The host wallet execution/verification broker remains provisional because
  the sibling repo's `tokenTradeTransaction` signs internally with
  `dumpprivkey`, which is outside BitAgent's security boundary.

### Exact wallet insertion point

- Wallet server transaction construction:
  `C:\projects\TLWallet\tradelayer-wallet\packages\wallet-server\src\services\tx-builder.service.ts`
- Wallet server routes:
  `packages\wallet-server\src\routes\main.route.ts`
- Frontend transaction orchestration:
  `packages\wallet-fe\src\app\@core\services\txs.service.ts`
- Confirmed/unconfirmed balance source:
  `packages\wallet-fe\src\app\@core\services\balance.service.ts`
- Existing receive/send UI:
  `packages\wallet-fe\src\app\@shared\dialogs\deposit\deposit.component.ts`
  and `withdraw\withdraw.component.ts`
- Existing runtime status pattern:
  `packages\wallet-fe\src\app\@core\services\bitvm-runtime.service.ts`
  (`BehaviorSubject`, refresh, persisted status, and watchtower polling).
- Best insertion:
  a typed BitAgent activity/workflow feed consumed alongside the existing
  runtime status service. The launch kernel owns conversation/referral state;
  the wallet owns addresses, balances, approval, signing, broadcast, and RPC
  truth.
- Security finding:
  the current wallet `sign-tx`/`sign-psbt` routes accept WIF material, and
  `TxsService#buildSingSendTx` reads WIF from frontend wallet state. BitAgent
  must not proxy, log, or request those values. Its execution tool accepts only
  an opaque wallet approval token produced by a wallet-owned approval surface.

### Withdrawal seam

- Protocol-neutral BTC withdrawal is a wallet-owned PSBT/send flow.
- Existing UI precedent:
  `WithdrawDialog#getTxOptions()` and `TxsService#buildSingSendTx(...)`.
- Launch-kernel behavior:
  validate the Bitcoin address and amount, simulate exact destination/amount/
  fee/change, wait for an explicit wallet approval token, execute through the
  broker, and verify the returned txid/confirmation state.
- The launch kernel never handles WIF, mnemonic, seed phrase, or private key.

### Referral and persistence seam

- Referral deep links are starter-local because no sibling repo exposes
  referral routing. The canonical query fields are `ref`, `campaign`,
  `workflow`, and optional `strategy`.
- A referral opens the matching conversation intent directly.
- Attribution is stored as pending on entry and becomes activated only after a
  verified starter-strategy completion.
- Workflow persistence is starter-local and records funnel stage, public wallet
  connection metadata, deposit observation, simulation, approval state,
  execution/verification, recovery instructions, and referral attribution.
- Hosted browser deployments use a structured D1 binding; the Node demo/test
  harness uses an atomic JSON store implementing the same repository contract.

### NEAR chain-abstraction seam

- Swap library:
  `@defuse-protocol/one-click-sdk-typescript@0.1.25`.
- Reused official calls:
  `OneClickService.getTokens()`, `getQuote()`, `submitDepositTx()`, and
  `getExecutionStatus()`.
- Live discovery on 2026-07-23 returned unique native routes for ETH/USDC on
  Ethereum, Base, Arbitrum, and Optimism plus native BTC and LTC destination
  assets. Asset IDs are still resolved from the current token list at quote
  time rather than copied into code.
- A live dry-run Base USDC to native BTC quote succeeded through the official
  SDK. It returned a correlation ID, exact input/output, minimum output,
  withdrawal fee, and time estimate without moving funds.
- Approval workflow:
  `src/crosschain/kernel.ts`, with atomic JSON persistence in
  `src/crosschain/store.ts`.
- Native account/signing library:
  `chainsig.js@1.1.16`.
- Reused official runtime exports:
  `contracts.ChainSignatureContract`,
  `chainAdapters.btc.Bitcoin`, and
  `chainAdapters.btc.BTCRpcAdapters.Mempool`.
- The signature contract is called only with a public NEAR account and a
  wallet-owned `signAndSendTransactions` callback. Secret-bearing input fields
  are rejected before SDK access.
- THORChain remains reachable only by `CROSS_CHAIN_RAIL=thorchain` or the
  explicit legacy scripts.

### DLC/VTXO seam

- Existing narrow hook:
  `C:\projects\Ark-TradeLayer\tl-vtxo-handshake-optimized\ark-tradelayer-handshake.js#ArkTradeLayerBridge`.
- The launch kernel keeps the typed `DlcPreparationHook` but does not expose
  DLC/VTXO as a supported user intent or strategy in this sprint.

### Missing and deliberately stubbed

- No safe wallet-owned opaque approval-token endpoint exists in the local
  wallet checkout.
- No production Bitcoin mainnet transaction builder/broadcaster is exposed as
  a keyless API by the sibling repos.
- No production position/order query with a stable schema is exposed for the
  Bitcoin type-5 path.
- Therefore `execute` and `verify` are broker interfaces with deterministic
  scripted implementations for evaluation. Production mode is fail-closed
  unless a real wallet broker is configured.
- Quote freshness is enforced in the workflow even though the launch demo uses
  a scripted quote provider; execution rejects simulations older than the
  configured TTL.
- Referral handling and BitAgent conversation state are new starter-local
  modules because none of the source repos owns those product concerns.

## Discovery

- Starter repo: `C:\projects\BitAgent\BitAgent\tradelayer-thorchain-starter\tradelayer-thorchain-starter`
- `UTXO-Ref`: `C:\projects\UTXORef\UTXO-Ref`
- `tradelayer.js`: `C:\projects\tradelayer.js`
- `tradelayer-wallet`: `C:\projects\TLWallet\tradelayer-wallet`
- `tl-relayer`: `C:\projects\tl-relayer`
- `Ark-TradeLayer`: `C:\projects\Ark-TradeLayer`
- NEAR IronClaw: `C:\projects\ironclaw`
- Hermes Agent: `C:\projects\hermes-agent`

## UTXO Reference Structures

- Primary seam: `C:\projects\UTXORef\UTXO-Ref\bitvm3\utxo_referee\index.js`
- Safe current funding seam: `v2.settlement.buildFundingSetV2([{ txid, vout, amountSats, scriptPubKeyHex }])`
- Safe receipt lifecycle seam: top-level `ReceiptDepositIndexer#observeDeposit(...)` with observed, confirmed, credited, and rolled-back states.
- Returned V2 funding fields: normalized `funding[]`, `fundingRoot`, `fundingCount`, and `fundingTotalSats`.
- Legacy payout types such as `PayoutLeaf` are intentionally removed from the safe top-level namespace and require an explicit `legacyUnsafe.load({ acknowledgeUnsafePrototype: true })`. They must not be used for new intake code.
- Funding hardening under active local development: `m1_funding_ledger.js` and `m1_funding_policy.js` provide reservation/idempotency/reorg and exact-PSBT policy concepts. They are currently uncommitted sibling-repo work, so this starter references their design without taking ownership of those files.

## TradeLayer Transaction Builders

- Closest live intake seam: `C:\projects\tradelayer.js\src\txUtils.js`
- Relevant functions:
- `createGrantManagedTokenTransaction(address, params)` for tx11-managed receipt mint / intake-like flow
- `createRedeemManagedTokenTransaction(address, params)` for reverse flow
- `sendTransaction(address, to, propertyId, amount, ...)` used by existing DLC tests for collateral movement
- Payload encoder: `C:\projects\tradelayer.js\src\txEncoder.js`
- Relevant function: `encodeGrantManagedToken(params)`
- Why this seam: existing TradeLayer DLC tests use tx11 grant-managed flows to mint receipt-like assets against vault/collateral movement, so this is the smallest real local path to reuse instead of inventing a new intake format.
- Gap: no explicit `absorbInboundUtxo()` export exists in `tradelayer.js`; this sprint uses tx11 grant-managed as the provisional intake builder and documents the missing native absorb API.

## TradeLayer Testnet Trading Seam

- Primary mock-trade seam: `C:\projects\tradelayer.js\scripts\broadcastBtctestVwapTrades.js`
- Stable exports: `parseArgs`, `buildTradePrints`, `buildVwapSummary`, `buildPlan`, and `validatePlan`.
- Network: Bitcoin testnet4 with paired tlBTC/tlUSD token-for-token trade prints.
- Safe invocation: run the sibling script with `--dry-run` and an explicit `--artifact=<starter runtime path>` argument. Dry-run still constructs and validates the exact OP_RETURN plans while leaving maker/taker txids unset.
- Provisional live seam: invoke the same script without `--dry-run` only when `TL_TESTNET_SUBMIT=true`, an explicit Bitcoin binary/data directory are configured, and an external capability broker has approved the invocation.
- PnL/perpetual reference: `C:\projects\tradelayer.js\scripts\ltcE2ePnlPerpRouteFlow.js` exercises a broader Litecoin testnet PnL route, but it is not called by the starter because its live behavior and fixture requirements are too broad for the default demo.
- Settlement decode seam: `C:\projects\tradelayer.js\src\txDecoder.js#decodeOnChainTokenForToken`. The starter decodes the tx5 payload found in independently observed OP_RETURN bytes and checks reciprocal property/amount fields for each maker/taker pair.
- Bitcoin evidence seam: Bitcoin Core wallet RPC through `bitcoin-cli -chain=testnet4`, using `gettransaction`, `decoderawtransaction`, and confirmation counts. The wallet-generated transaction hex avoids requiring a public txindex for the first live slice.
- Broker seam: Bitcoin Core `walletcreatefundedpsbt`, `decodepsbt`, `getaddressinfo`, `walletprocesspsbt`, `finalizepsbt`, `testmempoolaccept`, and `sendrawtransaction`. The agent does not call these directly.

## Storage And Compute Markets

- Filecoin chain-observation seam: Calibration JSON-RPC, configured by `FILECOIN_CALIBRATION_RPC`; the default endpoint is read-only and used only for an optional chain-head health probe.
- Filecoin deal seam: the starter emits a typed direct-deal preparation containing network, client, piece/CID metadata, duration, and maximum cost. It does not sign or publish a deal proposal.
- Akash seam: a typed deployment order containing an SDL manifest, resource requirements, maximum spend, and provider selection mode. Mock mode is the default; live deployment requires a separate Akash client/CLI broker and explicit approval.
- Other compute markets: `ComputeMarketAdapter` is provider-neutral. Akash is the first concrete provider and `generic` preserves the same quote/order boundary for later marketplaces without granting them custody.
- Chain abstraction seam: Filecoin and Akash preparations can be wrapped as NEAR Chain Signature requests after a one-shot capability lease. Transaction encoding, signer invocation, and relay remain external host duties.

## Wallet And Activity Surface

- Primary wallet runtime seam: `C:\projects\TLWallet\tradelayer-wallet\packages\wallet-fe\src\app\@core\services\bitvm-runtime.service.ts`
- Server/API seam: `C:\projects\TLWallet\tradelayer-wallet\packages\wallet-server\src\routes\main.route.ts` and `packages\wallet-fe\src\app\@core\apis\main-api.service.ts`
- Reusable state: `BitvmStatus`, its `BehaviorSubject`, local persistence, watchtower loop, pending-escrow caps, per-DLC caps, and sweep-window caps.
- Provisional browser seam: the starter-local `TlWebPhantomIntent` remains useful for unsigned intent transport.
- Security constraint: the wallet server's current `sign-tx` and `sign-psbt` routes accept WIF material. The financial survival harness must not call these from an agent process. Signing belongs behind a separate policy broker/HSM/guardian boundary.

## DLC, Ark, And Relayer Hooks

- Ark seam: `C:\projects\Ark-TradeLayer\tl-vtxo-handshake-optimized\ark-tradelayer-handshake.js`
- Exported classes: `ArkTemplateRegistry`, `ArkDepositRecognizer`, `ArkExitRecognizer`, `ArkTradeLayerBridge`
- Relayer seam: `C:\projects\tl-relayer\src\services\tx.service.ts`
- Why this seam: `ArkTradeLayerBridge` is already the narrowest local abstraction for recognizing Ark/VTXO deposits and exits. It is still partially placeholder-based, but it is a better typed boundary than inventing a new DLC adapter in the starter repo.

## Agent Harness Sources

- IronClaw authority seam: `C:\projects\ironclaw\docs\reborn\contracts\capability-access.md`
- IronClaw secret seam: `C:\projects\ironclaw\docs\reborn\contracts\secrets.md`
- IronClaw runtime map: `C:\projects\ironclaw\docs\reborn\2026-04-25-current-architecture-map.md`
- Hermes approval seam: `C:\projects\hermes-agent\tools\approval.py`
- Hermes skill provenance seam: `C:\projects\hermes-agent\tools\skills_guard.py`
- Hermes packaging seam: project skills use the portable `SKILL.md` + `references/` + `agents/openai.yaml` layout.
- Design rule reused here: the model/skill is untrusted userland. It may observe, plan, and request a financial capability, but only a default-deny host may reserve capital, authorize an exact intent, sign, or broadcast.

## Sovereign Harness Design Map

- MeTTa/Hyperon role: typed symbolic policy and replayable state-transition surface. This starter emits a compact MeTTa snapshot for inspection; it does not claim a production Hyperon runtime dependency yet.
- AIRIS role: causal expectations and prediction-error rows. Harness configuration candidates are evaluated against expected decisions, and surprises become structured training/evaluation evidence rather than direct policy mutations.
- DAS role: append-only, content-addressed state events with causal links. The starter keeps this as a local JSONL-compatible atom event seam until a concrete DAS service is selected.
- SelfModels seam: `C:\projects\SelfModel\SelfModels\smtk_starter_repo\docs\hrm_json_schemas.md` and `qwen_local_mechinterp\pet_architecture_1p7b.md`. The host owns identity, memory acceptance, legal actions, and route boundaries; the model proposes bounded local choices.
- IronClaw seam: `C:\projects\ironclaw\docs\reborn\contracts\capability-access.md`. Capabilities are default-deny and exact-invocation leases are one-shot, scoped, and fingerprinted.
- Hermes seam: `C:\projects\hermes-agent\tools\approval.py` and `tools\skills_guard.py`. Skills are procedural memory with provenance/security checks; skill trust never becomes financial authority.
- NEAR seam: 1Click handles current swap quotes/status. Chain Signatures can
  derive accounts and prepare exact Bitcoin PSBTs; `v1.signer` is reached only
  after a connected NEAR wallet approves the generated contract action.
  BitAgent holds no NEAR credential.
- Bitcoin L2 seam: Lightning, Fedimint, Ark/VTXO, DLC, THORChain, TradeLayer, and Bitcoin on-chain remain separate rails with explicit caps and trust metadata. No rail bypasses the survival policy or external signer boundary.

## Missing Or Provisional Pieces

- Missing: explicit TradeLayer `absorb` builder for inbound UTXOs in `tradelayer.js`
- Missing: local `tlweb` checkout or existing Phantom integration package
- Missing: a live NEAR Intents destination-txid to confirmed outpoint/vout
  observer in the starter repo
- Missing: descriptor-aware watch-only Bitcoin wallet adapter and Bitcoin Core/BDK chain source
- Missing: out-of-process signer/policy broker with exact-intent leases
- Missing: append-only signed/hash-chained financial lifecycle journal
- Missing: production LDK, Fedimint, DLC, and Ark clients; these remain capped optional rails
- Missing: funded Bitcoin testnet4 wallet/RPC credentials for live TradeLayer broadcasts
- Missing: Filecoin Calibration client address, storage provider selection, CommP/CAR generation, and deal publisher
- Missing: Akash account/key broker, certificate, provider bid selection, and deployment lease settlement
- Missing: settlement observers that reconcile TradeLayer fills and provider invoices into spendable treasury
- Missing: a funded, synchronized Bitcoin Core testnet4 wallet for exercising the live PSBT broker in this workspace

## Sprint Stubs

- Egress detection is stubbed through explicit observed env values when live chain indexing is unavailable.
- TradeLayer intake uses tx11 grant-managed as the provisional absorb path until a dedicated inbound absorb builder is exposed upstream.
- Phantom/TLWeb integration is exposed as a starter-local intent payload because there is no local `tlweb` package to import directly.
- The financial survival slice emits unsigned, policy-evaluated intents only. It does not sign or broadcast value transfers.
- Testnet trading uses the real sibling-repo planner in dry-run mode. Its profit is projected, never booked as settled treasury.
- Filecoin and Akash integrations prepare bounded orders only; mock provider costs are planning inputs rather than invoices.
