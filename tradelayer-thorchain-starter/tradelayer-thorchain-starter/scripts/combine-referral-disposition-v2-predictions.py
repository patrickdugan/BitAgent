"""Combine sharded v2 disposition predictions in frozen request order."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--requests", type=Path, required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--shard", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    requests = read_jsonl(args.requests)
    rows = [row for shard in args.shard for row in read_jsonl(shard)]
    by_id: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row.get("candidate") != args.candidate:
            raise SystemExit("candidate mismatch in shard")
        item_id = row.get("item_id")
        if not isinstance(item_id, str) or item_id in by_id:
            raise SystemExit(f"missing or duplicate item id: {item_id}")
        by_id[item_id] = row
    expected_ids = [row["item_id"] for row in requests]
    if set(by_id) != set(expected_ids):
        raise SystemExit("shards do not cover the frozen request IDs exactly")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    data = "".join(json.dumps(by_id[item_id], ensure_ascii=False) + "\n" for item_id in expected_ids)
    args.output.write_bytes(data.encode("utf-8"))
    receipt = {
        "schema": "bitagent.referral_disposition_combination_receipt.v2",
        "candidate": args.candidate,
        "rows": len(expected_ids),
        "requests_sha256": sha256_file(args.requests),
        "output_sha256": sha256_file(args.output),
        "shard_sha256": [sha256_file(shard) for shard in args.shard],
    }
    args.output.with_suffix(".receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
