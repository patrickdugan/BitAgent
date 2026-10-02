"""Assign subcomponents to capability chunks, then test the chunks causally on held-out windows.

Importance is measured on train windows; every causal number comes from eval windows.
`--svd` swaps the trained decomposition for an exact SVD of each matrix (no training), which
with `--importance attr` is the baseline a VPD run has to beat.
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import torch
import torch.nn.functional as F

import config
from qwen_suffix import cached_residual, drop_prefix, install_sites, load_model, parse_layers, suffix_logits
from vpd_core import Decomposition, assign, kl_logits, svd_init


def importance(dec: Decomposition, forward, resid: dict, kind: str, count: int, batch: int, device: str) -> torch.Tensor:
    """[capabilities, total components]: mean causal importance, or mean |d CE / d mask| at the unmasked point."""
    rows = []
    for capability in resid:
        total, tokens = 0.0, 0
        for hidden in resid[capability]["train"][:count].split(batch):
            hidden = hidden.to(device)
            dec.set_masks(capture=True)
            if kind == "ci":
                with torch.no_grad():
                    forward(hidden, torch.zeros(1, dtype=torch.long, device=device))  # taps only; skip the unembedding
                    lower, _ = dec.causal_importance(dec.taps())
                per_site = [lower[name].sum((0, 1)) for name in dec.sites]
            else:
                with torch.no_grad():
                    clean = forward(hidden)
                lead = hidden.shape[:2]
                masks = {n: torch.ones(*lead, s.V.shape[1], device=device, requires_grad=True) for n, s in dec.sites.items()}
                dec.set_masks(masks, {n: torch.ones(lead, device=device) for n in dec.sites})
                loss = F.cross_entropy(forward(hidden).flatten(0, 1), clean.argmax(-1).flatten(), reduction="sum")
                grads = torch.autograd.grad(loss, list(masks.values()))
                per_site = [g.abs().sum((0, 1)) for g in grads]
            total = total + torch.cat(per_site).cpu()
            tokens += hidden.shape[0] * hidden.shape[1]
        rows.append(total / tokens)
        print(f"importance[{kind}]: {capability}", flush=True)
    dec.set_masks()
    return torch.stack(rows)


def answer_nll(logits: torch.Tensor, tokens: torch.Tensor, answer_mask: torch.Tensor) -> tuple[float, int]:
    nll = -F.log_softmax(logits[:, :-1].float(), -1).gather(-1, tokens[:, 1:, None]).squeeze(-1)
    keep = answer_mask[:, 1:]
    return (nll * keep).sum().item(), int(keep.sum())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=config.OUT / "data-s96")
    parser.add_argument("--run", type=Path, help="decompose.py output directory")
    parser.add_argument("--svd", action="store_true", help="baseline: exact SVD components instead of a trained run")
    parser.add_argument("--layers", default="24-27")
    parser.add_argument("--kind", choices=["mlp", "attn", "all"], default="mlp")
    parser.add_argument("--cache-layer", type=int, help="with --svd: start the suffix here (default: first layer)")
    parser.add_argument("--importance", choices=["ci", "attr"], default="ci")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--alive-threshold", type=float)
    parser.add_argument("--share-threshold", type=float, default=0.5)
    parser.add_argument("--chunk-size", type=int, help="fixed-size chunks: the N most capability-specific components")
    parser.add_argument("--scores", type=Path, help="reuse a scores.pt from an earlier run instead of recomputing")
    parser.add_argument("--importance-windows", type=int, default=64)
    parser.add_argument("--eval-windows", type=int, default=16)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()
    if args.svd == bool(args.run) or (args.svd and args.importance == "ci"):
        parser.error("pass exactly one of --run or --svd; --svd has no causal-importance function, use --importance attr")
    config.lower_priority()
    torch.set_num_threads(args.threads)
    rng = random.Random(args.seed)
    args.output.mkdir(parents=True, exist_ok=True)

    windows = torch.load(args.data / "windows.pt")
    model = load_model(args.device)
    if args.svd:
        layers, kind, ci_hidden, first = parse_layers(args.layers), args.kind, 8, args.cache_layer
        components = min(model.get_submodule(f"model.layers.{layers[0]}.mlp.down_proj").weight.shape)
    else:
        saved = torch.load(args.run / "decomposition.pt")
        run_args = saved["args"]
        layers, kind, first = parse_layers(run_args["layers"]), run_args["kind"], run_args.get("cache_layer")
        components, ci_hidden = run_args["components"], run_args["ci_hidden"]
    first = min(layers) if first is None else first
    resid = cached_residual(model, windows, first, args.data)
    drop_prefix(model, first)
    dec = install_sites(model, layers, kind, components, ci_hidden)
    if args.svd:
        svd_init(dec)
    else:
        dec.load_state_dict(saved["state"])
    dec.requires_grad_(False)
    forward = lambda hidden, positions=None: suffix_logits(model, hidden, first, positions)
    capabilities, sites = list(resid), list(dec.sites)
    sizes = [dec.sites[name].V.shape[1] for name in sites]

    if args.scores:
        scores = torch.load(args.scores)["scores"]
    else:
        scores = importance(dec, forward, resid, args.importance, args.importance_windows, args.batch, args.device)
    relative = args.importance == "attr"
    alive_threshold = args.alive_threshold if args.alive_threshold is not None else (1.0 if relative else 0.01)
    groups = assign(scores, alive_threshold, args.share_threshold, relative, args.chunk_size)
    chunks, shared = groups["chunks"], groups["shared"]

    def site_masks(keep: torch.Tensor) -> dict:
        return {n: part.float().to(args.device)[None, None] for n, part in zip(sites, keep.split(sizes))}

    # Size-matched control for each chunk: random alive components from outside it, site by site.
    controls = []
    for chunk in chunks:
        control = torch.zeros_like(chunk)
        offset = 0
        for size in sizes:
            span = slice(offset, offset + size)
            candidates = ((shared | torch.stack(chunks).any(0)) & ~chunk)[span].nonzero().flatten().tolist()
            picked = rng.sample(candidates, min(int(chunk[span].sum()), len(candidates)))
            control[offset + torch.tensor(picked, dtype=torch.long)] = True
            offset += size
        controls.append(control)

    # Ablations keep the delta so only the chunk changes. The compact models drop the delta and every
    # dead component, so their KL is what a low-rank "shared + chunk" replacement would actually cost.
    settings = {"all_components_no_delta": (torch.ones_like(shared), 0.0), "alive_no_delta": (~groups["dead"], 0.0)}
    for k, name in enumerate(capabilities):
        settings[f"ablate:{name}"] = (~chunks[k], 1.0)
        settings[f"control:{name}"] = (~controls[k], 1.0)
        settings[f"keep_only:{name}"] = (shared | chunks[k], 0.0)

    kl = {label: {c: 0.0 for c in capabilities} for label in settings}
    nll = {label: {c: 0.0 for c in capabilities} for label in ["clean", *settings]}
    answer_tokens = {c: 0 for c in capabilities}
    batches = {c: 0 for c in capabilities}
    with torch.no_grad():
        for capability in capabilities:
            item = windows[capability]["eval"]
            for index in range(0, args.eval_windows, args.batch):
                span = slice(index, min(index + args.batch, args.eval_windows))
                hidden = resid[capability]["eval"][span].to(args.device)
                tokens, mask = item["tokens"][span].to(args.device), item["answer_mask"][span].to(args.device)
                dec.set_masks()
                clean = forward(hidden)
                total, count = answer_nll(clean, tokens, mask)
                nll["clean"][capability] += total
                answer_tokens[capability] += count
                batches[capability] += 1
                for label, (keep, delta) in settings.items():
                    dec.set_masks(site_masks(keep), {n: torch.full((1, 1), delta, device=args.device) for n in sites})
                    logits = forward(hidden)
                    kl[label][capability] += kl_logits(logits, clean).item()
                    nll[label][capability] += answer_nll(logits, tokens, mask)[0]
            print(f"causal tests: {capability}", flush=True)
    dec.set_masks()
    kl = {label: {c: v / batches[c] for c, v in row.items()} for label, row in kl.items()}
    nll = {label: {c: v / max(answer_tokens[c], 1) for c, v in row.items()} for label, row in nll.items()}

    # Low-rank size of "shared + chunk k" against the dense matrices it would replace (delta not counted).
    dims = [dec.sites[n].V.shape[0] + dec.sites[n].U.shape[1] for n in sites]
    dense = sum(dec.sites[n].W.numel() for n in sites)
    compaction = {}
    for k, name in enumerate(capabilities):
        ranks = [int(part.sum()) for part in (shared | chunks[k]).split(sizes)]
        compaction[name] = {"rank_per_site": ranks, "params": sum(r * d for r, d in zip(ranks, dims)),
                            "dense_params": dense}

    result = {
        "source": "svd" if args.svd else str(args.run), "importance": args.importance,
        "alive_threshold": alive_threshold, "share_threshold": args.share_threshold,
        "capabilities": capabilities, "sites": sites, "faithfulness": dec.faithfulness().item(),
        "counts": {"shared": int(shared.sum()), "dead": int(groups["dead"].sum()),
                   **{f"chunk:{c}": int(chunks[k].sum()) for k, c in enumerate(capabilities)}},
        "chunk_indices": {c: chunks[k].nonzero().flatten().tolist() for k, c in enumerate(capabilities)},
        "kl": kl, "answer_nll": nll, "compaction": compaction,
    }
    (args.output / "chunks.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    torch.save({"scores": scores, "capabilities": capabilities, "sites": sites, "sizes": sizes}, args.output / "scores.pt")

    lines = [f"# Capability chunks: {result['source']} ({args.importance} importance)", "",
             f"Counts: {json.dumps(result['counts'])}", "",
             "KL(clean || ablated) per eval capability (columns) when one chunk (rows) is removed; "
             "`control` removes a size-matched random set instead.", "",
             "| removed chunk | size | " + " | ".join(capabilities) + " | own / mean other | control own |",
             "|---|---|" + "---|" * (len(capabilities) + 2)]
    for k, name in enumerate(capabilities):
        row = kl[f"ablate:{name}"]
        others = [row[c] for c in capabilities if c != name]
        ratio = row[name] / max(sum(others) / len(others), 1e-9)
        lines.append(f"| {name} | {int(chunks[k].sum())} | " + " | ".join(f"{row[c]:.4f}" for c in capabilities)
                     + f" | {ratio:.1f} | {kl[f'control:{name}'][name]:.4f} |")
    lines += ["", "Compact model = shared + one chunk, no delta, no dead components. `all alive` is the same "
              "without removing the other chunks, so it is the floor for the `KL own` column.", "",
              "| kept chunk | KL own | all alive, own | mean KL others | low-rank params / dense |", "|---|---|---|---|---|"]
    for name in capabilities:
        row = kl[f"keep_only:{name}"]
        others = [row[c] for c in capabilities if c != name]
        ratio = compaction[name]["params"] / dense
        lines.append(f"| {name} | {row[name]:.4f} | {kl['alive_no_delta'][name]:.4f} | "
                     f"{sum(others) / len(others):.4f} | {ratio:.3f} |")
    lines += ["", f"All components, no delta: mean KL {sum(kl['all_components_no_delta'].values()) / len(capabilities):.4f}; "
              f"weight faithfulness {result['faithfulness']:.2e}."]
    (args.output / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
