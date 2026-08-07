# TradeLayer tx11 activation operator

This is a supervised Bitcoin testnet4 host workflow for activating tx11 on the
pinned candidate10 release. It is not an agent tool. The language model never
receives the PSBT, approves, signs, broadcasts, or authorizes a retry.

The required order is:

```text
prepare and simulate -> display exact effects -> approve or cancel -> execute -> verify
```

## Prerequisites

- a fully synchronized Bitcoin Core testnet4 node;
- a loaded, funded wallet whose sender address matches the request;
- the candidate10 request and policy fingerprint produced by the release
  preflight;
- a private runtime directory accessible only to the wallet host.

Set `BITCOIN_BIN`, `BTCTEST_DATADIR`, `BTCTEST_RPC_PORT`, `BTCTEST_WALLET`, and
`TL_ACTIVATION_POLICY_FINGERPRINT` for that wallet host. No private key, WIF,
mnemonic, or seed phrase is accepted.

After rerunning `npm run test:launch:release`, build the public request from the
fresh, exact release-source receipt. This command has no wallet or network
effect; it only validates the pinned manifest/source binding and writes a public
request:

```powershell
.\node_modules\.bin\tsx.cmd scripts\create-tradelayer-activation-request.ts `
  --sender-address=<owned-testnet4-address> `
  --max-fee-sats=2000
```

The source receipt must be no more than 15 minutes old by default. The generated
`sourceVerificationHash` binds the release ID, status, deployment commit, code
hash, and clean verified source checkout. A mismatched or stale receipt fails
closed before any wallet RPC is available.

The same command derives the public `policyFingerprint` from the exact release,
testnet4 network, wallet name, normalized sender, fee cap, one-input rule,
required output order, external-wallet signing authority, and model-execution
denial. Set `TL_ACTIVATION_POLICY_FINGERPRINT` to that printed value before the
wallet-hosted prepare step. A different supplied fingerprint is rejected.

## 1. Prepare and inspect

Preparation reserves exactly one confirmed wallet input and atomically stores
the private PSBT envelope. It prints only the public approval view.

```powershell
$env:TL_TESTNET_ACTIVATION_PREPARE = "true"
.\node_modules\.bin\tsx.cmd scripts\tradelayer-activation-operator.ts `
  --action=prepare `
  --input=.runtime/testnet-agent/tradelayer-activation/request.json
```

Read and compare every `exactEffects` field: input outpoint/value, tx11-only
OP_RETURN bytes and UTF-8 payload, positive wallet change, fee, unsigned txid,
PSBT hash, and approval hash. The output must not contain `rawPsbt`.

The durable default store is
`.runtime/testnet-agent/tradelayer-activation/private-candidates.json`. Writes
are serialized, atomic, integrity checked, and requested with owner-only file
mode. A corrupt store fails closed and is never overwritten by recovery logic.

## 2. Resume or cancel

After a refresh or process restart, display the same public view:

```powershell
.\node_modules\.bin\tsx.cmd scripts\tradelayer-activation-operator.ts `
  --action=status `
  --approval-hash=<exact-approval-hash>
```

To reject the candidate and prove the input lock was released:

```powershell
.\node_modules\.bin\tsx.cmd scripts\tradelayer-activation-operator.ts `
  --action=cancel `
  --cancel=<exact-approval-hash>
```

## 3. Explicit wallet approval and execution

Only after checking the displayed effects, set the submit interlock and repeat
the exact approval hash:

```powershell
$env:TL_TESTNET_ACTIVATION_SUBMIT = "true"
.\node_modules\.bin\tsx.cmd scripts\tradelayer-activation-operator.ts `
  --action=approve-execute `
  --approve=<exact-approval-hash>
```

The host revalidates the private envelope, node synchronization, unsigned
transaction, wallet ownership, finalized transaction, and mempool admission
before broadcast. Before signing it durably records `execution_requested`; an
interruption after that point never returns to approval-pending and permits only
positive reconciliation. A rejected signature or definite pre-broadcast failure
releases the input and is durably labeled `failed_released`.

If submission is ambiguous, the durable state is `submission_unknown`, the
input remains reserved, and retry is prohibited. Only positive observation of
the exact txid can advance it:

```powershell
.\node_modules\.bin\tsx.cmd scripts\tradelayer-activation-operator.ts `
  --action=reconcile `
  --approval-hash=<exact-approval-hash>
```

Absence is not evidence of failure and never authorizes another transaction.
Independent listener/Bitcoin activation proof is still required after a
confirmed transaction before release promotion or funded TradeLayer use.
