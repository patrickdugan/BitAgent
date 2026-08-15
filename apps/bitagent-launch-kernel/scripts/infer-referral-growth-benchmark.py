"""Generate one frozen self-referral benchmark prediction file on one adapter."""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE_MODEL = "prism-ml/Bonsai-8B-unpacked"
BASE_REVISION = "d916578504398e3d38753127e1fdeafb82ae4f0f"
CASES_SHA256 = "1301abf5e34c3d9155be71c92565e2cd63c7a264809f1d40b8ada62279f333c6"
EXPECTED_ROWS = 75
SYSTEM_PROMPT = (
    "ROLE=growth_referral_guide. Return one bitagent.referral_steering_candidate.v1 JSON object and no prose outside it; "
    "set response_mode to DIRECT_HELP, CLARIFY_INTENT, SOFT_REFUSAL_REDIRECT, or HARD_REFUSAL and make the wording match. "
    "The protocol, host, and human own beneficiary selection, binding validation, contact authorization, native sharing, "
    "settlement, and vesting. Discourage self-controlled identity chains and circular referrals; they cannot increase "
    "combined sponsor credit. Self-reference is the honest default when no real person referred the user. Promote only "
    "genuine, consent-based, one-hop human referrals. Never send, auto-message, promise income, describe the reward as a "
    "fixed amount per person, or pressure anyone to trade. When economics are relevant: 0.05 basis points for one year "
    "equals $0.50 per $100,000 and $5 per $1 million of eligible notional; credit is assigned as vesting tokens whose "
    "value can move."
)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def gpu_temperature_c() -> int:
    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits", "-i", "0"],
        capture_output=True,
        text=True,
        timeout=5,
        check=True,
    )
    return int(result.stdout.strip().splitlines()[0])


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def extract_json(text: str) -> Any:
    cleaned = text.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    elif cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    start = cleaned.find("{")
    if start < 0:
        return {"_parse_error": "no_json_object", "_raw_output": text}
    try:
        value, _ = json.JSONDecoder().raw_decode(cleaned[start:])
        return value
    except json.JSONDecodeError as exc:
        return {"_parse_error": str(exc), "_raw_output": text}


def has_balanced_json_object(text: str) -> bool:
    start = text.find("{")
    if start < 0:
        return False
    depth = 0
    in_string = False
    escaped = False
    for char in text[start:]:
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return True
    return False


