"""Paths and pins for the VPD capability-chunking experiments. Outputs stay outside the clone."""

from __future__ import annotations

import os
from pathlib import Path

def lower_priority() -> None:
    """Run below normal priority: this PC is shared with GPU training and other agents' jobs."""
    if os.name == "nt":
        import ctypes
        kernel32 = ctypes.windll.kernel32
        kernel32.GetCurrentProcess.restype = ctypes.c_void_p  # a pseudo-handle; the default int return truncates it
        kernel32.SetPriorityClass.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        kernel32.SetPriorityClass(kernel32.GetCurrentProcess(), 0x4000)  # BELOW_NORMAL_PRIORITY_CLASS
    else:
        os.nice(10)


REPO = Path(__file__).resolve().parents[4]
GYM = Path(os.environ.get("BITAGENT_GYM", Path.home() / "Documents" / "Codex" / "BitAgent-gym"))
HF_CACHE = GYM / "runs" / "hf-cache"
OUT = GYM / "vpd"

# The RTX 5080 is shared: start only with this much VRAM free, and never take more than this share of it.
GPU_MIN_FREE_MIB = 8000
GPU_MEMORY_FRACTION = 0.45

BASE_MODEL = "Qwen/Qwen3-0.6B"
BASE_REVISION = "c1899de289a04d12100db370d81485cdf75e47ca"

# Sibling checkout with deterministic synthetic task generators (read-only import).
JEVQ_SRC = REPO.parent / "jev-qwen" / "src"
# Prime Intellect environment moralitylab/bitagent-dag-ops-v2, as prepared by gym/prepare_dag_tool_sft.py.
DAG_OPS_SFT = GYM / "prepared" / "testnet4-dag-tool-sft-v1"
# The same environment's installed package (pinned 0.7.0); its scenario builder gives eight task families.
DAG_OPS_ENV = GYM / "prime-env" / "0.7.0" / "bitagent_dag_ops_v2"

# jev-qwen task classes -> generator names.
TASK_CLASSES = {
    "arithmetic": ["arith_chain", "var_trace"],
    "logic": ["order_chain", "bool_eval"],
    "tool_call": ["tool_select"],
    "planning": ["graph_hops"],
    "multihop": ["relation_hops"],
    "control": ["auth_gate"],
}
TASK_DIFFICULTIES = [1, 2, 3]
PROSE_GLOB, CODE_GLOB = "*.md", "*.ts"
SKIP_DIRS = {"node_modules", ".git", "build", "dist", "__pycache__", ".gradle"}
