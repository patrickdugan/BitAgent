# BitAgent

BitAgent is an agent stack for **Bitcoin-native DeFi, built to work with every
Bitcoin settlement rail rather than to pick one.** The agent's job is to move
and place Bitcoin capital for a user on L1, Lightning, Ark, TradeLayer,
DLCs, Nostr coordination and air-gapped signing, under one rule: the model
chooses and explains typed actions, and a deterministic host plus a
wallet-owned broker holds every key, approval and broadcast.

Three things live here, and a sibling set of public repos measures and hardens
them:

1. **A working vertical slice** (the launch kernel): referral link, wallet
   connection, Bitcoin deposit, starter TradeLayer strategy, approval-bound
   execution, verification, BTC withdrawal. Candidate-only, testnet/scripted.
2. **Small-model agency**: Bonsai/Hermes-class models, DAG adapters and skills
   that run on a laptop or phone (Android/Termux), so the agent need not be a
   hosted frontier model.
3. **An authority boundary** that keeps those models from touching keys or
   funds (see below). Work on a stronger runtime control layer, with a
   re-entrancy bench against Goose, is in progress and not yet published.

## The Bitcoin DeFi ecosystem BitAgent targets

| Rail | What the agent does there | Repo |
| --- | --- | --- |
| TradeLayer (UTXO-linked contracts) | deposit, starter strategy, withdrawal | [launch kernel](apps/bitagent-launch-kernel), [UTXO-Ref](https://github.com/patrickdugan/UTXO-Ref), [tradelayer-wallet](https://github.com/tradelayer-wallet/tradelayer-wallet) |
| Lightning channels | directional capital placement, rebalancing | [bitcoin-defi-bench](https://github.com/patrickdugan/bitcoin-defi-bench) families 1, 2, 6 |
| Ark VTXOs | server liquidity sizing, exit proofs | [vtxo-exit-proof](https://github.com/patrickdugan/vtxo-exit-proof), bench family 3 |
| DLCs | payout-curve rounding, collateral sizing against the `dlcspecs` rules | bench family 10 |
| Nostr and bitchat mesh | key custody, private messaging, counterparty checks | bench family 9 |
| Settlement objects and proof-carrying registries | choosing what to settle with, proving claims within a budget | bench families 3, 5, 7, built on the [Spiral](https://github.com/patrickdugan/Spiral) paper *Where the Capital Bound Moves* |
| Cold signing | single-key taproot signing with no network path | [airsign](https://github.com/patrickdugan/airsign), [SecureKeys](https://github.com/patrickdugan/securekeys) |
| Consensus behavior | differential testing against Bitcoin Core | [jurassic-bitcoin](https://github.com/patrickdugan/jurassic-bitcoin) |

EVM-side ETH/USDC liquidity can enter through a THORChain swap into a
BTC/LTC UTXO that is mapped through UTXO-Ref and absorbed into TradeLayer. See
[chain-abstraction](apps/bitagent-launch-kernel/docs/chain-abstraction.md) and
[repo-map](apps/bitagent-launch-kernel/docs/repo-map.md). That path is a
scripted slice, not a production bridge.

## Evals and benchmarks

- **[Bitcoin DeFi Bench](https://github.com/patrickdugan/bitcoin-defi-bench)**:
  deterministic, seeded simulators of an operator's capital decisions across
  Lightning, Ark, DLC and Nostr rails. Each task reports a normalized gain over
  a random baseline against an oracle, with preregistered hypotheses and
  confirmatory seeds. It produces a profile across families, never one
  composite score. One model (Bonsai 8B) has been run on a subset; the
  bench's own README says which families are preregistered and which are
  exploratory.
- **Launch kernel evaluator**: 51 focused agent cases plus scripted launch
  suites for the referral, deposit, strategy, approval, recovery and
  withdrawal paths (below).
- **[Stego Bench](https://github.com/patrickdugan/stego-bench)**: capacity,
  detectability and survival of covert channels in small open-weight models,
  relevant to agents that coordinate over public relays.
- **Wallet and signer security audits** (AI-assisted, with findings fixed in
  [airsign](https://github.com/patrickdugan/airsign), see its
  `SECURITY_AUDIT.md`).

## Adapters and tooling

- [BitAgent-web](https://github.com/patrickdugan/BitAgent-web): the public web
  surface, a submodule of this repo.
- [Bonsai 8B DAG adapter](model-releases/bitagent-bonsai8b-dagv2-lora-v3):
  LoRA release used by the Hermes tool loop.
- [jev-qwen](https://github.com/MoralityLabAI/jev-qwen): a Qwen3.5-4B
  decision model for approve/repair/reject calls.
- [vramorama](https://github.com/patrickdugan/vramorama): GPU allocation
  tracking for the shared machine the evals run on.

## Authority boundary

Every state-changing action follows:

```text
explain -> simulate -> display exact effects and fees -> request approval
-> execute -> verify
```

The model may select and explain typed tools, but it cannot request or access
seed phrases/private keys, sign, broadcast, approve on the user's behalf, or
invent wallet, quote, confirmation, or transaction state. The deterministic
host validates and persists workflow state; a wallet-owned broker is the only
future signing/execution boundary.

`fundedExecutionAllowed` is intentionally `false`. This repository is ready
for supervised scripted/testnet evaluation, not funded or autonomous trading.

## Start locally

The launch kernel supports three intents: deposit Bitcoin, use part of it in the
starter TradeLayer strategy, and withdraw it.


```powershell
git clone --recurse-submodules https://github.com/patrickdugan/BitAgent.git
Set-Location BitAgent\apps\bitagent-launch-kernel
npm install
npm run launch
```

Open `http://127.0.0.1:8790/`. A direct referral example is:

```text
http://127.0.0.1:8790/?ref=demo-referrer&campaign=launch&workflow=starter_strategy&strategy=starter-v1
```

## Verify the MVP

```powershell
npm run test:skills
npm run eval:launch
npm run demo:launch
```

The bundled evaluator contains 51 focused agent cases; the scripted launch
suite covers the referral, deposit, strategy, approval, recovery, and
withdrawal paths. Failure traces are written as sanitized JSONL/JSON artifacts
under the launch kernel's `eval/` and `.runtime/` directories.

## Hermes / Bonsai skills

The repo-native coordinator skill is
[`bitagent-hermes-launch`](apps/bitagent-launch-kernel/skills/bitagent-hermes-launch).
It routes the short-context Hermes flow to the existing lifecycle, compliance,
financial-survival, and marketing skills. Its MCP-intensive context contract is
strictly inclusive of a 12k-token window and preserves the candidate-only
authority boundary.

For a local low-resource runtime, it encodes the current NVIDIA 3050 thermal
policy: 79 C hard limit, 75 C proactive cutoff, and a three-sample admission
temperature of at most 71 C. It does not launch a model, sign a transaction,
or contact a chain node.

## Current blockers to a funded launch

- The locally checked-out `tradelayer.js` source has uncommitted drift from the
  sealed tx11 release manifest. The release test correctly fails closed until
  an operator either restores the pinned source or deliberately produces and
  approves a new sealed release manifest.
- The local Bitcoin Core testnet4 endpoint still needs operator-configured
  loopback RPC authentication before a real wallet-observed testnet journey
  can be exercised. Do not provide keys, seed phrases, or WIFs to BitAgent.
- A wallet-owned opaque approval/sign/broadcast/verification broker must be
  configured and independently audited before funded execution can be enabled.

See the launch kernel's
[operator guide](apps/bitagent-launch-kernel/docs/operator-guide.md),
[architecture](apps/bitagent-launch-kernel/docs/launch-kernel-architecture.md),
and [launch-readiness report](apps/bitagent-launch-kernel/docs/launch-readiness.md)
for the detailed operating procedure.
