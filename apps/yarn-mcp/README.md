# YaRN-MCP

A Goose GDK app over your own chat history. It indexes a ChatGPT or Claude data export, finds the
themes you keep returning to, the research threads you picked up again on different days, and how
conversations connect, and serves all of it as MCP tools a Goose agent can query. It can also distill
part of the archive into one long-context packet under a token limit you set, with the YaRN rope
scaling needed to serve that packet on a model whose native window is too small.

Everything stays on this machine. The server is stdlib Python with SQLite (FTS5), the GDK host only
talks to loopback model servers, and packets are written under the archive home with API keys,
private keys, emails and phone numbers masked.

```
apps/yarn-mcp/
  python/yarn_mcp/    MCP stdio server: ingest, store (SQLite FTS5), analyze, distill, service, server
  src/                Rust GDK host (goose-agent 0.1.0-alpha.14): bin yarn-mcp
  skills/             GDK skills: yarn-explore (+ questions.md playbooks), yarn-distill
  tests/              synthetic export + server tests
  ci_smoke.py         end-to-end check of the binary against a scripted OpenAI-compatible endpoint
```

## Quick start

```powershell
cargo +stable-x86_64-pc-windows-msvc build --release
$y = "target\release\yarn-mcp.exe"
& $y ingest "$env:USERPROFILE\Downloads\<export>.zip"     # ChatGPT/Claude export zip, folder or json
& $y status
& $y "What themes do I keep coming back to?"              # agent run on the local model
& $y run --skill yarn-distill --args "thread R02 at 60000 tokens for qwen3"
& $y distill --theme T06 --token-limit 60000 --preset qwen3   # no model: direct tool call
```

The archive lives in `--home`, else `$YARN_MCP_HOME`, else `~/.yarn-mcp`. `--python` (or
`$YARN_MCP_PYTHON`) picks the interpreter (3.10+, stdlib only); `--root` (or `$YARN_MCP_ROOT`) is this
directory and defaults to where the crate was built.

Agent runs use an OpenAI-compatible local server: `--base-url http://127.0.0.1:18090/v1 --model
inkling-2-mini` by default (the squid5080 Inkling server), `--tool-mode text` for servers without tool
calling. Each run prints one JSON receipt (tool calls and results, packets written, the `[c:...]`
citations in the answer, usage, transcript) and appends it to `<home>/receipts.jsonl`.

### From goose itself

`yarn-mcp serve` is the stdio MCP server with nothing else attached:

```powershell
goose session --with-extension "yarn:C:\path\to\yarn-mcp.exe serve --approve read-only --python C:\path\to\python.exe"
```

## Inputs

| export | what is read |
|---|---|
| ChatGPT data export | `conversations.json` or the sharded `conversations-000.json` ...; the main branch of each conversation (`current_node` back to the root), user and assistant text |
| Claude data export | `conversations.json` with `chat_messages` |
| JSONL | one conversation per line: `{"id", "title", "created", "messages": [{"role", "content"}]}` |
| notes | `.md` / `.txt` files, one document each, attributed to you |

A zip whose download was cut off (no central directory) is read from its local headers; every
conversations shard that is complete is used, with a warning. ChatGPT's inline markup is removed:
private-use citation markers, `<Cite/>`, layout components (`<box>`, `<row>`, ...), and `<Link>`
becomes a Markdown link. Skipped unless asked: reasoning (`--include-reasoning`), conversations marked
"do not remember" (`--include-do-not-remember`), hidden system context, tool output and regenerated
branches. Ingesting a newer export replaces conversations with the same id.

## Tools

