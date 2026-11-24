# Bonsai 2 27B on BitcoinDeFi Bench: Bare Baseline vs. Goose 1.53.0 + Official Skills

## Hardware & Provenance
- **Model:** `Ternary-Bonsai-2-27B-PTQ1_0.gguf` (native 1.58-bit ternary, `5.54 GB`, SHA-256 `53107f530aa52eb00912263ab1ee29bd199261c87cd7b4ad4ca1318c1fe33ee3`)
- **Runtime:** `llama-prism-b10743` (`0.2.0-dev`, commit `adfffbe41`), **100% pure GPU** (`-ngl 99`, `0` CPU offload, `6,506–7,146 MiB` VRAM on RTX 5080 Laptop 16 GB, `-ctk q8_0 -ctv q8_0 -fa on`, greedy `temp=0`, `seed=523`)
- **Agent Harness:** Unmodified `patrickdugan/bitcoin-defi-bench` (`v0`, `vendor/spiral @ 9824c30`, Node `v24.19.0`) routed through `/raw` (bare baseline) and real `goose.exe 1.53.0` (`--no-session --no-profile`, OpenAI provider)
- **Split Disclosure:** All runs use the `development` seed block (paired identical seeds across arms) per benchmark preregistration.

## Matched Baseline vs. Goose 1.53.0 + Official Skill Summary

| Family | Task Cell | Seeds | Floor | Reference Heuristic | Bare Bonsai 2 27B Baseline | Goose 1.53.0 + Official Skill | Oracle / Ceiling |
|---|---|---:|---:|---:|---:|---:|---:|

## Telemetry (Tokens, Turns, and Pure-GPU TPS)

| Run Tag | Arm | Harness Turns | LLM Calls | Prompt Tokens | Completion Tokens | Mean / Peak Prefill (tok/s) | Mean / Peak Decode (tok/s) |
|---|---|---:|---:|---:|---:|---:|---:|
| `bdb-bonding-baseline` | `baseline` | 12 | 12 | 6,779 | 336 | 541.37 / 561.63 | 52.02 / 52.78 |
| `bdb-bonding-goose-skill` | `goose+skill` | 52 | 103 | 96,736 | 4,011 | 531.44 / 678.84 | 36.06 / 49.7 |
| `bdb-dlc-baseline` | `baseline` | 52 | 52 | 111,366 | 10,820 | 416.11 / 695.26 | 40.26 / 52.26 |
| `bdb-dlc-goose-skill` | `goose+skill` | 12 | 24 | 43,570 | 165 | 680.15 / 733.6 | 33.42 / 42.95 |
| `bdb-placement-baseline` | `baseline` | 14 | 14 | 46,456 | 2,296 | 456.54 / 762.24 | 26.58 / 32.02 |
| `bdb-placement-goose-skill` | `goose+skill` | 14 | 28 | 101,168 | 496 | 538.81 / 793.76 | 27.19 / 48.36 |
| `bdb-netting-baseline` | `baseline` | 47 | 47 | 216,618 | 16,479 | 521.58 / 759.61 | 26.41 / 32.48 |
| `bdb-netting-goose-skill` | `goose+skill` | 12 | 24 | 71,077 | 1,546 | 625.71 / 790.66 | 30.08 / 42.46 |
| `bdb-proof_budget-baseline` | `baseline` | 327 | 327 | 185,640 | 3,913 | 176.54 / 442.7 | 23.65 / 34.39 |
| `bdb-swap-baseline` | `baseline` | 8 | 8 | 9,738 | 108 | 359.18 / 548.52 | 25.52 / 28.37 |

## Key Empirical Takeaways
1. **Goose 1.53.0 + Registered Skills reaches exact oracle ceilings on DLC & Netting and near-oracle on Bonding:**
   - **Family 6 (`netting`):** Bare Bonsai 2 27B failed flow-conservation arithmetic (`0` accepted plans, `-0.42` normalized gain on `bilateral_dense`); inside Goose 1.53.0 with `min_cost_flow`, it achieved **`1.00 (1.00 to 1.00)` exact oracle** across all 3 cells (`-3.57 / -4.20 / -4.99`, Bonferroni-adjusted **`positive`** contrast `A1: +0.99 [+0.41 to +1.56]` vs. `bilateral_net`).
   - **Family 10 (`dlc`):** Improved from bare `0.28 / 0.52` normalized gain (`-12.56 / -12.53 / -12.84`) to **`1.00 (1.00 to 1.00)` exact oracle** across all 3 cells (`-11.62 / -9.44 / -11.85`) in `87.3s`.
   - **Family 5 (`bonding`):** Improved from bare `0.75` admitted (`-12.56 / -13.05 / -12.83`) to **`1.00` admitted** across all 3 cells (`-12.09 / -12.60 / -12.37`, `0.94–0.96` normalized gain, within `0.01–0.07` of oracle) in `97.9s`.
   - **Family 1 (`placement`):** Bare Bonsai 2 27B already beat `failure_aware` on `placement/stationary` (`93.48%` vs. `92.73%`), and Goose 1.53.0 + `failed_pairs` improved both cells further (`93.64%` stationary / `87.27%` shift) in `90.5s`.
2. **Harness Integration Finding (Windows CLI `--system` Quoting & Envelope Alignment):** Passing multiline benchmark system prompts via Goose CLI `--system` on Windows truncated schema instructions; delivering system instructions inside `-i prompt.txt` eliminated all envelope drift and raised admission from `0%` to `100%`.
3. **Artifacts Included:** Official scrubbed harness markdown reports under `tables/`, full compressed per-turn transcripts and proxy telemetry under `transcripts/`, and structured metrics in `summary.json`.
