# BitAgent ChatGPT plugin

Status: candidate-only onboarding surface, 2026-10-01. Protocol and widget are
tested locally; the plugin has not yet been connected to a live ChatGPT
session.

## Outcome

A ChatGPT plugin (an MCP server, which is what ChatGPT Plugins are today) that
takes a person who has never used BitAgent from "what is this?" to a running
self-hosted copy, and gives ChatGPT a safe way to research trading-system
ideas against BitAgent's real risk engine.

```text
ChatGPT conversation
  -> bitagent_overview            what it is, and the rules ChatGPT must follow
  -> bitagent_money_plan          the person's own limits, or a hold
  -> bitagent_practice_*          scripted rehearsal, stops before approval
  -> bitagent_self_host_plan      download + run on their own device
  -> handoff sentence             typed into the self-hosted BitAgent
  -> wallet approval              only ever on the person's own device

  -> bitagent_research_brief      Strategy Covenant limits and research protocol
  -> bitagent_research_stress_test  draft + hypothetical scenarios -> real allocator
```

ChatGPT never approves, signs, executes, verifies, connects a wallet, or
records a deposit. The plugin exposes no tool that can.

## Run it

```powershell
npm run chatgpt:plugin
```

- MCP endpoint: `http://127.0.0.1:8791/mcp` (Streamable HTTP, stateless JSON
  responses, no session id, no server-initiated stream).
- Local harness: `http://127.0.0.1:8791/preview` calls the endpoint and renders
  each result in the widget the way a host would. It is served only when the
  server is bound to loopback, or when `BITAGENT_CHATGPT_PREVIEW=true`.
- Stdio: `npx tsx scripts/chatgpt-plugin-server.ts --stdio` speaks
  newline-delimited JSON-RPC. Do not use `npm run` for stdio; its banner lines
  corrupt the stream.

```powershell
npm run test:chatgpt
```

Configuration is environment-only and listed at the end of `.env.example`.
The scripts do not load `.env`; set the variables in the shell.

## Connect it to ChatGPT

ChatGPT needs to reach the endpoint. There are two ways.

1. **Hosted concierge (the path for new users).** Deploy this server at a
   public HTTPS address with `BITAGENT_CHATGPT_HOST=0.0.0.0` behind a TLS
   proxy. In ChatGPT: Settings -> Security and login -> turn on Developer mode,
   then ChatGPT Plugins -> plus -> Connection: Public endpoint, and enter the
   URL including `/mcp`. A host without the sibling protocol libraries serves
   every tool except the practice sandbox, which reports `practice_unavailable`.
2. **Your own BitAgent through a Secure MCP Tunnel (operators).** Create a
   tunnel in the OpenAI Platform tunnel settings, run OpenAI's `tunnel-client`
   with `--mcp-command "npx tsx scripts/chatgpt-plugin-server.ts --stdio"` from
   this directory, and choose Connection: Tunnel in ChatGPT Plugins. The
   connection is outbound-only; nothing is exposed to the internet. The
   tunnel guide also documents an HTTP upstream (`--mcp-server-url`); that form
   was not exercised here.

After changing tools or the widget, restart the server and press Refresh on
the connection in ChatGPT Plugins.

References: OpenAI Apps SDK "Build your MCP server", "Connect and test your
plugin", and "Secure MCP Tunnel" guides.

## Tools

| Tool | Writes state | What the host does |
| --- | --- | --- |
| `bitagent_overview` | no | Product facts, journey, authority boundary, default `UNKNOWN`/`NONE` compliance state. |
| `bitagent_self_host_plan` | no | Ordered steps and exact commands for Windows, macOS, Linux, or Android. Android model sizes and SHA-256 values are read from `android/model-package.lock.json`. |
| `bitagent_money_plan` | no | Slot-filling money dialogue: returns the next exact question, a hold, or the person's own limits. |
| `bitagent_practice_start` | sandbox only | Scripted workflow with a pretend wallet and a host-scripted confirmed deposit. |
| `bitagent_practice_simulate` | sandbox only | `simulateStrategy` or `simulateWithdrawal` on the scripted kernel; returns exact effects and fees. |
| `bitagent_practice_status` | no | Re-reads a practice run. |
| `bitagent_research_brief` | no | Strategy Covenant limits, allocation math, research protocol. |
| `bitagent_research_stress_test` | no | Validates a covenant draft and replays hypothetical scenarios through the real allocator and verifier. |

Every tool sets `destructiveHint: false` and `openWorldHint: false`. Inputs are
validated against exactly the JSON Schema published to ChatGPT
(`src/chatgpt/schema.ts`), with unknown fields rejected.

