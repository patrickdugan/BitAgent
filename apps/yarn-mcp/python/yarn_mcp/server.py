"""MCP stdio server (newline-delimited JSON-RPC 2.0, protocol 2025-06-18). Stdout carries frames only."""

from __future__ import annotations

import json
import sys
from typing import IO, Any

from .service import Service, ToolError

PROTOCOL = "2025-06-18"
VERSION = "0.1.0"
INSTRUCTIONS = (
    "YaRN-MCP: a personal chat archive (exported ChatGPT/Claude conversations) indexed for themes, research "
    "threads and interconnections. Start with archive_status or list_themes; use search for specifics, "
    "theme_card / research_threads / connections to trace how ideas link and recur, get_conversation to read. "
    "Cite conversations as [c:<id>] exactly as tools return them, and never state a theme, date or quote a tool "
    "did not return. distill_yarn writes a long-context packet under a token limit and returns the YaRN plan for "
    "serving it."
)


def _result(payload: dict[str, Any], error: bool = False) -> dict[str, Any]:
    text = json.dumps(payload, ensure_ascii=False)
    return {"content": [{"type": "text", "text": text}], "structuredContent": payload, "isError": error}


def handle(service: Service, message: dict[str, Any]) -> dict[str, Any] | None:
    if "id" not in message:
        return None
    method = message.get("method")
    params = message.get("params") or {}
    reply: dict[str, Any] = {"jsonrpc": "2.0", "id": message["id"]}
    if method == "initialize":
        reply["result"] = {"protocolVersion": PROTOCOL, "capabilities": {"tools": {"listChanged": False}},
                           "serverInfo": {"name": "yarn-mcp", "version": VERSION}, "instructions": INSTRUCTIONS}
    elif method == "ping":
        reply["result"] = {}
    elif method == "tools/list":
        reply["result"] = {"tools": service.tools()}
    elif method == "tools/call":
        try:
            reply["result"] = _result(service.call(str(params.get("name")), params.get("arguments")))
        except ToolError as exc:
            reply["result"] = _result({"error": exc.code, "detail": exc.detail}, error=True)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            reply["result"] = _result({"error": "internal_error", "detail": f"{type(exc).__name__}: {exc}"}, True)
    else:
        reply["error"] = {"code": -32601, "message": f"method not found: {method}"}
    return reply


def serve(service: Service, reader: IO[bytes] = sys.stdin.buffer, writer: IO[bytes] = sys.stdout.buffer) -> None:
    for raw in reader:
        line = raw.decode("utf-8", errors="replace").strip()
        if not line:
            continue
        try:
            message = json.loads(line)
            if not isinstance(message, dict):
                raise ValueError("not an object")
        except ValueError:
            response: dict[str, Any] | None = {"jsonrpc": "2.0", "id": None,
                                               "error": {"code": -32700, "message": "parse error"}}
        else:
            response = handle(service, message)
        if response is not None:
            writer.write((json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8"))
            writer.flush()
