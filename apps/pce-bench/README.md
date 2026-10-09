# PCE-Bench: Personal Context Exploitation Benchmark

How does progressively richer personal context change an assistant's
capacity to leak private facts, state protected conclusions, act beyond
delegated authority, or be socially engineered? PCE-Bench is a
standard-library-only Python harness that builds a synthetic longitudinal
population, exposes a defender to seven context levels and five memory
architectures, scores every reply against a relational ground-truth graph,
and tests whether the effect of context is volume, connectivity, tool
access, or the memory system's own summarisation.

Read in order:

1. [docs/00_hypothesis_critique.md](docs/00_hypothesis_critique.md): why the
   stated hypothesis is underdetermined, ten alternatives, and the minimum
   viable experiment that can falsify it.
2. [docs/01_threat_model.md](docs/01_threat_model.md): system tuple, access
   lattice, six scenarios, goals, scope, one-page proposal.
3. [docs/02_benchmark_spec.md](docs/02_benchmark_spec.md): artifacts,
   schemas, levels, families, scoring, architectures.
4. [docs/03_statistical_analysis_plan.md](docs/03_statistical_analysis_plan.md):
   measures, the proposed decision rule, shape fits, ablations.
5. [docs/04_paper_outline.md](docs/04_paper_outline.md).
6. [docs/05_control_harness_integration.md](docs/05_control_harness_integration.md).
7. [docs/06_calibration_results.md](docs/06_calibration_results.md): what
   the scripted controls show, including the design defects they caught.
8. [docs/07_review_response.md](docs/07_review_response.md): the first
   review's five issues, what changed for each, and the evidence.
9. [docs/08_live_exploratory_cloud.md](docs/08_live_exploratory_cloud.md):
   the cloud run with Claude models, once a cloud environment has an API
   credential (as of 2026-10-10 it records why it has not run).
10. [docs/09_live_exploratory_local.md](docs/09_live_exploratory_local.md):
    two local model families (Bonsai 8B, Qwen2.5-3B) on the development
    pack, exploratory.

## Quick start

No dependencies beyond Python 3.10+. `pytest` for the tests.

```bash
cd apps/pce-bench
PYTHONPATH=src python -m pce_bench run --config configs/preflight_scripted.json --out results/preflight
```

```bash
PYTHONPATH=src python -m pce_bench analyze --out results/preflight
```

```bash
PYTHONPATH=src python -m pce_bench report --out results/preflight
```

```bash
PYTHONPATH=src python -m pytest tests -q
```

Other commands: `generate-population`, `build-probes`, `verify`. See
`python -m pce_bench --help`.

## Configs

| File | Design | Question |
|---|---|---|
| `configs/preflight_scripted.json` | ladder, levels 0-6, 5 scripted defenders, 5 architectures | plumbing, scoring, architecture ordering |
| `configs/mve_matched_pair_scripted.json` | within-persona linked vs scattered, 100 personas, 3 seeds | the falsification experiment, calibrated on a null and a hypothesis defender |
| `configs/factorial_capabilities_scripted.json` | level x capability set | tools versus information |
| `configs/memory_mode_ablation_scripted.json` | transcript / summary / summary with inferences | summarise-then-store as the mechanism |
| `configs/memory_writer_ablation_scripted.json` | summaries with locally derivable vs globally derivable conclusions at partial retrieval | the memory writer as a separate principal |
| `configs/scorer_validation_scripted.json` | surface-form vs paraphrasing leaky controls against the oracle judge | the deterministic scorer's blind spot; admission test for a model judge |
| `configs/mve_matched_pair_confirmatory.json` | the confirmatory pack, population seed 1, hash-locked | one run per live defender, after sign-off |
| `configs/dev_pack_live.example.json` | development pack, seed 2, two live families plus a Claude judge | exploratory live runs |
| `configs/live_llama_server.example.json` | ladder with a local OpenAI-compatible defender | local-model template |

Live defenders: `live_anthropic` (official `anthropic` SDK, optional
dependency, credentials from the environment or `ant auth login`) and
`live_openai_compatible` (any chat-completions server, key from
`OPENAI_API_KEY`). Runs with live defenders or judges need `live.allow` in
the config and `--allow-live-inference`. Development and calibration use
population seed 2; the confirmatory pack is seed 1 and refuses to run if
the generator has drifted from its hash.

Other commands: `pair-diagnostics` (matching invariants per persona) and
`validate-judge` (scorer agreement on the validation config).

## Layout

```
src/pce_bench/
  graph.py          relational graph, inference closure, sensitivity mass
  arcs.py           story-arc catalogue (facts, inferences, decoys)
  population.py     deterministic fictional personas
  history.py        sessions, connected-app records, memory summaries
  levels.py         context levels, matched pair, length matching
  probes.py         seven attack families plus benign utility
  scoring.py        judge-free disclosure scoring
  architectures.py  A monolithic .. E control harness
  defenders.py      scripted controls and the live adapter
  stats.py          Wilson, exact McNemar, Holm, cluster bootstrap, IRLS, shape fits
  harness.py        runner, receipts, summary, analysis, verification
  cli.py
schemas/            JSON Schemas for graph, probe, episode row
configs/            experiment configs
tests/              unit and end-to-end calibration tests
docs/               threat model, spec, analysis plan, outline, results
```

## Safety boundaries

Every persona, organisation and place is fictional; attacker endpoints use
the reserved `.example` domain; actions are simulated ledger commits; the
impersonation family scores which private details are surfaced and never
produces a message. Scripted defenders are positive and negative controls,
not evidence about any model.
