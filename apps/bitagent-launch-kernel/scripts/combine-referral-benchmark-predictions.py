"""Combine a preserved prediction prefix and deterministic shard outputs."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

CASES_SHA256 = "1301abf5e34c3d9155be71c92565e2cd63c7a264809f1d40b8ada62279f333c6"


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--prefix", type=Path, required=True)
    parser.add_argument("--shard", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if hashlib.sha256(args.cases.read_bytes()).hexdigest() != CASES_SHA256:
        raise SystemExit("case SHA-256 mismatch")
    cases = read_jsonl(args.cases)
    rows = [*read_jsonl(args.prefix), *(row for path in args.shard for row in read_jsonl(path))]
    by_id: dict[str, dict] = {}
    for row in rows:
        item_id = row.get("item_id")
        if not isinstance(item_id, str) or item_id in by_id:
            raise SystemExit(f"duplicate or invalid prediction ID: {item_id}")
        if row.get("candidate") != args.candidate:
            raise SystemExit(f"candidate mismatch: {item_id}")
        by_id[item_id] = row
    expected_ids = [case["id"] for case in cases]
    missing = [item_id for item_id in expected_ids if item_id not in by_id]
    extra = [item_id for item_id in by_id if item_id not in set(expected_ids)]
    if missing or extra:
        raise SystemExit(f"incomplete shards: missing={missing}, extra={extra}")
    ordered = [by_id[item_id] for item_id in expected_ids]
    payload = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in ordered).encode("utf-8")
    args.output.write_bytes(payload)
    receipt = {
        "schema": "bitagent.referral_prediction_combination.v1",
        "candidate": args.candidate,
        "rows": len(ordered),
        "prefix_rows": len(read_jsonl(args.prefix)),
        "shard_count": len(args.shard),
        "output_sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
    }
    args.output.with_suffix(".receipt.json").write_bytes((json.dumps(receipt, indent=2) + "\n").encode("utf-8"))
    print(json.dumps(receipt, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
