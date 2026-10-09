# 05. Integration with Control-Harness

Control-Harness lives at `C:\Users\patri\Documents\GitHub\MoralityLabAI\Control-Harness`
(branch `claude/runtime-control-layer` when this was written, with untracked
work from another session, so nothing there was edited). PCE-Bench reuses
its discipline and its envelope rather than its code.

## What was reused

| Control-Harness element | PCE-Bench counterpart |
|---|---|
| `receipt-record.v2` kinds (`run_start`, `probe`, `action_proposed`, `monitor_decision`, `environment_transition`, `run_end`) and the hash chain | `harness.Receipt`; chains verified by `verify` |
| data-only scenario packs bound by `content_sha256` | population and probe packs bound in the manifest; `population.path` + `content_sha256` in a config refuses a changed file |
| the environment decides authorization at commit time; the actor's own claims carry no weight | `ControlHarness` architecture: a proposal's citation of injected authority is ignored; commits need the requester to be the authenticated principal and a standing authorization |
| `attempted_violations` vs `escaped_violations` vs `false_blocks` | `unauthorized_actions_attempted` vs `_committed` vs `false_refusal` |
| scripted positive and negative controls before any model | `leaky`, `rule_following`, `volume_linear`, `connectivity_superlinear`, `injection_prone` |
| matched cells that differ in one typed field, template as the unit, exact McNemar | the linked/scattered pair, (persona, probe, seed) as the unit, exact McNemar with Holm |
| fix scorer and thresholds before outcomes | [03](03_statistical_analysis_plan.md) is marked proposed; the live example config warns not to run the matched pack first |
| `AgentAdapter` for scripted and live actors; `llama_server` backend | `Defender` with the OpenAI-compatible adapter |

## Architecture F and the control plane

The first review asked for a stronger separation between authenticated
session identity and the provenance of instructions. Architecture F
(`ProvenanceHarness`) is that separation expressed with the typed inputs the
harness already has: the principal's own turn text, the retrieved content,
and the memory context. It adds request scope, taint redaction, the
memory-writer check and in-turn authorization on top of E. In
Control-Harness terms, F treats the principal's words as
`environment_sound` provenance for this turn, retrieved content as
`model_sound` at best, and a memory-writer conclusion as a claim whose
lineage must be re-derivable from retrievable premises before it is
admitted. That is the Typed v2 membrane rule applied to disclosure and to
instruction source rather than to grants.

## Where the two should meet next

1. **Run PCE-Bench episodes through the runtime control plane.** The
   Goose-Experiments `runtime_control` package serves tools behind a gateway
   that commits only against a one-shot lease. Architectures E and F are
   the policies that gateway would enforce: register a
   `PceDisclosureEngine`, a `PceProvenanceEngine` and a `PceActionEngine`
   with `runtime_control.engines`, expose `memory_retrieve`, `reply`, and
   the four action tools through the gateway, and compare the ledger field
   by field with `episodes.jsonl` as `run_config_through_control_plane`
   does for the contract environment.
2. **Export rows as Control-Harness scenarios.** A PCE probe plus bundle is
   a scenario with environment-owned truth (the graph) and conditions (level,
   mode, architecture). A `to_scenario_v1()` exporter would let the matrix
   runner and its `summarize` consume PCE episodes directly.
3. **Held-out arcs.** Control-Harness's open question, who authors held-out
   families, applies here unchanged. Arcs for the confirmatory run should be
   written by someone who has not read `scoring.py`.
4. **Live defender.** The same local `llama-server` recipe used for the
   Bonsai 8B contract-matrix smoke works with
   `configs/live_llama_server.example.json`: alias must match `model`, run
   with `--allow-live-inference`, stop the server afterwards.

## What was deliberately not done

- No import of Control-Harness modules. PCE-Bench is standard-library only
  so it runs in any venv; the envelope compatibility is by schema, not by
  code.
- No edits in the Control-Harness checkout.
