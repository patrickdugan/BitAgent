"""Refine one capability's adapter by distilling the dense model's outputs on that capability's data.

subspace.py fits each matrix on its own, so errors compound when many layers are compressed. Here
the shared base stays frozen and only the capability's adapter factors are trained, end to end, to
minimise KL(dense || compressed) on that capability's train windows. The refined adapter is saved
next to the original as `adapter-<capability>-refined.safetensors`, which lean.py can load.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from safetensors.torch import load_file, save_file
from torch import nn

import config
from qwen_suffix import cached_residual, drop_prefix, load_model, set_modules, site_modules, suffix_logits
from vpd_core import kl_logits


class BaseAdapterLinear(nn.Module):
    """Frozen low-rank base plus a trainable low-rank adapter."""

    def __init__(self, base: tuple[torch.Tensor, torch.Tensor], adapter: tuple[torch.Tensor, torch.Tensor], bias):
        super().__init__()
        self.register_buffer("base_A", base[0], persistent=False)
        self.register_buffer("base_B", base[1], persistent=False)
        # Rebalance each adapter direction so A and B have equal norms; the product is unchanged and
        # one learning rate then suits both factors.
        scale = (adapter[1].norm(dim=1) / adapter[0].norm(dim=0).clamp_min(1e-12)).sqrt()
        self.A = nn.Parameter(adapter[0] * scale)
        self.B = nn.Parameter(adapter[1] / scale[:, None])
        self.bias = bias

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return F.linear(F.linear(x, self.base_B), self.base_A, self.bias) + F.linear(F.linear(x, self.B), self.A)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--subspace", type=Path, required=True, help="subspace.py output directory")
    parser.add_argument("--capability", required=True)
    parser.add_argument("--data", type=Path, default=config.OUT / "data-s96")
    parser.add_argument("--steps", type=int, default=200)
    parser.add_argument("--batch", type=int, default=4)
    parser.add_argument("--relative-lr", type=float, default=0.01, help="Adam step as a share of each factor's RMS entry")
    parser.add_argument("--loss-positions", type=int, default=32)
    parser.add_argument("--eval-windows", type=int, default=8)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--threads", type=int, default=6)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()
    config.lower_priority()
    torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)

    manifest = json.loads((args.subspace / "subspace.json").read_text(encoding="utf-8"))
    layers, kind, first = manifest["layers"], manifest["kind"], min(manifest["layers"])
    windows = torch.load(args.data / "windows.pt")
    model = load_model(args.device)
    resid = cached_residual(model, windows, first, args.data)
    drop_prefix(model, first)
    dense = site_modules(model, layers, kind)
    base = load_file(str(args.subspace / "base.safetensors"), device=args.device)
    adapter = load_file(str(args.subspace / f"adapter-{args.capability}.safetensors"), device=args.device)
    lean = {name: BaseAdapterLinear((base[f"{name}.A"], base[f"{name}.B"]),
                                    (adapter[f"{name}.A"], adapter[f"{name}.B"]), linear.bias)
            for name, linear in dense.items()}
    groups = [{"params": [p], "lr": args.relative_lr * p.detach().pow(2).mean().sqrt().item()}
              for module in lean.values() for p in (module.A, module.B)]
    opt = torch.optim.AdamW(groups, weight_decay=0.0)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda step: 0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * step / args.steps)))

    capabilities = manifest["capabilities"]

    @torch.no_grad()
    def evaluate() -> dict[str, float]:
        out = {}
        for capability in capabilities:
            hidden = resid[capability]["eval"][:args.eval_windows].to(args.device)
            set_modules(model, layers, kind, dense)
            clean = suffix_logits(model, hidden, first)
            set_modules(model, layers, kind, lean)
            out[capability] = round(kl_logits(suffix_logits(model, hidden, first), clean).item(), 4)
        return out

    before = evaluate()
    print(json.dumps({"event": "before", "kl": before}), flush=True)
    pool = resid[args.capability]["train"]
    order: list[int] = []
    start = time.time()
    for step in range(args.steps):
        if len(order) < args.batch:
            order = torch.randperm(len(pool)).tolist()
        hidden = pool[[order.pop() for _ in range(args.batch)]].to(args.device)
        positions = torch.randperm(pool.shape[1], device=args.device)[:args.loss_positions]
        set_modules(model, layers, kind, dense)
        with torch.no_grad():
            clean = suffix_logits(model, hidden, first, positions)
        set_modules(model, layers, kind, lean)
        loss = kl_logits(suffix_logits(model, hidden, first, positions), clean)
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        if step % 10 == 0:
            print(json.dumps({"event": "train", "step": step, "kl": round(loss.item(), 5),
                              "seconds": round(time.time() - start, 1)}), flush=True)
    after = evaluate()
    set_modules(model, layers, kind, dense)
    print(json.dumps({"event": "after", "kl": after}), flush=True)

    save_file({f"{name}.{part}": tensor.detach().cpu().contiguous() for name, module in lean.items()
               for part, tensor in (("A", module.A), ("B", module.B))},
              str(args.subspace / f"adapter-{args.capability}-refined.safetensors"))
    (args.subspace / f"refine-{args.capability}.json").write_text(json.dumps(
        {"capability": args.capability, "steps": args.steps, "batch": args.batch, "relative_lr": args.relative_lr,
         "loss_positions": args.loss_positions, "kl_before": before, "kl_after": after}, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
