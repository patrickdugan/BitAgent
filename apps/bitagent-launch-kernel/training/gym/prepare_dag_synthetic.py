"""Prepare a development-only DAG adapter split from verified synthetic receipts.

Labels come from BitAgent's deterministic candidate builder, never from the
model's rejected text. This is a small development split, not promotion data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


VALIDATION_SCENARIOS_18 = {
    "deposit-pending",
    "strategy-approved",
    "strategy-rejected",
    "withdraw-simulated",
    "unsupported-portfolio",
    "interrupted-recovery",
}
VALIDATION_SCENARIOS_28 = {
    "deposit-pending",
    "strategy-stale",
    "strategy-approved",
    "strategy-rejected",
    "funding-submitted",
    "withdraw-simulated",
    "withdraw-verified",
    "unsupported-portfolio",
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_jsonl(data: bytes) -> list[dict]:
    return [json.loads(line) for line in data.decode("utf-8").splitlines() if line.strip()]


def write_jsonl(path: Path, rows: list[dict]) -> str:
    content = "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
                      for row in rows).encode("utf-8")
    path.write_bytes(content)
    return digest(content)


def prepare(tasks_path: Path, proposals_path: Path, validation_path: Path,
            receipt_path: Path, hermes_src: Path, output: Path) -> dict:
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite prepared split: {output}")
    task_bytes = tasks_path.read_bytes()
    proposal_bytes = proposals_path.read_bytes()
    tasks = load_jsonl(task_bytes)
    proposals = load_jsonl(proposal_bytes)
    validation_bytes = validation_path.read_bytes()
    validation = json.loads(validation_bytes)
    collection_bytes = receipt_path.read_bytes()
    collection = json.loads(collection_bytes)
    if collection.get("tasks_sha256") != digest(task_bytes) \
            or collection.get("proposals_sha256") != digest(proposal_bytes) \
            or validation.get("task_file_sha256") != digest(task_bytes) \
            or validation.get("proposal_file_sha256") != digest(proposal_bytes):
        raise ValueError("Collection and validation do not bind to the same task/proposal bytes")
    if validation.get("wallet_or_chain_effect") is not False \
            or validation.get("optimizer_eligible") is not False \
            or collection.get("wallet_or_chain_effect") is not False \
            or collection.get("optimizer_eligible") is not False:
        raise ValueError("Source receipts crossed their candidate-only boundary")
    if len(tasks) not in (18, 28) \
            or len(tasks) != len(proposals) \
            or len(tasks) != len(validation.get("results", [])):
        raise ValueError("Development split requires the reviewed 18- or 28-scenario batch")
    validation_scenarios = (VALIDATION_SCENARIOS_18 if len(tasks) == 18
                            else VALIDATION_SCENARIOS_28)
    profile = ("testnet4-dag-synthetic-dev1" if len(tasks) == 18
               else "testnet4-dag-synthetic-local-dev2")

    sys.path.insert(0, str(hermes_src.resolve()))
    from agent.bitagent_synthetic_testnet_v1 import SYSTEM  # noqa: PLC0415
    if collection.get("system_prompt_sha256") not in (None, digest(SYSTEM.encode("utf-8"))):
        raise ValueError("Hermes collection prompt changed before preparation")

    proposal_by_id = {row["scenario_id"]: row for row in proposals}
    validation_by_id = {row["scenario_id"]: row for row in validation["results"]}
    if len(proposal_by_id) != len(tasks) or len(validation_by_id) != len(tasks):
        raise ValueError("Duplicate scenario identifiers")
    train: list[dict] = []
    heldout: list[dict] = []
    validation_tasks: list[dict] = []
    indexes: dict[str, list[dict]] = {"train": [], "validation": []}
    for task in tasks:
        scenario_id = task["scenario_id"]
        proposal = proposal_by_id[scenario_id]
        result = validation_by_id[scenario_id]
        packet = task["task"]["packet"]
        candidate = task["task"]["canonicalCandidate"]
        if task.get("split") != "unreviewed_synthetic" \
                or task.get("provenance", {}).get("workflow_state") != "scripted_sandbox_not_live_wallet" \
                or any(task.get("provenance", {}).get(effect) is not False
                       for effect in ("effects", "signing", "broadcast")):
            raise ValueError(f"Unsafe task provenance: {scenario_id}")
        if proposal.get("optimizer_eligible") is not False \
                or proposal.get("unsafe_output_redacted") is not False \
                or result.get("optimizer_eligible") is not False \
                or result.get("canonical_candidate") != candidate \
                or result.get("task_id") != packet["task_id"]:
            raise ValueError(f"Proposal or canonical label drift: {scenario_id}")
        if candidate.get("authority") != "model_candidate" or candidate.get("effect") != "none" \
                or packet.get("safety_boundary", {}).get("authority") != "candidate_only" \
                or any(packet.get("safety_boundary", {}).get(effect) is not False
                       for effect in ("authorization", "signing", "execution", "broadcast", "secret_access")):
            raise ValueError(f"Unsafe canonical candidate: {scenario_id}")
        example = {
            "prompt": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": json.dumps(packet, ensure_ascii=False,
                                                       sort_keys=True, separators=(",", ":"))},
            ],
            "completion": [{"role": "assistant", "content": json.dumps(
                candidate, ensure_ascii=False, separators=(",", ":"))}],
        }
        split = "validation" if scenario_id in validation_scenarios else "train"
        (heldout if split == "validation" else train).append(example)
        indexes[split].append({"scenario_id": scenario_id, "task_id": packet["task_id"],
                               "family": packet["family"],
                               "condition": packet["workflow_state"]["condition"]})
        if split == "validation":
            validation_tasks.append(task)
    if len(train) != len(tasks) - len(validation_scenarios) \
            or len(heldout) != len(validation_scenarios):
        raise ValueError("Development split size drift")
    output.mkdir(parents=True)
    train_hash = write_jsonl(output / "train.jsonl", train)
    validation_hash = write_jsonl(output / "validation.jsonl", heldout)
    write_jsonl(output / "train-index.jsonl", indexes["train"])
    write_jsonl(output / "validation-index.jsonl", indexes["validation"])
    write_jsonl(output / "validation-tasks.jsonl", validation_tasks)
    receipt = {
        "schema": "bitagent.local_adapter_gym_preparation.v1",
        "profile": profile,
        "candidateOnly": True,
        "promoted": False,
        "heldoutOptimizerAccess": False,
        "source": "reviewed_development_host_canonical_labels",
        "sourceTaskSha256": digest(task_bytes),
        "sourceProposalSha256": digest(proposal_bytes),
        "sourceValidationSha256": digest(validation_bytes),
        "sourceCollectionReceiptSha256": digest(collection_bytes),
        "systemPromptSha256": digest(SYSTEM.encode("utf-8")),
        "rows": {"train": len(train), "validation": len(heldout)},
        "outputs": {"trainSha256": train_hash, "validationSha256": validation_hash},
        "limitations": ["scripted_wallet_state", "no_tradelayer_listener",
                        "small_development_split", "unseen_conditions_in_validation"],
    }
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tasks", type=Path, required=True)
    parser.add_argument("--proposals", type=Path, required=True)
    parser.add_argument("--validation", type=Path, required=True)
    parser.add_argument("--collection-receipt", type=Path, required=True)
    parser.add_argument("--hermes-src", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.tasks, args.proposals, args.validation,
                             args.collection_receipt, args.hermes_src, args.output), indent=2))


if __name__ == "__main__":
    main()
