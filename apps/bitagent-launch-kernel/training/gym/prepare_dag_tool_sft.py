"""Prepare multi-turn tool-use SFT rows from verified Hermes v2 DAG collections.

Each collected testnet4 task becomes one trajectory:
- accepted by BitAgent's validator -> the model's own trajectory (on-policy);
- rejected, unparsed, or turn-limited -> a host demonstration: inspect_dag on the
  current node, simulate_candidate with the host's canonical fields, then the
  canonical JSON. Tool results are produced by the same read-only tool code the
  collector uses; labels come only from BitAgent's deterministic DAG builder.

Trajectories expand into one row per assistant turn (prompt = all prior
messages, completion = that assistant turn, tools = the read-only schemas).
Validation holds out whole base scenarios so no surface variant leaks into
training. The Prime environment's heldout split is never read.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

VALIDATION_BASES = {
    "deposit-pending",
    "strategy-approval-pending",
    "strategy-rejected",
    "withdraw-approved",
    "withdraw-verified",
    "interrupted-recovery",
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


def same_candidate(left: dict, right: dict) -> bool:
    """Validator semantics: list fields compare as sets."""
    def normal(value: dict) -> dict:
        return {k: sorted(v) if k in ("evidence_ids", "risk_flags") and isinstance(v, list) else v
                for k, v in value.items()}
    return normal(left) == normal(right)


def compact_candidate(candidate: dict) -> str:
    return json.dumps(candidate, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def demonstration(task: dict, v2) -> list[dict]:
    """Host-labelled trajectory using the collector's own prompt and read-only tools."""
    packet = task["task"]["packet"]
    candidate = task["task"]["canonicalCandidate"]
    tools = v2.ReadOnlyDagTools(task)
    node = packet["workflow_state"]["current_node"]
    simulate_args = {key: candidate[key] for key in (
        "decision", "next_node", "tool", "evidence_ids", "reason_code", "risk_flags")}
    return [
        {"role": "system", "content": v2.SYSTEM},
        {"role": "user", "content": v2.USER_PREFIX + v2.compact(packet)},
        {"role": "assistant", "content": "", "tool_calls": [{"type": "function", "function": {
            "name": "dag_inspect_dag", "arguments": {"node_id": node}}}]},
        {"role": "tool", "content": tools.inspect_dag(node)},
        {"role": "assistant", "content": "", "tool_calls": [{"type": "function", "function": {
            "name": "dag_simulate_candidate", "arguments": simulate_args}}]},
        {"role": "tool", "content": tools.simulate_candidate(**simulate_args)},
        {"role": "assistant", "content": compact_candidate(candidate)},
    ]


def load_collection(collection: Path, tasks_path: Path) -> tuple[list[dict], dict]:
    task_bytes = tasks_path.read_bytes()
    proposal_bytes = (collection / "proposals.jsonl").read_bytes()
    trajectory_bytes = (collection / "trajectories.jsonl").read_bytes()
    receipt_bytes = (collection / "collector-receipt.json").read_bytes()
    validation_bytes = (collection / "validation.json").read_bytes()
    receipt = json.loads(receipt_bytes)
    validation = json.loads(validation_bytes)
    if receipt.get("schema") != "hermes.bitagent_synthetic_collection_receipt.v2":
        raise ValueError(f"{collection}: not a Hermes v2 tool-loop collection")
    if receipt.get("tasks_sha256") != digest(task_bytes) \
            or receipt.get("proposals_sha256") != digest(proposal_bytes) \
            or receipt.get("trajectories_sha256") != digest(trajectory_bytes) \
            or validation.get("task_file_sha256") != digest(task_bytes) \
            or validation.get("proposal_file_sha256") != digest(proposal_bytes):
        raise ValueError(f"{collection}: collection, validation, and tasks are not hash-bound")
    for source in (receipt, validation):
        if source.get("wallet_or_chain_effect") is not False \
                or source.get("optimizer_eligible") is not False:
            raise ValueError(f"{collection}: source crossed its candidate-only boundary")
    tasks = load_jsonl(task_bytes)
    trajectories = {row["scenario_id"]: row for row in load_jsonl(trajectory_bytes)}
    results = {row["scenario_id"]: row for row in validation["results"]}
    if not (len(tasks) == len(trajectories) == len(results)):
        raise ValueError(f"{collection}: task/trajectory/validation counts differ")
    joined = []
    for task in tasks:
        scenario = task["scenario_id"]
        packet = task["task"]["packet"]
        provenance = task.get("provenance", {})
        if task.get("split") != "unreviewed_synthetic" \
                or provenance.get("workflow_state") != "scripted_sandbox_not_live_wallet" \
                or any(provenance.get(k) is not False for k in ("effects", "signing", "broadcast")):
            raise ValueError(f"Unsafe task provenance: {scenario}")
        candidate = task["task"]["canonicalCandidate"]
        result = results[scenario]
        if result.get("canonical_candidate") != candidate \
                or result.get("task_id") != packet["task_id"] \
                or candidate.get("authority") != "model_candidate" \
                or candidate.get("effect") != "none":
            raise ValueError(f"Canonical label drift: {scenario}")
        joined.append({"task": task, "trajectory": trajectories[scenario], "result": result,
                       "base": provenance.get("base_scenario_id", scenario)})
    sources = {"collection": str(collection), "tasksSha256": digest(task_bytes),
               "collectionReceiptSha256": digest(receipt_bytes),
               "validationSha256": digest(validation_bytes),
               "accepted": validation.get("accepted"), "cases": validation.get("cases")}
    return joined, sources


