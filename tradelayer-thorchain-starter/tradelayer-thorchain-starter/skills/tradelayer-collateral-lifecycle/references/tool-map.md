# Local Tool Map

Use these local seams as sources of truth. Do not copy their protocol logic
into the skill.

## Wallet and deposit

- BitAgent launch tools:
  `src/launch/tools.ts`
  - `bitagent.wallet.connect`
  - `bitagent.deposit.prepare`
  - `bitagent.deposit.observe`
  - `bitagent.withdraw.simulate`
  - `bitagent.wallet.request_approval`
  - `bitagent.wallet.resolve_approval`
  - `bitagent.action.execute`
  - `bitagent.action.verify`
  - `bitagent.workflow.get`
- Deposit adapter:
  `src/launch/utxoTool.ts`
- Wallet authority protocol:
  `src/launch/remoteWalletProtocol.ts`
  - public wallet snapshot and exact-candidate contracts
  - opaque approval status only
  - testnet4 execution and reconciliation projections
- UTXORef source:
  `C:\projects\UTXORef\UTXO-Ref\bitvm3\utxo_referee\index.js`
- Exact safe export:
  `v2.settlement.buildFundingSetV2(...)`

The launch demo persists public workflow state and uses a scripted broker. The
local TradeLayer wallet now exposes a testnet4-only public authority protocol,
candidate preparation, opaque approval polling, wallet-owned execution, and
positive-proof reconciliation. Execution is disabled by default. Production
remains unavailable; the current executor is hard-limited to testnet4 and must
never pass WIF, mnemonic, raw PSBT, grant, signature, or signed transaction
material through BitAgent.

Wallet sources of truth:

- `C:\projects\TLWallet\tradelayer-wallet\packages\wallet-server\src\services\bitagent-wallet-authority.service.ts`
- `C:\projects\TLWallet\tradelayer-wallet\packages\wallet-server\src\services\bitagent-withdrawal-candidate.service.ts`
- `C:\projects\TLWallet\tradelayer-wallet\packages\wallet-server\src\routes\bitagent-wallet.route.ts`

## Committed algorithmic signals

- Tool schemas and registry:
  `src/signals/tools.ts`
  - `bitagent.signal.start`
  - `bitagent.signal.ingest`
  - `bitagent.signal.simulate`
  - `bitagent.signal.request_approval`
  - `bitagent.signal.resolve_approval`
  - `bitagent.signal.execute`
  - `bitagent.signal.verify`
  - `bitagent.signal.get`
- Signal validation:
  `src/signals/signalValidator.ts`
- Codebase verification:
  `src/signals/codebaseVerifier.ts`
- Risk policy:
  `src/signals/riskPolicy.ts`
- UTXO selection:
  `src/signals/utxoFunding.ts`
- TradeLayer encoding:
  `src/signals/tradelayerSignalAdapter.ts`
- Workflow persistence:
  `src/signals/store.ts`

The algorithm is never imported or executed by BitAgent. It may emit one
signed, typed post-only TLBTC/TLUSD signal from an operator-approved codebase.

## TradeLayer order and settlement

- Protocol encoder:
  `C:\projects\tradelayer.js\src\txEncoder.js`
- Exact order export:
  `encodeOnChainTokenForToken(...)`
- Decoder:
  `C:\projects\tradelayer.js\src\txDecoder.js`
- TradeLayer balance/PnL observer:
  `src/settlement/tradelayerPnlObserver.ts`
- CLI:
  `scripts/observe-tradelayer-pnl.ts`
- Settlement observer:
  `src/settlement/tradelayerSettlementObserver.ts`

Official TradeLayer endpoints may expose transaction, order-book, trade
history, contract-position, and address-balance state. Prefer local checkout
behavior and independently reconcile returned state with Bitcoin transaction
evidence.

## PnL release

No production-safe local broker currently proves that positive TradeLayer PnL
was released or converted into spendable Bitcoin owned by the wallet session.

Require a future broker to:

1. read verified PnL evidence;
2. simulate the exact close/redeem/swap/release action;
3. bind exact effects and fees to a new wallet approval;
4. sign and broadcast outside the model process;
5. return transaction identifiers and a receipt hash;
6. prove the resulting Bitcoin UTXO or wallet balance independently.

Until then:

- allow `simulated` only in simulated mode;
- reject testnet/mainnet completion as `pnl_release_unavailable`;
- never feed a projected or token-valued PnL number into the Bitcoin
  withdrawal balance.

## Existing commands

```powershell
npm run hash:signal-codebase -- "C:\projects\Trading Algos"
npm run demo:launch
npm run demo:signals
npm run test:launch
npm run test:signals
npm run observe:pnl -- --action=snapshot --output=<path>
npm run observe:pnl -- --action=evidence --before=<path> --after=<path> --receipt=<path> --price=<price> --output=<path>
```

Dry-run and scripted commands do not prove funded execution, fills, realized
PnL, release, or withdrawal.

The funded testnet4 candidate commands intentionally stop before signing:

```powershell
npm run test:bitagent-authority:live
npm run test:bitagent-withdrawal-candidate:live
npm run prepare:local-testnet-tx
npm run release:local-testnet-tx
```

These commands prove public state observation, unsigned construction, fee and
effect binding, cancellation, and input-lock release. They do not prove a
broadcast or a TradeLayer fill.
