"""Ground-truth check for vpd_core on a toy model of superposition (5 features in 2 dimensions).

The true mechanisms are known: one rank-one map per feature in each layer. The check passes
when each layer keeps exactly `n_features` alive subcomponents and they match those maps.
"""

from __future__ import annotations

import argparse
import json
import random

import torch
import torch.nn.functional as F

from vpd_core import ComponentSite, Decomposition, PersistentSources, TrainConfig
from vpd_core import evaluate, faithfulness_warmup, make_optimizer, train_step


def sample(batch: int, n_features: int, p_active: float) -> torch.Tensor:
    return torch.rand(batch, n_features) * (torch.rand(batch, n_features) < p_active)


def train_tms(n_features: int, n_hidden: int, p_active: float, steps: int) -> tuple[torch.Tensor, torch.Tensor]:
    W = torch.nn.Parameter(torch.randn(n_hidden, n_features) * 0.5)
    b = torch.nn.Parameter(torch.zeros(n_features))
    opt = torch.optim.AdamW([W, b], lr=5e-3, weight_decay=0.0)
    for _ in range(steps):
        x = sample(2048, n_features, p_active)
        loss = (F.relu(x @ W.T @ W + b) - x).pow(2).sum(-1).mean()
        opt.zero_grad()
        loss.backward()
        opt.step()
    return W.detach(), b.detach()


def match_ground_truth(site: ComponentSite, truth: torch.Tensor, alive: torch.Tensor) -> tuple[float, list[int]]:
    """Mean over true mechanisms of the best cosine to an alive subcomponent; `truth` is [n, d_in, d_out]."""
    comps = torch.einsum("ic,co->cio", site.V.detach(), site.U.detach())[alive].flatten(1)
    cos = F.cosine_similarity(truth.flatten(1)[:, None, :], comps[None, :, :], dim=-1)
    best = cos.max(dim=1)
    return best.values.mean().item(), best.indices.tolist()


class TiedSite(ComponentSite):
    """Second layer of a tied-weight toy model: its subcomponents are the transposes of the first layer's."""

    def __init__(self, source: ComponentSite, bias: torch.Tensor):
        torch.nn.Module.__init__(self)
        self._source = [source]  # in a list so the source is not registered as a submodule twice
        self.register_buffer("W", source.W.T.contiguous(), persistent=False)
        self.register_buffer("bias", bias.detach().clone(), persistent=False)
        self.mask = self.delta_mask = self.tap = None
        self.capture = False

    @property
    def V(self) -> torch.Tensor:
        return self._source[0].U.T

    @property
    def U(self) -> torch.Tensor:
        return self._source[0].V.T