| tool | read-only | what it returns |
|---|---|---|
| `archive_status` | yes | counts, date span, sources, themes, threads, packet settings |
| `search` | yes | FTS5 over every message (all words, then any word), grouped by conversation, with snippets; `role`, `since`, `until` filters |
| `list_themes` | yes | themes with label, terms, size, span, `user_share` (how much of the text you wrote); sort by size, recent or personal |
| `theme_card` | yes | members, related themes, threads inside, activity by month |
| `research_threads` | yes | lines of inquiry held on two or more days, in time order; filter by theme or query |
| `connections` | yes | a conversation's neighbours and the terms that link them; a term's themes and co-terms; the conversations that bridge two themes |
| `timeline` | yes | monthly activity for a term, a theme or the archive |
| `get_conversation` | yes | one conversation clipped to `max_tokens`, long messages cut head and tail |
| `distill_yarn` | no | writes a packet; returns its manifest and YaRN plan |
| `ingest_export` | no | indexes an export (only offered with `--approve all`) |

Conversations are cited `[c:<id>]`, the shortest id prefix of at least 8 characters that is unique in
the archive; every tool that takes a conversation accepts it.

How the index is built: each conversation is a TF-IDF vector over words and word pairs (your messages
count twice, titles three times, code blocks and URLs are ignored). Themes are spherical k-means
(k = sqrt(n/2), fixed seed); a conversation close to a second theme is listed there too. Links are
cosine nearest neighbours with the terms that make them. A research thread is a group joined by
mutual-neighbour links that share at least two distinct words, held on at least two days. These are
term statistics: labels can be noisy, and the skills tell the model to separate what the index
computed from what a conversation says.

## Packets, the token limit and YaRN

`distill_yarn` (or `yarn-mcp distill`) takes a scope (`query`, `theme`, `thread`, `conversations`, or
nothing for the whole archive, themes round-robin) and a `token_limit`. The packet is Markdown: a map
of the themes and threads it covers, then an excerpt of each conversation in relevance order (time
order for a thread), omitted messages marked. Bigger limits go wider (about one conversation per
1000 tokens) before going deeper.

The limit is clamped twice:

- by the server ceiling, `--max-packet-tokens` (default 131072);
- by what YaRN can reach for the target model: `native_ctx x max_yarn_factor - reserve_tokens`
  (defaults 32768 x 4 - 4096 = 126976). Past that the manifest says `clamp_reason: context does not
  permit` and the packet is built at the reachable size.

The manifest's `yarn` block: `needed: false` when packet plus reserve fits the native window;
otherwise the integer factor and context, with the serving settings:

```json
"llama_cpp": ["--rope-scaling", "yarn", "--rope-scale", "2", "--yarn-orig-ctx", "32768", "-c", "65536"],
"hf_rope_scaling": {"rope_type": "yarn", "factor": 2.0, "original_max_position_embeddings": 32768},
"vllm": ["--rope-scaling", "{...}", "--max-model-len", "65536"]
```

Static YaRN applies to every request on that server, so serve a packet from its own instance.
Presets: `--preset qwen3`, `qwen2.5` (32768 native, factor up to 4, per their model cards); any other
model takes `--native-ctx` and `--max-yarn-factor`. Token counts are an estimate (about 3.8 ASCII
characters per token) unless `--tokenize-url http://127.0.0.1:PORT/tokenize` points at the target
model's llama.cpp server, which makes them exact (`token_counter: tokenize`).

## Approval

`--approve read-only` (search and read), `packets` (default: also `distill_yarn`), `all` (also
`ingest_export`). Tools above the level are not offered to the model, and a call to one is refused.
A call identical to one that already failed twice is refused with the last error.

## Build and test

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo +stable-x86_64-pc-windows-msvc build
cargo +stable-x86_64-pc-windows-msvc test
python -m unittest discover -s tests
python -I ci_smoke.py target\debug\yarn-mcp.exe --python <python 3.10+>
```

Verified 2026-11-29 on Windows: 20 server tests, 7 Rust tests, and `ci_smoke.py` (ingest of a cut-off
synthetic export, status, two direct distills, a refused ingest, a native-tool agent run through
`/yarn-explore` with seven tool calls and a packet, a text-protocol read-only run) pass. On a real
1.36 GB ChatGPT export whose download had stopped before the central directory (1,308 conversations
in 14 shards): ingest and analysis in 25-90 s, 26 themes, 43 threads, a packet of any size in under
a second, and `serve` answers MCP over stdio.
