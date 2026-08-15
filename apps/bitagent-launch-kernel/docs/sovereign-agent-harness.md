# Sovereign Agent Harness

## Working Definition

The sovereign harness is a host-owned control plane around an untrusted model. The model may propose actions, memories, skills, routes, and configuration mutations. It cannot authorize, sign, broadcast, rewrite immutable constraints, or promote its own configuration.

This sprint implements the smallest vertical slice:

```text
bounded configuration candidates
  -> expected-flow benchmark arena
  -> causal surprise records
  -> zero-unsafe-authorization promotion gate
  -> structured self-model update
  -> exact capability request
  -> one-shot fingerprinted lease
  -> unsigned NEAR Chain Signature preparation
  -> hash-linked event and MeTTa inspection artifacts
```

## Design Sources

- MeTTa/Hyperon: typed symbolic state and explicit policy facts.
- AIRIS: expected causal outcomes and prediction-error evidence.
- DAS: content-addressed events with causal links and replayable history.
- SelfModels: the host owns continuity, memory acceptance, legal actions, and route boundaries.
- IronClaw: default-deny capabilities with scoped, exact-invocation leases.
- Hermes: portable skills and reflection as untrusted procedural memory with provenance checks.
- NEAR Chain Signatures: optional threshold-signing backend after host authorization.
- Bitcoin L2s: multiple bounded execution rails behind one policy membrane.

The local source paths and exact seams are recorded in `docs/repo-map.md`.

## Authority Boundaries

| Layer | May do | Must not do |
| --- | --- | --- |
| Model/skill | Propose intent, route, memory, config candidate | Hold keys, grant capabilities, promote itself |
| Benchmark arena | Compare candidates to expected flows | Execute financial actions |
| Self-model store | Preserve identity, constraints, competence, memory head | Accept model-written state without validation |
| Policy membrane | Deny, require approval, or authorize an exact intent | Sign or broadcast |
| Lease store | Issue and consume one exact capability lease | Create ambient/reusable authority |
| External signer | Sign an independently reconstructed payload | Trust model prose or a mutable prompt |
| Runtime/relayer | Broadcast and reconcile observed results | Invent authorization after the fact |

## Adaptation Rule

The demo evaluates four configurations: baseline, calibrated, permissive, and over-cautious. A candidate is promotable only when every critical benchmark matches its expected decision, it produces zero unsafe authorizations, and its score exceeds the baseline.

The calibrated configuration fixes a safe false block at 35,000 sats. The permissive candidate is rejected because it authorizes an oversized payment and an experimental Ark action. The self-model updates only after the promotion gate succeeds.

This is configuration search with hard safety constraints. It is not online weight training, unrestricted self-modification, or evidence of general alignment.

## Bitcoin And L2 Capability Surface

The existing survival policy keeps Bitcoin on-chain, Lightning, THORChain, TradeLayer, Fedimint, Ark/VTXO, and DLC as distinct rails with separate caps. Experimental rails require manual approval. No capability includes broadcast authority.

## NEAR Chain Signature Seam

`src/adapters/nearChainSignatureAdapter.ts` validates an active lease and emits a prepared request envelope containing the target chain, derivation path, payload hash, lease ID, and authorization proof hash.

It does not contact `v1.signer`, load credentials, return a signature, or relay a transaction. A production host must reconstruct the transaction, compare the payload hash, call the MPC contract, verify the result, consume the lease transactionally, and reconcile the destination chain.

## Run

```powershell
npm run demo:sovereign
```

Outputs are written to `.runtime/sovereign-demo/latest/`:

- `summary.json`
- `events.jsonl`
- `self-model.metta`

The wallet activity feed also receives the selected configuration, score, unsafe-authorization count, consumed lease status, and NEAR adapter status.

## Next Build Arc

1. Replace the in-memory lease store with an out-of-process durable capability broker.
2. Add a real MeTTa validator for immutable constraints and transition admissibility.
3. Map atom events into an actual DAS backend with replay and branch isolation.
4. Import SelfModels router benchmark rows as additional expected-flow scenarios.
5. Integrate Hermes skill provenance as candidate metadata, never authority.
6. Add Bitcoin Core/LDK/Fedimint/Ark/DLC read-only observers before any live capability.
7. Add NEAR testnet Chain Signature requests only after exact transaction reconstruction and test-vector validation exist.
8. Add live submission one rail at a time, beginning with capped testnet flows and mandatory reconciliation.
