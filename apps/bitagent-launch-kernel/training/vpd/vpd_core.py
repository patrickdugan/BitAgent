"""Single-process VPD core: rank-one subcomponents, causal-importance masks, losses.

Follows the numerical contract in goodfire-ai/param-decomp (core/SPEC.md and
nano_param_decomp/run.py). Deviations are listed in README.md.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

import torch
import torch.nn.functional as F
from torch import nn


class _LowerLeaky(torch.autograd.Function):
    @staticmethod
    def forward(ctx, x, alpha):
        ctx.save_for_backward(x)
        ctx.alpha = alpha
        return x.clamp(0, 1)

    @staticmethod
    def backward(ctx, grad_output):
        (x,) = ctx.saved_tensors
        zero = torch.zeros_like(grad_output)
        # Below 0 only gradients that would raise the importance leak through,
        # so a dead subcomponent can be resurrected but is never pushed further down.
        below = torch.where(grad_output < 0, ctx.alpha * grad_output, zero)
        return torch.where(x <= 0, below, torch.where(x <= 1, grad_output, zero)), None


def lower_leaky(x: torch.Tensor, alpha: float = 0.01) -> torch.Tensor:
    return _LowerLeaky.apply(x, alpha)


def upper_leaky(x: torch.Tensor, alpha: float = 0.01) -> torch.Tensor:
    return torch.where(x > 1, 1 + alpha * (x - 1), x.clamp(0, 1))


class ComponentSite(nn.Module):
    """One frozen linear map W as C rank-one subcomponents V[:, c] U[c, :] plus the delta W - (VU)^T.

    Stands in for the nn.Linear it replaces. With `mask` unset it is the target layer.
    """

    def __init__(self, weight: torch.Tensor, bias: torch.Tensor | None, C: int):
        super().__init__()
        d_out, d_in = weight.shape
        self.register_buffer("W", weight.detach().clone().float(), persistent=False)
        self.register_buffer("bias", None if bias is None else bias.detach().clone().float(), persistent=False)
        self.V = nn.Parameter(torch.randn(d_in, C) / math.sqrt(d_in))
        self.U = nn.Parameter(torch.randn(C, d_out) / math.sqrt(C))
        self.mask: torch.Tensor | None = None  # [..., C]
        self.delta_mask: torch.Tensor | None = None  # [...]
        self.capture = False
        self.tap: torch.Tensor | None = None

    def weight_delta(self) -> torch.Tensor:
        return self.W - (self.V @ self.U).T

    def faithfulness(self) -> torch.Tensor:
        return self.weight_delta().pow(2).sum() / self.W.pow(2).sum()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if self.capture:
            self.tap = x.detach()
        target = F.linear(x, self.W)
        if self.mask is None:
            return target if self.bias is None else target + self.bias
        # (xV * mask) U + delta_mask * (xW^T - xVU), with the two U products merged.
        delta_mask = self.delta_mask.unsqueeze(-1)
        out = ((x @ self.V) * (self.mask - delta_mask)) @ self.U + delta_mask * target
        return out if self.bias is None else out + self.bias


class CIFn(nn.Module):
    """Per-site MLP from the RMS-normed clean site input to C causal-importance pre-activations."""

    def __init__(self, d_in: int, C: int, hidden: int, init_bias: float):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(d_in, hidden), nn.GELU(), nn.Linear(hidden, C))
        nn.init.constant_(self.net[2].bias, init_bias)
        with torch.no_grad():
            self.net[2].weight.mul_(0.1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(F.rms_norm(x, (x.shape[-1],)))


class ComponentCIFn(nn.Module):
    """One small MLP per subcomponent on that subcomponent's own activation x @ V[:, c].

    This is the reference's `mlp` causal-importance type, including its initialisation.
    """

    def __init__(self, C: int, hidden: int):
        super().__init__()
        self.w1 = nn.Parameter(torch.randn(C, hidden) * math.sqrt(2.0))
        self.b1 = nn.Parameter(torch.zeros(C, hidden))
        self.w2 = nn.Parameter(torch.randn(C, hidden) / math.sqrt(hidden))
        self.b2 = nn.Parameter(torch.zeros(C))

    def forward(self, inner: torch.Tensor) -> torch.Tensor:
        return (F.gelu(inner.unsqueeze(-1) * self.w1 + self.b1) * self.w2).sum(-1) + self.b2


class Decomposition(nn.Module):
    def __init__(self, sites: dict[str, ComponentSite], ci_hidden: int = 256, ci_init_bias: float = 0.8,
                 ci_type: str = "input"):
        super().__init__()
        self.sites = nn.ModuleDict(sites)
        self.ci_type = ci_type
        self.cifns = nn.ModuleDict({
            name: ComponentCIFn(site.V.shape[1], ci_hidden) if ci_type == "component"
            else CIFn(site.V.shape[0], site.V.shape[1], ci_hidden, ci_init_bias)
            for name, site in sites.items()
        })

    def component_parameters(self) -> list[nn.Parameter]:
        # A site whose V and U are views of another site's (tied weights) contributes no parameters.
        return [p for site in self.sites.values() for p in (site.V, site.U) if isinstance(p, nn.Parameter)]

    def set_masks(self, masks: dict | None = None, delta_masks: dict | None = None, capture: bool = False) -> None:
        """Sites missing from `masks` run as the target layer (this is how routing subsets are expressed)."""
        for name, site in self.sites.items():
            site.mask = None if masks is None else masks.get(name)
            site.delta_mask = None if delta_masks is None else delta_masks.get(name)
            site.capture = capture

    def taps(self) -> dict[str, torch.Tensor]:
        return {name: site.tap for name, site in self.sites.items()}

    def causal_importance(self, taps: dict[str, torch.Tensor]) -> tuple[dict, dict]:
        if self.ci_type == "component":
            pre = {name: self.cifns[name](taps[name] @ site.V) for name, site in self.sites.items()}
        else:
            pre = {name: self.cifns[name](taps[name]) for name in self.sites}
        return {n: lower_leaky(p) for n, p in pre.items()}, {n: upper_leaky(p) for n, p in pre.items()}

    def faithfulness(self) -> torch.Tensor:
        return torch.stack([site.faithfulness() for site in self.sites.values()]).mean()


def importance_minimality(upper: dict[str, torch.Tensor], p: float, beta: float, eps: float = 1e-12) -> torch.Tensor:
    total = 0.0
    for ci in upper.values():
        vals = (ci + eps).pow(p).flatten(0, -2)  # [tokens, C]
        mean = vals.mean(0)
        total = total + (mean + beta * mean * torch.log2(1 + vals.sum(0))).sum()
    return total


def kl_logits(pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    """Mean per-position KL(target || pred)."""
    log_p = F.log_softmax(target.detach().float(), dim=-1)
    log_q = F.log_softmax(pred.float(), dim=-1)
    return (log_p.exp() * (log_p - log_q)).sum(-1).mean()


class PersistentSources:
    """Adversarial mask sources in [0, 1], kept across steps and ascended with Adam."""

    def __init__(self, dec: Decomposition, lead_shape: tuple[int, ...], lr: float = 0.01,
                 betas: tuple[float, float] = (0.5, 0.99), eps: float = 1e-8):
        device = next(dec.parameters()).device
        self.src = {n: torch.rand(*lead_shape, s.V.shape[1] + 1, device=device).requires_grad_(True)
                    for n, s in dec.sites.items()}
        self.m = {n: torch.zeros_like(s) for n, s in self.src.items()}
        self.v = {n: torch.zeros_like(s) for n, s in self.src.items()}
        self.lr, self.betas, self.eps, self.t = lr, betas, eps, 0

    def tensors(self) -> list[torch.Tensor]:
        return list(self.src.values())

    def masks(self, lower: dict[str, torch.Tensor]) -> tuple[dict, dict]:
        masks = {n: lower[n] + (1 - lower[n]) * s[..., :-1] for n, s in self.src.items()}
        return masks, {n: s[..., -1] for n, s in self.src.items()}

    @torch.no_grad()
    def ascend(self, grads: list[torch.Tensor]) -> None:
        self.t += 1
        b1, b2 = self.betas
        for (name, src), g in zip(self.src.items(), grads):
            self.m[name].mul_(b1).add_(g, alpha=1 - b1)
            self.v[name].mul_(b2).addcmul_(g, g, value=1 - b2)
            m_hat = self.m[name] / (1 - b1 ** self.t)
            v_hat = self.v[name] / (1 - b2 ** self.t)
            src.add_(self.lr * m_hat / (v_hat.sqrt() + self.eps)).clamp_(0.0, 1.0)


@dataclass
class TrainConfig:
    steps: int = 1000
    lr_components: float = 1e-3
    lr_ci: float = 1e-3
    lr_final_frac: float = 0.1
    coeff_faith: float = 1e3
    coeff_imp: float = 2e-4
    coeff_stoch: float = 0.5
    coeff_layerwise: float = 0.0  # stochastic masks on one site at a time (the reference's toy recipe)
    coeff_adv: float = 0.5
    subset_routing: bool = True  # stochastic term masks a random subset of sites instead of all
    p_start: float = 2.0
    p_end: float = 0.4
    imp_beta: float = 0.5
    pgd_warmup: int = 1
    grad_clip_components: float | None = 0.01
    faith_warmup_steps: int = 400
    faith_warmup_lr: float = 1e-3
    faith_warmup_weight_decay: float = 0.0


@torch.no_grad()
def svd_init(dec: Decomposition, rotate: bool = False) -> None:
    """Start each site from an exact factorisation of W: its SVD, optionally mixed by a random rotation.

    With fewer subcomponents than the rank, the tail of the spectrum is left to the delta; any
    subcomponents beyond the rank start near zero.
    """
    for site in dec.sites.values():
        left, singular, right_t = torch.linalg.svd(site.W, full_matrices=False)  # W = left S right_t
        k = min(site.V.shape[1], singular.numel())
        V = right_t[:k].T * singular[:k].sqrt()
        U = singular[:k].sqrt()[:, None] * left[:, :k].T
        if rotate:
            q, _ = torch.linalg.qr(torch.randn(k, k, device=V.device))
            V, U = V @ q, q.T @ U
        site.V.mul_(1e-3)
        site.U.mul_(1e-3)
        site.V[:, :k] = V
        site.U[:k] = U


def faithfulness_warmup(dec: Decomposition, cfg: TrainConfig) -> float:
    opt = torch.optim.AdamW(dec.component_parameters(), lr=cfg.faith_warmup_lr,
                            weight_decay=cfg.faith_warmup_weight_decay)
    for _ in range(cfg.faith_warmup_steps):
        opt.zero_grad()
        loss = dec.faithfulness()
        loss.backward()
        opt.step()
    return dec.faithfulness().item()


def make_optimizer(dec: Decomposition, cfg: TrainConfig) -> tuple[torch.optim.Optimizer, object]:
    opt = torch.optim.AdamW(
        [{"params": dec.component_parameters(), "lr": cfg.lr_components},
         {"params": dec.cifns.parameters(), "lr": cfg.lr_ci}],
        weight_decay=0.0,
    )
    floor = cfg.lr_final_frac
    cosine = lambda step: floor + (1 - floor) * 0.5 * (1 + math.cos(math.pi * min(step / cfg.steps, 1.0)))
    return opt, torch.optim.lr_scheduler.LambdaLR(opt, cosine)


def train_step(dec: Decomposition, forward, recon, batch, sources: PersistentSources | None,
               opt: torch.optim.Optimizer, cfg: TrainConfig, frac: float) -> dict[str, float]:
    """One VPD step. `forward(batch)` runs the target network through the sites' current masks.

    Pass `sources=None` to train without the adversarial term.
    """
    dec.set_masks(capture=True)
    with torch.no_grad():
        target = forward(batch)
    taps = dec.taps()
    lower, upper = dec.causal_importance(taps)

    def stochastic(names: list[str]) -> tuple[dict, dict]:
        return ({n: lower[n] + (1 - lower[n]) * torch.rand_like(lower[n]) for n in names},
                {n: torch.rand_like(lower[n][..., 0]) for n in names})

    if sources is not None:
        for _ in range(cfg.pgd_warmup):
            dec.set_masks(*sources.masks({n: ci.detach() for n, ci in lower.items()}))
            sources.ascend(torch.autograd.grad(recon(forward(batch), target), sources.tensors()))

    names = list(dec.sites)
    routed = random.sample(names, random.randint(1, len(names))) if cfg.subset_routing else names
    dec.set_masks(*stochastic(routed))
    loss_stoch = recon(forward(batch), target)

    loss_layerwise = target.new_zeros(())
    if cfg.coeff_layerwise:
        for name in names:
            dec.set_masks(*stochastic([name]))
            loss_layerwise = loss_layerwise + recon(forward(batch), target) / len(names)

    loss_adv = target.new_zeros(())
    if sources is not None:
        dec.set_masks(*sources.masks(lower))
        loss_adv = recon(forward(batch), target)

    faith = dec.faithfulness()
    p = cfg.p_start + (cfg.p_end - cfg.p_start) * frac
    imp = importance_minimality(upper, p, cfg.imp_beta)
    loss = (cfg.coeff_faith * faith + cfg.coeff_imp * imp + cfg.coeff_stoch * loss_stoch
            + cfg.coeff_layerwise * loss_layerwise + cfg.coeff_adv * loss_adv)

    opt.zero_grad()
    if sources is not None:
        for src in sources.tensors():
            src.grad = None
    loss.backward()
    if cfg.grad_clip_components is not None:
        nn.utils.clip_grad_norm_(dec.component_parameters(), cfg.grad_clip_components)
    opt.step()
    if sources is not None:
        sources.ascend([src.grad for src in sources.tensors()])
    dec.set_masks()
    return {"loss": loss.item(), "faith": faith.item(), "imp": imp.item(), "stoch": loss_stoch.item(),
            "layerwise": loss_layerwise.item(), "adv": loss_adv.item(), "p": p}


def assign(scores: torch.Tensor, alive_threshold: float, share_threshold: float, relative: bool,
           chunk_size: int | None = None) -> dict:
    """Split components into one chunk per capability, a shared set and a dead set.

    `scores` is [capabilities, components]. A component joins capability k's chunk when it is alive and
    k holds most of its importance mass. With `chunk_size`, each chunk is instead the that-many alive
    components k owns with the highest share, whatever the share is, for comparisons at equal size.
    """
    # Ownership uses each capability's scores relative to its own mean. Raw scores differ in scale per
    # capability (attribution magnitudes, or simply denser causal importance), and without this the
    # densest capability owns almost every component.
    normalised = scores / scores.mean(1, keepdim=True)
    top, owner = normalised.max(0)
    share = top / normalised.sum(0).clamp_min(1e-12)
    alive = (normalised if relative else scores).max(0).values > alive_threshold
    if chunk_size is None:
        chunks = [alive & (owner == k) & (share >= share_threshold) for k in range(scores.shape[0])]
    else:
        chunks = []
        for k in range(scores.shape[0]):
            ranked = torch.where(alive & (owner == k), share, torch.zeros_like(share)).argsort(descending=True)
            chunk = torch.zeros_like(alive)
            chunk[ranked[:chunk_size]] = True
            chunks.append(chunk & alive & (owner == k))
    exclusive = torch.stack(chunks).any(0)
    return {"chunks": chunks, "shared": alive & ~exclusive, "dead": ~alive, "share": share}


@torch.no_grad()
def evaluate(dec: Decomposition, forward, recon, batch) -> dict[str, float]:
    """Monitor-only reconstruction under fixed mask settings, plus causal-importance L0 per site."""
    dec.set_masks(capture=True)
    target = forward(batch)
    lower, _ = dec.causal_importance(dec.taps())
    ones = {n: torch.ones_like(ci) for n, ci in lower.items()}
    off = {n: torch.zeros_like(ci[..., 0]) for n, ci in lower.items()}
    on = {n: torch.ones_like(ci[..., 0]) for n, ci in lower.items()}
    settings = {
        "unmasked": (ones, off),  # parameter faithfulness as behaviour: all components, no delta
        "ci_masked": (lower, off),
        "ci_masked_delta": (lower, on),
        "rounded": ({n: (ci > 0).float() for n, ci in lower.items()}, off),
        "random": ({n: torch.rand_like(ci) for n, ci in lower.items()}, off),
        "zero": ({n: torch.zeros_like(ci) for n, ci in lower.items()}, off),
    }
    out = {}
    for label, (masks, delta_masks) in settings.items():
        dec.set_masks(masks, delta_masks)
        out[f"recon/{label}"] = recon(forward(batch), target).item()
    dec.set_masks()
    out["l0"] = sum((ci > 0).float().sum(-1).mean().item() for ci in lower.values())
    out["l0_half"] = sum((ci > 0.5).float().sum(-1).mean().item() for ci in lower.values())
    out["faith"] = dec.faithfulness().item()
    return out