RECIPES = {
    # The reference's own toy settings (experiments/tms/tms_5-2_config.yaml): tied components, one
    # importance MLP per subcomponent on its own activation, fixed p = 1, no adversary, no faithfulness term.
    "reference": {"steps": 10000, "batch": 4096, "coeff_imp": 3e-3, "lr": 1e-3, "imp_beta": 0.0},
    # The language-model recipe decompose.py uses, on untied sites. Swept by hand: 1e-2 at 20,000 steps
    # leaves one feature split, 3e-2 collapses the importances.
    "lm": {"steps": 20000, "batch": 1024, "coeff_imp": 2e-2, "lr": 3e-3, "imp_beta": 0.5},
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--recipe", choices=list(RECIPES), default="reference")
    parser.add_argument("--features", type=int, default=5)
    parser.add_argument("--hidden", type=int, default=2)
    parser.add_argument("--components", type=int, default=20)
    parser.add_argument("--steps", type=int)
    parser.add_argument("--batch", type=int)
    parser.add_argument("--coeff-imp", type=float)
    parser.add_argument("--lr", type=float)
    parser.add_argument("--imp-beta", type=float, help="weight of the frequency (log) term")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()
    for key, value in RECIPES[args.recipe].items():
        if getattr(args, key) is None:
            setattr(args, key, value)
    reference = args.recipe == "reference"
    torch.set_num_threads(1)  # tensors this small are slower with intra-op threading
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    p_active = 0.05

    W, b = train_tms(args.features, args.hidden, p_active, steps=5000)
    # The ground truth below assumes the target represents every feature in its own direction.
    directions = F.normalize(W, dim=0)
    overlap = (directions.T @ directions - torch.eye(args.features)).max().item()
    print(json.dumps({"target_feature_norms": [round(v, 3) for v in W.norm(dim=0).tolist()],
                      "target_max_feature_cosine": round(overlap, 3)}))
    first = ComponentSite(W, None, args.components)
    second = TiedSite(first, b) if reference else ComponentSite(W.T.contiguous(), b, args.components)
    dec = Decomposition({"linear1": first, "linear2": second}, ci_hidden=16 if reference else 64,
                        ci_type="component" if reference else "input")
    forward = lambda x: F.relu(dec.sites["linear2"](dec.sites["linear1"](x)))
    if reference:
        recon = lambda pred, target: (pred - target).pow(2).mean()
        cfg = TrainConfig(steps=args.steps, coeff_imp=args.coeff_imp, coeff_stoch=1.0, coeff_layerwise=1.0,
                          coeff_adv=0.0, coeff_faith=0.0, subset_routing=False, p_start=1.0, p_end=1.0,
                          imp_beta=args.imp_beta, lr_components=args.lr, lr_ci=args.lr, lr_final_frac=0.0,
                          grad_clip_components=None, faith_warmup_steps=200, faith_warmup_lr=0.01,
                          faith_warmup_weight_decay=0.1)
    else:
        recon = lambda pred, target: (pred - target).pow(2).sum(-1).mean()
        cfg = TrainConfig(steps=args.steps, coeff_imp=args.coeff_imp, coeff_stoch=1.0, coeff_adv=1.0,
                          lr_components=args.lr, lr_ci=args.lr, imp_beta=args.imp_beta)
    print(json.dumps({"recipe": args.recipe, "faith_after_warmup": faithfulness_warmup(dec, cfg)}))
    opt, sched = make_optimizer(dec, cfg)
    sources = None if reference else PersistentSources(dec, (args.batch,))
    for step in range(cfg.steps):
        metrics = train_step(dec, forward, recon, sample(args.batch, args.features, p_active),
                             sources, opt, cfg, step / cfg.steps)
        sched.step()
        if step % 1000 == 0 or step == cfg.steps - 1:
            print(json.dumps({"step": step, **{k: round(v, 5) for k, v in metrics.items()}}))

    x = sample(20000, args.features, p_active)
    print(json.dumps({k: round(v, 5) for k, v in evaluate(dec, forward, recon, x).items()}))
    dec.set_masks(capture=True)
    with torch.no_grad():
        forward(x)
        lower, _ = dec.causal_importance(dec.taps())
        dec.set_masks(capture=True)
        forward(0.75 * torch.eye(args.features))
        single, _ = dec.causal_importance(dec.taps())
    dec.set_masks()

    eye = torch.eye(args.features)
    truth = {
        "linear1": torch.einsum("fi,of->fio", eye, W),  # feature f: read e_f, write W[:, f]
        "linear2": torch.einsum("if,fo->fio", W, eye),  # feature f: read W[:, f], write e_f
    }
    ok = True
    for name, site in dec.sites.items():
        alive = lower[name].mean(0) > 1e-3
        mmcs, matched = match_ground_truth(site, truth[name], alive)
        per_feature = (single[name][:, alive] > 0.5).sum(-1).tolist()
        site_ok = int(alive.sum()) == args.features and mmcs > 0.9 and len(set(matched)) == args.features
        ok &= site_ok
        print(json.dumps({"site": name, "alive": int(alive.sum()), "mmcs": round(mmcs, 4),
                          "distinct_matches": len(set(matched)), "active_per_single_feature": per_feature,
                          "pass": site_ok}))
    print(json.dumps({"ground_truth_check": "pass" if ok else "fail"}))


if __name__ == "__main__":
    main()