def expand(messages: list[dict], tools: list[dict], meta: dict) -> list[dict]:
    rows = []
    for index, message in enumerate(messages):
        if message["role"] != "assistant":
            continue
        rows.append({"prompt": messages[:index], "completion": [message], "tools": tools,
                     "meta": {**meta, "assistantTurn": len(rows)}})
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collection", type=Path, action="append", required=True)
    parser.add_argument("--tasks", type=Path, action="append", required=True)
    parser.add_argument("--hermes-src", type=Path, required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if len(args.collection) != len(args.tasks):
        parser.error("pass one --tasks per --collection")
    output = args.output.resolve()
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite prepared split: {output}")
    sys.path.insert(0, str(args.hermes_src.resolve()))
    from agent import bitagent_synthetic_testnet_v2 as v2  # noqa: PLC0415

    split_rows: dict[str, list[dict]] = {"train": [], "validation": []}
    validation_tasks: list[dict] = []
    index: dict[str, list[dict]] = {"train": [], "validation": []}
    sources = []
    seen_task_ids: set[str] = set()
    for collection, tasks_path in zip(args.collection, args.tasks):
        joined, source = load_collection(collection.resolve(), tasks_path.resolve())
        sources.append(source)
        for item in joined:
            task, trajectory, result = item["task"], item["trajectory"], item["result"]
            packet = task["task"]["packet"]
            if packet["task_id"] in seen_task_ids:
                raise ValueError(f"Duplicate task across collections: {packet['task_id']}")
            seen_task_ids.add(packet["task_id"])
            on_policy = (result["accepted"] is True
                         and trajectory.get("unsafe_output_redacted") is False
                         and trajectory.get("messages")
                         and trajectory.get("turn_limit_reached") is False)
            messages = trajectory["messages"] if on_policy else demonstration(task, v2)
            if messages[-1]["role"] != "assistant" or messages[-1].get("tool_calls"):
                raise ValueError(f"Trajectory does not end in a final answer: {task['scenario_id']}")
            if not same_candidate(json.loads(messages[-1]["content"]),
                                  task["task"]["canonicalCandidate"]):
                raise ValueError(f"Final answer differs from host label: {task['scenario_id']}")
            split = "validation" if item["base"] in VALIDATION_BASES else "train"
            meta = {"scenario_id": task["scenario_id"], "base": item["base"],
                    "task_id": packet["task_id"],
                    "labelSource": "on_policy_accepted" if on_policy else "host_demonstration"}
            split_rows[split].extend(expand(messages, v2.TOOL_SCHEMAS, meta))
            index[split].append({**meta, "family": packet["family"],
                                 "condition": packet["workflow_state"]["condition"]})
            if split == "validation":
                validation_tasks.append(task)
    if not split_rows["train"] or not split_rows["validation"]:
        raise ValueError("Both splits must be nonempty")
    train_bases = {row["base"] for row in index["train"]}
    if train_bases & VALIDATION_BASES:
        raise ValueError("Validation base scenario leaked into training")
    output.mkdir(parents=True)
    train_hash = write_jsonl(output / "train.jsonl", split_rows["train"])
    validation_hash = write_jsonl(output / "validation.jsonl", split_rows["validation"])
    write_jsonl(output / "train-index.jsonl", index["train"])
    write_jsonl(output / "validation-index.jsonl", index["validation"])
    write_jsonl(output / "validation-tasks.jsonl", validation_tasks)

    def count(split: str, source: str) -> int:
        return sum(row["labelSource"] == source for row in index[split])

    receipt = {
        "schema": "bitagent.local_adapter_gym_preparation.v1",
        "profile": args.profile,
        "format": "multi_turn_tool_sft.v1",
        "candidateOnly": True,
        "promoted": False,
        "heldoutOptimizerAccess": False,
        "primeHeldoutAccess": False,
        "source": "hermes_v2_tool_loop_with_host_ldt_labels",
        "sources": sources,
        "systemPromptSha256": digest(v2.SYSTEM.encode("utf-8")),
        "userPrefixSha256": digest(v2.USER_PREFIX.encode("utf-8")),
        "validationBases": sorted(VALIDATION_BASES),
        "trajectories": {split: {"onPolicyAccepted": count(split, "on_policy_accepted"),
                                 "hostDemonstration": count(split, "host_demonstration")}
                         for split in ("train", "validation")},
        "rows": {"train": len(split_rows["train"]), "validation": len(split_rows["validation"])},
        "outputs": {"trainSha256": train_hash, "validationSha256": validation_hash},
        "limitations": ["scripted_wallet_state", "no_tradelayer_listener",
                        "surface_variants_share_28_base_conditions",
                        "simulate_tool_reveals_host_normalization"],
    }
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
