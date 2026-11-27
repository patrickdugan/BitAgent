"""End-to-end smoke test for bitagent-cli against BitAgent's real MCP server and a scripted model.

A local OpenAI-compatible stub plays the model: its first reply calls a BitAgent tool, its second
answers in text. Three runs check, from the JSON receipts and the requests the stub saw:

  native   the call arrives as OpenAI tool_calls, `tools` is in the request, bitagent_overview runs
  text     no `tools` field, the tool list is in the system prompt, a <tool_call> block in the reply
           runs, and the result comes back to the model as <tool_response> text
  denied   bitagent_practice_start (not read-only) is denied in a headless run without --approve all

usage: python ci_smoke.py BITAGENT_CLI KERNEL_DIR [NODE]
"""

import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FINAL = "BitAgent is a candidate-only onboarding agent; your wallet approves every action."


class Stub:
    def __init__(self, tool, args, mode):
        self.tool, self.args, self.mode, self.requests = tool, args, mode, []

    def reply(self, body):
        self.requests.append(body)
        messages = body.get("messages", [])
        answered = any(m.get("role") == "tool" for m in messages) or any(
            "<tool_response>" in str(m.get("content")) for m in messages if m.get("role") == "user"
        )
        if answered:
            message = {"role": "assistant", "content": FINAL}
            finish = "stop"
        elif self.mode == "native":
            message = {
                "role": "assistant",
                "content": None,
                "tool_calls": [{"id": "call_1", "type": "function",
                                "function": {"name": self.tool, "arguments": json.dumps(self.args)}}],
            }
            finish = "tool_calls"
        else:
            call = json.dumps({"name": self.tool, "arguments": self.args})
            message = {"role": "assistant", "content": f"Checking.\n<tool_call>\n{call}\n</tool_call>"}
            finish = "stop"
        return {
            "id": f"stub-{len(self.requests)}", "object": "chat.completion", "created": 0, "model": "stub",
            "choices": [{"index": 0, "message": message, "finish_reason": finish}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 10, "total_tokens": 110},
        }


def serve(stub):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, payload):
            data = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self._send({"object": "list", "data": [{"id": "stub", "object": "model"}]})

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            self._send(stub.reply(body))

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def run(cli, kernel, node, mode, tool, args):
    stub = Stub(tool, args, mode)
    server = serve(stub)
    command = [cli, "--once", "What is BitAgent?", "--model", "custom-openai",
               "--base-url", f"http://127.0.0.1:{server.server_port}/v1/", "--served-model", "stub",
               "--tool-mode", mode, "--kernel-dir", kernel, "--timeout-secs", "60"]
    if node:
        command += ["--node", node]
    done = subprocess.run(command, capture_output=True, text=True, timeout=180, stdin=subprocess.DEVNULL)
    server.shutdown()
    if done.returncode != 0:
        sys.exit(f"[{mode}] bitagent-cli exited {done.returncode}\n{done.stdout}\n{done.stderr}")
    return json.loads(done.stdout.strip().splitlines()[-1]), stub.requests


def check(condition, label):
    print(("ok   " if condition else "FAIL ") + label)
    return condition


def main():
    cli, kernel = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
    node = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("BITAGENT_NODE")
    passed = True

    receipt, requests = run(cli, kernel, node, "native", "bitagent_overview", {})
    calls = receipt["toolCalls"]
    passed &= check(bool(requests) and "tools" in requests[0] and len(requests[0]["tools"]) == 8, "native: 8 tools offered")
    passed &= check(len(calls) == 1 and calls[0]["name"] == "bitagent_overview" and calls[0]["ok"], "native: overview ran")
    passed &= check("candidate" in (calls[0].get("result") or "").lower() if calls else False, "native: result is BitAgent's")
    passed &= check(receipt["answer"] == FINAL and receipt["inferenceCalls"] == 2, "native: final answer after 2 calls")

    receipt, requests = run(cli, kernel, node, "text", "bitagent_overview", {})
    calls = receipt["toolCalls"]
    system = requests[0]["messages"][0]["content"] if requests else ""
    passed &= check(bool(requests) and "tools" not in requests[0], "text: no tools field")
    passed &= check("<tool_call>" in system and "bitagent_money_plan" in system, "text: tool list in system prompt")
    passed &= check(len(calls) == 1 and calls[0]["ok"], "text: <tool_call> ran")
    second = requests[1]["messages"] if len(requests) > 1 else []
    passed &= check(any(m["role"] == "user" and "<tool_response>" in str(m["content"]) for m in second)
                    and not any(m["role"] == "tool" for m in second), "text: result returned as <tool_response>")
    passed &= check(receipt["answer"] == FINAL, "text: final answer")

    receipt, _ = run(cli, kernel, node, "native", "bitagent_practice_start", {"practiceDepositSats": 20000})
    calls = receipt["toolCalls"]
    passed &= check(len(calls) == 1 and calls[0]["ok"] is False and "approval" in (calls[0]["result"] or ""),
                    "denied: practice_start needs approval headless")

    print(json.dumps({"passed": bool(passed)}))
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
