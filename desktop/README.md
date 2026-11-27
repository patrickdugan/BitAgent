# BitAgent Desktop

A native desktop app for BitAgent, built as a Goose GDK app: a `goose-agent` state machine
(`=0.1.0-alpha.14`, the same GDK pin as Pocket Goblin and Receipt Goblin in HybridTRMLDT
`MCP/goose_gdk_app`) drives BitAgent's candidate-only MCP tools with a model running on this
machine. It is the desktop counterpart of the Android app in [`../android`](../android).

- `bitagent-desktop`: the window (Rust, egui/eframe 0.37).
- `bitagent-cli`: the same agent without the window, for Goose-harness runs, scripts and CI. It
  writes one JSON receipt per prompt.

## Models

The catalog is [`models.json`](models.json). Every GGUF is pinned to a Hugging Face revision,
byte count and SHA-256, and the window's **Download** button verifies all three before it keeps
a file.

| id | model | runner | tool calls | GPU lease |
|---|---|---|---|---|
| `inkling-2-mini` | Inkling 2 Mini | squid5080 fast runner (squid5090 on the RTX 5080, in WSL) | text protocol | 15,000 MiB |
| `bonsai-2.5-27b` | Ternary Bonsai 2.5 27B, PTQ1_0 + MTP | PrismML llama.cpp prism-b12178 | native | 10,000 MiB |
| `bonsai-2-27b` | Ternary Bonsai 2 27B, PTQ1_0 | prism-b12178 | native | 10,000 MiB |
| `bonsai-2-9b` | Ternary Bonsai 2 9B, PTQ1_0 | prism-b12178 | native | 5,000 MiB |
| `bonsai-2-4b` | Ternary Bonsai 2 4B, PTQ1_0 | prism-b12178 | native | 3,500 MiB |
| `bonsai-2-2b` | Ternary Bonsai 2 2B, PTQ1_0 | prism-b12178 | native | 2,500 MiB |
| `bonsai-8b` | Bonsai 8B, 1-bit Q1_0 | prism-b12178 | native | 3,500 MiB |
| `custom-openai` | any OpenAI-compatible server you run | none | native | none |

**Start** launches the model's server. A llama.cpp server runs behind a vramorama lease when
`programs.vramorama` exists, so it queues behind other GPU jobs instead of competing with them.
Inkling runs through `~/tools/squid5080/serve.sh`, which takes its own lease. The window stops
every server it started when it closes. Logs go to `%LOCALAPPDATA%\BitAgentDesktop\logs`.

squid5090 has no OpenAI tool calling, so Inkling gets BitAgent's tools through a text protocol.
The tools are listed in the system prompt, the model writes
`<tool_call>{"name": ..., "arguments": {...}}</tool_call>`, and results come back as
`<tool_response>` text. Calls are parsed into goose tool requests, so approval and dispatch are
the same as in native mode.

## The agent

One `StateMachine` per run, over a conversation the app keeps:

1. `TextToolCalls`: `<tool_call>` text becomes goose tool requests.
2. `ToolApprovalOperation`: read-only BitAgent tools run. Any other tool shows an approval card
   in the window. A headless run denies it unless `--approve all` is given.
3. `ToolOperation`: BitAgent's MCP server (`scripts/chatgpt-plugin-server.ts --stdio` in
   `apps/bitagent-launch-kernel`) as a goose `ToolProvider`.
4. `UnhandledToolCallsOperation`, then `MaxTurnsOperation` (12 model turns per message).
5. The desktop instructions plus the MCP server's own instructions as prompt parts.
6. `InferenceRunner` over `goose-providers`' OpenAI-compatible client.

The authority boundary is BitAgent's. Every tool is candidate-only: none can sign, broadcast,
approve on the person's behalf or move funds. The app never asks for keys or seed phrases.

## Build and run

The Windows build needs the MSVC toolchain. The GNU toolchain lacks `dlltool`.

```powershell
cd desktop
cargo +stable-x86_64-pc-windows-msvc build --release
.\target\release\bitagent-desktop.exe
```

BitAgent's tools need Node and the launch kernel's dependencies (`npm ci` in
`apps/bitagent-launch-kernel`). If `node` is not on PATH, set `bitagent.node` in `models.json`
or `BITAGENT_NODE`. `BITAGENT_KERNEL_DIR` and `BITAGENT_DESKTOP_CONFIG` override the kernel path
and the catalog.

Headless:

```powershell
.\target\release\bitagent-cli.exe --list-models
.\target\release\bitagent-cli.exe --once "What is BitAgent?" --model bonsai-2-4b --start-server
.\target\release\bitagent-cli.exe --download bonsai-2-9b
```

`--once` prints a receipt: the answer, each tool call with its arguments, outcome and result,
any pending approvals, and token usage.

## Tests

```powershell
cargo +stable-x86_64-pc-windows-msvc test
python ci_smoke.py target\debug\bitagent-cli.exe ..\apps\bitagent-launch-kernel [NODE]
```

`ci_smoke.py` stands in for the model with a scripted OpenAI-compatible stub and runs the real
BitAgent MCP server. It checks a native tool call, a text-protocol call (no `tools` field; the
result is returned as `<tool_response>`), and that `bitagent_practice_start` is denied in a
headless run.
