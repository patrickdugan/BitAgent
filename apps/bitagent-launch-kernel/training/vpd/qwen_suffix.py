"""Qwen3 plumbing: offline load, residual cache at a layer boundary, suffix-only forward, site install.

Decomposing only layers >= `first_layer` lets every training step skip the frozen prefix:
the residual stream entering `first_layer` is computed once per window and cached.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")

import torch
from transformers import AutoModelForCausalLM

import config
from vpd_core import ComponentSite, Decomposition

KINDS = {
    "mlp": ["mlp.gate_proj", "mlp.up_proj", "mlp.down_proj"],
    "attn": ["self_attn.q_proj", "self_attn.k_proj", "self_attn.v_proj", "self_attn.o_proj"],
}
KINDS["all"] = KINDS["attn"] + KINDS["mlp"]


def parse_layers(spec: str) -> list[int]:
    """Parse decoder layer indices such as "24-27" or "20,24-27" into a sorted list."""
    layers: set[int] = set()
    for part in spec.split(","):
        first, _, last = part.strip().partition("-")
        layers.update(range(int(first), int(last or first) + 1))
    return sorted(layers)


def claim_gpu() -> None:
    """Refuse to start on a busy card, and cap this process so it cannot spill into other jobs' memory."""
    query = subprocess.run(["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
                           check=True, capture_output=True, text=True, timeout=15)
    free = int(query.stdout.strip().splitlines()[0])
    if free < config.GPU_MIN_FREE_MIB:
        raise SystemExit(f"GPU has {free} MiB free; need {config.GPU_MIN_FREE_MIB}. Wait for the other job.")
    torch.cuda.set_per_process_memory_fraction(config.GPU_MEMORY_FRACTION)


def load_model(device: str):
    if device.startswith("cuda"):
        claim_gpu()
    model = AutoModelForCausalLM.from_pretrained(
        config.BASE_MODEL, revision=config.BASE_REVISION, cache_dir=config.HF_CACHE, dtype=torch.float32,
    )
    return model.eval().requires_grad_(False).to(device)


def install_sites(model, layers: list[int], kind: str, components: int, ci_hidden: int) -> Decomposition:
    """Replace the selected nn.Linear modules with ComponentSites, in place."""
    sites = {}
    for layer in layers:
        for path in KINDS[kind]:
            parent_path, _, child = f"model.layers.{layer}.{path}".rpartition(".")
            parent = model.get_submodule(parent_path)
            linear = getattr(parent, child)
            site = ComponentSite(linear.weight, linear.bias, components)
            setattr(parent, child, site)
            sites[f"L{layer}_{path.replace('.', '_')}"] = site
    return Decomposition(sites, ci_hidden).to(linear.weight.device)


def run_layers(model, hidden: torch.Tensor, start: int, stop: int | None) -> torch.Tensor:
    batch, length = hidden.shape[:2]
    positions = torch.arange(length, device=hidden.device).unsqueeze(0).expand(batch, -1)
    rotary = model.model.rotary_emb(hidden, positions)
    causal = torch.full((length, length), float("-inf"), device=hidden.device, dtype=hidden.dtype).triu(1)[None, None]
    for layer in model.model.layers[start:stop]:
        hidden = layer(hidden, attention_mask=causal, position_embeddings=rotary)
        hidden = hidden[0] if isinstance(hidden, tuple) else hidden
    return hidden


class LowRankLinear(torch.nn.Module):
    """x -> A (B x): two thin matrices in place of one dense weight."""

    def __init__(self, left: torch.Tensor, right: torch.Tensor, bias: torch.Tensor | None):
        super().__init__()
        self.A = torch.nn.Parameter(left, requires_grad=False)  # [d_out, rank]
        self.B = torch.nn.Parameter(right, requires_grad=False)  # [rank, d_in]
        self.bias = bias

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.nn.functional.linear(torch.nn.functional.linear(x, self.B), self.A, self.bias)


def site_modules(model, layers: list[int], kind: str) -> dict[str, torch.nn.Module]:
    """The modules currently installed at the selected sites, keyed like install_sites names them."""
    return {f"L{layer}_{path.replace('.', '_')}": model.get_submodule(f"model.layers.{layer}.{path}")
            for layer in layers for path in KINDS[kind]}


def set_modules(model, layers: list[int], kind: str, modules: dict[str, torch.nn.Module]) -> None:
    """Install `modules` (keyed like site_modules) at their places in the model."""
    for layer in layers:
        for path in KINDS[kind]:
            parent_path, _, leaf = f"model.layers.{layer}.{path}".rpartition(".")
            setattr(model.get_submodule(parent_path), leaf, modules[f"L{layer}_{path.replace('.', '_')}"])


def drop_prefix(model, first_layer: int) -> None:
    """Free the layers before `first_layer`; once the residual cache exists nothing runs them again."""
    for index in range(first_layer):
        model.model.layers[index] = torch.nn.Identity()


def suffix_logits(model, hidden: torch.Tensor, first_layer: int, positions: torch.Tensor | None = None) -> torch.Tensor:
    """Logits at every position, or only at `positions` (the unembedding dominates CPU cost)."""
    hidden = model.model.norm(run_layers(model, hidden, first_layer, None))
    return model.lm_head(hidden if positions is None else hidden[:, positions])


@torch.no_grad()
def cached_residual(model, windows: dict, first_layer: int, data_dir: Path, batch: int = 8) -> dict:
    """{capability: {split: [N, S, d] residual entering `first_layer`}}, cached next to the windows."""
    path = data_dir / f"resid_L{first_layer}.pt"
    if path.exists():
        return torch.load(path)
    device = model.lm_head.weight.device
    # Continue from the deepest earlier cache when there is one, instead of re-running the whole prefix.
    earlier = [int(p.stem.split("_L")[1]) for p in data_dir.glob("resid_L*.pt")]
    start = max((layer for layer in earlier if layer < first_layer), default=None)
    source = torch.load(data_dir / f"resid_L{start}.pt") if start is not None else None
    resid = {}
    for capability, splits in windows.items():
        resid[capability] = {}
        for split, item in splits.items():
            if source is None:
                inputs = [model.model.embed_tokens(ids.to(device)) for ids in item["tokens"].split(batch)]
            else:
                inputs = [hidden.to(device) for hidden in source[capability][split].split(batch)]
            chunks = [run_layers(model, hidden, start or 0, first_layer).cpu() for hidden in inputs]
            resid[capability][split] = torch.cat(chunks)
        print(f"cached residual L{first_layer}: {capability}", flush=True)
    torch.save(resid, path)
    return resid
