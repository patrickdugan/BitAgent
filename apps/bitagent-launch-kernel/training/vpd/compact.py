"""Per-capability compaction curves: how well does a rank-r version of each matrix keep one capability?

At equal rank this compares plain SVD, activation-aware low rank fitted on all capabilities, the
same fitted on the target capability, and (with --run) a trained VPD run's subcomponents ranked by
causal importance on all capabilities or on the target capability. No delta is kept in any of them.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

import config
from qwen_suffix import KINDS, cached_residual, drop_prefix, load_model, parse_layers, site_modules, suffix_logits
from subspace import input_moments, whiten
from vpd_core import kl_logits


def factors(weight: torch.Tensor, moment: torch.Tensor | None, ridge: float) -> tuple[torch.Tensor, torch.Tensor]:
    """A, B with A[:, :r] @ B[:r] the best rank-r fit of `weight` on inputs with this second moment (None: plain SVD)."""
    if moment is None:
        left, singular, right_t = torch.linalg.svd(weight, full_matrices=False)
        return left * singular, right_t
    root, root_inverse = whiten(moment, ridge)
    left, singular, right_t = torch.linalg.svd(weight @ root, full_matrices=False)
    return left * singular, right_t @ root_inverse


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=config.OUT / "data-s96")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--run", type=Path, help="decompose.py output directory; adds the VPD columns")
    parser.add_argument("--scores", type=Path, help="scores.pt from chunk.py --run for the same run, to rank its "
                        "subcomponents; without it the run's subcomponents are all kept (a capability-targeted run)")
    parser.add_argument("--layers", default="27", help="used without --run")
    parser.add_argument("--kind", choices=list(KINDS), default="mlp", help="used without --run")
    parser.add_argument("--ranks", default="64,128,256")
    parser.add_argument("--ridge", type=float, default=1e-3)
    parser.add_argument("--moment-windows", type=int, default=64)
    parser.add_argument("--eval-windows", type=int, default=8)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--threads", type=int, default=6)
    args = parser.parse_args()
    if args.scores and not args.run:
        parser.error("--scores needs --run")
    config.lower_priority()
    torch.set_num_threads(args.threads)
    args.output.mkdir(parents=True, exist_ok=True)
    ranks = [int(r) for r in args.ranks.split(",")]

    windows = torch.load(args.data / "windows.pt")
    model = load_model(args.device)
    first = None
    if args.run:
        saved = torch.load(args.run / "decomposition.pt", map_location=args.device)
        layers, kind = parse_layers(saved["args"]["layers"]), saved["args"]["kind"]
        first = saved["args"].get("cache_layer")
    else:
        layers, kind = parse_layers(args.layers), args.kind
    first = min(layers) if first is None else first
    resid = cached_residual(model, windows, first, args.data)
    drop_prefix(model, first)
    capabilities = list(resid)
    linears = site_modules(model, layers, kind)
    original = {name: linear.weight.detach().clone() for name, linear in linears.items()}
    moments = input_moments(model, linears, resid, first, max(layers), args.moment_windows, args.batch)

    fits = {"svd": {}, "generic": {}, **{f"own:{c}": {} for c in capabilities}}
    for name, weight in original.items():
        fits["svd"][name] = factors(weight, None, args.ridge)
        pooled = torch.stack([moments[c][name] for c in capabilities]).mean(0)
        fits["generic"][name] = factors(weight, pooled, args.ridge)
        for capability in capabilities:
            fits[f"own:{capability}"][name] = factors(weight, moments[capability][name], args.ridge)
        print(f"factors: {name}", flush=True)
    del moments

    vpd = None
    if args.scores:
        scores = torch.load(args.scores)["scores"].to(args.device)  # [capabilities, all components], sites in run order
        sizes = [saved["state"][f"sites.{name}.V"].shape[1] for name in linears]
        relative = scores / scores.mean(1, keepdim=True)
        rows = {"vpd_generic": relative.mean(0), **{f"vpd_own:{c}": scores[k] for k, c in enumerate(capabilities)}}
        vpd = {label: dict(zip(linears, row.split(sizes))) for label, row in rows.items()}

    def weights(method: str, capability: str, rank: int) -> dict[str, torch.Tensor]:
        if method.startswith("vpd"):
            out = {}
            for name in linears:
                state = saved["state"]
                if method == "vpd_all":  # every subcomponent of the run, whatever the rank column says
                    keep = slice(None)
                else:
                    ranking = vpd["vpd_generic" if method == "vpd_generic" else f"vpd_own:{capability}"]
                    keep = ranking[name].topk(rank).indices
                out[name] = (state[f"sites.{name}.V"][:, keep] @ state[f"sites.{name}.U"][keep]).T
            return out
        fit = fits[f"own:{capability}" if method == "own" else method]
        return {name: fit[name][0][:, :rank] @ fit[name][1][:rank] for name in linears}

    methods = ["svd", "generic", "own"]
    if args.run:
        methods += ["vpd_generic", "vpd_own"] if vpd else ["vpd_all"]
    kl = {rank: {method: {} for method in methods} for rank in ranks}
    with torch.no_grad():
        for capability in capabilities:
            hidden = resid[capability]["eval"][:args.eval_windows].to(args.device)
            for name, linear in linears.items():
                linear.weight.copy_(original[name])
            clean = suffix_logits(model, hidden, first)
            for rank in ranks:
                for method in methods:
                    for name, weight in weights(method, capability, rank).items():
                        linears[name].weight.copy_(weight)
                    kl[rank][method][capability] = kl_logits(suffix_logits(model, hidden, first), clean).item()
            print(f"evaluated: {capability}", flush=True)
        for name, linear in linears.items():
            linear.weight.copy_(original[name])

    dense = sum(w.numel() for w in original.values())
    per_rank = sum(sum(w.shape) for w in original.values())
    result = {"layers": layers, "kind": kind, "ranks": ranks, "capabilities": capabilities, "ridge": args.ridge,
              "run": str(args.run) if args.run else None, "kl": {str(rank): kl[rank] for rank in ranks},
              "params_fraction": {str(rank): per_rank * rank / dense for rank in ranks}}
    (args.output / "compact.json").write_text(json.dumps(result, indent=1), encoding="utf-8")

    lines = [f"# Compaction curves, layers {layers[0]}-{layers[-1]} {kind}", "",
             "KL(dense || rank-r model) on each capability. `own` and `vpd_own` are fitted or selected for that "
             "capability; the other columns are the same for every capability.", ""]
    for rank in ranks:
        lines += [f"## Rank {rank} ({per_rank * rank / dense:.1%} of dense parameters)", "",
                  "| capability | " + " | ".join(methods) + " |", "|---|" + "---|" * len(methods)]
        lines += [f"| {c} | " + " | ".join(f"{kl[rank][m][c]:.4f}" for m in methods) + " |" for c in capabilities]
        lines.append("")
    (args.output / "report.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
