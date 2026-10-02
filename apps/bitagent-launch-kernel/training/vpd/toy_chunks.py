"""Ground-truth check for capability chunking, on a toy model whose capabilities use known features.

Each capability has private features and all capabilities use a few shared ones, stored in
superposition. After a VPD decomposition, the chunk assignment should put every private feature's
subcomponent in its capability's chunk and the shared features' subcomponents in the shared set;
removing a chunk should break only its capability; shared + one chunk should be enough for it.
"""

from __future__ import annotations

import argparse
import json
import random

import torch
import torch.nn.functional as F

from toy_tms import TiedSite
from vpd_core import ComponentSite, Decomposition, TrainConfig, assign
from vpd_core import faithfulness_warmup, make_optimizer, train_step


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--capabilities", type=int, default=3)
    parser.add_argument("--private", type=int, default=3, help="features only one capability uses")
    parser.add_argument("--shared", type=int, default=3, help="features every capability uses")
    parser.add_argument("--hidden", type=int, default=5)
    # Sparsity settings follow the reference's larger toy (tms_40-10_config.yaml): five subcomponents per
    # feature, coefficient 1e-4, p = 2. The 5-in-2 settings (3e-3, p = 1) merge features here.
    parser.add_argument("--components", type=int, default=60)
    parser.add_argument("--steps", type=int, default=10000)
    parser.add_argument("--batch", type=int, default=4096)
    parser.add_argument("--coeff-imp", type=float, default=1e-4)
    parser.add_argument("--pnorm", type=float, default=2.0)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()
    torch.set_num_threads(1)
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    K, p_active = args.capabilities, 0.05
    n = K * args.private + args.shared
    group = torch.tensor([f // args.private for f in range(K * args.private)] + [K] * args.shared)  # K = shared
    allowed = torch.stack([(group == k) | (group == K) for k in range(K)]).float()  # [capability, feature]

    def sample(batch: int, capability: int | None = None) -> torch.Tensor:
        rows = torch.randint(K, (batch,)) if capability is None else torch.full((batch,), capability)
        return torch.rand(batch, n) * (torch.rand(batch, n) < p_active) * allowed[rows]

    # Target: a tied-weight autoencoder trained on the mixture of capabilities.
    W = torch.nn.Parameter(torch.randn(args.hidden, n) * 0.5)
    b = torch.nn.Parameter(torch.zeros(n))
    opt = torch.optim.AdamW([W, b], lr=5e-3, weight_decay=0.0)
    for _ in range(8000):
        x = sample(2048)
        loss = (F.relu(x @ W.T @ W + b) - x).pow(2).sum(-1).mean()
        opt.zero_grad()
        loss.backward()
        opt.step()
    W, b = W.detach(), b.detach()
    represented = W.norm(dim=0) > 0.5
    print(json.dumps({"features": n, "hidden": args.hidden, "represented_features": int(represented.sum()),
                      "feature_norms": [round(v, 2) for v in W.norm(dim=0).tolist()]}))

    first = ComponentSite(W, None, args.components)
    dec = Decomposition({"linear1": first, "linear2": TiedSite(first, b)}, ci_hidden=16, ci_type="component")
    forward = lambda x: F.relu(dec.sites["linear2"](dec.sites["linear1"](x)))
    recon = lambda pred, target: (pred - target).pow(2).mean()
    cfg = TrainConfig(steps=args.steps, coeff_imp=args.coeff_imp, coeff_stoch=1.0, coeff_layerwise=1.0, coeff_adv=0.0,
                      coeff_faith=0.0, subset_routing=False, p_start=args.pnorm, p_end=args.pnorm, imp_beta=0.0, lr_components=1e-3,
                      lr_ci=1e-3, lr_final_frac=0.0, grad_clip_components=None, faith_warmup_steps=200,
                      faith_warmup_lr=0.01, faith_warmup_weight_decay=0.1)
    faithfulness_warmup(dec, cfg)
    opt, sched = make_optimizer(dec, cfg)
    for step in range(cfg.steps):
        metrics = train_step(dec, forward, recon, sample(args.batch), None, opt, cfg, step / cfg.steps)
        sched.step()
        if step % 2000 == 0 or step == cfg.steps - 1:
            print(json.dumps({"step": step, **{k: round(v, 5) for k, v in metrics.items()}}))

    # Importance per capability from fresh "train" samples, exactly as chunk.py does on Qwen.
    names = list(dec.sites)
    with torch.no_grad():
        rows = []
        for k in range(K):
            dec.set_masks(capture=True)
            forward(sample(20000, k))
            lower, _ = dec.causal_importance(dec.taps())
            rows.append(torch.cat([lower[name].mean(0) for name in names]))
        dec.set_masks()
    groups = assign(torch.stack(rows), alive_threshold=0.01, share_threshold=0.5, relative=False)
    chunks, shared, dead = groups["chunks"], groups["shared"], groups["dead"]

    # Ground truth: the feature a subcomponent reads (layer 1) and writes (layer 2, tied) tells its group.
    feature = first.V.detach().abs().argmax(0).repeat(len(names))  # same components in both tied sites
    truth = group[feature]
    predicted = torch.full_like(truth, -1)
    for k, chunk in enumerate(chunks):
        predicted[chunk] = k
    predicted[shared] = K
    alive = ~dead
    correct = int((predicted[alive] == truth[alive]).sum())
    covered = len(set(feature[: args.components][alive[: args.components]].tolist()))
    print(json.dumps({"alive_per_site": int(alive.sum()) // len(names), "features_with_a_subcomponent": covered,
                      "assigned_correctly": correct, "alive_total": int(alive.sum()),
                      "chunk_sizes_per_site": [int(c.sum()) // len(names) for c in chunks],
                      "shared_per_site": int(shared.sum()) // len(names)}))

    def masked_error(keep: torch.Tensor, delta: float, capability: int) -> float:
        x = sample(20000, capability)
        dec.set_masks()
        target = forward(x)
        masks = {name: part.float()[None] for name, part in zip(names, keep.split(args.components))}
        dec.set_masks(masks, {name: torch.full((1,), delta) for name in names})
        error = recon(forward(x), target).item()
        dec.set_masks()
        return error * 1e3

    ok = correct == int(alive.sum()) and covered == int(represented.sum())
    with torch.no_grad():
        for k in range(K):
            ablate = [masked_error(~chunks[k], 1.0, j) for j in range(K)]
            keep = [masked_error(shared | chunks[k], 0.0, j) for j in range(K)]
            others = [v for j, v in enumerate(ablate) if j != k]
            kept_others = [v for j, v in enumerate(keep) if j != k]
            specific = ablate[k] > 20 * max(max(others), 1e-6) and keep[k] * 20 < min(kept_others)
            ok &= specific
            print(json.dumps({"capability": k, "mse_x1000_when_chunk_removed": [round(v, 3) for v in ablate],
                              "mse_x1000_with_only_shared_plus_chunk": [round(v, 3) for v in keep], "pass": specific}))
    print(json.dumps({"chunking_ground_truth_check": "pass" if ok else "fail"}))


if __name__ == "__main__":
    main()
