"""Verify frozen BitAgent corpora and build completion-only SFT inputs.

This module uses only the Python standard library. It deliberately reads only
the manifest's train and validation entries; held-out files never enter the
optimizer directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


KERNEL_ROOT = Path(__file__).resolve().parents[2]
DATASETS_ROOT = KERNEL_ROOT / "training" / "datasets"
PROFILES = {
    "referral-growth": "bonsai-referral-growth-v1",
    "referral-disposition": "bonsai-referral-disposition-v2",
    "marketing-cues": "bitagent-marketing-trajectories-v1",
    "marketing-multiturn": "bitagent-marketing-multiturn-v1",
}
ALLOWED_ROLES = {"system", "user", "assistant"}


def sha256(path: Path, normalize_crlf: bool = False) -> str:
    data = path.read_bytes()
    if normalize_crlf:
        data = data.replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def corpus_path(dataset_dir: Path, relative: str) -> Path:
    if Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise ValueError(f"Unsafe manifest path: {relative}")
    if relative.startswith("training/"):
        path = KERNEL_ROOT / relative
    else:
        path = dataset_dir / relative
    resolved = path.resolve()
    if not resolved.is_relative_to(KERNEL_ROOT.resolve()):
        raise ValueError(f"Manifest path escapes launch kernel: {relative}")
    return resolved


def verified_rows(dataset_dir: Path, entry: dict, split: str) -> tuple[list[dict], Path]:
    path = corpus_path(dataset_dir, entry["path"])
    actual_hash = sha256(path)
    canonical_hash = sha256(path, normalize_crlf=True)
    if actual_hash != entry["sha256"] and canonical_hash != entry["sha256"]:
        raise ValueError(f"{split} SHA-256 mismatch: {path}")
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(rows) != entry["rows"]:
        raise ValueError(f"{split} row count mismatch: {len(rows)} != {entry['rows']}")
    for row in rows:
        if row.get("split") != split:
            raise ValueError(f"Wrong split in {path}: {row.get('id')}")
    return rows, path


def training_examples(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    examples: list[dict] = []
    index: list[dict] = []
    for row in rows:
        messages = row.get("messages")
        if not isinstance(messages, list) or len(messages) < 3:
            raise ValueError(f"Missing conversation: {row.get('id')}")
        if any(message.get("role") not in ALLOWED_ROLES or not isinstance(message.get("content"), str)
               for message in messages):
            raise ValueError(f"Invalid message role/content: {row.get('id')}")
        assistant_turns = 0
        for position, message in enumerate(messages):
            if message["role"] != "assistant":
                continue
            if not any(prior["role"] == "user" for prior in messages[:position]):
                raise ValueError(f"Assistant turn without user: {row.get('id')}")
            candidate = json.loads(message["content"])
            if candidate.get("authority") != "model_candidate" or candidate.get("effect") != "none":
                raise ValueError(f"Non-candidate assistant output: {row.get('id')}")
            prompt = messages[:position]
            completion = [message]
            examples.append({"prompt": prompt, "completion": completion})
            index.append({"id": row["id"], "familyId": row.get("familyId"), "assistantTurn": assistant_turns})
            assistant_turns += 1
        if assistant_turns == 0:
            raise ValueError(f"No assistant completion: {row.get('id')}")
    return examples, index


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows),
        encoding="utf-8",
    )


def prepare(profile: str, output: Path) -> dict:
    dataset_dir = DATASETS_ROOT / PROFILES[profile]
    manifest_path = dataset_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    train, train_path = verified_rows(dataset_dir, manifest["files"]["train"], "train")
    validation, validation_path = verified_rows(dataset_dir, manifest["files"]["validation"], "validation")
    train_ids = {row["id"] for row in train}
    validation_ids = {row["id"] for row in validation}
    if train_ids & validation_ids:
        raise ValueError("Train/validation IDs overlap")
    train_families = {row.get("familyId") for row in train if row.get("familyId")}
    validation_families = {row.get("familyId") for row in validation if row.get("familyId")}
    if train_families & validation_families:
        raise ValueError("Train/validation families overlap")
    train_examples, train_index = training_examples(train)
    validation_examples, validation_index = training_examples(validation)
    output.mkdir(parents=True, exist_ok=True)
    write_jsonl(output / "train.jsonl", train_examples)
    write_jsonl(output / "validation.jsonl", validation_examples)
    write_jsonl(output / "train-index.jsonl", train_index)
    write_jsonl(output / "validation-index.jsonl", validation_index)
    receipt = {
        "schema": "bitagent.local_adapter_gym_preparation.v1",
        "profile": profile,
        "candidateOnly": True,
        "heldoutOptimizerAccess": False,
        "manifestSha256": sha256(manifest_path),
        "inputs": {"train": str(train_path), "validation": str(validation_path)},
        "rows": {"train": len(train), "validation": len(validation)},
        "completions": {"train": len(train_examples), "validation": len(validation_examples)},
        "outputs": {"trainSha256": sha256(output / "train.jsonl"),
                    "validationSha256": sha256(output / "validation.jsonl")},
    }
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True, choices=PROFILES)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare(args.profile, args.output.resolve()), indent=2))


if __name__ == "__main__":
    main()
