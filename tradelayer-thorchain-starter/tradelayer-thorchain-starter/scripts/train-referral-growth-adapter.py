"""Continue the frozen BitAgent v3 adapter on the referral-growth SFT seed.

This entry point is candidate-only. It has no wallet, signer, RPC, chain, or
message-send integration and refuses inputs whose frozen hashes do not match.
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import os
import random
import subprocess
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE_MODEL = "prism-ml/Bonsai-8B-unpacked"
BASE_REVISION = "d916578504398e3d38753127e1fdeafb82ae4f0f"
ROLE = "growth_referral_guide"
SCHEMA = "hermes.bitagent_role_example.v1"
TRAIN_SHA256 = "49b01152c31935196d0c3aa8afe038041e4cdc4f0eb9dcbbc62e1d1222ac3563"
VALIDATION_SHA256 = "f19ae314135e49797a911f14ea2dee4e61d95d507a9a1197df6d37426231f729"
SOURCE_ADAPTER_SHA256 = "ceb39699033124710f2537d1e65d3cb794f43f9e7c3313b3c93522da7df913be"
EXPECTED_TRAIN_ROWS = 38
EXPECTED_VALIDATION_ROWS = 14


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8-sig").splitlines()
        if line.strip()
    ]


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def append_event(path: Path, event: str, **fields: Any) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"ts": utc_now(), "event": event, **fields}, ensure_ascii=False) + "\n")


def directory_hash(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def gpu_temperature_c() -> int:
    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits", "-i", "0"],
        capture_output=True,
        text=True,
        timeout=5,
        check=True,
    )
    return int(result.stdout.strip().splitlines()[0])


def validate_rows(path: Path, split: str, expected_hash: str, expected_rows: int) -> list[dict[str, Any]]:
    actual_hash = sha256_file(path)
    if actual_hash != expected_hash:
        raise ValueError(f"{split} SHA-256 mismatch: {actual_hash}")
    rows = read_jsonl(path)
    if len(rows) != expected_rows:
        raise ValueError(f"{split} row count mismatch: {len(rows)}")
    for row in rows:
        if row.get("schema") != SCHEMA or row.get("role") != ROLE or row.get("split") != split:
            raise ValueError(f"invalid {split} row identity: {row.get('id')}")
        messages = row.get("messages")
        if not isinstance(messages, list) or [item.get("role") for item in messages] != ["system", "user", "assistant"]:
            raise ValueError(f"invalid message contract: {row.get('id')}")
        candidate = json.loads(messages[-1]["content"])
        if candidate.get("schema") != "bitagent.referral_steering_candidate.v1":
            raise ValueError(f"invalid assistant schema: {row.get('id')}")
        authority = row.get("authority", {})
        if not authority.get("proposeOnly") or "send_initial_message" not in authority.get("forbiddenEffects", []):
            raise ValueError(f"expanded authority in row: {row.get('id')}")
    return rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train", type=Path, required=True)
    parser.add_argument("--validation", type=Path, required=True)
    parser.add_argument("--source-adapter", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--training-task-id", default="bitagent-referral-growth-v1")
    parser.add_argument("--max-seq-length", type=int, default=2048)
    parser.add_argument("--epochs", type=float, default=3.0)
    parser.add_argument("--learning-rate", type=float, default=5e-5)
    parser.add_argument("--gradient-accumulation", type=int, default=4)
    parser.add_argument("--save-steps", type=int, default=5)
    parser.add_argument("--checkpoint-seconds", type=int, default=60)
    parser.add_argument("--max-wall-seconds", type=int, default=2700)
    parser.add_argument("--ram-cap-mb", type=int, default=24576)
    parser.add_argument("--cpu-cap-pct", type=float, default=50.0)
    parser.add_argument("--io-cap-mb-s", type=float, default=50.0)
    parser.add_argument("--temperature-cap-c", type=int, default=79)
    parser.add_argument("--min-free-vram-mb", type=int, default=44000)
    parser.add_argument("--seed", type=int, default=20260811)
    parser.add_argument("--preflight-only", action="store_true")
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not 1024 <= args.max_seq_length <= 2048:
        raise ValueError("max sequence length must be between 1024 and 2048")
    if not 1 <= args.epochs <= 4:
        raise ValueError("epochs must be between 1 and 4")
    if not 1 <= args.save_steps <= 10 or not 10 <= args.checkpoint_seconds <= 60:
        raise ValueError("checkpoint cadence exceeds the run contract")
    if not 1 <= args.max_wall_seconds <= 2700:
        raise ValueError("training wall cap exceeds 45 minutes")
    if args.temperature_cap_c != 79:
        raise ValueError("temperature cap must remain 79 C")
    source_weights = args.source_adapter / "adapter_model.safetensors"
    if sha256_file(source_weights) != SOURCE_ADAPTER_SHA256:
        raise ValueError("source adapter weight SHA-256 mismatch")
    return (
        validate_rows(args.train, "train", TRAIN_SHA256, EXPECTED_TRAIN_ROWS),
        validate_rows(args.validation, "validation", VALIDATION_SHA256, EXPECTED_VALIDATION_ROWS),
    )


def main() -> int:
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    events_path = args.output / "events.jsonl"
    train_rows, validation_rows = validate_args(args)
    manifest = {
        "schema": "bitagent.referral_adapter_prime_run.v1",
        "created_at": utc_now(),
        "training_task_id": args.training_task_id,
        "base_model": BASE_MODEL,
        "base_revision": BASE_REVISION,
        "source_adapter_sha256": SOURCE_ADAPTER_SHA256,
        "train_sha256": TRAIN_SHA256,
        "validation_sha256": VALIDATION_SHA256,
        "train_rows": len(train_rows),
        "validation_rows": len(validation_rows),
        "heldout_present": False,
        "training": {
            "max_sequence_tokens": args.max_seq_length,
            "epochs": args.epochs,
            "learning_rate": args.learning_rate,
            "per_device_batch": 1,
            "gradient_accumulation": args.gradient_accumulation,
            "seed": args.seed,
        },
        "caps": {
            "ram_mb": args.ram_cap_mb,
            "cpu_pct_of_pod": args.cpu_cap_pct,
            "io_mb_s": args.io_cap_mb_s,
            "temperature_c": args.temperature_cap_c,
            "min_free_vram_mb": args.min_free_vram_mb,
            "wall_seconds": args.max_wall_seconds,
        },
        "checkpoint": {"steps": args.save_steps, "seconds": args.checkpoint_seconds},
        "authority": "candidate_only_no_wallet_chain_rpc_signer_or_send",
    }
    write_json(args.output / "run_manifest.json", manifest)
    if args.preflight_only:
        write_json(args.output / "preflight.json", {"status": "passed", **manifest})
        print(json.dumps({"status": "passed", "training_started": False, **manifest}, indent=2))
        return 0

    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    os.environ.setdefault("WANDB_DISABLED", "true")
    started = time.monotonic()
    status = "failed"
    abort_reason = ""
    samples: list[dict[str, Any]] = []
    cleanup: dict[str, Any] = {}
    model = tokenizer = trainer = train_dataset = eval_dataset = None
    try:
        import psutil
        import torch
        from peft import PeftModel, prepare_model_for_kbit_training
        from torch.utils.data import Dataset
        from transformers import (
            AutoModelForCausalLM,
            AutoTokenizer,
            BitsAndBytesConfig,
            DataCollatorForSeq2Seq,
            Trainer,
            TrainerCallback,
            TrainingArguments,
            set_seed,
        )

        if not torch.cuda.is_available():
            raise RuntimeError("CUDA unavailable")
        free_vram, total_vram = torch.cuda.mem_get_info()
        if free_vram / 1024**2 < args.min_free_vram_mb:
            raise RuntimeError(f"free VRAM below cap: {free_vram / 1024**2:.0f} MiB")
        admission_temp = gpu_temperature_c()
        if admission_temp > args.temperature_cap_c:
            raise RuntimeError(f"GPU temperature at admission is {admission_temp} C")
        random.seed(args.seed)
        set_seed(args.seed)
        process = psutil.Process()
        process.cpu_percent(interval=None)
        last_io = process.io_counters().read_bytes + process.io_counters().write_bytes
        state = {
            "last_sample": time.monotonic(),
            "last_checkpoint": time.monotonic(),
            "last_io": last_io,
            "cpu_excess": 0,
            "io_excess": 0,
            "abort_reason": "",
        }

        class Rows(Dataset):
            def __init__(self, values: list[dict[str, Any]]):
                self.values = values

            def __len__(self) -> int:
                return len(self.values)

            def __getitem__(self, index: int) -> dict[str, Any]:
                return self.values[index]

        class ResourceGuard(TrainerCallback):
            def on_step_end(self, _callback_args, callback_state, control, **_kwargs):
                now = time.monotonic()
                counters = process.io_counters()
                io_total = counters.read_bytes + counters.write_bytes
                sample_seconds = max(0.001, now - state["last_sample"])
                io_rate = max(0, io_total - state["last_io"]) / 1024**2 / sample_seconds
                cpu_pct = process.cpu_percent(interval=None) / max(1, psutil.cpu_count(logical=True))
                rss_mb = process.memory_info().rss / 1024**2
                temperature = gpu_temperature_c()
                sample = {
                    "step": callback_state.global_step,
                    "rss_mb": round(rss_mb, 2),
                    "cpu_pct_of_pod": round(cpu_pct, 2),
                    "io_mb_s": round(io_rate, 2),
                    "temperature_c": temperature,
                    "cuda_allocated_mb": round(torch.cuda.memory_allocated() / 1024**2, 2),
                    "cuda_reserved_mb": round(torch.cuda.memory_reserved() / 1024**2, 2),
                }
                samples.append(sample)
                append_event(events_path, "resource_sample", **sample)
                state["last_sample"] = now
                state["last_io"] = io_total
                state["cpu_excess"] = state["cpu_excess"] + 1 if cpu_pct > args.cpu_cap_pct else 0
                state["io_excess"] = state["io_excess"] + 1 if io_rate > args.io_cap_mb_s else 0
                reason = ""
                if rss_mb > args.ram_cap_mb:
                    reason = "ram_cap_exceeded"
                elif temperature > args.temperature_cap_c:
                    reason = "temperature_cap_exceeded"
                elif state["cpu_excess"] >= 5:
                    reason = "sustained_cpu_cap_exceeded"
                elif state["io_excess"] >= 3:
                    reason = "sustained_io_cap_exceeded"
                elif now - started >= args.max_wall_seconds:
                    reason = "wall_clock_cap"
                if now - state["last_checkpoint"] >= args.checkpoint_seconds:
                    control.should_save = True
                    state["last_checkpoint"] = now
                if reason:
                    state["abort_reason"] = reason
                    control.should_save = True
                    control.should_training_stop = True
                    append_event(events_path, "abort_requested", step=callback_state.global_step, reason=reason)
                return control

            def on_save(self, _callback_args, callback_state, control, **_kwargs):
                append_event(events_path, "checkpoint", step=callback_state.global_step)
                return control

        compute_dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
        quantization = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=compute_dtype,
        )
        tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, revision=BASE_REVISION, trust_remote_code=False)
        if tokenizer.pad_token_id is None:
            tokenizer.pad_token = tokenizer.eos_token
        tokenizer.padding_side = "right"
        base = AutoModelForCausalLM.from_pretrained(
            BASE_MODEL,
            revision=BASE_REVISION,
            trust_remote_code=False,
            quantization_config=quantization,
            torch_dtype=compute_dtype,
            low_cpu_mem_usage=True,
            device_map={"": 0},
        )
        base.config.use_cache = False
        base = prepare_model_for_kbit_training(base, use_gradient_checkpointing=True)
        model = PeftModel.from_pretrained(base, args.source_adapter, is_trainable=True)

        def encode(row: dict[str, Any]) -> dict[str, list[int]]:
            messages = row["messages"]
            prompt = tokenizer.apply_chat_template(messages[:-1], tokenize=False, add_generation_prompt=True)
            full = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
            prompt_ids = tokenizer(prompt, add_special_tokens=False)["input_ids"]
            encoded = tokenizer(full, add_special_tokens=False)
            if len(encoded["input_ids"]) > args.max_seq_length:
                raise RuntimeError(f"row exceeds context cap: {row['id']}")
            if encoded["input_ids"][: len(prompt_ids)] != prompt_ids:
                raise RuntimeError(f"prompt mask drift: {row['id']}")
            labels = [-100] * len(prompt_ids) + list(encoded["input_ids"][len(prompt_ids):])
            if not any(value != -100 for value in labels):
                raise RuntimeError(f"empty assistant mask: {row['id']}")
            return {**encoded, "labels": labels}

        train_dataset = Rows([encode(row) for row in train_rows])
        eval_dataset = Rows([encode(row) for row in validation_rows])
        training_args = TrainingArguments(
            output_dir=str(args.output / "checkpoints"),
            per_device_train_batch_size=1,
            per_device_eval_batch_size=1,
            gradient_accumulation_steps=args.gradient_accumulation,
            num_train_epochs=args.epochs,
            learning_rate=args.learning_rate,
            warmup_ratio=0.1,
            lr_scheduler_type="cosine",
            logging_steps=1,
            save_strategy="steps",
            save_steps=args.save_steps,
            save_total_limit=3,
            eval_strategy="epoch",
            optim="paged_adamw_8bit",
            max_grad_norm=0.3,
            bf16=compute_dtype == torch.bfloat16,
            fp16=compute_dtype == torch.float16,
            gradient_checkpointing=True,
            report_to=[],
            remove_unused_columns=False,
            seed=args.seed,
            data_seed=args.seed,
        )
        trainer = Trainer(
            model=model,
            args=training_args,
            train_dataset=train_dataset,
            eval_dataset=eval_dataset,
            data_collator=DataCollatorForSeq2Seq(
                tokenizer=tokenizer,
                padding=True,
                label_pad_token_id=-100,
                pad_to_multiple_of=8,
                return_tensors="pt",
            ),
            callbacks=[ResourceGuard()],
        )
        append_event(events_path, "training_started", train_rows=len(train_rows), validation_rows=len(validation_rows))
        result = trainer.train()
        if state["abort_reason"]:
            status = "aborted"
            abort_reason = state["abort_reason"]
        else:
            final_adapter = args.output / "adapter"
            model.save_pretrained(final_adapter, safe_serialization=True)
            tokenizer.save_pretrained(final_adapter)
            evaluation = trainer.evaluate()
            adapter_sha = sha256_file(final_adapter / "adapter_model.safetensors")
            receipt = {
                "schema": "bitagent.referral_adapter_training_receipt.v1",
                "status": "completed",
                "training_task_id": args.training_task_id,
                "base_model": BASE_MODEL,
                "base_revision": BASE_REVISION,
                "source_adapter_sha256": SOURCE_ADAPTER_SHA256,
                "train_sha256": TRAIN_SHA256,
                "validation_sha256": VALIDATION_SHA256,
                "heldout_present": False,
                "adapter_model_sha256": adapter_sha,
                "adapter_tree_sha256": directory_hash(final_adapter),
                "global_step": trainer.state.global_step,
                "train_runtime_seconds": result.metrics.get("train_runtime"),
                "train_loss": result.metrics.get("train_loss"),
                "eval_loss": evaluation.get("eval_loss"),
                "max_temperature_c": max([admission_temp, *[item["temperature_c"] for item in samples]]),
                "wallet_or_chain_access": False,
                "promotion_status": "candidate_pending_frozen_heldout_evaluation",
                "completed_at": utc_now(),
            }
            write_json(args.output / "training_receipt.json", receipt)
            print(json.dumps(receipt, indent=2))
            status = "completed"
    except Exception as exc:
        abort_reason = abort_reason or str(exc)
        append_event(events_path, "training_exception", reason=abort_reason, traceback=traceback.format_exc(limit=12))
    finally:
        before_rss = None
        try:
            import psutil
            before_rss = round(psutil.Process().memory_info().rss / 1024**2, 2)
        except Exception:
            pass
        try:
            del trainer, model, tokenizer, train_dataset, eval_dataset
        except Exception:
            pass
        gc.collect()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
        except Exception:
            pass
        gc.collect()
        cleanup = {
            "schema": "bitagent.referral_adapter_cleanup.v1",
            "owned_pid": os.getpid(),
            "rss_before_cleanup_mb": before_rss,
            "broad_process_termination": False,
            "cuda_cache_clear_requested": True,
            "completed_at": utc_now(),
        }
        write_json(args.output / "cleanup_receipt.json", cleanup)
        summary = {
            "schema": "bitagent.referral_adapter_run_summary.v1",
            "status": status,
            "abort_reason": abort_reason,
            "elapsed_seconds": round(time.monotonic() - started, 2),
            "resource_samples": len(samples),
            "cleanup": cleanup,
            "completed_at": utc_now(),
        }
        write_json(args.output / "summary.json", summary)
    return 0 if status == "completed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
