"""Train a VPD decomposition of selected Qwen3 weight matrices over all capability windows."""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import torch

import config
from compact import factors
from qwen_suffix import cached_residual, drop_prefix, install_sites, load_model, parse_layers, site_modules
from qwen_suffix import suffix_logits
from subspace import input_moments
from vpd_core import PersistentSources, TrainConfig, evaluate, faithfulness_warmup, kl_logits
from vpd_core import make_optimizer, svd_init, train_step


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=config.OUT / "data-s96")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--layers", default="24-27")
    parser.add_argument("--kind", choices=["mlp", "attn", "all"], default="mlp")
    parser.add_argument("--cache-layer", type=int, help="start the suffix here (default: first decomposed layer)")
    parser.add_argument("--components", type=int, default=1024)
    parser.add_argument("--ci-hidden", type=int, default=256)
    parser.add_argument("--steps", type=int, default=1000)
    parser.add_argument("--batch", type=int, default=4)
    # Adam moves every entry by about lr per step, and SVD-initialised V and U have entries near 1e-2,
    # so the component rate has to stay well below that or the first steps destroy the factorisation.
    parser.add_argument("--lr-components", type=float, default=1e-4)
    parser.add_argument("--lr-ci", type=float, default=2e-4)
    parser.add_argument("--coeff-imp", type=float, default=2e-4)
    parser.add_argument("--coeff-faith", type=float, default=1e3)
    parser.add_argument("--init", choices=["svd", "svd_rotated", "asvd", "random"], default="svd",
                        help="svd variants start exactly faithful; asvd starts from the activation-aware fit on the "
                             "target capabilities; all three skip the faithfulness warm-up")
    parser.add_argument("--capabilities", help="comma-separated target capabilities (default: all). With few "
                        "components this trains a capability-targeted chunk; pair it with --coeff-faith 0")
    parser.add_argument("--faith-warmup-steps", type=int, default=400)
    parser.add_argument("--pgd-warmup", type=int, default=1)
    parser.add_argument("--loss-positions", type=int, help="reconstruct this many random positions per step (default: all)")
    parser.add_argument("--eval-every", type=int, default=100)
    parser.add_argument("--eval-per-capability", type=int, default=2)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()
    config.lower_priority()
    torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    args.output.mkdir(parents=True, exist_ok=True)

    windows = torch.load(args.data / "windows.pt")
    model = load_model(args.device)
    layers = parse_layers(args.layers)
    first = min(layers) if args.cache_layer is None else args.cache_layer
    if first > min(layers):
        parser.error("--cache-layer must not come after the first decomposed layer")
    resid = cached_residual(model, windows, first, args.data)
    drop_prefix(model, first)
    targets = args.capabilities.split(",") if args.capabilities else list(resid)
    pool = torch.cat([resid[c]["train"] for c in targets])
    eval_batch = torch.cat([resid[c]["eval"][:args.eval_per_capability] for c in targets]).to(args.device)

    fits = None
    if args.init == "asvd":  # closed-form best rank-C fit of each matrix on the target capabilities' inputs
        linears = site_modules(model, layers, args.kind)
        moments = input_moments(model, linears, {c: resid[c] for c in targets}, first, max(layers), 64, 8)
        fits = [factors(linear.weight.detach(), torch.stack([moments[c][name] for c in targets]).mean(0), 1e-3)
                for name, linear in linears.items()]

    dec = install_sites(model, layers, args.kind, args.components, args.ci_hidden)
    positions = None  # rebound each training step; None reconstructs every position
    forward = lambda hidden: suffix_logits(model, hidden, first, positions)
    cfg = TrainConfig(steps=args.steps, lr_components=args.lr_components, lr_ci=args.lr_ci, coeff_imp=args.coeff_imp,
                      coeff_faith=args.coeff_faith, faith_warmup_steps=args.faith_warmup_steps,
                      pgd_warmup=args.pgd_warmup)
    if fits is not None:
        with torch.no_grad():
            for site, (left, right) in zip(dec.sites.values(), fits):
                site.V.copy_(right[:args.components].T)
                site.U.copy_(left[:, :args.components].T)
        cfg.faith_warmup_steps = 0
    elif args.init != "random":
        svd_init(dec, rotate=args.init == "svd_rotated")
        cfg.faith_warmup_steps = 0

    log = (args.output / "metrics.jsonl").open("w", encoding="utf-8")

    def emit(row: dict) -> None:
        log.write(json.dumps(row) + "\n")
        log.flush()
        print(json.dumps({k: round(v, 5) if isinstance(v, float) else v for k, v in row.items()}), flush=True)

    start = time.time()
    emit({"event": "faith_warmup", "faith": faithfulness_warmup(dec, cfg), "seconds": time.time() - start,
          "sites": list(dec.sites), "components": args.components})
    opt, sched = make_optimizer(dec, cfg)
    sources = PersistentSources(dec, (args.batch, pool.shape[1]))
    order: list[int] = []
    start = time.time()
    for step in range(cfg.steps):
        if len(order) < args.batch:
            order = torch.randperm(len(pool)).tolist()
        batch = pool[[order.pop() for _ in range(args.batch)]].to(args.device)
        if args.loss_positions:
            positions = torch.randperm(pool.shape[1], device=args.device)[:args.loss_positions]
        metrics = train_step(dec, forward, kl_logits, batch, sources, opt, cfg, step / cfg.steps)
        sched.step()
        positions = None
        if step % 10 == 0:
            emit({"event": "train", "step": step, "seconds": time.time() - start, **metrics})
        if (step + 1) % args.eval_every == 0 or step == cfg.steps - 1:
            emit({"event": "eval", "step": step, **evaluate(dec, forward, kl_logits, eval_batch)})
            torch.save({"state": dec.state_dict(), "sites": list(dec.sites), "args": vars(args) | {
                "data": str(args.data), "output": str(args.output)}, "step": step}, args.output / "decomposition.pt")
    log.close()


if __name__ == "__main__":
    main()
