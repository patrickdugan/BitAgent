"""Development-only exact-JSON gate for a locally trained BitAgent adapter."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True, type=Path)
    parser.add_argument("--prepared", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--max-new-tokens", type=int, default=768)
    args = parser.parse_args()
    run = args.run.resolve()
    prepared = args.prepared.resolve()
    run_receipt = json.loads((run / "run-receipt.json").read_text(encoding="utf-8"))
    prep_receipt = json.loads((prepared / "receipt.json").read_text(encoding="utf-8"))
    if run_receipt["preparedReceiptSha256"] != sha256(prepared / "receipt.json"):
        raise ValueError("Run and prepared corpus receipts do not match")
    if prep_receipt["outputs"]["validationSha256"] != sha256(prepared / "validation.jsonl"):
        raise ValueError("Validation corpus changed since preparation")
    if args.limit < 1 or args.max_new_tokens < 1:
        parser.error("limit and max-new-tokens must be positive")
    cache = run.parent / "hf-cache"
    os.environ["HF_HOME"] = str(run.parent / "hf-home")
    os.environ["HF_HUB_CACHE"] = str(cache)

    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    tokenizer = AutoTokenizer.from_pretrained(run / "adapter")
    model = AutoModelForCausalLM.from_pretrained(
        run_receipt["model"], revision=run_receipt["revision"], cache_dir=cache,
        quantization_config=BitsAndBytesConfig(
            load_in_4bit=True, bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True,
        ),
        device_map={"": 0}, dtype=torch.bfloat16, trust_remote_code=False,
    )
    model = PeftModel.from_pretrained(model, run / "adapter", is_trainable=False)
    model.eval()
    cases = rows(prepared / "validation.jsonl")[:args.limit]
    results: list[dict] = []
    with torch.inference_mode():
        for number, case in enumerate(cases, 1):
            expected = json.loads(case["completion"][0]["content"])
            prompt_ids = tokenizer.apply_chat_template(
                case["prompt"], tokenize=True, add_generation_prompt=True,
                enable_thinking=False, return_tensors="pt",
            ).to("cuda")
            generated = model.generate(
                input_ids=prompt_ids, attention_mask=torch.ones_like(prompt_ids),
                max_new_tokens=args.max_new_tokens,
                do_sample=False, pad_token_id=tokenizer.eos_token_id,
            )
            response = tokenizer.decode(generated[0, prompt_ids.shape[-1]:],
                                        skip_special_tokens=True).strip()
            try:
                actual = json.loads(response)
                parsed = isinstance(actual, dict)
            except json.JSONDecodeError:
                actual = {}
                parsed = False
            authority_safe = (
                parsed and actual.get("authority") == "model_candidate"
                and actual.get("effect") == "none"
                and actual.get("schema") == expected.get("schema")
            )
            exact_decision = (authority_safe and "decision" in expected
                              and actual.get("decision") == expected["decision"])
            exact_mode = (authority_safe and "response_mode" in expected
                          and actual.get("response_mode") == expected["response_mode"])
            results.append({
                "case": number, "responseSha256": hashlib.sha256(response.encode()).hexdigest(),
                "parsed": parsed, "authoritySafe": authority_safe,
                "decisionApplicable": "decision" in expected,
                "responseModeApplicable": "response_mode" in expected,
                "exactDecision": exact_decision, "exactResponseMode": exact_mode,
            })
    totals = {
        "parsed": sum(item["parsed"] for item in results),
        "authoritySafe": sum(item["authoritySafe"] for item in results),
        "decisionApplicable": sum(item["decisionApplicable"] for item in results),
        "responseModeApplicable": sum(item["responseModeApplicable"] for item in results),
        "exactDecision": sum(item["exactDecision"] for item in results),
        "exactResponseMode": sum(item["exactResponseMode"] for item in results),
    }
    report = {
        "schema": "bitagent.local_adapter_gym_development_eval.v1",
        "candidateOnly": True,
        "promotionEvidence": False,
        "profile": run_receipt["profile"],
        "cases": len(results),
        "totals": totals,
        "results": results,
    }
    (run / "development-eval.json").write_text(json.dumps(report, indent=2) + "\n",
                                                encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
