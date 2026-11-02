# RTX 5080 experiment queue

As of 2026-10-31. Machine-readable rows, with hashes, caps, stop conditions and required artifacts, are in [queue.json](queue.json). This page is the summary and the first-run proposal.

The source Page ("RTX 5080 Experiment Queue" in ChatGPT) sits behind a login and could not be read. Every row here comes from local inspection.

## Machine state at inventory

- GPU: RTX 5080 Laptop, 16,303 MiB, 5 MiB used, no compute process, enforced power limit 150 W (not the 15 W cap).
- RAM: 31.1 GB physical with about 1.6 GB available; commit 67 of 113 GB. Physical RAM, not VRAM, is the tight resource.
- No other agent holds the GPU. A `cargo test` from another session and idle Codex sandboxes are running; nothing was stopped.

## Research queue

| ID | Pri | Experiment | Work | Status | Gate / blocker |
|---|---|---|---|---|---|
| Q1 | 1 | BrokenVerifier-Gym v0.3 CUDA dev sanity run | GPU | DONE | 2026-10-31: exit 0, identical to CPU preflight, strict coverage 0 |
| Q1b | 1 | BrokenVerifier-Gym v0.3 sealed held-out (seed 50931, once) | GPU | DONE | 2026-10-31: run once; strict coverage 0; lenient shows no truth separation |
| Q2a | 2 | ConstitutionalAlignment format diagnosis (chat-template render, tokenizer only) | CPU | DONE | 2026-11-01: multi-turn template drops think block on turns 1-2; explains all 3,200 invalid rows |
| Q2b | 2 | ConstitutionalAlignment NF4-vs-bf16 check on the 6 existing adapters | GPU | DONE | 2026-11-02: NF4 does not restore reasoning; it empties the think block in the demo arms too (their trained format) |
| Q3a | 3 | Bonsai 2 27B S0 codec unit checks at `0064ab4` | CPU | DONE | 2026-10-31: 23/23 pass (torch); vectors hand-written, still synthetic |
| Q3b | 3 | Bonsai 2 27B S0 real-row parity | CPU | DONE | 2026-10-31 PASS: bit-exact vs fork C dequant, 402 tensors; no forward pass |
| Q3b2 | 3 | Bonsai 2 27B S0 projection parity (one projection, real signs) | CPU | DONE | 2026-11-01 PASS on 3 weights; only gap is the fork's Q8_0 activation quantization |
| Q3b3 | 3 | Bonsai 2 27B S0 full-model logit parity (32 prompts) | CPU/GPU | DONE | 2026-11-02 PASS (A1 CPU-only ref): PQ2 CPU and full CUDA both 99.326% top-1 vs PTQ1 CPU |
| Q3c | 3 | Bonsai 2 27B GPU inference baseline (8K/32K VRAM) | GPU | DONE | 2026-11-02: 32K peak 8,480 MiB, pp512 950 t/s, tg 47.7 t/s |
| Q4a | 4 | BitAgent / Hermes | TBD | BLOCKED | no defined experiment to run |
| Q4b | 4 | Persona Holonomy v0.13 Qwen pilot | CPU→GPU | EXTERNAL | another Claude session is running the confirm runs on the GPU |
| Q4c | 4 | Storyworld steering: TSUN-01B scripted oracle + tests (GPTStoryworld `c8d4659`) | CPU | DONE | 2026-11-01: 8/8 policies match oracle; tests 8/8 + 9/9 |
| Q4c2 | 4 | Storyworld steering: live GGUF run (gne, 24-unit recipe) | GPU | BLOCKED | Qwen3.8-27B Q3_K_XL downloaded + CUDA 12.8 in WSL; gne build refused by classifier (needs your approval) |
| Q4d | 4 | Adict RMAX/HAB two-query measurement | GPU | DONE | 2026-11-02: RMAX lands in RMAX; HAB unassigned again (CG 0.16); Adict 0394d33 local main, unpushed |
| Q4e | 4 | Exoself: ExoselfBench Dugan-v-Dugan (`18d9e024`) tests, validate, mock demo | CPU | DONE | 2026-11-01: 33/33 tests; validate OK (12 cases, 3 profiles); 180 mock turns |
| Q4e2 | 4 | Exoself: live evaluation | GPU | DONE | 2026-11-02: driver + pinned manuscripts; base/prompt/rag 30 calls each, valid, no probability movement; adapter arms + human scoring still open |
| X1 | – | Recurrent mechinterp (RMP, RC-01) | – | EXTERNAL | Silico |
| D1 | – | ConstitutionalAlignment six-arm run | – | DONE | do not retrain |
| D2 | – | BrokenVerifier v0.3 CPU fp32 dev preflight | – | DONE | negative result kept |

Evidence classes: Q1, Q1b, Q2b, Q3b and Q3c produce real-model evidence; Q3a is synthetic (a codec round-trip cannot catch a layout error shared by encoder and decoder); Q2a is template inspection. Negative results kept on record: BrokenVerifier strict parser 140/140 invalid; six-arm reflection arms 3,200/3,200 format-invalid, with the registered result left standing.

What Q2a already knows: none of the rendered training files contain `<think>` or `</think>` (15 stray `</think>` strings inside F3-concrete training text), and every reflection eval row has empty `reasoning_content` with `finish_reason` stop.

## Creative queue (kept separate)

| ID | Project | Status |
|---|---|---|
| C1 | JRPG (`Documents\GitHub\JRPG`, worktrees anim-foundation, timing-windows) | not assessed |
| C2 | inner-war (`inner-war`, `inner-war-dist`) | not assessed |

## Proposed first run: Q1, BrokenVerifier-Gym v0.3 CUDA development

Bounded to one attempt, one process, ≤ 4 GB VRAM, ≤ 15 minutes. The held-out split is not touched.

Prerequisites (all checked 2026-10-31): worktree `C:\Users\patri\Documents\Codex\Control-Harness-bvg-v03` clean at `99738c6`; venv `bvg-v03` with torch 2.11.0+cu128 and transformers 4.46.3; Qwen2.5-0.5B-Instruct@`7ae55760` cached (sha256 `fdf756fa…fb7fe`); GPU idle at a 150 W limit. The flight script itself refuses under 3,000 MiB free or under 50 W, and a refusal is not an attempt.

```powershell
Set-Location C:\Users\patri\Documents\Codex\Control-Harness-bvg-v03
$py = "$env:USERPROFILE\.venvs\bvg-v03\Scripts\python.exe"
nvidia-smi --query-gpu=memory.used,memory.total,enforced.power.limit,pstate --format=csv
& $py scripts\fly_broken_verifier_model.py -- --split development --backend transformers --device cuda --dev-cases 2 --out-dir results\broken_verifier_gym\model_dev_qwen_v03
& $py scripts\reparse_broken_verifier_model.py results\broken_verifier_gym\model_dev_qwen_v03
```

Completion checks:

1. A new `results\broken_verifier_gym\v03_attempts\<utc>-development\exit.json` with `exit_code` 0; `env.json` names CUDA, the GPU, checkpoint hashes matching `fdf756fa…` and commit `99738c6`.
2. `model_dev_qwen_v03` holds 48 rows and about 140 model calls, like the CPU preflight; the manifest identity matches the registered config.
3. Response shapes compared with the CPU fp32 preflight. If strict coverage is again 0, record it as the expected negative result; do not touch the parser.
4. Lenient re-parse table produced next to the strict one and labelled secondary.
5. No held-out directory is created. Q1b waits for your go.

On failure: keep the attempt directory, write up the error, and stop. No second attempt without a write-up.
