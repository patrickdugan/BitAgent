"""Build fixed-length token windows per capability, with a mask over each window's answer tokens.

Each window belongs to exactly one capability. Train and eval windows come from different
generator seeds, different SFT splits, or different source files.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
import random
import sys
import types
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")

import torch
from transformers import AutoTokenizer

import config

sys.path.insert(0, str(config.JEVQ_SRC))
from jevq.tasks import GENERATOR_VERSION, TASKS  # noqa: E402
from jevq.tasks.base import make_rng  # noqa: E402

Window = tuple[list[int], list[bool]]


def task_windows(tok, task_class: str, split: str, count: int, length: int, seed: int) -> list[Window]:
    """Few-shot streams: Q/A examples of one generator back to back, cut at `length` tokens."""
    rng = make_rng(seed, task_class, split)
    sep = tok.encode("\n\n", add_special_tokens=False)
    windows = []
    for _ in range(count):
        generate = TASKS[rng.choice(config.TASK_CLASSES[task_class])].generate
        ids: list[int] = []
        mask: list[bool] = []
        while len(ids) < length:
            question, answer, _, _ = generate(rng, rng.choice(config.TASK_DIFFICULTIES))
            q = tok.encode(f"Q: {question}\nA:", add_special_tokens=False)
            a = tok.encode(f" {answer}", add_special_tokens=False)
            ids += q + a + sep
            mask += [False] * len(q) + [True] * len(a) + [False] * len(sep)
        windows.append((ids[:length], mask[:length]))
    return windows


def dag_ops_windows(tok, split: str, count: int, length: int, seed: int) -> list[Window]:
    """The last `length` tokens of each chat-rendered row; the answer is the assistant completion."""
    path = config.DAG_OPS_SFT / ("train.jsonl" if split == "train" else "validation.jsonl")
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    random.Random(f"{seed}|dag_ops|{split}").shuffle(rows)
    windows = []
    for row in rows:
        kwargs = {"tools": row.get("tools"), "tokenize": True, "enable_thinking": False}
        prefix = tok.apply_chat_template(row["prompt"], add_generation_prompt=True, **kwargs)
        full = tok.apply_chat_template(row["prompt"] + row["completion"], add_generation_prompt=False, **kwargs)
        if len(full) < length or full[:len(prefix)] != prefix:
            continue
        mask = [i >= len(prefix) for i in range(len(full))]
        windows.append((full[-length:], mask[-length:]))
        if len(windows) == count:
            break
    return windows


def prime_scenarios():
    """The Prime environment's scenario module, imported without its package __init__ (which needs verifiers)."""
    if "bitagent_dag_ops_v2" not in sys.modules:
        package = types.ModuleType("bitagent_dag_ops_v2")
        package.__path__ = [str(config.DAG_OPS_ENV)]
        sys.modules["bitagent_dag_ops_v2"] = package
    return importlib.import_module("bitagent_dag_ops_v2.scenarios")


def prime_family_windows(tok, family: str, split: str, count: int, length: int, seed: int) -> list[Window]:
    """Windows over one task family's chat-rendered tasks; the answer is the expected JSON candidate.

    Train windows come from the environment's train split and eval windows from its development
    split. The heldout split is never read.
    """
    wanted = "train" if split == "train" else "development"
    rows = [r for r in prime_scenarios().build_rows() if r["family"] == family and r["split"] == wanted]
    windows = []
    for row in rows:
        chat = [{"role": "system", "content": row["system_prompt"]}, {"role": "user", "content": row["prompt"]}]
        answer = [{"role": "assistant", "content": json.dumps(row["expected"], separators=(",", ":"))}]
        prefix = tok.apply_chat_template(chat, tokenize=True, add_generation_prompt=True, enable_thinking=False)
        full = tok.apply_chat_template(chat + answer, tokenize=True, add_generation_prompt=False, enable_thinking=False)
        mask = [i >= len(prefix) for i in range(len(full))]
        # Count back from the end so the last window always ends with the complete answer.
        for end in range(len(full), length - 1, -length):
            windows.append((full[end - length:end], mask[end - length:end]))
    random.Random(f"{seed}|{family}|{split}").shuffle(windows)
    return windows[:count]


def file_windows(tok, pattern: str, split: str, count: int, length: int, seed: int) -> list[Window]:
    files = sorted(p for p in config.REPO.rglob(pattern) if not config.SKIP_DIRS & set(p.parts))
    # Every fifth file is held out so eval windows never share a file with train windows.
    files = [p for i, p in enumerate(files) if (i % 5 == 0) == (split == "eval")]
    windows = []
    for path in files:
        ids = tok.encode(path.read_text(encoding="utf-8", errors="replace"), add_special_tokens=False)
        windows += [(ids[i:i + length], [True] * length) for i in range(0, len(ids) - length + 1, length)]
    random.Random(f"{seed}|{pattern}|{split}").shuffle(windows)
    return windows[:count]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=config.OUT / "data-s96")
    parser.add_argument("--profile", choices=["general", "prime"], default="general")
    parser.add_argument("--length", type=int, default=96)
    parser.add_argument("--train", type=int, default=128)
    parser.add_argument("--eval", type=int, default=32)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    tok = AutoTokenizer.from_pretrained(config.BASE_MODEL, revision=config.BASE_REVISION, cache_dir=config.HF_CACHE)
    if args.profile == "prime":
        # One capability per task family of the Prime environment, with three unrelated ones for contrast.
        builders = {f"env_{family}": (prime_family_windows, family) for family in prime_scenarios().FAMILIES}
        builders["arithmetic"] = (task_windows, "arithmetic")
    else:
        builders = {name: (task_windows, name) for name in config.TASK_CLASSES}
        builders["dag_ops"] = (dag_ops_windows, None)
    builders["prose"] = (file_windows, config.PROSE_GLOB)
    builders["code"] = (file_windows, config.CODE_GLOB)

    data: dict[str, dict[str, dict[str, torch.Tensor]]] = {}
    counts = {}
    for capability, (build, arg) in builders.items():
        data[capability] = {}
        for split, count in (("train", args.train), ("eval", args.eval)):
            extra = () if arg is None else (arg,)
            windows = build(tok, *extra, split, count, args.length, args.seed)
            if len(windows) < count:
                raise ValueError(f"{capability}/{split}: only {len(windows)} of {count} windows available")
            data[capability][split] = {
                "tokens": torch.tensor([w[0] for w in windows], dtype=torch.long),
                "answer_mask": torch.tensor([w[1] for w in windows], dtype=torch.bool),
            }
            counts[f"{capability}/{split}"] = len(windows)

    args.output.mkdir(parents=True, exist_ok=True)
    torch.save(data, args.output / "windows.pt")
    receipt = {
        "baseModel": config.BASE_MODEL, "baseRevision": config.BASE_REVISION, "length": args.length,
        "seed": args.seed, "jevqGeneratorVersion": GENERATOR_VERSION, "dagOpsSource": str(config.DAG_OPS_SFT),
        "windows": counts, "windowsSha256": hashlib.sha256((args.output / "windows.pt").read_bytes()).hexdigest(),
    }
    (args.output / "receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps(receipt, indent=2))
    for capability in data:
        print(f"--- {capability} ---\n{tok.decode(data[capability]['train']['tokens'][0])[:300]!r}")


if __name__ == "__main__":
    main()
