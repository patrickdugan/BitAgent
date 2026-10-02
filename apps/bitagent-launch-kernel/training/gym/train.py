"""Single-GPU, candidate-only QLoRA trainer for BitAgent adapter corpora."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path


BASE_MODEL = "prism-ml/Bonsai-8B-unpacked"
BASE_REVISION = "376f381570d6115bc03f82adcfa4af0c7672ae54"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def gpu_reading() -> tuple[int, int]:
    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=temperature.gpu,memory.free",
         "--format=csv,noheader,nounits"],
        check=True, capture_output=True, text=True, timeout=15,
    )
    first = result.stdout.strip().splitlines()[0]
    temperature, free_mib = (int(part.strip()) for part in first.split(",")[:2])
    return temperature, free_mib


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def tokenized_examples(path: Path, tokenizer, max_length: int) -> tuple[list[dict], dict]:
    results: list[dict] = []
    trimmed = 0
    longest = 0
    for row_number, row in enumerate(load_jsonl(path), 1):
        prompt = list(row["prompt"])
        completion = row["completion"]
        # Multi-turn tool rows (prepare_dag_tool_sft.py) carry their tool schemas;
        # the completion may be a tool-call turn or the final JSON candidate.
        tools = row.get("tools")
        if len(completion) != 1 or completion[0]["role"] != "assistant":
            raise ValueError(f"{path}:{row_number} is not one assistant completion")
        while True:
            prefix = tokenizer.apply_chat_template(
                prompt, tools=tools, tokenize=True, add_generation_prompt=True,
                enable_thinking=False,
            )
            full = tokenizer.apply_chat_template(
                prompt + completion, tools=tools, tokenize=True, add_generation_prompt=False,
                enable_thinking=False,
            )
            if full[:len(prefix)] != prefix:
                raise ValueError(f"{path}:{row_number} chat template prefix mismatch")
            if len(full) <= max_length:
                break
            if tools:
                # Dropping turns would orphan tool calls from their results.
                raise ValueError(
                    f"{path}:{row_number} tool trajectory needs {len(full)} tokens; "
                    f"max is {max_length}"
                )
            # Keep the system instruction and the latest exchanges. Never cut
            # through an assistant JSON completion or silently truncate it.
            start = 1 if prompt[0]["role"] == "system" else 0
            if len(prompt) - start <= 1:
                raise ValueError(
                    f"{path}:{row_number} needs {len(full)} tokens; max is {max_length}"
                )
            del prompt[start:start + 2]
            trimmed += 1
        labels = [-100] * len(prefix) + full[len(prefix):]
        if not any(label != -100 for label in labels):
            raise ValueError(f"{path}:{row_number} has no completion tokens")
        results.append({"input_ids": full, "attention_mask": [1] * len(full), "labels": labels})
        longest = max(longest, len(full))
    if not results:
        raise ValueError(f"No training examples: {path}")
    return results, {"examples": len(results), "trimmedPairs": trimmed, "longestTokens": longest}


def parse_layers(spec: str) -> list[int]:
    """Parse decoder layer indices such as "0-7,12" into a sorted list."""
    layers: set[int] = set()
    for part in spec.split(","):
        first, _, last = part.strip().partition("-")
        start = int(first)
        end = int(last) if last else start
        if end < start:
            raise ValueError(f"descending layer range: {part}")
        layers.update(range(start, end + 1))
    return sorted(layers)


def parse_names(spec: str) -> list[str]:
    names = [name.strip() for name in spec.split(",") if name.strip()]
    if not names:
        raise ValueError("no module names")
    return names


def lora_target_modules(model, names: list[str] | None, layers: list[int] | None):
    """Return LoraConfig.target_modules for the requested adapter placement."""
    if names:
        return names
    if not layers:
        return "all-linear"
    import torch

    # PEFT refuses layer indices with the "all-linear" string, so name the same
    # modules it would pick: every linear layer except the LM head.
    head = model.get_output_embeddings()
    return sorted({
        name.rsplit(".", 1)[-1] for name, module in model.named_modules()
        if isinstance(module, torch.nn.Linear) and module is not head
    })


class ListDataset:
    def __init__(self, examples: list[dict]):
        self.examples = examples

    def __len__(self) -> int:
        return len(self.examples)

    def __getitem__(self, index: int) -> dict:
        return self.examples[index]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", default=BASE_MODEL)
    parser.add_argument("--revision", default=BASE_REVISION)
    parser.add_argument("--init-adapter", type=Path)
    parser.add_argument("--steps", type=int, default=30)
    parser.add_argument("--max-length", type=int, default=1024)
    parser.add_argument("--gradient-accumulation", type=int, default=8)
    parser.add_argument("--lora-r", type=int, default=16)
    parser.add_argument("--target-modules", type=parse_names,
                        help="Comma-separated module names for a new adapter, e.g. "
                             "q_proj,v_proj (default: all linear layers)")
    parser.add_argument("--layers", type=parse_layers,
                        help="Decoder layer indices for a new adapter, e.g. 20-27 or "
                             "0-7,12 (default: every layer)")
    parser.add_argument("--seed", type=int, default=20260927,
                        help="Seeds LoRA initialisation and the training loop")
    parser.add_argument("--bf16-frozen-matrices", action="store_true",
                        help="Keep frozen embedding/LM-head matrices in BF16 instead of the "
                             "FP32 upcast from prepare_model_for_kbit_training (~2.5 GB each "
                             "on Bonsai 8B); needed for ~3k-token tool trajectories on 16 GB")
    parser.add_argument("--cuda-memory-fraction", type=float,
                        help="Cap the CUDA caching allocator at this fraction of VRAM. On "
                             "Windows/WDDM, exceeding VRAM spills to shared memory instead "
                             "of raising OOM, so the allocator never frees its cache; a cap "
                             "(e.g. 0.92) makes it reclaim cached blocks first")
    parser.add_argument("--eval-steps", type=int,
                        help="Validation/checkpoint interval (default: min(steps, 10))")
    parser.add_argument("--save-steps", type=int,
                        help="Checkpoint interval (default: --eval-steps); on a shared GPU a "
                             "short interval bounds the work lost to an external OOM")
    parser.add_argument("--resume", action="store_true",
                        help="Continue from the newest checkpoint in OUTPUT/checkpoints")
    parser.add_argument("--min-free-vram-mib", type=int, default=12000)
    parser.add_argument("--stop-temp-c", type=int, default=80)
    args = parser.parse_args()
    if args.steps < 1 or args.max_length < 128 or args.gradient_accumulation < 1:
        parser.error("steps, max-length, and gradient-accumulation must be positive")
    if args.init_adapter and (args.target_modules or args.layers):
        parser.error("--init-adapter keeps its own shape; drop --target-modules/--layers")
    prepared = args.prepared.resolve()
    output = args.output.resolve()
    if (output / "run-receipt.json").exists():
        raise FileExistsError(f"Completed run already exists: {output}")
    receipt = json.loads((prepared / "receipt.json").read_text(encoding="utf-8"))
    if receipt.get("schema") != "bitagent.local_adapter_gym_preparation.v1":
        raise ValueError("Missing verified BitAgent preparation receipt")
    for split in ("train", "validation"):
        expected = receipt["outputs"][f"{split}Sha256"]
        if sha256(prepared / f"{split}.jsonl") != expected:
            raise ValueError(f"Prepared {split} corpus changed since verification")
    if receipt.get("heldoutOptimizerAccess") is not False:
        raise ValueError("Held-out access must be disabled")
    cache_dir = output.parent / "hf-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(output.parent / "hf-home")
    os.environ["HF_HUB_CACHE"] = str(cache_dir)
    temperature, free_mib = gpu_reading()
    if temperature >= args.stop_temp_c or free_mib < args.min_free_vram_mib:
        raise RuntimeError(
            f"GPU admission refused: {temperature} C, {free_mib} MiB free"
        )

    import bitsandbytes as bnb
    import torch
    from peft import LoraConfig, PeftModel, get_peft_model, prepare_model_for_kbit_training
    from transformers import (
        AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig,
        DataCollatorForSeq2Seq, Trainer, TrainerCallback, TrainingArguments, set_seed,
    )

    if not torch.cuda.is_available() or not torch.cuda.is_bf16_supported():
        raise RuntimeError("A CUDA GPU with BF16 support is required")
    if tuple(torch.cuda.get_device_capability(0)) < (12, 0):
        raise RuntimeError("This profile requires the verified RTX 5080 class GPU")
    if not torch.version.cuda or not torch.version.cuda.startswith("12.8"):
        raise RuntimeError(f"Expected CUDA 12.8 PyTorch wheel, got {torch.version.cuda}")
    if args.cuda_memory_fraction is not None:
        if not 0.5 <= args.cuda_memory_fraction <= 1.0:
            parser.error("--cuda-memory-fraction must be between 0.5 and 1.0")
        torch.cuda.set_per_process_memory_fraction(args.cuda_memory_fraction, 0)
    # Exercise the exact 4-bit CUDA path before loading the 8B model.
    probe = bnb.nn.Linear4bit(64, 64, bias=False, compute_dtype=torch.bfloat16,
                             quant_type="nf4").to("cuda")
    probe_input = torch.ones(1, 64, device="cuda", dtype=torch.bfloat16,
                             requires_grad=True)
    probe(probe_input).sum().backward()
    del probe
    torch.cuda.empty_cache()

    output.mkdir(parents=True, exist_ok=True)
    tokenizer = AutoTokenizer.from_pretrained(
        args.model, revision=args.revision, cache_dir=cache_dir, trust_remote_code=False,
    )
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"
    train, train_stats = tokenized_examples(prepared / "train.jsonl", tokenizer, args.max_length)
    validation, validation_stats = tokenized_examples(
        prepared / "validation.jsonl", tokenizer, args.max_length
    )
    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )
    model = AutoModelForCausalLM.from_pretrained(
        args.model, revision=args.revision, cache_dir=cache_dir,
        quantization_config=quantization, device_map={"": 0},
        dtype=torch.bfloat16, trust_remote_code=False,
    )
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    if args.bf16_frozen_matrices:
        for parameter in model.parameters():
            if (not parameter.requires_grad and parameter.dtype == torch.float32
                    and parameter.dim() == 2):
                parameter.data = parameter.data.to(torch.bfloat16)
        torch.cuda.empty_cache()
    if args.init_adapter:
        model = PeftModel.from_pretrained(model, str(args.init_adapter.resolve()),
                                          is_trainable=True)
    else:
        layer_count = model.config.num_hidden_layers
        if args.layers and args.layers[-1] >= layer_count:
            raise ValueError(f"--layers exceeds the model's {layer_count} decoder layers")
        # The Trainer seeds only its own loop; LoRA A is initialised here.
        set_seed(args.seed)
        model = get_peft_model(model, LoraConfig(
            r=args.lora_r, lora_alpha=args.lora_r * 2, lora_dropout=0.05,
            bias="none",
            target_modules=lora_target_modules(model, args.target_modules, args.layers),
            layers_to_transform=args.layers, task_type="CAUSAL_LM",
        ))
    model.print_trainable_parameters()
    lora = model.peft_config["default"]
    lora_modules = (lora.target_modules if isinstance(lora.target_modules, str)
                    else sorted({name.rsplit(".", 1)[-1] for name in lora.target_modules}))

    class ThermalStop(TrainerCallback):
        def on_step_end(self, args, state, control, **kwargs):
            current_temp, _ = gpu_reading()
            if current_temp >= args_stop_temp:
                raise RuntimeError(f"GPU temperature reached {current_temp} C")
            # Variable-length rows fragment the caching allocator; on Windows/WDDM
            # reserved memory past VRAM silently spills to shared system memory.
            print(json.dumps({"step": state.global_step,
                              "peakAllocatedMiB": round(torch.cuda.max_memory_allocated(0) / 1048576),
                              "reservedMiB": round(torch.cuda.memory_reserved(0) / 1048576),
                              "temperatureC": current_temp}), flush=True)
            torch.cuda.empty_cache()
            return control

    class CompletionLogitsTrainer(Trainer):
        """Run the LM head only where labels are supervised.

        Prompts here are ~2-3k tokens but completions are short; full-vocabulary
        logits for every prompt position overflow 16 GB and spill into shared
        memory. The loss is the same token-mean cross-entropy over completion
        tokens, normalized by num_items_in_batch under gradient accumulation.
        """

        def compute_loss(self, model, inputs, return_outputs=False, num_items_in_batch=None):
            labels = inputs["labels"]
            if labels.shape[0] != 1:
                raise ValueError("CompletionLogitsTrainer expects batch size 1")
            # Position p predicts token p+1.
            keep = (labels[0, 1:] != -100).nonzero(as_tuple=True)[0]
            outputs = model(input_ids=inputs["input_ids"],
                            attention_mask=inputs["attention_mask"],
                            logits_to_keep=keep, use_cache=False)
            logits = outputs.logits[0].float()
            loss = torch.nn.functional.cross_entropy(
                logits, labels[0, keep + 1], reduction="sum")
            if num_items_in_batch is not None:
                loss = loss / num_items_in_batch
            else:
                loss = loss / keep.numel()
            return (loss, outputs) if return_outputs else loss

    eval_steps = args.eval_steps or max(1, min(args.steps, 10))
    args_stop_temp = args.stop_temp_c
    training_args = TrainingArguments(
        output_dir=str(output / "checkpoints"),
        per_device_train_batch_size=1,
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=args.gradient_accumulation,
        max_steps=args.steps,
        learning_rate=1e-4,
        bf16=True,
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        optim="paged_adamw_8bit",
        logging_steps=1,
        eval_strategy="steps",
        eval_steps=eval_steps,
        save_strategy="steps",
        save_steps=args.save_steps or eval_steps,
        save_total_limit=2,
        report_to=[],
        dataloader_num_workers=0,
        remove_unused_columns=False,
        seed=args.seed,
    )
    trainer = CompletionLogitsTrainer(
        model=model,
        args=training_args,
        train_dataset=ListDataset(train),
        eval_dataset=ListDataset(validation),
        data_collator=DataCollatorForSeq2Seq(
            tokenizer, padding=True, label_pad_token_id=-100,
            return_tensors="pt",
        ),
        callbacks=[ThermalStop()],
    )
    checkpoints = sorted((output / "checkpoints").glob("checkpoint-*"),
                         key=lambda path: int(path.name.rsplit("-", 1)[-1]))
    resume_from = str(checkpoints[-1]) if args.resume and checkpoints else None
    if resume_from:
        print(json.dumps({"resumeFrom": resume_from}), flush=True)
    train_result = trainer.train(resume_from_checkpoint=resume_from)
    eval_result = trainer.evaluate()
    adapter_dir = output / "adapter"
    model.save_pretrained(adapter_dir, safe_serialization=True)
    tokenizer.save_pretrained(adapter_dir)
    with (output / "environment.txt").open("w", encoding="utf-8") as environment_file:
        subprocess.run(
            [os.sys.executable, "-m", "pip", "freeze"],
            check=True, stdout=environment_file,
        )
    adapter_file = adapter_dir / "adapter_model.safetensors"
    result = {
        "schema": "bitagent.local_adapter_gym_run.v1",
        "candidateOnly": True,
        "promoted": False,
        "profile": receipt["profile"],
        "preparedReceiptSha256": sha256(prepared / "receipt.json"),
        "model": args.model,
        "revision": args.revision,
        "initAdapter": str(args.init_adapter.resolve()) if args.init_adapter else None,
        "adapterSha256": sha256(adapter_file),
        "seed": args.seed,
        "loraR": lora.r,
        "targetModules": lora_modules,
        "layers": lora.layers_to_transform,
        "trainableParameters": model.get_nb_trainable_parameters()[0],
        "steps": args.steps,
        "maxLength": args.max_length,
        "bf16FrozenMatrices": args.bf16_frozen_matrices,
        "cudaMemoryFraction": args.cuda_memory_fraction,
        "resumedFromCheckpoint": resume_from,
        "lossScope": "completion_positions_only_token_mean",
        "train": train_stats,
        "validation": validation_stats,
        "trainMetrics": train_result.metrics,
        "evalMetrics": eval_result,
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "gpu": torch.cuda.get_device_name(0),
        "peakAllocatedMiB": round(torch.cuda.max_memory_allocated(0) / 1048576, 1),
        "finalTemperatureC": gpu_reading()[0],
    }
    (output / "run-receipt.json").write_text(
        json.dumps(result, indent=2, default=str) + "\n", encoding="utf-8"
    )
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
