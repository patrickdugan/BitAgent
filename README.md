# BitAgent

BitAgent is a **candidate-only, testnet/scripted MVP** for a referral-driven
Bitcoin-to-TradeLayer journey:

```text
referral link -> wallet connection -> Bitcoin deposit -> starter strategy
-> approval-bound execution -> position/order verification -> BTC withdrawal
```

It supports exactly three user intents:

1. Help me deposit Bitcoin.
2. Use part of my Bitcoin in the starter TradeLayer strategy.
3. Help me withdraw my Bitcoin.

The application lives in
[`apps/bitagent-launch-kernel`](apps/bitagent-launch-kernel). The web surface
is a public Git submodule at
[`BitAgent-web`](https://github.com/patrickdugan/BitAgent-web).

## Start locally

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