## Money-management dialogue

`bitagent_money_plan` is deterministic. ChatGPT passes only answers the person
actually gave; the host returns one of:

- `needs_answers`: the remaining questions, word for word;
- `hold_view_only`: the money is borrowed or needed soon, or a short quoted
  statement trips `vulnerabilitySessionState` from `src/compliance/marketing.ts`.
  Statements are screened, never stored, and never echoed;
- `practice_only`: emergency savings below the guardrail, high-interest debt,
  or a budget that cannot cover fees;
- `limits_recorded`: budget, fee buffer, starter-strategy cap, and the rest
  kept spendable, with a `planHash` and a handoff sentence the self-hosted
  kernel's own intent parser accepts.

It never recommends an amount and always reports `fundedExecutionAllowed:
false`. Dollar figures appear only when the person states a BTC price, and are
labelled `user_declared_price_not_a_quote`.

## Trading-system research

ChatGPT does the open-ended research and reasoning. The server contributes the
part a language model should not improvise: BitAgent's actual limits and
arithmetic. A draft is turned into a canonical `StrategyCovenant` by
`createStrategyCovenant`, and each scenario runs through
`buildStrategyCandidate` and `verifyStrategyCandidate` unchanged.

The result is a what-if table (action, side, size, projected net delta, risk
flags, circuit breakers), never a candidate object: no candidate hash, covenant
hash, or approval reference leaves the host, so a replay cannot be mistaken
for, or fed into, the committed-signal lane. Scenario inputs are labelled
`model_hypothetical_not_market_data`.

Leverage is capped at 1x gross (10000 bps) on this surface. Compliance state is
`UNKNOWN` here, and the compliance skill's default for an unresolved session is
`leverage_permission: NONE`.

## Module map

| File | Role |
| --- | --- |
| `src/chatgpt/config.ts` | Every URL, origin, port, and guardrail constant. |
| `src/chatgpt/mcp.ts` | Dependency-free MCP JSON-RPC endpoint, server instructions, stdio transport. |
| `src/chatgpt/server.ts` | HTTP transport, origin allowlist, body limit, `/healthz`, `/preview`. |
| `src/chatgpt/tools.ts` | Tool definitions, schemas, annotations, widget metadata. |
| `src/chatgpt/selfHostPlan.ts`, `moneyPlan.ts`, `strategyResearch.ts`, `practiceSandbox.ts` | The four domains. |
| `chatgpt-ui/widget.html` | Self-contained MCP Apps widget (`text/html;profile=mcp-app`); loads and contacts nothing. |
| `chatgpt-ui/preview.html` | Local host harness. |

## Stubs, assumptions, and open seams

- **tradelayer.js download.** No public clone URL for the reviewed release is
  recorded in this repository, so the self-host plan says so instead of
  inventing one. Set `BITAGENT_PLUGIN_TRADELAYER_JS_URL` once one exists.
  Until then a new user cannot complete self-hosting unaided.
- **Self-hosting needs the sibling repos.** `npm run launch` fails at import
  time without `UTXO-Ref` and `tradelayer.js`. The plan therefore includes
  cloning them and setting `UTXO_REF_REPO` / `TRADELAYER_JS_REPO`; the root
  README's four-line quick start omits this.
- **Practice sandbox is lazy.** It imports the launch kernel only on first use
  so the other tools work on a host without the sibling repos.
- **Money guardrails are provisional product policy** (`moneyGuardrails` in
  `config.ts`): 3 months of emergency savings, a 3000-sat fee buffer, a 10%
  default and 25% maximum starter-strategy share. They need an owner decision.
- **Android app.** There is no signed public APK; the plan marks it as a
  build-from-source step.
- **No referral attribution.** The plugin does not issue or carry referral
  links. Referral copy stays behind the compliance and marketing skills.
- **No jurisdiction check.** The plugin never establishes eligibility; it
  stays in setup, practice, and research.
- **Public hosting hardening.** There is no rate limiting or authentication.
  Practice state is in-memory and capped at 500 runs. Put a reverse proxy in
  front of a public deployment.
- **Unverified against ChatGPT.** Tool metadata and the widget bridge follow
  the published Apps SDK reference, and the widget was exercised through the
  local harness in light, dark, and phone widths, but no live ChatGPT
  connection has been made.
- **Practice sandbox against the real kernel is unverified on the authoring
  machine.** That checkout had no `tradelayer.js`, so the suite exercised the
  sandbox through a fake kernel port and confirmed the fail-closed
  `practice_unavailable` path. On a host with both sibling repos the same test
  runs the real scripted kernel instead; run `npm run test:chatgpt` there.
