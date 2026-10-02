# Local adapter gym (RTX 5080, 16 GB)

This gym turns BitAgent's **frozen** train and validation corpora into completion-only SFT examples, trains a candidate QLoRA adapter, and runs a development JSON check. It does not modify the application runtime, replace an existing adapter, or provide promotion evidence. The held-out splits stay outside the optimizer input directory.

The default base is [`prism-ml/Bonsai-8B-unpacked`](https://huggingface.co/prism-ml/Bonsai-8B-unpacked) at revision `376f381570d6115bc03f82adcfa4af0c7672ae54`, matching the launch kernel integration pin. Use the full Hugging Face model for training; a GGUF inference file is not a PEFT source adapter.

## Machine and Python environment

Verified on the RTX 5080 Laptop GPU (16,303 MiB), Windows driver 572.76, Python 3.12, PyTorch 2.9.1 CUDA 12.8, Transformers 4.57.6, PEFT 0.21.0, Accelerate 1.15.0, and bitsandbytes 0.50.2. The scripts require at least 12,000 MiB free GPU memory and stop if the GPU reaches 80 C. Close other GPU workloads before training. A current CUDA 13 wheel is not the right match for this installed driver.

From the repository root in PowerShell, create an environment **outside the clone** and install the checked package versions:

```powershell
$gym = Join-Path $env:USERPROFILE 'Documents\Codex\BitAgent-gym'
$python312 = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
& $python312 -m venv "$gym\.venv"
& "$gym\.venv\Scripts\python.exe" -m pip install torch==2.9.1 --index-url https://download.pytorch.org/whl/cu128
& "$gym\.venv\Scripts\python.exe" -m pip install transformers==4.57.6 peft==0.21.0 accelerate==1.15.0 bitsandbytes==0.50.2 datasets==4.8.5 hf_xet==1.6.0
```

The current PC's environment is already at `$gym\.venv`; its Python came from the bundled Codex Python 3.12 runtime. If that runtime moves after an app update, recreate the environment with another Python 3.12 executable.

A one-step Bonsai 8B smoke run on this PC completed training and validation at 1,024 tokens, using 10,615 MiB peak allocated GPU memory and ending at 53 C. It proves the training path fits this card; one step is not a trained production adapter. The downloaded base is cached under `$gym\runs\hf-cache`.

## Prepare and train

Choose one profile: `referral-growth`, `referral-disposition`, `marketing-cues`, or `marketing-multiturn`. Preparation verifies the frozen manifest's train and validation hashes and row counts, checks split identity and candidate-only outputs, and expands each assistant turn into one supervised example. The 4 profiles are independent; start with one.

```powershell
$gym = Join-Path $env:USERPROFILE 'Documents\Codex\BitAgent-gym'
$python = "$gym\.venv\Scripts\python.exe"
$profile = 'referral-growth'
& $python apps/bitagent-launch-kernel/training/gym/prepare.py --profile $profile --output "$gym\prepared\$profile"
& $python apps/bitagent-launch-kernel/training/gym/train.py --prepared "$gym\prepared\$profile" --output "$gym\runs\$profile"
```

The default candidate run is 30 optimizer steps, batch size 1, accumulation 8, context limit 1024, NF4 double quantization, BF16 compute, gradient checkpointing, and LoRA rank 16 on linear layers. The script uses Qwen3's nonthinking chat prompt and masks all prompt tokens from the loss, so only the JSON response is supervised. If earlier conversation pairs exceed the context limit, it drops oldest pairs and never cuts an assistant JSON completion. It refuses a single completion that cannot fit. `--steps`, `--max-length`, `--gradient-accumulation`, and `--lora-r` are adjustable. A new adapter can be restricted with `--target-modules q_proj,v_proj` (default: every linear layer except the LM head) and `--layers 20-27` (zero-based decoder layers; default: all); `--seed` sets both LoRA initialisation and the training loop. A source PEFT adapter directory can be continued with `--init-adapter PATH`, which keeps that adapter's shape; a GGUF cannot.

Outputs stay in `$gym`: frozen-source preparation receipts and split indexes in `prepared`, Hugging Face downloads in `runs\hf-cache`, and checkpoints, final adapter, package freeze, and run receipt in `runs\<profile>`. The run receipt records the base revision, input receipt hash, adapter hash, seed, adapter shape (rank, modules, layers, trainable parameters), tokenization trims, metrics, GPU, and peak allocated memory. Keep these receipts with any candidate you review.

## Development check

```powershell
& $python apps/bitagent-launch-kernel/training/gym/evaluate.py --run "$gym\runs\$profile" --prepared "$gym\prepared\$profile" --limit 20
```

This greedy validation sample measures parseable JSON, expected schema plus `model_candidate`/`none` authority, and exact decision/response-mode fields where present. It is a development signal only. Run the repository's existing frozen held-out harness and safety gates separately before considering an adapter for promotion; do not tune on held-out cases.

## Testnet4 DAG synthetic collection

The local collection loop uses 28 scripted testnet4 deposit, strategy, withdrawal, approval, refusal, stale-evidence, verification, and recovery states. A public testnet4 tip or a fully synced local Bitcoin Core tip is recorded as provenance; the wallet and TradeLayer state in each task remains scripted. Neither the exporter nor Hermes Lite signs, broadcasts, or uses wallet credentials.

From `apps/bitagent-launch-kernel`, export tasks, run the locally cached Bonsai base through Hermes Lite, then validate every proposal with BitAgent's deterministic DAG validator:

```powershell
$gym = Join-Path $env:USERPROFILE 'Documents\Codex\BitAgent-gym'
$env:PYTHONPATH = Join-Path $env:USERPROFILE 'Documents\Codex\hermes-lite\src'
& '.\node_modules\.bin\tsx.cmd' scripts/export-dag-synthetic-testnet.ts "--output=$gym\synthetic\tasks.jsonl"
& "$gym\.venv\Scripts\python.exe" -m agent.bitagent_synthetic_testnet_v1 --tasks "$gym\synthetic\tasks.jsonl" --output "$gym\synthetic\proposals.jsonl" --cache-dir "$gym\runs\hf-cache" --temperature 0
& '.\node_modules\.bin\tsx.cmd' scripts/validate-dag-synthetic-proposals.ts "--tasks=$gym\synthetic\tasks.jsonl" "--proposals=$gym\synthetic\proposals.jsonl" "--output=$gym\synthetic\validation.json"
```

When the local Bitcoin Core testnet4 node has completed initial block download, add `--bitcoin-datadir=C:\Users\patri\Documents\Codex\BitAgent-testnet4-node\data` to the export command. The exporter fails while the local node is still syncing. These receipts are a candidate review queue, **not** a training or promotion approval. Inspect generated text, validator failures, duplicate scenarios, and the canonical corrections before selecting any rows for an optimizer split. Keep frozen held-out data out of this loop.

The collector accepts `--adapter PATH` to rerun the same candidate tasks with a local PEFT adapter and records its SHA256 in the collection receipt. Validate its proposals with the same BitAgent script and compare the full set of checks, not just parse rate. Baseline Bonsai parsed all 18 public-tip and all 28 synced-local-tip scripted cases, but BitAgent accepted 0 in either batch. This is an adapter development signal, not a live-wallet or settlement result.

`prepare_dag_synthetic.py` verifies the task, proposal, collection, and validation hashes and builds a development-only train/validation split from the host's canonical candidates. The split keeps distinct scenario IDs out of the optimizer and records the Hermes prompt hash. For the expanded local batch, it allocates 20 training and 8 validation scenarios. Use the output with `train.py` only as a candidate adapter experiment; the split is far below the role-adapter promotion sample floors, and it does not establish wallet or TradeLayer correctness.

A 10-step local development run on the 20/8 split completed on the RTX 5080 with a 2,048-token context, LoRA rank 8, 13,332.5 MiB peak allocated VRAM, and an 87 MB PEFT adapter. Its training receipt reports validation loss 0.2251. That loss is not a task-success measure; rerun the eight validation tasks with `--adapter` and compare BitAgent's exact DAG receipts before interpreting the adapter.

```powershell
$prepared = "$gym\prepared\testnet4-dag-synthetic-local-dev2"
$run = "$gym\runs\testnet4-dag-synthetic-local-dev2"
& "$gym\.venv\Scripts\python.exe" -m agent.bitagent_synthetic_testnet_v1 --tasks "$prepared\validation-tasks.jsonl" --output "$gym\synthetic\local-dev2-eval\proposals.jsonl" --cache-dir "$gym\runs\hf-cache" --adapter "$run\adapter" --temperature 0
& '.\node_modules\.bin\tsx.cmd' scripts/validate-dag-synthetic-proposals.ts "--tasks=$prepared\validation-tasks.jsonl" "--proposals=$gym\synthetic\local-dev2-eval\proposals.jsonl" "--output=$gym\synthetic\local-dev2-eval\validation.json"
```

That 10-step adapter accepted 0/8 of those validation tasks (base Bonsai: 0/8); see the tool-loop section below for why.

## Tool-loop collection (Hermes v2) and multi-turn SFT

The single-turn v1 collector above gives the model no tools, so it cannot learn the host's closed `decision`/`reason_code` vocabulary; the accepted adapter was trained in the Prime Intellect environment [`moralitylab/bitagent-dag-ops-v2`](https://app.primeintellect.ai/dashboard/environments/moralitylab/bitagent-dag-ops-v2) (pinned 0.3.1), where the read-only `simulate_candidate` tool returns BitAgent's LDT-normalized candidate. `agent.bitagent_synthetic_testnet_v2` mirrors that environment's three read-only tools and prompt on BitAgent's own testnet4 packets, writes v1-compatible `proposals.jsonl` for the existing validator, and adds full `trajectories.jsonl`.

The accepted artifacts are public: LoRA GGUF `AlephFunk/bitagent-bonsai8b-dagv2-lora-v3` (SHA-256 `9a11fe…`, matching `loraGgufSha256`) on base `prism-ml/Bonsai-8B-gguf` `Bonsai-8B-Q1_0.gguf` (`284a33…`). Q1_0 needs PrismML's llama.cpp fork; on driver 572.76 use the `win-cuda-12.4` release build. A PEFT copy for `--init-adapter` comes from converting the GGUF (rank 16, alpha 32); it is functionally, not byte-, equivalent to source adapter `ceb396…`.

`--variants=N --seed=S` on the exporter adds N surface variants per scenario (amounts, balances, fees, confirmation thresholds, hashes, session IDs, message prefixes). Labels still come from `buildDagCandidateTask`; check that each variant's canonical candidate equals its base scenario's. Default output is unchanged.

```powershell
$env:PYTHONPATH = Join-Path $env:USERPROFILE 'Documents\Codex\hermes-lite\src'
& '.\node_modules\.bin\tsx.cmd' scripts/export-dag-synthetic-testnet.ts "--output=$gym\synthetic\variants-tasks.jsonl" "--bitcoin-datadir=C:\Users\patri\Documents\Codex\BitAgent-testnet4-node\data" --variants=10 --seed=1
# llama-server -m Bonsai-8B-Q1_0.gguf --lora bitagent-bonsai8b-dagv2-lora-v3-f16.gguf -ngl 99 -c 12288 --host 127.0.0.1 --port 8091
& "$gym\.venv\Scripts\python.exe" -m agent.bitagent_synthetic_testnet_v2 --tasks "$gym\synthetic\variants-tasks.jsonl" --output-dir "$gym\synthetic\variants-v3" --cache-dir "$gym\runs\hf-cache" --server-url http://127.0.0.1:8091 --base-gguf "$gym\prime-artifacts\Bonsai-8B-Q1_0.gguf" --lora-gguf "$gym\prime-artifacts\bitagent-bonsai8b-dagv2-lora-v3-f16.gguf"
& '.\node_modules\.bin\tsx.cmd' scripts/validate-dag-synthetic-proposals.ts "--tasks=$gym\synthetic\variants-tasks.jsonl" "--proposals=$gym\synthetic\variants-v3\proposals.jsonl" "--output=$gym\synthetic\variants-v3\validation.json"
& "$gym\.venv\Scripts\python.exe" training/gym/prepare_dag_tool_sft.py --collection "$gym\synthetic\variants-v3" --tasks "$gym\synthetic\variants-tasks.jsonl" --hermes-src $env:PYTHONPATH --profile testnet4-dag-tool-sft-v1 --output "$gym\prepared\testnet4-dag-tool-sft-v1"
& "$gym\.venv\Scripts\python.exe" training/gym/train.py --prepared "$gym\prepared\testnet4-dag-tool-sft-v1" --output "$gym\runs\testnet4-dag-tool-sft-v1" --init-adapter "$gym\prime-artifacts\dagv2-lora-v3-peft" --max-length 3072 --steps 90 --eval-steps 30 --bf16-frozen-matrices --cuda-memory-fraction 0.92
```

Memory on 16 GB: these trajectories are ~2-3k-token prompts with short supervised completions. `train.py` therefore computes logits only at supervised positions (`logits_to_keep`; same token-mean loss). `--bf16-frozen-matrices` stops `prepare_model_for_kbit_training` from upcasting the frozen embedding and LM-head matrices to FP32. `--cuda-memory-fraction 0.92` caps the caching allocator. Without the cap, Windows/WDDM silently spills variable-length allocations into shared system memory instead of raising OOM, and steps slow from ~47 s to 80-300 s. With all three, the longest row peaks at ~12.1 GB allocated and ~13 GB reserved. Each step logs peak and reserved MiB.

`prepare_dag_tool_sft.py` keeps accepted trajectories as on-policy rows and replaces rejected ones with host demonstrations (inspect, simulate with the canonical fields, canonical JSON). It holds out six whole base scenarios for validation and expands each trajectory into one row per assistant turn. `train.py` passes each row's tool schemas to the chat template and refuses to trim tool trajectories. Re-evaluate any new adapter on the Prime environment's 32 heldout tasks (no forgetting) and on fresh-seed variants; never train on either.

First run on this PC (2026-10-01): the accepted v3 adapter scored 32/32 on the Prime heldout split, raw Bonsai 26/32. On BitAgent's local-tip packets it accepted 16/28 base scenarios and 192/280 surface variants. Failures concentrate on late-stage approval and verification packets (`funding-approved`, `funding-submitted`, `withdraw-approved`, `withdraw-verified`), where it echoes the packet instead of calling tools.