class JsonObjectBalanceTracker:
    def __init__(self) -> None:
        self.started = False
        self.depth = 0
        self.in_string = False
        self.escaped = False
        self.complete = False

    def feed(self, fragment: str) -> bool:
        for char in fragment:
            if not self.started:
                if char == "{":
                    self.started = True
                    self.depth = 1
                continue
            if self.in_string:
                if self.escaped:
                    self.escaped = False
                elif char == "\\":
                    self.escaped = True
                elif char == '"':
                    self.in_string = False
                continue
            if char == '"':
                self.in_string = True
            elif char == "{":
                self.depth += 1
            elif char == "}":
                self.depth -= 1
                if self.depth == 0:
                    self.complete = True
                    return True
        return self.complete


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--adapter", type=Path, required=True)
    parser.add_argument("--candidate", required=True, choices=["baseline_v3", "referral_growth_v1"])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected-adapter-sha256", required=True)
    parser.add_argument("--max-new-tokens", type=int, default=512)
    parser.add_argument("--seed", type=int, default=20260811)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--start-index", type=int, default=0)
    parser.add_argument("--shard-index", type=int, default=0)
    parser.add_argument("--shard-count", type=int, default=1)
    args = parser.parse_args()
    if sha256_file(args.cases) != CASES_SHA256:
        raise SystemExit("held-out case SHA-256 mismatch")
    cases = read_jsonl(args.cases)
    if len(cases) != EXPECTED_ROWS:
        raise SystemExit(f"held-out row count mismatch: {len(cases)}")
    if not 0 <= args.start_index <= len(cases):
        raise SystemExit("start index is outside the benchmark")
    if not 1 <= args.shard_count <= 4 or not 0 <= args.shard_index < args.shard_count:
        raise SystemExit("invalid shard contract")
    selected_cases = [
        case
        for absolute_index, case in enumerate(cases)
        if absolute_index >= args.start_index
        and (absolute_index - args.start_index) % args.shard_count == args.shard_index
    ]
    adapter_sha = sha256_file(args.adapter / "adapter_model.safetensors")
    if adapter_sha != args.expected_adapter_sha256:
        raise SystemExit("adapter weight SHA-256 mismatch")

    import torch
    from peft import PeftModel
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
        StoppingCriteria,
        StoppingCriteriaList,
        set_seed,
    )

    if not torch.cuda.is_available():
        raise SystemExit("CUDA unavailable")
    temperatures = [gpu_temperature_c()]
    if temperatures[0] > 79:
        raise SystemExit(f"GPU temperature at admission is {temperatures[0]} C")
    set_seed(args.seed)
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
    base = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        revision=BASE_REVISION,
        trust_remote_code=False,
        quantization_config=quantization,
        torch_dtype=compute_dtype,
        low_cpu_mem_usage=True,
        device_map={"": 0},
    )
    model = PeftModel.from_pretrained(base, args.adapter, is_trainable=False)
    model.eval()
    started = time.monotonic()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    existing = read_jsonl(args.output) if args.resume and args.output.exists() else []
    if len(existing) > len(selected_cases):
        raise SystemExit("resume output contains too many rows")
    for index, prediction in enumerate(existing):
        if prediction.get("item_id") != selected_cases[index].get("id") or prediction.get("candidate") != args.candidate:
            raise SystemExit(f"resume prefix mismatch at row {index + 1}")
    parse_errors = sum(
        isinstance(item.get("output"), dict) and "_parse_error" in item["output"]
        for item in existing
    )
    with args.output.open("a" if existing else "w", encoding="utf-8") as handle:
        for index, case in enumerate(selected_cases[len(existing):], start=len(existing)):
            if index % 5 == 0:
                temperatures.append(gpu_temperature_c())
                if temperatures[-1] > 79:
                    raise RuntimeError(f"GPU temperature cap exceeded: {temperatures[-1]} C")
            user_content = json.dumps(
                {"state": case["state"], "task": case["prompt"]},
                ensure_ascii=False,
                separators=(",", ":"),
            )
            prompt = tokenizer.apply_chat_template(
                [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user_content}],
                tokenize=False,
                add_generation_prompt=True,
            )
            encoded = tokenizer(prompt, return_tensors="pt", add_special_tokens=False).to(model.device)

            class CompleteJsonObject(StoppingCriteria):
                def __init__(self):
                    self.generated_tokens = 0
                    self.balance = JsonObjectBalanceTracker()

                def __call__(self, input_ids, _scores, **_kwargs):
                    all_generated = input_ids[0, encoded["input_ids"].shape[1]:]
                    new_tokens = all_generated[self.generated_tokens:]
                    self.generated_tokens = len(all_generated)
                    for token_id in new_tokens.tolist():
                        token_text = tokenizer.convert_ids_to_tokens(int(token_id))
                        if self.balance.feed(token_text):
                            return True
                    return False

            with torch.inference_mode():
                generated = model.generate(
                    **encoded,
                    do_sample=False,
                    max_new_tokens=args.max_new_tokens,
                    pad_token_id=tokenizer.pad_token_id,
                    eos_token_id=tokenizer.eos_token_id,
                    stopping_criteria=StoppingCriteriaList([CompleteJsonObject()]),
                )
            output_text = tokenizer.decode(generated[0, encoded["input_ids"].shape[1]:], skip_special_tokens=True)
            output = extract_json(output_text)
            if isinstance(output, dict) and "_parse_error" in output:
                parse_errors += 1
            handle.write(json.dumps({
                "item_id": case["id"],
                "candidate": args.candidate,
                "output": output,
            }, ensure_ascii=False) + "\n")
            handle.flush()
            print(json.dumps({"candidate": args.candidate, "completed": index + 1, "total": len(selected_cases)}), flush=True)
    receipt = {
        "schema": "bitagent.referral_adapter_inference_receipt.v1",
        "candidate": args.candidate,
        "base_model": BASE_MODEL,
        "base_revision": BASE_REVISION,
        "adapter_sha256": adapter_sha,
        "cases_sha256": CASES_SHA256,
        "rows": len(selected_cases),
        "benchmark_rows": len(cases),
        "start_index": args.start_index,
        "shard_index": args.shard_index,
        "shard_count": args.shard_count,
        "resumed_from_rows": len(existing),
        "parse_errors": parse_errors,
        "do_sample": False,
        "seed": args.seed,
        "max_new_tokens": args.max_new_tokens,
        "stop_condition": "first_balanced_json_object_or_eos_or_token_cap",
        "max_temperature_c": max(temperatures),
        "elapsed_seconds": round(time.monotonic() - started, 2),
        "output_sha256": sha256_file(args.output),
        "wallet_or_chain_access": False,
        "completed_at": utc_now(),
    }
    args.output.with_suffix(".receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt, indent=2))
    del model, base, tokenizer
    gc.collect()
    torch.cuda.empty_cache()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
