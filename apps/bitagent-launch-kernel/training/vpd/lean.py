"""Build one capability's compact model from subspace.py's exported files and measure what it saves.

The selected matrices are replaced by low-rank modules holding the shared base factors plus one
adapter's factors; nothing dense is kept for them. `--check` compares the result with the dense
model on every capability's eval windows.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from safetensors.torch import load_file

import config
from qwen_suffix import LowRankLinear, cached_residual, load_model, set_modules, site_modules, suffix_logits
from vpd_core import kl_logits


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--subspace", type=Path, required=True, help="subspace.py output directory")
    parser.add_argument("--capability", help="adapter to load on top of the base (default: base only)")
    parser.add_argument("--data", type=Path, default=config.OUT / "data-s96")
    parser.add_argument("--check", action="store_true", help="KL to the dense model on each capability's eval windows")
    parser.add_argument("--eval-windows", type=int, default=8)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--threads", type=int, default=6)
    args = parser.parse_args()
    config.lower_priority()
    torch.set_num_threads(args.threads)

    manifest = json.loads((args.subspace / "subspace.json").read_text(encoding="utf-8"))
    layers, kind = manifest["layers"], manifest["kind"]
    model = load_model(args.device)
    dense = site_modules(model, layers, kind)
    total_before = sum(p.numel() for p in model.parameters())

    parts = [load_file(str(args.subspace / "base.safetensors"), device=args.device)]
    if args.capability:
        parts.append(load_file(str(args.subspace / f"adapter-{args.capability}.safetensors"), device=args.device))
    lean = {name: LowRankLinear(torch.cat([p[f"{name}.A"] for p in parts], dim=1),
                                torch.cat([p[f"{name}.B"] for p in parts], dim=0), linear.bias)
            for name, linear in dense.items()}

    replaced = sum(linear.weight.numel() for linear in dense.values())
    kept = sum(module.A.numel() + module.B.numel() for module in lean.values())
    report = {
        "capability": args.capability or "base only",
        "replaced_matrices": len(dense),
        "dense_params_replaced": replaced, "low_rank_params": kept, "ratio": round(kept / replaced, 4),
        "dense_megabytes_fp32": round(replaced * 4 / 2 ** 20, 1), "low_rank_megabytes_fp32": round(kept * 4 / 2 ** 20, 1),
        "whole_model_params_before": total_before, "whole_model_params_after": total_before - replaced + kept,
    }

    if args.check:
        windows = torch.load(args.data / "windows.pt")
        first = min(layers)
        resid = cached_residual(model, windows, first, args.data)
        kl = {}
        with torch.no_grad():
            for capability in resid:
                hidden = resid[capability]["eval"][:args.eval_windows].to(args.device)
                set_modules(model, layers, kind, dense)
                clean = suffix_logits(model, hidden, first)
                set_modules(model, layers, kind, lean)
                kl[capability] = round(kl_logits(suffix_logits(model, hidden, first), clean).item(), 4)
        report["kl_to_dense"] = kl
    else:
        set_modules(model, layers, kind, lean)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
