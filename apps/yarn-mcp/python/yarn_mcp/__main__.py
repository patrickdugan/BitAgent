"""YaRN-MCP command line.

    python -m yarn_mcp serve  [--home DIR] [--read-only] [--allow-ingest] [packet options]
    python -m yarn_mcp ingest PATH [--home DIR] [--include-reasoning] [--include-do-not-remember]
    python -m yarn_mcp call TOOL [JSON_ARGS] [--home DIR] [packet options]

Packet options: --token-limit N (default packet size), --max-packet-tokens N (ceiling),
--native-ctx N, --max-yarn-factor F, --reserve-tokens N, --tokenize-url URL (loopback /tokenize
for exact counts), --no-redact.

The archive lives in --home, else $YARN_MCP_HOME, else ~/.yarn-mcp. Nothing leaves this machine.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .server import serve
from .service import Service, ToolError


def default_home() -> Path:
    return Path(os.environ.get("YARN_MCP_HOME") or Path.home() / ".yarn-mcp")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="yarn_mcp")
    parser.add_argument("command", choices=["serve", "ingest", "call"])
    parser.add_argument("target", nargs="?")
    parser.add_argument("arguments", nargs="?", default="{}")
    parser.add_argument("--home", type=Path, default=None)
    parser.add_argument("--read-only", action="store_true")
    parser.add_argument("--allow-ingest", action="store_true")
    parser.add_argument("--token-limit", type=int, default=32000)
    parser.add_argument("--max-packet-tokens", type=int, default=131072)
    parser.add_argument("--native-ctx", type=int, default=32768)
    parser.add_argument("--max-yarn-factor", type=float, default=4.0)
    parser.add_argument("--reserve-tokens", type=int, default=4096)
    parser.add_argument("--tokenize-url", default=None)
    parser.add_argument("--no-redact", action="store_true")
    parser.add_argument("--include-reasoning", action="store_true")
    parser.add_argument("--include-do-not-remember", action="store_true")
    args = parser.parse_args(argv)
    service = Service(
        args.home or default_home(), read_only=args.read_only,
        allow_ingest=args.allow_ingest or args.command == "ingest", token_limit=args.token_limit,
        max_packet_tokens=args.max_packet_tokens, native_ctx=args.native_ctx, max_yarn_factor=args.max_yarn_factor,
        reserve_tokens=args.reserve_tokens, tokenize_url=args.tokenize_url, redact=not args.no_redact)
    if args.command == "serve":
        serve(service)
        return 0
    try:
        if args.command == "ingest":
            if not args.target:
                parser.error("ingest needs PATH")
            result = service.call("ingest_export", {"path": args.target, "include_reasoning": args.include_reasoning,
                                                    "include_do_not_remember": args.include_do_not_remember})
        else:
            if not args.target:
                parser.error("call needs TOOL")
            result = service.call(args.target, json.loads(args.arguments))
    except ToolError as exc:
        print(json.dumps({"error": exc.code, "detail": exc.detail}), file=sys.stderr)
        return 2
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
