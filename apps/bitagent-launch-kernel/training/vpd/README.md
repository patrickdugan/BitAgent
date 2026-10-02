# VPD capability chunking (local, Qwen3-0.6B)

Experiments that split a small Qwen's weights into rank-one subcomponents with VPD (Goodfire's parameter decomposition, [`goodfire-ai/param-decomp`](https://github.com/goodfire-ai/param-decomp)), group the subcomponents by which capability uses them, and test whether those groups ("chunks") can be removed or kept on their own. The longer-term aim is one compact adapter or model per capability; this directory only establishes whether the chunking itself works.

Nothing here touches the application runtime or the adapter gym in `../gym`. Outputs go to `$gym\vpd` (outside the clone), following the gym's convention.

## Pipeline

| step | script | output |
|---|---|---|
| 1. Ground-truth check of the VPD code on a toy model with known mechanisms | `toy_tms.py` | pass/fail printed |
| 2. Token windows per capability, with answer-token masks | `capability_data.py` | `$gym\vpd\data-s96\windows.pt` |
| 3. Train a decomposition of selected matrices | `decompose.py` | `runs\<name>\decomposition.pt`, `metrics.jsonl` |
| 4. Assign chunks from train windows, test them causally on eval windows | `chunk.py` | `chunks\<name>\report.md`, `chunks.json` |
| 5. Closed-form reference: shared low-rank base plus one adapter per capability | `subspace.py` | `subspace\<name>\report.md`, `subspace.json` |
| 6. Compaction curves at equal rank: SVD, activation-aware, VPD | `compact.py` | `compact\<name>\report.md`, `compact.json` |
| 7. Load base + one adapter as a model with no dense copy, and verify it | `lean.py` | JSON report printed |
| 8. Refine one adapter end to end against the dense model's outputs | `refine.py` | `adapter-<capability>-refined.safetensors` |
| Ground-truth check of the chunk assignment and causal tests on a toy with known capabilities | `toy_chunks.py` | pass/fail printed |

`chunk.py --svd --importance attr` runs step 4 on an exact SVD of each matrix with gradient attribution instead of a trained decomposition. It needs no training and is the baseline a VPD run has to beat.

```powershell
$gym = Join-Path $env:USERPROFILE 'Documents\Codex\BitAgent-gym'
$python = "$gym\.venv\Scripts\python.exe"
cd apps\bitagent-launch-kernel\training\vpd
& $python toy_tms.py
& $python capability_data.py
& $python decompose.py --output "$gym\vpd\runs\L27-mlp" --layers 27 --components 1024 --steps 1000 --loss-positions 24
& $python chunk.py --run "$gym\vpd\runs\L27-mlp" --output "$gym\vpd\chunks\L27-mlp-ci"
& $python chunk.py --svd --importance attr --layers 27 --chunk-size 100 --output "$gym\vpd\chunks\L27-mlp-svd-attr-top100"
```

All scripts default to CPU, lower their own process priority, and load the model offline from `$gym\runs\hf-cache`. Pass `--device cuda` only when no other job holds the GPU. `chunk.py --chunk-size N` builds fixed-size chunks (the N most capability-specific components each) so two decompositions can be compared at equal size; `--scores` reuses an earlier importance pass.

On this PC, start long runs detached (`Invoke-CimMethod Win32_Process Create` with `cmd /c "... > log 2>&1"`); jobs started from an agent session die with it, and `Start-Process -RedirectStandardOutput` children crashed repeatedly with `0xc000070a`. Each script that loads the model takes 5 to 8 GB of system memory on CPU. Run one at a time and check free commit first: the PC rebooted uncleanly on 2026-10-01 with several such jobs and other sessions' servers loaded.

`subspace.py`, `compact.py`, `lean.py`, `chunk.py` and `decompose.py` accept `--device cuda`. On the GPU they refuse to start with less than 8,000 MiB of VRAM free and cap themselves at 45% of the card (`config.py`), because the card is shared.

## Capabilities

Nine capabilities, 128 train and 32 eval windows of 96 tokens each (`config.py`):

- `arithmetic`, `logic`, `tool_call`, `planning`, `multihop`, `control`: few-shot Q/A streams from the `jev-qwen` generators (sibling checkout, imported read-only).
- `dag_ops`: the Prime Intellect environment `moralitylab/bitagent-dag-ops-v2`, taken from the gym's prepared SFT rows. Only the last 96 tokens of each row are used, so this is the environment's tool-call and JSON output distribution, not the full in-context task.
- `prose`, `code`: markdown and TypeScript files from this repository.

`capability_data.py --profile prime` builds a second set in which the capabilities are the Prime environment's own eight task families (`env_tradelayer_opreturn`, `env_bitcoin_rpc_txbuild`, `env_utxoref_settlement`, `env_trading_risk`, `env_circle_of_trust`, `env_incident_response`, `env_market_judgement_aml`, `env_activation_recovery`), plus `arithmetic`, `prose` and `code` for contrast. Windows are cut from each task's chat-rendered prompt and expected JSON candidate, using the installed environment package's scenario builder. Train windows come from the environment's train split and eval windows from its development split; the heldout split is never read.

## How this differs from the reference VPD

`vpd_core.py` follows `param_decomp/core/SPEC.md` and `nano_param_decomp/run.py` for the decomposition form, mask formation, leaky hard sigmoids, importance-minimality loss, stochastic and persistent-adversarial reconstruction, and optimizer settings. It differs in these ways:

- **Causal-importance function.** One small MLP per site on that site's RMS-normed clean input, instead of one shared transformer over all sites with attention across positions.
- **Scale.** Hundreds to thousands of steps on a handful of matrices, against 400,000 steps on every matrix of a 67M model in the reference. Runs here are unconverged by the reference's standard; treat chunk counts as provisional.
- **Suffix only.** Only layers from `--layers` onward are decomposed, and the residual stream entering the first of them is cached, so the earlier layers never run during training.
- **Initialisation.** `--init svd` (default) starts each site from its exact SVD and skips the faithfulness warm-up; the reference starts from random V and U. `svd_rotated` mixes the SVD by a random rotation, `random` is the reference behaviour. Random initialisation was still at faithfulness 0.85 after 40 steps, which this step budget cannot afford.
- **Loss positions.** `--loss-positions K` reconstructs K random positions per step instead of all, because the 151,936-row unembedding dominates CPU cost.
- **Routing.** The random site subset in the stochastic term is drawn once per step, not per position.
- **Adversary.** One warm-up ascent per step instead of two (`--pgd-warmup`).
- **Faithfulness** is normalised per matrix by its squared norm.
- **Chunk ownership** is this directory's own rule, not part of VPD: a component belongs to the capability holding the largest share of its importance, after each capability's scores are divided by their mean.

## Results so far (2026-10-01, CPU only)

The RTX 5080 was held by an adapter training run all day, so everything below ran on a CPU shared with other jobs.

### 1. Ground-truth check (`toy_tms.py`): passes on three seeds of three with the reference's toy recipe

The toy model stores 5 features in 2 dimensions; the true decomposition is 5 rank-one subcomponents per layer.

`--recipe reference` (the default) reproduces the settings of the reference's own `tms_5-2_config.yaml`: tied components, one importance MLP per subcomponent on its own activation, fixed p = 1, layerwise stochastic reconstruction, no adversary. Seeds 0, 1 and 2 all recover exactly 5 alive subcomponents per layer, one per feature, with cosine 0.9985 to 0.9988 to the true mechanisms.

`--recipe lm` runs the language-model recipe that `decompose.py` uses (untied sites, one shared importance MLP on the site input, p annealed from 2 to 0.4, persistent adversary) on the same toy. It is much less reliable there:

| `--recipe lm` setting (`--coeff-imp`, `--imp-beta`, steps) | seed 0 | seed 1 | seed 2 |
|---|---|---|---|
| 1e-2, 0.5, 20,000 | 6 and 7 to 9 alive: one feature split | | |
| 2e-2, 0.5, 20,000 (`lm` default) | **pass** (cosine to truth 0.998 / 0.987) | partial collapse | 4 alive: two features merged |
| 1e-2, 0.5, 40,000 | **pass** (0.9996 / 0.995) | merged | merged |
| 3e-3, 2, 40,000 | **pass** (0.9995 / 0.996) | merged | merged |
| 1.5e-3, 4, 40,000 | **pass** (0.9997 / 0.993) | merged in layer 1 only | merged in layer 1 only |
| 3e-2 or 5e-2, 0.5, 20,000 | importances collapse to zero | | |

The merged runs reconstruct as well as the passing ones (masked reconstruction 0.0017 to 0.0024 against 0.072 with everything ablated) and are within 15% of the ideal number of active subcomponents, but one subcomponent serves two features. This is the "polysemantic subcomponent" failure the reference handbook describes; raising the frequency penalty (`--imp-beta`) fixed it in the second layer only. So the core code is correct against ground truth, but the language-model recipe has a narrow usable sparsity range and seed-dependent merges even on a five-feature toy. That caveat carries over to every Qwen number below.

The formulas in `vpd_core.py` (leaky hard sigmoids, importance minimality, masked forward with delta) were also compared line by line with the local checkout of the reference at `C:\Users\patri\src\moralitylab\param-decomp` and match.

### 1b. Ground-truth check of the chunking itself (`toy_chunks.py`): passes

A toy model stores 12 features in 5 dimensions. Three capabilities each use 3 private features, and all three use 3 shared ones. After a VPD decomposition with the reference's larger-toy settings (60 subcomponents, coefficient 1e-4, p = 2), the same assignment rule and causal tests that `chunk.py` applies to Qwen give, on seed 0:

- 12 alive subcomponents, one per feature; all assigned correctly: three chunks of 3 and a shared set of 3.
- Removing a chunk raises the error on its own capability to 3.9 to 4.1 (MSE x1000) and leaves the other two at 0.007 to 0.015.
- Keeping only the shared set plus one chunk, with everything else deleted, leaves that capability at 0.017 to 0.031 and breaks the other two (4.0 to 4.3).

Seeds 1 and 2 come close but fail the script's strict check, each with one subcomponent out of 24 or 26 misassigned:

| seed | alive per layer (12 expected) | assigned correctly | worst own-to-other ratio when a chunk is removed | strict check |
|---|---|---|---|---|
| 0 | 12 | 24 of 24 | about 270 | pass |
| 1 | 12 | 23 of 24 | about 195 | fail (one private subcomponent not in its chunk) |
| 2 | 13 | 25 of 26 | about 18 | fail (one feature split in two, half assigned to the wrong chunk) |

With the smaller toy's settings (coefficient 3e-3, p = 1) seed 0 merges features: 10 subcomponents for 12 features, and one chunk stops being specific. So when the decomposition recovers the mechanisms, the chunking, dissociation and compaction steps all work as intended; errors come from the decomposition (a split or merged feature), not from the assignment rule.

### 2. Baseline without training: SVD directions are not capability-specific

`chunk.py --svd --importance attr`, MLP matrices of layers 24 to 27 (12,288 components):

- No component gives any one capability more than 34% of its importance (11% would be uniform; the median is 15%). The 50% ownership threshold yields nine empty chunks.
- Importance profiles are correlated 0.78 to 0.96 between capabilities. `prose`, `code` and `dag_ops` are closest (0.92 to 0.96); `multihop`, `planning` and `arithmetic` are the most distinct.

Same matrices, chunks fixed at the 100 most capability-specific components each:

- Removing a chunk raises KL on its own capability 1.3 to 3.3 times more than on the others for seven capabilities, 5.3 times for `dag_ops` and 12.9 times for `logic` (0.079 on itself, about 0.006 elsewhere). The effects are small: at most 0.17 KL.
- Random controls of the same size did less damage than the chunk in five of nine cases; for `code` the random set hit a critical direction (KL 10.3).
- Compact models (shared plus one chunk, 54% of the dense parameter count) cost KL 0.30 to 0.67 on the kept capability, against 0.16 to 0.40 with all above-average components.

Layer 27 alone (3,072 components), chunks fixed at the 100 most capability-specific components each:

- Removing a chunk raises KL on its own capability only 1.1 to 2.5 times more than on the others. `dag_ops` is the exception at 6.6 times (0.279 on itself, 0.03 to 0.08 elsewhere).
- Removing 100 random components was often more damaging than removing the chunk (for `planning`, 1.63 against 0.05).
- A compact model of shared components plus one chunk is unusable: KL 2.4 to 9.3 on the kept capability, against 0.12 to 0.31 when all above-average components are kept.

These are the numbers a trained decomposition has to beat.

### 3. VPD on Qwen3-0.6B, layer 27 MLP: one real chunk, decomposition not converged

Two runs of 1,000 steps on the three layer-27 MLP matrices (1,024 subcomponents each, SVD start), in `$gym\vpd\runs\L27-mlp-imp*`, analysed in `$gym\vpd\chunks\L27-mlp-imp*`:

| `--coeff-imp` | KL with importance masks | subcomponents active per matrix | KL, all components, no delta |
|---|---|---|---|
| 2e-4 | 0.128 | 25 | 0.003 |
| 5e-5 | 0.102 | 87 | 0.002 |
| MLP fully ablated | 0.384 | 0 | |

The masks recover about 70% of the gap to full ablation, so neither run is a converged decomposition by the reference's standard.

- **`logic` gets a real chunk in both runs.** 17 subcomponents (`2e-4`) and 18 (`5e-5`) pass the 50% ownership threshold, 9 of them the same, nearly all in `gate_proj`. Removing them costs KL 0.113 and 0.072 on `logic` and about 0.001 on every other capability (114 and 82 times more on `logic`); a random set of the same size costs 0.005. The SVD baseline's `logic` chunk at this layer was 1.4 times.
- **The `logic` chunk is a boolean-expression chunk, not a reasoning chunk.** In the `2e-4` run its 200 strongest positions are all inside `bool_eval` expressions, at `(`, `or`, `and` and `not`, where the next token is `True`, `False`, `not` or `(`. It is no stronger at answer positions (1.35) than elsewhere in `logic` windows (1.71), and it is active at only a quarter of `logic` positions, so the `order_chain` half of the capability appears not to use it (not checked directly). Summed importance is 1.69 on `logic`, 0.36 on `dag_ops` and at most 0.07 on the rest. As expected for the last layer, it tracks which tokens are being produced.
- **No other capability gets one.** The remaining chunks are empty or have negligible effect. The 482 `dag_ops` subcomponents in the `2e-4` run are near-dead ones that `dag_ops` uses slightly more; removing them hurts all capabilities equally.
- **At a fixed size of 100 the comparison with SVD is mixed.** For the `5e-5` run the own-to-other KL ratio beats the layer-27 SVD baseline for `logic` (6.7 against 1.4) and `multihop` (4.0 against 2.5), loses for `dag_ops` (4.5 against 6.6) and `planning` (1.0 against 2.2), and is about equal elsewhere. Forcing 100 components per chunk dilutes the few that are specific.
- **No compaction yet.** The `5e-5` run keeps 3,056 of 3,072 subcomponents alive, which stored as factors is larger than the dense matrices. The `2e-4` run's "shared + chunk" models are about 84% of dense size (105% for `dag_ops`) at KL 0.04 to 0.11.
- **Learning rates.** At 1e-3 (fine for the toy) the first ten steps wrecked the SVD initialisation and collapsed the importances. 1e-4 for components and 2e-4 for the importance function are stable.
- **Cost.** Four layers (24 to 27) cost about 13 s per step on the shared CPU; layer 27 alone cost 7 to 30 s depending on contention.

### 4. Closed-form capability adapters (`subspace.py`): all nine capabilities separate

No training. Each MLP matrix of layers 24 to 27 is replaced by a shared rank-256 base fitted to the inputs of all capabilities (33% of the dense parameters), plus one rank-64 adapter per capability (8.3%) that best restores the matrix's output on that capability's inputs. Fitted on train windows, KL to the dense model measured on eval windows:

| capability | base only | + generic adapter | + own adapter | + another capability's adapter (mean) | share of the base-to-dense gap closed by own |
|---|---|---|---|---|---|
| arithmetic | 0.109 | 0.083 | 0.032 | 0.094 | 71% |
| logic | 0.098 | 0.067 | 0.024 | 0.080 | 75% |
| tool_call | 0.190 | 0.135 | 0.057 | 0.164 | 70% |
| planning | 0.136 | 0.103 | 0.022 | 0.122 | 84% |
| multihop | 0.112 | 0.086 | 0.033 | 0.098 | 71% |
| control | 0.171 | 0.122 | 0.042 | 0.148 | 75% |
| dag_ops | 0.141 | 0.105 | 0.074 | 0.120 | 48% |
| prose | 0.432 | 0.377 | 0.343 | 0.395 | 21% |
| code | 0.364 | 0.319 | 0.297 | 0.331 | 18% |

- Every capability's own adapter beats every other capability's adapter and a capability-agnostic adapter of the same rank. Own adapters help 2.0 to 8.4 times more than another capability's does. This is the separation the VPD runs have not yet shown, in the form the end goal needs: a shared base plus a small adapter per capability.
- The six synthetic task capabilities separate cleanly. `prose` and `code` are broad distributions and a rank-64 adapter recovers only a fifth of what the base lost.
- "Capability" here means the windows' distribution. The synthetic tasks reuse a small vocabulary and fixed templates, so part of what an adapter restores is that surface form.
- One setting, eight eval windows per capability, layers 24 to 27 only. The layer sweep (`$gym\vpd\subspace\L*-mlp-b256-a64`) tests other depths.

**Prime environment task families** (`--profile prime` data, same layers and ranks): each of the eight families' own adapter is the best adapter for that family, eight out of eight, but the margin is small.

| | own adapter | generic adapter | another capability's adapter (mean) |
|---|---|---|---|
| share of the base-to-dense gap closed, eight families | 31% to 43% | 24% to 29% | 18% to 22% |
| same, `arithmetic` in this dataset | 77% | 26% | 11% |

The families share most of their prompt (the DAG, tool list and response contract), so another family's adapter already helps about half as much as the right one. The structure here looks like one environment-level adapter with a thin family-level layer on top, not eight independent chunks.

**Exported adapters load into a model that keeps no dense copy** (`lean.py`). `subspace.py` writes `base.safetensors` (48 MB for these 12 matrices) and one `adapter-<capability>.safetensors` each (12 MB), against 144 MB dense. `lean.py --capability arithmetic --check` rebuilt the model from those two files with low-rank modules only and reproduced the reported KL on all eleven capabilities to four decimals (0.0368 on `arithmetic`). The replaced matrices go from 37.7M to 15.7M parameters. The whole model only drops from 596M to 574M, because four layers' MLPs are a small part of it; the all-layer run is what tests a real memory saving.

**All 28 layers' MLPs at once** (`--layers 0-27`, four capabilities): 264M MLP parameters become an 88M shared base plus a 22M adapter. The adapters stay specific, but the compact model is no longer faithful:

| capability | base only | + generic adapter | + own adapter | + another capability's adapter (mean) |
|---|---|---|---|---|
| arithmetic | 0.234 | 0.171 | 0.097 | 0.201 |
| tool_call | 0.574 | 0.321 | 0.202 | 0.437 |
| dag_ops | 0.593 | 0.370 | 0.296 | 0.453 |
| code | 2.875 | 1.456 | 1.621 | 1.961 |

Each matrix is fitted alone on inputs from the dense model, so the errors of 84 compressed matrices compound. KL 0.1 to 0.3 on the task capabilities and 1.6 on `code` is too much to call the compact model equivalent. `refine.py` addresses this by training only the adapter, end to end, against the dense model's outputs.

**Refining the adapter end to end fixes most of that, and only for its own capability** (`refine.py`, shared base frozen, 200 steps on the capability's train windows, 16 minutes on CPU):

| KL to dense on eval windows, all 28 MLP layers compact | arithmetic | tool_call | dag_ops | code |
|---|---|---|---|---|
| base + `arithmetic` adapter, closed form | 0.097 | 0.464 | 0.455 | 1.993 |
| base + `arithmetic` adapter, refined | 0.032 | 0.449 | 0.453 | 1.999 |
| base + `tool_call` adapter, closed form | 0.190 | 0.202 | 0.467 | 2.241 |
| base + `tool_call` adapter, refined | 0.176 | 0.038 | 0.442 | 1.896 |

Each refined model holds 110M MLP parameters where the dense model holds 264M (whole model 442M against 596M; 420 MB against 1,008 MB of MLP weights in fp32). Refining brings the adapter's own capability 3 to 5 times closer to the dense model and barely moves the others. `lean.py --capability tool_call-refined --check` rebuilt that model from the two exported files and reproduced these numbers. The five capabilities this base was not fitted on (`logic`, `planning`, `multihop`, `control`, `prose`) are at KL 1.6 to 4.1 in the same model: it keeps what it was built for and loses the rest.

Not done yet: refining the shared base itself, more than 200 steps, the other capabilities, and any check of task accuracy rather than agreement with the dense model.

### 5. Compaction curves at equal rank (`compact.py`), layer 27 MLP

KL to the dense model on the capability itself when each of the three matrices is cut to rank r, no base and no delta:

| rank (share of dense parameters) | plain SVD | activation-aware, all capabilities | activation-aware, own capability | VPD `5e-5` run, top r by own importance |
|---|---|---|---|---|
| 64 (8.3%), six task capabilities | 0.23 to 0.53 | 0.09 to 0.15 | 0.028 to 0.052 | 0.11 to 0.18 |
| 256 (33.3%), six task capabilities | 0.22 to 0.51 | 0.036 to 0.063 | 0.0016 to 0.0071 | 0.06 to 0.10 |
| 256, `dag_ops` | 0.63 | 0.054 | 0.020 | 0.19 |
| 256, `prose` / `code` | 0.70 / 0.43 | 0.14 / 0.12 | 0.11 / 0.09 | 0.18 / 0.15 |

- **A third of the parameters keeps a task capability almost exactly** (KL 0.002 to 0.007) when the low-rank fit is made on that capability's own inputs. A capability-agnostic fit of the same rank is 9 to 28 times worse on the same capability.
- **Plain SVD is useless here**: rank 64 is often worse than removing the MLP (0.38).
- **The 1,000-step VPD run does not compete yet.** Its subcomponents ranked by causal importance are no better than the capability-agnostic closed-form fit, and ranking them by the target capability's importance is no better than ranking them generically. So far VPD has not found the capability structure that the closed-form fit shows is there.
- `prose` and `code` stay expensive at every rank.

## Stubs and gaps

- **Vision is not covered.** Qwen3-0.6B is text-only. A multimodal `Qwen/Qwen3.5-4B-Base` is cached at `%USERPROFILE%\.cache\huggingface\hub` (it has image and video preprocessor configs), but at 8.9 GB of weights it needs the GPU, and it needs the BlueBeam venv's newer transformers. A smaller multimodal Qwen (`Qwen/Qwen3.5-0.8B`) would have to be downloaded.
- **The reference implementation is not used for training.** A full checkout sits at `C:\Users\patri\src\moralitylab\param-decomp` and imports from the BlueBeam venv; BlueBeam's `param_decomp_lane.py` already wraps its `optimize()`. Here it served to check formulas and the toy recipe. Its description-length clustering needs `numba`, which no local venv has.
- **Other Prime Intellect hub environments are not covered.** Only `bitagent-dag-ops-v2` is on disk.
- **No clustering.** Chunks are assigned by a share-of-importance threshold per subcomponent; the reference's description-length clustering of subcomponents into components is not implemented.
- **Adapters are exported only by the closed-form route.** `subspace.py` writes base and adapter files and `lean.py` loads them; `chunk.py` reports the low-rank size of a VPD "shared + chunk" model but writes no adapter files, and the exported factors are a local format, not PEFT or GGUF.
