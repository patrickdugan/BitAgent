---
name: bitagent-hermes-launch
description: "Coordinate the candidate-only BitAgent launch workflow on Hermes Lite or Bonsai 8B: classify one supported intent, retrieve a bounded 12k phase packet, select only reviewed read-only tools, preserve workflow recovery, and hand exact simulations to the wallet approval boundary. Use for referral onboarding, Bitcoin deposit, starter TradeLayer strategy simulation, withdrawal planning, testnet4 rehearsal, local Bonsai screening, or launch-readiness review."
---

# BitAgent Hermes Launch

Run only the supported lifecycle:

```text
referral -> wallet -> Bitcoin deposit -> starter strategy -> withdrawal
```

Use the model as a candidate producer. The deterministic host owns state,
simulation, evidence validation, and verification; the wallet/user owns
approval and signing; the execution broker owns the one-time approved action.

## Load the current phase

Read [references/authority-contract.md](references/authority-contract.md) first.
Read [references/runtime-policy.md](references/runtime-policy.md) for local
Bonsai screening or any testnet4 rehearsal. Then load exactly one phase packet
from [references/mcp-12k-resource-manifest.json](references/mcp-12k-resource-manifest.json).

Use the existing domain skills rather than creating parallel workflows:

- `tradelayer-collateral-lifecycle` for deposit, collateral, strategy, and withdrawal state;
- `bitagent-compliance` before referral or market-facing copy;
- `agent-financial-survival` for deterministic expense-policy review;
- `android/termux/hermes-skill` only for the mobile candidate surface.

## Candidate-only protocol

1. Read persisted workflow and public evidence handles.
2. Classify only: deposit, starter strategy, withdrawal, or recovery/hold.
3. Ask the deterministic host to simulate the exact next action.
4. Display host-provided effects, fees, expiry, and evidence hashes.
5. Stop at `wallet.request_approval`; never approve, sign, execute, broadcast,
   request secrets, or report an unobserved balance/transaction.
6. After broker execution, read deterministic verification evidence and persist a
   classified receipt or recovery state.

Never expand the starter strategy, custody assets, import a signal codebase, or
treat a benchmark tool label as a production capability.

## MCP-intensive 12k mode

The 12k window is inclusive. Use at most three active reviewed tools, three
rounds, six calls, five resource handles, and one failure replay. Keep raw
PSBTs, signatures, wallet grants, transcripts, and raw tool results external;
carry only a compact evidence ledger and hashes. Reject an over-budget packet
instead of reducing output, safety, or approval constraints.

## Completion and recovery

Treat a scripted receipt as simulated, never funded. Testnet4 requires observed
wallet and chain evidence. Production remains disabled until the exact release,
independent TradeLayer verification, wallet-owned approval broker, PnL release,
and Bitcoin withdrawal verification gates all pass.

For stale quotes, rejected signatures, unconfirmed deposits, disconnects, or
ambiguous submission: preserve state, do not retry an effect, and route to the
matching recovery packet.
