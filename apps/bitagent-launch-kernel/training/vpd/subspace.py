"""Capability-specific low-rank adapters from activation statistics (closed form, no training).

Each selected matrix W is replaced by a shared rank-b base fitted to the inputs of all capabilities,
plus one rank-a adapter per capability that best restores W's output on that capability's inputs.
The test is causal: does a capability's own adapter help it more than another capability's adapter,
or a capability-agnostic adapter of the same rank? This is the reference a VPD chunk has to match
before it is worth exporting as an adapter.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from safetensors.torch import save_file

import config
from chunk import answer_nll
from qwen_suffix import KINDS, LowRankLinear, cached_residual, drop_prefix, load_model, parse_layers
from qwen_suffix import run_layers, set_modules, site_modules, suffix_logits
from vpd_core import kl_logits


def whiten(moment: torch.Tensor, ridge: float) -> tuple[torch.Tensor, torch.Tensor]:
    """S and S^-1 with S S^T = moment (plus a ridge so rarely used input directions stay bounded)."""
    values, vectors = torch.linalg.eigh(moment.double())
    values = values.clamp_min(0) + ridge * values.mean()
    return (vectors * values.sqrt()).float(), (vectors / values.sqrt()).T.float()


def low_rank(weight: torch.Tensor, moment: torch.Tensor, rank: int, ridge: float) -> tuple[torch.Tensor, torch.Tensor]:
    """Factors A, B of the rank-`rank` matrix A @ B minimising E||(weight - A B) x||^2 for inputs with this second moment."""
    root, root_inverse = whiten(moment, ridge)
    left, singular, right_t = torch.linalg.svd(weight @ root, full_matrices=False)
    return left[:, :rank] * singular[:rank], right_t[:rank] @ root_inverse


@torch.no_grad()
def input_moments(model, linears: dict, resid: dict, first: int, last: int, count: int, batch: int) -> dict:
    """{capability: {site: E[x x^T]}} of each matrix's input over that capability's train windows."""
    current: dict[str, torch.Tensor] = {}
    hooks = [linear.register_forward_pre_hook(
        lambda _module, inputs, name=name: current.__setitem__(name, inputs[0].flatten(0, -2)))
        for name, linear in linears.items()]
    device = next(iter(linears.values())).weight.device
    moments = {}
    for capability in resid:
        sums = {name: torch.zeros(linear.weight.shape[1], linear.weight.shape[1], device=device)
                for name, linear in linears.items()}
        tokens = 0
        for hidden in resid[capability]["train"][:count].split(batch):
            run_layers(model, hidden.to(device), first, last + 1)  # only the layers that hold a selected matrix
            for name, x in current.items():
                sums[name] += x.T @ x
            tokens += hidden.shape[0] * hidden.shape[1]
        moments[capability] = {name: total / tokens for name, total in sums.items()}
        print(f"moments: {capability}", flush=True)
    for hook in hooks:
        hook.remove()
    return moments


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=config.OUT / "data-s96")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--layers", default="24-27")
    parser.add_argument("--kind", choices=list(KINDS), default="mlp")
    parser.add_argument("--base-rank", type=int, default=256)
    parser.add_argument("--adapter-rank", type=int, default=64)
    parser.add_argument("--ridge", type=float, default=1e-3)
    parser.add_argument("--block", type=int, default=4, help="layers fitted per pass (bounds memory)")
    parser.add_argument("--capabilities", help="comma-separated subset to fit and evaluate (default: all)")
    parser.add_argument("--moment-windows", type=int, default=64)
    parser.add_argument("--eval-windows", type=int, default=8)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--threads", type=int, default=6)
    args = parser.parse_args()
    config.lower_priority()
    torch.set_num_threads(args.threads)
    args.output.mkdir(parents=True, exist_ok=True)

    windows = torch.load(args.data / "windows.pt")
    model = load_model(args.device)
    layers = parse_layers(args.layers)
    first = min(layers)
    capabilities = args.capabilities.split(",") if args.capabilities else list(windows)
    dense_modules = site_modules(model, layers, args.kind)

    # Fit a few layers at a time so only one block's input moments are in memory. Every block is fitted
    # on inputs from the dense model, so errors from compressing earlier layers are not corrected for.
    base, generic, adapters = {}, {}, {c: {} for c in capabilities}
    for start in range(0, len(layers), args.block):
        block = layers[start:start + args.block]
        resid = cached_residual(model, windows, block[0], args.data)
        linears = site_modules(model, block, args.kind)
        moments = input_moments(model, linears, {c: resid[c] for c in capabilities}, block[0], block[-1],
                                args.moment_windows, args.batch)
        for name, linear in linears.items():
            weight = linear.weight.detach()
            pooled = torch.stack([moments[c][name] for c in capabilities]).mean(0)
            base[name] = low_rank(weight, pooled, args.base_rank, args.ridge)
            remainder = weight - base[name][0] @ base[name][1]
            generic[name] = low_rank(remainder, pooled, args.adapter_rank, args.ridge)
            for capability in capabilities:
                adapters[capability][name] = low_rank(remainder, moments[capability].pop(name), args.adapter_rank, args.ridge)
            print(f"factors: {name}", flush=True)
        del moments, resid
    resid = cached_residual(model, windows, first, args.data)
    drop_prefix(model, first)

    # Export: one file for the shared base and one small file per capability, loadable by lean.py.
    export = {"base": base, "adapter-generic": generic, **{f"adapter-{c}": adapters[c] for c in capabilities}}
    for label, per_site in export.items():
        save_file({f"{name}.{part}": tensor.cpu().contiguous() for name, pair in per_site.items()
                   for part, tensor in zip("AB", pair)}, str(args.output / f"{label}.safetensors"))

    def compressed(extra: dict | None) -> dict[str, LowRankLinear]:
        """Low-rank modules for the base alone, or the base with one adapter's factors appended."""
        return {name: LowRankLinear(
            base[name][0] if extra is None else torch.cat([base[name][0], extra[name][0]], dim=1),
            base[name][1] if extra is None else torch.cat([base[name][1], extra[name][1]], dim=0),
            dense_modules[name].bias) for name in dense_modules}

    settings = {"base": None, "base+generic": generic, **{f"base+{c}": adapters[c] for c in capabilities}}
    kl = {label: {} for label in settings}
    nll = {label: {} for label in ["dense", *settings]}
    with torch.no_grad():
        for capability in capabilities:
            item = windows[capability]["eval"]
            hidden = resid[capability]["eval"][:args.eval_windows].to(args.device)
            tokens = item["tokens"][:args.eval_windows].to(args.device)
            mask = item["answer_mask"][:args.eval_windows].to(args.device)
            set_modules(model, layers, args.kind, dense_modules)
            clean = suffix_logits(model, hidden, first)
            total, count = answer_nll(clean, tokens, mask)
            nll["dense"][capability] = total / max(count, 1)
            for label, extra in settings.items():
                set_modules(model, layers, args.kind, compressed(extra))
                logits = suffix_logits(model, hidden, first)
                kl[label][capability] = kl_logits(logits, clean).item()
                nll[label][capability] = answer_nll(logits, tokens, mask)[0] / max(count, 1)
            print(f"evaluated: {capability}", flush=True)
        set_modules(model, layers, args.kind, dense_modules)

    dense = sum(module.weight.numel() for module in dense_modules.values())
    per_rank = sum(sum(module.weight.shape) for module in dense_modules.values())
    result = {
        "layers": layers, "kind": args.kind, "base_rank": args.base_rank, "adapter_rank": args.adapter_rank,
        "ridge": args.ridge, "capabilities": capabilities, "kl": kl, "answer_nll": nll,
        "params": {"dense": dense, "base": per_rank * args.base_rank, "adapter": per_rank * args.adapter_rank},
    }
    (args.output / "subspace.json").write_text(json.dumps(result, indent=1), encoding="utf-8")

    lines = [f"# Capability adapters, layers {args.layers} {args.kind}: base rank {args.base_rank}, adapter rank {args.adapter_rank}", "",
             f"Base is {per_rank * args.base_rank / dense:.1%} of the dense parameters, each adapter {per_rank * args.adapter_rank / dense:.1%}.", "",
             "KL(dense || compressed) on each eval capability. `own` adds that capability's adapter, `other` is the "
             "mean over the eight other adapters, `generic` adds a capability-agnostic adapter of the same rank.", "",
             "| capability | base | generic | own | other (mean) | other (best) | own gain / other gain |", "|---|---|---|---|---|---|---|"]
    for capability in capabilities:
        base_kl = kl["base"][capability]
        own = kl[f"base+{capability}"][capability]
        others = [kl[f"base+{c}"][capability] for c in capabilities if c != capability]
        mean_other = sum(others) / len(others)
        ratio = (base_kl - own) / max(base_kl - mean_other, 1e-9)
        lines.append(f"| {capability} | {base_kl:.4f} | {kl['base+generic'][capability]:.4f} | {own:.4f} | "
                     f"{mean_other:.4f} | {min(others):.4f} | {ratio:.1f} |")
    lines += ["", "Full matrix: adapter (rows) by eval capability (columns).", "",
              "| adapter | " + " | ".join(capabilities) + " |", "|---|" + "---|" * len(capabilities)]
    for label in settings:
        lines.append(f"| {label} | " + " | ".join(f"{kl[label][c]:.4f}" for c in capabilities) + " |")
    (args.output / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
