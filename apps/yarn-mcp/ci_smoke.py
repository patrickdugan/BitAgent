"""End-to-end check of the yarn-mcp binary on a synthetic export and a scripted OpenAI-compatible endpoint.

    python -I ci_smoke.py PATH/TO/yarn-mcp [--python PY]

1. `yarn-mcp ingest` indexes the synthetic export (tests/synth.py) into a temporary home.
2. `yarn-mcp status` and `yarn-mcp distill` call the server directly (no model).
3. Run 1 (native tool calls, default --approve packets): `/yarn-explore` loads the skill; the scripted
   model loads the playbook, calls archive_status, list_themes, research_threads, connections, an
   ingest_export the app must deny at this level, distill_yarn with a token limit, then answers with
   citations taken from tool results.
4. Run 2 (--tool-mode text, --approve read-only): the text protocol, with write tools hidden.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

APP = Path(__file__).resolve().parent
sys.path.insert(0, str(APP / "tests"))
import synth  # noqa: E402

SEEN: list[dict[str, Any]] = []


def tool_results(messages: list[dict[str, Any]]) -> list[Any]:
    found = []
    for message in messages:
        if message.get("role") == "tool":
            try:
                found.append(json.loads(message.get("content") or ""))
            except ValueError:
                found.append({"text": message.get("content")})
    return found


def call(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return {"tool": name, "arguments": arguments}


def native_script(messages: list[dict[str, Any]]) -> dict[str, Any] | str:
    results = tool_results(messages)
    done = len(results)
    if done == 0:
        return call("load_skill", {"name": "yarn-explore/questions.md"})
    if done == 1:
        return call("archive_status", {})
    if done == 2:
        return call("list_themes", {"sort": "personal"})
    if done == 3:
        return call("research_threads", {"query": "covenant"})
    if done == 4:
        thread = results[3]["threads"][0]
        return call("connections", {"conversation": thread["members"][0]["cite"]})
    if done == 5:
        return call("ingest_export", {"path": "elsewhere.zip"})
    if done == 6:
        return call("distill_yarn", {"thread": results[3]["threads"][0]["thread"], "token_limit": 3000,
                                     "model": "qwen3"})
    linked = results[4]["linked"][0]
    return (f"The covenant thread {results[3]['threads'][0]['thread']} starts at "
            f"[{results[4]['conversation']['cite']}] and links to [{linked['cite']}] via {', '.join(linked['via'][:2])}. "
            f"Packet: {results[6]['packet_tokens']} tokens.")


def text_script(messages: list[dict[str, Any]]) -> str:
    if not any(m.get("role") != "system" and "<tool_response>" in str(m.get("content")) for m in messages):
        return '<tool_call>\n{"name": "search", "arguments": {"query": "levain"}}\n</tool_call>'
    return "Levain comes up in the sourdough conversations."


class Endpoint(BaseHTTPRequestHandler):
    mode = "native"

    def log_message(self, *args: Any) -> None:
        pass

    def _send(self, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        self._send({"object": "list", "data": [{"id": "scripted", "object": "model"}]})

    def do_POST(self) -> None:
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        SEEN.append(request)
        reply = native_script(request["messages"]) if type(self).mode == "native" else text_script(request["messages"])
        message: dict[str, Any] = {"role": "assistant", "content": None}
        finish = "stop"
        if isinstance(reply, dict):
            message["tool_calls"] = [{"id": f"call_{len(SEEN)}", "type": "function", "function": {
                "name": reply["tool"], "arguments": json.dumps(reply["arguments"])}}]
            finish = "tool_calls"
        else:
            message["content"] = reply
        self._send({"id": f"cmpl-{len(SEEN)}", "object": "chat.completion", "model": request.get("model"),
                    "choices": [{"index": 0, "message": message, "finish_reason": finish}],
                    "usage": {"prompt_tokens": 100, "completion_tokens": 10, "total_tokens": 110}})


def run(binary: str, *argv: str, check: bool = True) -> subprocess.CompletedProcess:
    done = subprocess.run([binary, *argv], capture_output=True, text=True, encoding="utf-8", timeout=600,
                          stdin=subprocess.DEVNULL)
    if check:
        assert done.returncode == 0, f"{argv[0]}: exit {done.returncode}\n{done.stdout[-2000:]}\n{done.stderr[-4000:]}"
    return done


def main() -> int:
    binary = sys.argv[1]
    python = sys.argv[sys.argv.index("--python") + 1] if "--python" in sys.argv else sys.executable
    server = ThreadingHTTPServer(("127.0.0.1", 0), Endpoint)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        export = synth.write_zip(Path(tmp) / "export.zip", truncate=True)
        common = ["--root", str(APP), "--python", python, "--home", str(home)]
        ingest = json.loads(run(binary, "ingest", str(export), *common).stdout)
        assert ingest["ingest"]["kept"] == 26 and ingest["analysis"]["themes"] >= 3, ingest
        status = json.loads(run(binary, "status", *common).stdout)
        assert status["conversations"] == 26 and status["packets"]["token_limit"] == 32000, status
        packet = json.loads(run(binary, "distill", "--query", "levain", "--token-limit", "1200", *common).stdout)
        assert packet["packet_tokens"] <= 1200 and Path(packet["packet_path"]).is_file(), packet
        clamped = json.loads(run(binary, "distill", "--token-limit", "900000", "--native-ctx", "2048",
                                 "--max-yarn-factor", "2", "--reserve-tokens", "1000", *common).stdout)
        assert clamped["clamped"] and clamped["token_limit"] == 3096, clamped
        denied = run(binary, "call", "ingest_export", json.dumps({"path": str(export)}), *common, check=False)
        assert denied.returncode == 2 and "unknown_tool" in denied.stderr, (denied.returncode, denied.stderr)

        agent = [*common, "--base-url", f"http://127.0.0.1:{port}/v1", "--model", "scripted", "--timeout-secs", "120"]
        receipt = json.loads(run(binary, "run", "--skill", "yarn-explore", "--args", "how did covenants develop?",
                                 *agent).stdout.strip().splitlines()[-1])
        first = json.dumps(SEEN[0]["messages"])
        assert "# Loaded Skill: yarn-explore" in first and "/yarn-explore how did covenants develop?" in first
        offered = {t["function"]["name"] for t in SEEN[0]["tools"]}
        assert {"load_skill", "search", "distill_yarn", "connections"} <= offered, sorted(offered)
        assert "ingest_export" not in offered, "ingest must be hidden below --approve all"
        calls = receipt["toolCalls"]
        assert [c["name"] for c in calls] == ["load_skill", "archive_status", "list_themes", "research_threads",
                                              "connections", "ingest_export", "distill_yarn"], calls
        assert [i for i, c in enumerate(calls) if not c["ok"]] == [5], calls
        assert "not a YaRN-MCP tool" in calls[5]["result"], calls[5]
        assert receipt["packets"][0]["tokens"] <= 3000 and receipt["packets"][0]["yarnFactor"] == 1.0, receipt["packets"]
        assert len(receipt["citations"]) == 2 and all(c.startswith("c:covenants-") for c in receipt["citations"]), (
            receipt["citations"], receipt["answer"])
        receipts = (home / "receipts.jsonl").read_text(encoding="utf-8").splitlines()
        assert len(receipts) == 1

        Endpoint.mode = "text"
        SEEN.clear()
        text = json.loads(run(binary, "Where", "did", "I", "write", "about", "levain?", "--tool-mode", "text",
                              "--approve", "read-only", *agent).stdout.strip().splitlines()[-1])
        assert "tools" not in SEEN[0] or not SEEN[0]["tools"], "text mode must not send native tools"
        system = SEEN[0]["messages"][0]["content"]
        assert "\n- search:" in system and "\n- distill_yarn:" not in system, system[:3000]
        assert [c["name"] for c in text["toolCalls"]] == ["search"] and text["toolCalls"][0]["ok"], text["toolCalls"]
        assert text["prompt"] == "Where did I write about levain?" and text["approve"] == "read-only"
        print(json.dumps({"ok": True, "themes": ingest["analysis"]["themes"], "threads": ingest["analysis"]["threads"],
                          "native_calls": len(calls), "packet_tokens": receipt["packets"][0]["tokens"],
                          "citations": sorted(receipt["citations"]), "text_calls": len(text["toolCalls"])}))
    server.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
