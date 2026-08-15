#!/data/data/com.termux/files/usr/bin/python
"""Candidate-only BitAgent client for the Hermes Termux skill."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE_URL = "http://127.0.0.1:8787"
MAX_RESPONSE_BYTES = 1_000_000


def request(method: str, path: str, body: dict[str, object] | None = None) -> object:
    encoded = None if body is None else json.dumps(body).encode("utf-8")
    call = Request(
        BASE_URL + path,
        data=encoded,
        method=method,
        headers={"content-type": "application/json"},
    )
    try:
        with urlopen(call, timeout=10) as response:
            payload = response.read(MAX_RESPONSE_BYTES + 1)
            if len(payload) > MAX_RESPONSE_BYTES:
                raise RuntimeError("BitAgent response exceeded 1 MiB")
            return json.loads(payload.decode("utf-8"))
    except HTTPError as error:
        detail = error.read(16_384).decode("utf-8", errors="replace")
        raise RuntimeError(f"BitAgent HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise RuntimeError(f"BitAgent unavailable at {BASE_URL}: {error.reason}") from error


def candidate_file(path: str) -> object:
    candidate_path = Path(path).expanduser().resolve(strict=True)
    if candidate_path.stat().st_size > 256_000:
        raise RuntimeError("Candidate file exceeds 256 KiB")
    return json.loads(candidate_path.read_text(encoding="utf-8"))


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser("health")
    start = commands.add_parser("start")
    start.add_argument("--network", choices=("bitcoin-testnet4", "bitcoin"), default="bitcoin-testnet4")
    get = commands.add_parser("get")
    get.add_argument("workflow_id")
    for name in ("plan", "task"):
        item = commands.add_parser(name)
        item.add_argument("workflow_id")
        item.add_argument("message")
    validate = commands.add_parser("validate")
    validate.add_argument("workflow_id")
    validate.add_argument("message")
    validate.add_argument("candidate_file")
    return root


def main() -> int:
    args = parser().parse_args()
    if args.command == "health":
        result = request("GET", "/api/dag-runtime")
    elif args.command == "start":
        result = request("POST", "/api/workflows", {"network": args.network})
    elif args.command == "get":
        result = request("GET", f"/api/workflows/{args.workflow_id}")
    elif args.command == "plan":
        result = request(
            "POST",
            f"/api/workflows/{args.workflow_id}/message",
            {"message": args.message},
        )
    elif args.command == "task":
        result = request(
            "POST",
            f"/api/workflows/{args.workflow_id}/dag-task",
            {"message": args.message},
        )
    else:
        result = request(
            "POST",
            f"/api/workflows/{args.workflow_id}/dag-candidate",
            {"message": args.message, "candidate": candidate_file(args.candidate_file)},
        )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
