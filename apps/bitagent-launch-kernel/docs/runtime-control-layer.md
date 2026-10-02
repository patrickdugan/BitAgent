# Runtime control layer: one control module across Hermes and Goose

Status: design only, written 2026-10-01. Nothing in this document is
implemented. It proposes changes in four repositories (Control-Harness,
Hermes Lite, a Goose fork, BitAgent) and reuses types that already exist in
them.

## 0. Decisions in brief

1. **The control module is a separate process, not a plugin of either
   runtime.** Hermes Lite has no interception hooks at all, and Goose's hooks
   and inspectors fail open, cannot ask or rewrite, are skipped by code mode,
   and are switched off in subagents. Neither is a safe home for authority.
2. **Authority sits at the effect boundary.** Every consequential tool is
   served by one tool gateway the harness owns. The gateway commits an effect
   only against a one-shot lease issued by the control module. In-runtime
   interception adds provenance and blocks built-in tools; it is never the
   only line.
3. **The 12K ceiling is enforced outside the runtimes**, at a model proxy that
   counts tokens with the model server's own tokenizer. The two runtimes count
   tokens differently, and neither count is the model's.
4. **The persistent control thread is a long-lived controller conversation
   with a deterministic ledger underneath.** A second model conversation,
   hosted by the control module, reads rendered ledger events (never raw tool
   output) and retains the run contract, its own prior interventions, open
   authorization questions and a compact history of consequential actions. It
   can hold a call, question the principal, intervene with the actor or halt
   the run. It can never admit anything.
5. **Hermes Lite's phase contracts and typed validator (LDT) move into the
   control module** as a policy engine. That is what makes the specialized
   skills portable to Goose, which has no phase-contract concept.
6. **Three arms: clean Hermes Lite, modified Hermes Lite, modified Goose.**
   The modified arm is the local branch at `48743730`. The clean arm is
   Hermes Lite `main` at `b11821b1`, because the pinned commit `c12ddd46`
   exists neither locally nor on GitHub. Upstream Hermes is not an arm: it
   enforces a 64,000-token minimum context in code.
7. **Do not invent a fourth vocabulary.** The ledger envelope is
   Control-Harness's receipt record; run-contract state is BitAgent's
   `RunContract`, `RunBudgetState` and `GateVerdict`; the allow/deny and
   oracle split is RTG's gateway and mandate.

## 1. What was read

| Thing | Location | Revision |
|---|---|---|
| Hermes Agent (upstream) | `NousResearch/hermes-agent`, read over HTTP | `eb8d21f4` (2026-10-01) |
| Hermes Lite (your fork) | `C:\Users\patri\Documents\Codex\hermes-lite` | branch `bitagent-synthetic`, `48743730` |
| Goose | `aaif-goose/goose` (`block/goose` redirects), read over HTTP | `bab8ff64`, v1.53.0 |
| Control-Harness | `C:\Users\patri\Documents\GitHub\MoralityLabAI\Control-Harness` | branch `claude/live-actor-control-matrix` |
| BitAgent run contract and bench | `apps/bitagent-launch-kernel/src/{runcontract,bench}` | working tree, written today |
| RTG (Red Team Gladiatorics) | `Spiral/src/spiral_ln/rtg` | working tree, written today |

Things that shape the rest of this document:

- No Goose checkout or install exists on this machine, and no upstream Hermes
  checkout either.
- No file yet implements a controller conversation. The pieces it builds on
  are Hermes Lite's `LeanStateStore` (`events.jsonl` plus `snapshot.json`),
  its control-mesh receipts and 6K durable-summary lane, BitAgent's run
  contract and gate engine, and Control-Harness's receipt ledger.
- Other sessions were writing to BitAgent, Spiral and Control-Harness while
  this was read. Line numbers were correct when read.

### 1.1 Hermes Lite revisions

The fork (`patrickdugan/hermes-lite`, itself a fork of `m0at/hermes-lite`) is
a linear stack on `main`:

| Ref | Commit | Commits ahead of `main` |
|---|---|---|
| `main` | `b11821b1` | 0 |
| `feat/ultra-lean-trm-ldt-harness` | `218bc7c2` | 2 |
| `feat/bonsai-mcp-complexity-ladder-v0` | `18b50f82` | 34 |
| `feat/hermes-lite-12k-control-mesh-v1` | `b3ad2605` | 50 |
| `feat/bitagent-hermes-role-mesh-v0` (local `bitagent-synthetic`) | `48743730` | 63 |

- **`c12ddd46` is unavailable.** BitAgent's
  `config/bitagent-bonsai-dag-runtime.json` pins it, but it is not in the
  local pack and GitHub returns no such commit. It was probably made on
  another machine and never pushed. It is also not a clean revision: it
  carries a sidecar (`agent.bitagent_dag_model_sidecar_v1`) that the local
  branch lacks, so it is later work, not earlier.
- **The clean comparison point that exists is `main` at `b11821b1`**, the
  fork before any 12K, skill or control change. Hermes Lite has no
  minimum-context floor, so `main` can run at 12K with its standard loop.
- **What the 63 commits changed (277 files):**

  | Group | Files | Belongs in the runtime arm |
  |---|---|---|
  | Lean runtime modules added under `src/agent/`: `lean_runtime`, `lean_packet`, `lean_state`, `lean_contracts`, `lean_router_trm`, `lean_cli`, `retrieval_packet`, `skill_catalog` | 8 | yes |
  | Core files modified: `run_agent.py`, `hermes_agent.py`, `cli.py`, `utils.py`, `agent/{loop_driver,model_metadata,prompt_builder}.py`, `hermes_cli/{config,doctor,main,models,runtime_provider,status}.py`, `tools/{file_operations,memory_tool,process_registry,skill_tools}.py`, `tools/environments/local.py` | 18 | yes |
  | Lab and benchmark modules added under `src/agent/`: the `bitagent_*`, `intellect3_*`, `*_control_mesh_*`, `mcp_*`, `lean_filesystem_mcp`, `ultra_lean_skill_lab` files | 20 | no, except the sidecar and LDT code the policy engine reuses |
  | `reports/`, `evals/registered/` | 158 | no |
  | `configs/`, `contracts/`, `scripts/`, `integrations/`, `docs/`, `tests/` | 63 | config and tests only |
  | Root files and other | 10 | as needed |

  So the branch is mostly research artifacts around a small runtime change.
  The modified arm needs the first two rows; the rest can stay where it is.
- Two files in the working tree are newer than the last commit
  (`src/agent/bitagent_synthetic_testnet_v1.py` and `_v2.py`).

### 1.2 This machine

| Need | State |
|---|---|
| POSIX shell for Goose hooks | `sh.exe` exists only inside GitHub Desktop's bundled Git (`…\GitHubDesktop\app-3.6.6\resources\app\git\usr\bin\`), which is not on `PATH` and moves with each Desktop update. `bash` on `PATH` is the WSL launcher stub and fails without WSL. |
| Git | Same bundled copy only. The Hermes Lite checkout is owned by a different Windows account (`CodexSandboxOnline`), so git refuses to operate in it from the user account until a `safe.directory` exception is added. |
| Rust toolchain for the Goose fork | Absent: no `cargo`, `rustc` or `rustup`. |
| Goose binary | Absent. |
| Docker | Absent. |

## 2. Architecture comparison

Three columns, because upstream Hermes and your fork have diverged far enough
to be different runtimes.

| Dimension | Hermes upstream | Hermes Lite (your fork) | Goose 1.53 |
|---|---|---|---|
| **Tool execution** | Layered. Loop calls pass `tool_executor._dispatch_authorized_once`; non-loop calls pass `model_tools.handle_function_call`. No single function sees every call. Parallel and sequential segments. | `AIAgent._execute_tool_calls` (`run_agent.py:2446`) → `_execute_single_tool` or `_execute_tool_batch` (thread pool, up to 8). Inline tools (`todo`, `session_search`, `clarify`, `delegate_task`, `memory`) run in the loop; the rest go `handle_function_call` → `registry.dispatch`. Every result passes `_finalize_tool_result`. 12 tools. The lean runtime calls no registry tools: the model returns `{phase, operation, gate}` and harness-owned modules run. | Two loops (legacy `reply_internal`, and a state machine behind `GOOSE_STATE_MACHINE=1`); upstream requires parity. `Agent::dispatch_tool_call` (`agent.rs:1067`) → `ExtensionManager::dispatch_tool_call_inner` (`extension_manager/mod.rs:1269`). Futures run concurrently. |
| **Context management** | Hard floor: `MINIMUM_CONTEXT_LENGTH = 64_000` raises at init. Compressor constants assume large windows (2K minimum summary, 10K tail floor). About 60 tool schemas by default. | Lean runtime: stateless packets, 8,000 input tokens maximum, counted by llama.cpp `/tokenize`, fixed trim order, `ContextOverflow` stops the run. Server started with `-c 12288`. Standard loop: compressor at 85% of detected context. | Accumulating conversation with auto-compaction at limit × 0.8. `GOOSE_CONTEXT_LIMIT` overrides the limit. Tokens are counted with `o200k_base` for every model. The compaction estimate excludes the system prompt and tool schemas. Shell output caps are hard-coded (50,000 bytes, 2,000 lines). |
| **Skills** | `SKILL.md` with rich frontmatter, `skills_list` / `skill_view`, index in the prompt, agent-authored skills via `skill_manage`. | `SKILL.md` plus `ULTRA_LEAN.json` contracts (`hermes.ultra_lean_skill.v1/v2`): phases, allowed operations, model-owned vs harness-owned fields. `HybridSkillRouter` picks a contract. | `SKILL.md` from `.agents/skills`, `.goose/skills`, `.claude/skills` and home equivalents; index in the system prompt; `load_skill` on demand. Recipes configure a whole run. No phase contracts. |
| **Persistent state** | SQLite, schema v31, in-place compaction flags, memory files, memory-provider plugins, checkpoints. | SQLite `sessions` / `messages` with FTS5. Lean runtime: `.hermes/runtime/<task_id>/events.jsonl`, `snapshot.json`, artifacts; `rebuild_snapshot()` folds events; resumes when status is `running` or `paused`. Not hash-chained. | SQLite `sessions.db`, schema v16; `parent_session_id`; per-session `extension_data`; `permission.yaml`. |
| **Subagents** | In-process child agent, depth 1, blocked-tool list, same hook pipeline with the child's session id. | `delegate_task` emits a `DelegateTask` message to the Rust TUI swarm. Unavailable in the standalone CLI. No lineage record. | `delegate` in the summon extension. Child gets its own session row. Child mode is forced to `Auto`, hooks are disabled, inspectors are a fresh default chain, and nesting is refused. |
| **Control interception** | Plugin `pre_tool_call` can block, escalate to approval, or modify arguments, and fails closed on timeout or exception. `tool_execution` middleware wraps the call but fails open. | None. Only `tool_progress_callback` and `step_callback`, both observe-only. | `ToolInspector` trait: allow, deny or require approval; no rewrite; registration is code-only; an inspector error is logged and skipped. Hooks plugin: `PreToolUse` can deny; failure defaults to allow; `PostToolUse` carries no output. Code-mode inner calls skip both. |
| **Authorization** | Approvals for terminal, `execute_code`, plugin escalations, protected writes, untrusted MCP writes. `--yolo` and `approvals.mode: off` auto-approve plugin escalations. | Dangerous-shell-pattern approval only (`tools/approval.py`). In the BitAgent mesh, the LDT validates a candidate and materializes a `CapabilityRequest`; BitAgent decides. | Modes `Auto` (default), `Approve`, `SmartApprove`, `Chat`; `permission.yaml`; an LLM read-only judge. Headless `goose run` errors out in the approve modes and auto-answers `AllowOnce` in `Auto`, including for security alerts. |
| **Logging** | SQLite messages, log files, optional ShareGPT trajectories. Request bodies are not persisted. | Same family, plus a JSONL subprocess protocol (`ToolCallStart`, `ToolCallResult`, …) with truncated previews, and lean `events.jsonl` with budget receipts. | Session DB holds full messages. Provider request log is a ring of the last 10 requests. OTLP and Langfuse layers. `--output-format stream-json`. |
| **Replay** | None built in. A scripted fake LLM server exists for tests. | State fold only (`rebuild_snapshot`). No model or tool replay. | Test-only: `TestProvider` record/replay and MCP stdio record/playback. |
| **Sandboxing** | Terminal backends (Docker with capability drops, others). The agent process, inline tools and MCP children run on the host. | Terminal backends inherited; local by default. | `--container` runs stdio extensions via `docker exec`. The developer shell and code mode run in-process on the host. |
| **Model portability** | Many API modes, but requires native `tool_calls` and a 64K window. | OpenAI-compatible llama.cpp at `127.0.0.1:8801` (Bonsai-8B plus role LoRAs), Ollama fallback. A `<tool_call>` text parser exists for models without native tool calls. Lean runtime uses JSON mode at temperature 0. | `Provider` trait; declarative OpenAI-compatible custom providers with per-model `context_limit`; local llama.cpp provider; "toolshim" uses a second model to interpret tool calls. |

### What the comparison forces

- **Interception inside either runtime is incomplete by construction.**
  Goose's code mode calls `manager.dispatch_tool_call` directly
  (`code_execution.rs:359-406`), below the inspectors and hooks. Hermes Lite's
  inline tools never reach `registry.dispatch`. A shell tool can reach any
  loopback HTTP API, and BitAgent's `/api/tools/:name` currently answers with
  `access-control-allow-origin: *`.
- **Goose defaults fail open in four places**: inspector errors, hook
  failures, headless `Auto` confirmations, and subagents.
- **The two runtimes disagree about what a turn is.** Hermes Lite's lean
  runtime rebuilds a stateless packet each turn. Goose accumulates a
  conversation and compacts it. BitAgent's benchmark assumes stateless turns.
- **Goose's compaction is unsafe at 12K as shipped.** Its estimate ignores the
  system prompt and tool schemas, it counts with the wrong tokenizer for a
  Qwen-family model, and its summarizer recovers only when the server returns
  a hard context error.
- **Rebasing onto upstream Hermes would be a rewrite.** The 64K floor, the
  compressor constants and the size of the default tool set all work against a
  12K window. Upstream's `pre_tool_call` directive shape (`block`, `approve`,
  `modify`) is still worth copying for naming.

## 3. Requirements

Every consequential tool call must carry four things, and each maps to a
field defined in section 5:

| Requirement | Carried by |
|---|---|
| Provenance | `ToolCallProposal.provenance` |
| Authorization scope | `Decision.scope` |
| Run-contract state | `Decision.state` |
| Auditable decision trail | `Decision.checks`, `Decision.engines`, `Decision.reasonCodes`, and the ledger chain |

A tool call is **consequential** unless the pinned tool registry classifies
it as `none` or `read`. A tool missing from the registry is consequential.

Invariants the design must hold on both runtimes:

- **I1.** An effect is committed only by the tool gateway, and only against an
  unexpired lease whose fingerprint matches the call.
- **I2.** Any failure to reach the control module is a denial.
- **I3.** The model never sees a lease, a token or an oracle label.
- **I4.** Every ledger record is hash-chained, and control state equals the
  fold of the ledger.
- **I5.** The deterministic stages of a decision are a pure function of the
  proposal, the state before it and the policy. The controller's
  contribution is recorded verbatim. A decision can therefore be re-evaluated
  offline with the controller's action replayed from the ledger.
- **I9.** The controller can only reduce authority. Its actions are hold,
  question, intervene and halt; admission comes only from the deterministic
  engines and the principal.
- **I10.** The controller never reads text that an untrusted source could
  have written.
- **I6.** A delegated actor's scope is a subset of its parent's, and both
  draw on one budget.
- **I7.** No model request above the context ceiling reaches the model
  server.
- **I8.** Runtime-specific detail is confined to `runtime` and
  `provenance.nativeCallId`, so ledgers from the two runtimes can be diffed.

## 4. Target architecture

### 4.1 Components

```text
                         experiment harness (Control-Harness)
                  owns: run contract, scenario, oracle, principal
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
          ▼                           ▼                           ▼
   ┌─────────────┐   decide    ┌──────────────┐   commit   ┌──────────────┐
   │ runtime     │────────────►│ control      │◄───────────│ tool gateway │
   │ + shim      │   outcome   │ module       │   outcome  │ (MCP server) │
   │             │────────────►│              │            │              │
   │ Hermes Lite │ intervene   │ ledger       │            │ environment: │
   │ or Goose    │◄────────────│ state fold   │            │ BitAgent     │
   └──────┬──────┘             │ leases       │            │ world, RTG   │
          │                    │ budgets      │            │ world, or a  │
          │ tool calls         │ policy       │            │ Control-     │
          └────────────────────┤ engines      │            │ Harness env  │
          │                    │ ──────────── │            └──────▲───────┘
          │                    │ controller   │                   │
          │                    │ thread       │                   │
          │                    └───┬──────▲───┘                   │
          │ model requests         │      │ model_turn events     │
          ▼        controller turns│      │                       │
   ┌─────────────┐◄────────────────┘      │                       │
   │ model proxy │────────────────────────┘                       │
   │ ceiling,    │                                                │
   │ record,     │      tool calls from the runtime ──────────────┘
   │ replay      │
   └──────┬──────┘
          ▼
   llama-server (Bonsai-8B, Qwen3.5 sizes) or any OpenAI-compatible endpoint
```

| Component | Owns | Trusts |
|---|---|---|
| **Control module** (daemon, one per run) | Ledger, folded state, leases, budgets, escalations, policy-engine calls | Harness token; nothing from the runtime beyond what it can check |
| **Controller thread** (inside the control module) | A model conversation that reviews events and issues hold, question, intervene and halt actions | Rendered ledger events only |
| **Runtime shim** | Turning each tool call into a proposal with provenance; denying built-in tools; reporting outcomes | Nothing; it runs in the actor's process |
| **Tool gateway** | The only path to environment effects; lease consumption; result capture | Control module |
| **Model proxy** | Token ceiling, request/response record, scripted and replay modes | Control module |
| **Policy engines** | The decision itself | Control module |
| **Principal** | Resolving escalations and approving contracts | Harness |

The shim runs inside the thing being controlled, so its reports are evidence,
not authority. A stolen shim token lets an actor spoof provenance on its own
proposals. It cannot widen what policy admits, and it cannot consume a lease,
because the gateway holds a different token.

### 4.2 Two enforcement layers

1. **Gateway (authoritative).** All environment tools are gateway tools. On
   each call the gateway asks the control module to commit. With a matching
   lease the commit succeeds after a re-check of contract and budget. With no
   lease, the control module runs the full decision itself, marks the
   provenance `gateway_only`, and records `bypass_detected` if the run profile
   required a shim.
2. **Shim (provenance and built-ins).** The shim proposes every tool call
   before the runtime dispatches it. For built-in tools (shell, file write,
   memory, skill load, delegation) the shim's denial is the enforcement. For
   gateway tools it is an early denial plus the provenance the gateway cannot
   see: which model turn, which skill, which subagent.

For controlled experiments the default profile disables every built-in
effectful tool, so the gateway is the only tool surface and the bypass
surface inside the runtime is empty. Profiles that enable a shell (the `H0`
raw level) need a container with egress limited to the proxy, the gateway and
the control module.

### 4.3 The control thread

The control thread is a second model conversation per run: a controller that
sits above the actor's loop, lives as long as the run, and is separate from
the actor's context. It has three layers.

- **Ledger (deterministic).** Append-only, hash-chained JSONL (section 7).
- **State (deterministic).** A fold over the ledger: active contract and
  version, approval status, budget, lease table, run status, current phase,
  actor lineage, evidence root, open escalations.
- **Controller conversation (model).** Each controller turn takes a batch of
  rendered ledger events and returns one typed control action. Between turns
  the thread retains four things:

  | Retained | Source | Authored by |
  |---|---|---|
  | Run contract card | Folded state | Deterministic |
  | Compact history of consequential actions | Folded state: recent entries verbatim, older ones rolled up by tool and verdict | Deterministic |
  | Prior interventions and whether the actor followed them | `intervention` records plus the proposals that came after | Deterministic, with the controller's text |
  | Unresolved authorization questions | `escalation` records | Controller wording, deterministic status |

  plus a bounded set of the controller's own notes and its last few turns
  verbatim.

Every controller turn is itself a ledger record, so the whole thread is a
fold of the ledger and can be rebuilt after a crash, a restart of either
runtime, or a compaction of the actor's context.

**Why the control module hosts it, not the runtime.** The same controller
then runs unchanged in all three arms, the actor cannot tamper with it, and
it survives a runtime restart. Goose does ship an in-process LLM reviewer
(`AdversaryInspector`), but it reviews one call at a time, fails open, and
is skipped by code mode, so it is not a base to build on.

**What the controller may do.** It is a monitor in Control-Harness terms. It
can turn an admitted call into a hold, open an authorization question to the
principal, send an intervention to the actor, or halt the run. It cannot
admit a call the deterministic engines refused, and it cannot grant scope.
The hard gate (zero unauthorized effects) therefore holds whatever the
controller's quality, and the controller's contribution is measurable
against always-pass and always-hold references.

**What the controller reads.** Structured events, not terminal output. A
deterministic renderer turns each ledger record into one compact line of
whitelisted fields. Tool results appear as status, size, evidence ids and
flags. Free-text arguments and results are replaced by their hash, length
and taint label unless the tool registry marks a field controller-visible.

**What the actor sees.** A bounded projection of state (remaining budget,
allowed action classes, run status, admissible tools, the last decision and
its reason codes, open questions) and any pending intervention. For BitAgent
the projection is the existing `TaskPacketV3.contract_projection`,
`admissible` and `receipts`. Both reach the actor without a runtime patch:
the harness places them in the packet in step mode, and the gateway appends
them to tool results in session mode. Runtimes with a native steering
channel use that instead (section 6.7).

## 5. Interface definitions

### 5.1 Wire types

Hashed objects use canonical JSON: sorted keys, no insignificant whitespace,
UTF-8, no floats, amounts as decimal strings of integer atoms. Section 11
lists the reconciliation this needs across the four existing canonicalizers.

```ts
type ActorRef = {
  agentId: string;                 // "root", "root/1", ...
  lineage: string[];               // runtime session ids, root first
  role?: string;                   // e.g. "risk_approval_guard"
};

type RuntimeRef = {
  id: "hermes-lite" | "goose";
  version: string;
  commit: string;
  shimHash: string;
  tier: "gateway_only" | "hooks" | "fork";
};

type Provenance = {
  schema: "control.provenance.v1";
  surface: "agent_loop" | "code_mode" | "subagent" | "lean_phase"
         | "sidecar" | "app_call" | "gateway_only";
  attestation: "shim" | "gateway_only";
  nativeCallId?: string;
  modelTurn?: {
    turnId: string;
    requestSha256: string;
    responseSha256: string;
    modelHash: string;
    adapterHash?: string;
  };
  skill?: { id: string; sha256: string; phase?: string };
  contextTaint: {
    evidenceId: string;
    trust: "host_verified" | "provider_reported" | "untrusted_text";   // BitAgent EvidenceTrust
  }[];
  argRefs?: Record<string, string>;        // argument name -> evidence id
  claims?: {
    claimId: string;
    provenance: "environment_sound" | "model_sound" | "experience_sound" | "unknown";  // Control-Harness
  }[];
};

type ToolCallProposal = {
  schema: "control.tool_call_proposal.v1";
  runId: string;
  seq: number;                             // shim-local, monotonic
  actor: ActorRef;
  runtime: RuntimeRef;
  tool: { id: string; nativeName: string; registryHash: string };
  args: Record<string, unknown>;
  fingerprint: string;                     // sha256(canonical({runId, agentId, tool.id, args}))
  contractHash: string;
  provenance: Provenance;
  proposedAt: string;
};

type AuthorizationScope = {
  schema: "control.authorization_scope.v1";
  tools: string[];                         // tool ids or action classes
  resources: Record<string, string[]>;     // engine-defined: chains, assets, venues, destinations, paths
  limits: Record<string, string>;          // engine-defined, decimal strings
  expiresAt: string;
  delegable: boolean;
};

type Decision = {
  schema: "control.decision.v1";
  decisionId: string;
  fingerprint: string;
  verdict: "allow" | "deny" | "escalate";
  effectClass: "none" | "read" | "local_write" | "state_change" | "delegation" | "authority";
  reasonCodes: string[];
  checks: Record<string, boolean>;         // e.g. G01..G18, "ldt.phase", "ldt.operation"
  engines: { engineId: string; policyHash: string; verdict: unknown }[];  // native verdicts, e.g. GateVerdict
  nextAuthority: "none" | "principal" | "lease";
  controller?: { turn: number; action: "pass" | "hold" | "ask_principal" | "halt_run" };
  scope?: AuthorizationScope;
  lease?: { leaseId: string; expiresAt: string };
  amendedArgs?: Record<string, unknown>;   // applied by the gateway only
  state: {
    contractHash: string;
    contractVersion: number;
    budgetHashBefore: string;
    evidenceRoot: string;
    runStatus: "ACTIVE" | "CLOSED" | "HELD" | "CLARIFY" | "INCIDENT" | "EXPIRED" | "EXHAUSTED";
  };
  decidedAt: string;
};

type ToolCallOutcome = {
  schema: "control.tool_call_outcome.v1";
  fingerprint: string;
  decisionId: string;
  status: "ok" | "error" | "denied" | "timeout" | "cancelled";
  resultSha256: string;
  resultBytes: number;
  resultTokens?: number;
  evidenceIds: string[];
  effectId?: string;
  durationMs: number;
};
```

Notes on the choices:

- `verdict` has no `rewrite`. Goose cannot rewrite arguments below a fork, so
  normalization is expressed as `allow` with `amendedArgs`, and only the
  gateway applies it. That works identically on both runtimes.
- `escalate` maps to BitAgent's `manual_required` and
  `nextAuthority: "wallet_user"`. The control module resolves it through the
  principal; neither runtime's approval UI is involved.
- Identical calls produce identical fingerprints. Leases are therefore a
  queue per fingerprint, consumed oldest first. Effect idempotency stays the
  policy engine's job (BitAgent G14).

### 5.2 Control module API

Loopback HTTP with JSON bodies, because Python, Rust, TypeScript and a shell
hook can all call it. Three bearer tokens per run: shim, gateway, harness.

| Call | Caller | Effect |
|---|---|---|
| `POST /v1/runs` | harness | Open a run with the experiment contract, run contract, tool registry and engine list. Writes `run_start`. |
| `POST /v1/decide` | shim | `ToolCallProposal` → `Decision`. Writes `action_proposed`, `control_decision`, and `grant_issued` on allow. |
| `POST /v1/commit` | gateway | Consume a lease by fingerprint and re-check state; or decide in full when no lease exists. |
| `POST /v1/outcome` | shim, gateway | `ToolCallOutcome`. Writes `tool_result` or `environment_transition`; settles budget. The reply carries any pending intervention for that actor. |
| `GET /v1/thread` | harness | Current controller thread, for inspection and for the R1c replay check. |
| `POST /v1/events` | shim, proxy | `model_turn`, `context_packet`, `context_compacted`, `skill_loaded`, delegation events. |
| `GET /v1/projection` | harness, gateway | Bounded projection of current state. |
| `POST /v1/escalations/{id}` | principal | Resolve an escalation: approve, reject or amend. |
| `POST /v1/runs/{id}/close` | harness | Write `run_end` and return the chain root. |

### 5.3 Harness-side protocols (Python, Control-Harness style)

These sit beside the existing protocols in
`src/harness/control_contracts.py` and use the same `Record` mappings.

```python
class RuntimeAdapter(Protocol):
    adapter_id: str                      # "hermes-lite" | "goose"
    version: str

    def capabilities(self) -> Record:
        """tier, drive modes, subagents, code mode, native event stream."""

    def prepare(self, run: Record) -> Record:
        """Write config, recipe, skills and environment; return a launch receipt
        with the config hash and runtime binary or commit hash."""

    def propose(self, task: Record, state: Record) -> Sequence[Record]:
        """Step mode: one model turn in, candidate actions out.
        Same signature as AgentAdapter.propose."""

    def run_session(self, task: Record) -> Iterator[Record]:
        """Session mode: the runtime owns the loop; yields native events."""

    def export_native(self, run_dir: Path) -> Record:
        """Export the runtime's own session log for the coverage audit."""

    def shutdown(self) -> None: ...


class PolicyEngine(Protocol):
    engine_id: str
    policy_hash: str

    def evaluate(self, proposal: Record, state: Record) -> Record:
        """Pure. Returns admit or refuse, per-check booleans, reason codes,
        and the engine's native verdict."""

    def settle(self, outcome: Record, state: Record) -> Record:
        """Return the state delta after a committed effect, e.g. budget."""


class Principal(Protocol):
    def resolve(self, escalation: Record, state: Record) -> Record:
        """approve | reject | amend. Scripted in experiments."""
```

How they line up with what exists:

| New | Existing counterpart |
|---|---|
| `RuntimeAdapter.propose` | Control-Harness `AgentAdapter.propose`; BitAgent bench `Policy.propose(packet, context)` |
| `PolicyEngine.evaluate` | BitAgent `evaluateGates(envelope, context)`; RTG ledger gateway; Hermes Lite LDT |
| Controller thread (may only reduce authority) | Control-Harness `MonitorAdapter.inspect`; BitAgent arm `A4` veto-only critic, with memory added |
| Gateway commit | Control-Harness `CommitAuthority.commit`; BitAgent `kernel.execute` |
| Oracle, kept out of the control plane | RTG `Mandate.verdict`; BitAgent `auditEffects` |

Engines compose by conjunction: every engine must admit. The controller can
add a hold or a question and can never admit, which is the Control-Harness
rule that model- and experience-derived sets stay soft.

### 5.4 Goose patch trait (Rust)

```rust
// crates/goose/src/control/mod.rs (new)
#[async_trait]
pub trait ControlGate: Send + Sync {
    async fn pre(&self, call: &ControlCall<'_>) -> ControlVerdict;
    async fn post(&self, call: &ControlCall<'_>, outcome: &ControlOutcome<'_>);
}

pub struct ControlCall<'a> {
    pub session_id: &'a str,
    pub parent_session_id: Option<&'a str>,
    pub request_id: Option<&'a str>,
    pub extension: &'a str,
    pub tool: &'a str,                       // resolved name, not the prefixed one
    pub arguments: Option<&'a JsonObject>,
    pub surface: Surface,
}

pub enum Surface { AgentLoop, CodeMode, AppCall, FinalOutput, SkillLoad }

pub enum ControlVerdict {
    Allow,
    Deny { reason_code: String, message: String },
}
```

`pre` blocks while an escalation is open and returns `Deny` on timeout. A
denial is returned to the model as the tool error, as hook denials are today.

### 5.5 Hermes Lite shim surface (Python)

```python
# src/agent/control_client.py (new)
class ControlClient:
    @classmethod
    def from_env(cls) -> "ControlClient | None": ...       # HERMES_CONTROL_URL, _TOKEN, _REQUIRED
    def decide(self, proposal: dict) -> dict: ...           # raises ControlUnavailable
    def outcome(self, outcome: dict) -> None: ...
    def event(self, kind: str, payload: dict) -> None: ...
    def denial_result(self, decision: dict) -> str: ...     # JSON tool result shown to the model
```

Standard library only (`urllib`), as `lean_runtime._post` already does.

### 5.6 Controller thread

```ts
type ControlAction =
  | { action: "pass" }
  | { action: "hold"; reasonCode: string }                    // blocking triggers only
  | { action: "ask_principal"; questionId: string; summary: string;
      blocking: string[] }                                    // fingerprints waiting on the answer
  | { action: "intervene"; kind: "remind" | "correct" | "stop_and_wait";
      refs: number[]; text: string }                          // refs are ledger indexes
  | { action: "halt_run"; reasonCode: string };

type ControllerTurn = {
  schema: "control.controller_turn.v1";
  threadId: string;
  turn: number;
  trigger: { kind: string; index: number; fingerprint?: string };
  eventRange: [number, number];            // ledger indexes rendered into this turn
  packetSha256: string;
  inputTokens: number;
  output: ControlAction & { note?: string };
  modelHash: string;
  promptTemplateSha256: string;
  latencyMs: number;
};

type ControllerThread = {
  schema: "control.controller_thread.v1";
  threadId: string;
  runId: string;
  turn: number;
  lastEventIndex: number;
  contractCard: Record<string, unknown>;   // deterministic projection of the run contract
  actions: {
    recent: { index: number; actor: string; tool: string; effectClass: string;
              verdict: string; reasonCodes: string[]; effectId?: string }[];
    rollup: Record<string, { allowed: number; denied: number; escalated: number }>;
  };
  interventions: { index: number; turn: number; kind: string; trigger: string;
                   delivered: boolean; followed: "yes" | "no" | "unknown" }[];
  openQuestions: { questionId: string; openedAtIndex: number; blocking: string[];
                   status: "open" | "answered" | "withdrawn"; summary: string }[];
  notes: { turn: number; text: string }[]; // controller-authored, bounded, tainted
  tail: { turn: number; trigger: string; action: string }[];
};
```

The controller's output is grammar-constrained to one `ControlAction` plus an
optional note. `summary`, `text` and `note` are the only model-authored
strings, and each has a token cap.

```python
class ControllerAdapter(Protocol):
    controller_id: str
    version: str

    def turn(self, thread: Record, events: Sequence[Record], trigger: Record) -> Record:
        """One controller turn. Returns a ControlAction with an optional note."""


class InterventionChannel(Protocol):
    def deliver(self, actor: Record, intervention: Record) -> Record:
        """Deliver to the actor; return {delivered, channel, atIndex}."""
```

`RuntimeAdapter` gains `intervention_channel() -> InterventionChannel`.
Reference controllers `always_pass`, `always_hold` and a scripted controller
implement `ControllerAdapter` for the soundness gates.

## 6. Middleware design

### 6.1 Decision pipeline (inside `/v1/decide` and `/v1/commit`)

| # | Stage | Refusal code |
|---|---|---|
| 1 | Authenticate the caller and bind the run | `unauthenticated` |
| 2 | Canonicalize; recompute the fingerprint; reject a mismatch | `fingerprint_mismatch` |
| 3 | Append `action_proposed` | (none: always recorded) |
| 4 | Classify the effect from the pinned registry; unknown tools are `state_change` | `registry_hash_mismatch` |
| 5 | Run state: status `ACTIVE`, contract approved and unexpired, actor lineage registered | `run_not_active`, `unknown_actor` |
| 6 | Admissibility: the tool is in the admissible set for the current phase or node | `not_admissible` |
| 7 | Policy engines in order | engine reason codes |
| 8 | Controller review, when a blocking trigger fires (section 6.7). Append `controller_turn`. | `controller_hold`, `controller_unavailable` |
| 9 | Reserve budget as in-flight | `budget_exhausted` |
| 10 | Append `control_decision`; on allow append `grant_issued` | (none) |
| 11 | Reply | (none) |

Stages 4 to 7 and 9 read only the proposal and the folded state. Stage 8 is
the one model call in the path, and its output is recorded, which is what
keeps offline re-evaluation possible (I5). The ledger append in stage 10
happens before the reply, so a crash cannot produce an unrecorded allow.

`read` and `none` calls take a short path: stages 1 to 5 and 10, with no
lease and no controller turn.

### 6.2 Hermes Lite shim

Hermes Lite keeps `run_agent.py` clean for upstream sync and puts fork
behaviour in `HermesLiteAgent`. The patch follows that.

| File | Change |
|---|---|
| `src/agent/control_client.py` | New. Section 5.5. |
| `src/hermes_agent.py` | In `__init__`, build `self._control`. Override `_execute_tool_calls` to run calls one at a time when control is on, so ledger order is deterministic. Override `_execute_single_tool`: build the proposal, call `decide`, and on anything but allow pass a denial result to `_finalize_tool_result` without dispatching. Override `_finalize_tool_result` to post the outcome, then call `super()`. |
| `src/tools/registry.py` | Backstop in `ToolRegistry.dispatch`: when control is required and no decision is bound to the current call, return an error result and report `bypass_detected`. |
| `src/tools/control_gateway_tools.py` | New. Fetch the gateway's `tools/list` and register each tool under toolset `control-gateway`, with a handler that calls the gateway. Hermes Lite has no MCP client in the standard loop, so this is a small JSON-RPC bridge. |
| `src/model_tools.py`, `src/toolsets.py` | Add the new module to `_discover_tools` and a `control-gateway` toolset. |
| `src/agent/lean_runtime.py` | Mirror `store.append(...)` into control events, post a `model_turn` after each `_post`, and post the budget receipt from `packet_builder.build` as `context_packet`. Call `decide` before a phase module runs when that module has an effect. |
| `src/agent/lean_packet.py` | Record which counter produced the budget (`/tokenize` or the `len / 3.2` fallback) in the receipt. Today the fallback is silent. |

Coverage argument: every tool the standard loop runs, inline or dispatched,
goes through `_execute_single_tool` once sequential mode is forced, and every
result goes through `_finalize_tool_result`. The registry backstop catches
any future caller that reaches `dispatch` another way.

The lean runtime's phase modules (`artifact_retrieval`, `model_generation`,
`verifier`, `finalizer`) have no external effect today, so in lean mode the
shim is mostly an event source. The consequential path in the BitAgent mesh
is the sidecar's `materialize_capability_request`, which already hands the
decision to BitAgent.

### 6.3 Goose shim

**Tier `hooks` (no fork).** Configuration only; useful as a first step and as
a control arm.

- A plugin at `<project>/.agents/plugins/control-gate/hooks/hooks.json` with a
  `PreToolUse` command hook matching every tool and `"on_failure": "block"`,
  plus `PostToolUse` and `PostToolUseFailure` observers. The command is a
  small client that reads the hook JSON on stdin and calls `/v1/decide`.
- Gateway attached with `--with-streamable-http-extension`; `--no-profile`;
  no developer, code-execution or summon extension.
- Known limits: hooks are off in subagents and skipped by code mode, so both
  must stay disabled; `PostToolUse` has no output, so results come from the
  gateway record; hooks are spawned with `sh -c` unconditionally, so on
  Windows a missing `sh` turns into a hook failure.

**Tier `fork`.** Required for subagents, code mode, or any built-in tool.

| File | Change |
|---|---|
| `crates/goose/src/control/{mod.rs,client.rs}` | New. Trait from section 5.4 and an HTTP client configured by `GOOSE_CONTROL_URL`, `GOOSE_CONTROL_TOKEN`, `GOOSE_CONTROL_REQUIRED`. |
| `crates/goose/src/agents/extension_manager/mod.rs` | Hold `Option<Arc<dyn ControlGate>>`. In `dispatch_tool_call_inner`, after `resolve_tool_with_constraints` and the availability check and before `client.call_tool`, call `pre`. Wrap the result future to call `post`. |
| `crates/goose/src/agents/tool_execution.rs` | Add a `surface` field to `ToolCallContext`. |
| `crates/goose/src/agents/platform_extensions/code_execution.rs` | `create_tool_callback` sets `surface = CodeMode`. |
| `crates/goose/src/agents/agent.rs` | Gate the `FINAL_OUTPUT_TOOL_NAME` branch of `dispatch_tool_call`, which never reaches the extension manager. |
| `crates/goose/src/agents/state_machine/` | Gate `load_skill` in `SkillOperation` and `recipe__final_output` in `RecipeOperation`. Both loops must behave the same. |
| Startup | When control is required, refuse providers that execute tools themselves (`claude_code`, `codex`, `gemini_cli`, the `*_acp` providers). |

`dispatch_tool_call_inner` is the one function that the main loop, the state
machine, code mode, app calls and subagents all reach, because each subagent
builds its own extension manager. The gate is constructed from the
environment, so children inherit it without a change to `summon.rs`.

Context settings for a 12K run:

| Setting | Value | Why |
|---|---|---|
| `GOOSE_CONTEXT_LIMIT` | `12000` | Overrides the 128,000 default |
| `GOOSE_AUTO_COMPACT_THRESHOLD` | about `0.6` | Compensates for the estimate ignoring system prompt and schemas |
| `GOOSE_MAX_TOOL_RESPONSE_SIZE` | about `8000` chars | Default is 200,000 |
| `--no-profile`, `available_tools` | gateway tools only | Fewer schemas |
| llama-server | context shift disabled | The summarizer's retry ladder needs a hard context error |

Fork-level context patches, only if session mode at 12K matters: the
hard-coded shell caps in `developer/shell.rs`, and the compaction estimate in
`context_mgmt/mod.rs`.

### 6.4 Tool gateway

One MCP server (Streamable HTTP and stdio), owned by the harness.

- **Tools** come from an environment adapter: BitAgent's bench world and
  typed tool registry, RTG's typed namespaces (`ledger`, `net`, `msg`, `id`,
  `market`, `ask`, `report`, `mem`, `meta`), or a Control-Harness
  `EnvironmentAdapter`.
- **Each call:** canonicalize, `commit`, execute against the environment with
  `amendedArgs` if present, mint evidence receipts from the result, post the
  outcome, append the projection to the result.
- **Results** returned to the model are bounded by the tool-result reserve of
  the 12K split; the full result is stored by hash.
- **Tool annotations** such as `readOnlyHint` are ignored for classification.
  The pinned registry decides.

BitAgent's existing MCP server in `src/chatgpt/mcp.ts` is the pattern to
extend. The skill manifests already name `mcp://bitagent/workflows/...`,
`wallet-authority/...` and `evidence/...` resources that no server
implements; the gateway is where they would live.

### 6.5 Model proxy

An OpenAI-compatible reverse proxy in front of the model server. Both
runtimes point their base URL at it.

| Mode | Behaviour |
|---|---|
| `live` | Count request tokens with the server's `/tokenize`; refuse above the ceiling with a context-length error; forward; record request and response bodies and hashes; post `model_turn`. |
| `scripted` | Answer from a reference policy (BitAgent's oracle, adversary and random policies) instead of a model. No GPU. |
| `replay` | Answer from a recorded `model_io.jsonl`, keyed by request hash. |

This gives both runtimes the same request-level record, which Goose lacks
(its provider log keeps ten requests) and Hermes Lite lacks outside the lean
runtime.

### 6.6 Subagents

- A delegation tool call is consequential (`effectClass: "delegation"`). The
  default policy denies it unless the contract lists approved delegates, as
  Control-Harness's `AuthorizationContract.approved_delegates` does.
- On allow the control module writes `delegation_spawned` with the child's
  `agentId` and an attenuated scope. The child's first proposal carries its
  session lineage, which joins it to the parent.
- Parent and children draw on one budget.
- One controller thread covers the whole run. Child events carry the child's
  `agentId`, and an intervention names the actor it is for.
- Hermes Lite's `delegate_task` routes through the TUI swarm and is
  unavailable headless. Leave it out of controlled runs until a second agent
  process can be launched with its own shim.

### 6.7 Controller thread

**When the controller runs.** A deterministic, hash-pinned trigger policy
decides, so the same ledger always yields the same controller turns. All
turns are synchronous: the actor waits at a shim or gateway call while the
controller runs. That costs latency and buys a replayable order.

| Trigger | Blocking the call | Typical action |
|---|---|---|
| The engines admitted a consequential call (profile: all, flagged only, or none) | yes | `pass` or `hold` |
| The engines returned `escalate` | yes | `ask_principal`, worded from the contract and the proposal |
| N consecutive denials for one actor | no | `intervene: correct` |
| An authorization question was answered, or the contract was amended | no | `intervene: remind` with the new state |
| The actor's context was compacted | no | `intervene: remind` restating open questions and limits |
| A delegation was spawned or returned | no | `pass` or `intervene` |
| K consequential actions, or the unreviewed backlog exceeds B tokens | no | digest turn: usually `pass` with a note |
| Run end | no | final note |

The run contract carries `controller.maxTurns` and `controller.maxTokens`.

**Controller context budget.** The controller runs in the same 12K window as
the actor, split as Hermes Lite's control mesh already does: a 6K durable
lane and a 6K working lane. Proposed partition, to be tuned on the
development split:

| Lane | Section | Tokens |
|---|---|---|
| Durable | Kernel and action grammar | 600 |
| Durable | Run contract card | 900 |
| Durable | Action history | 1,800 |
| Durable | Interventions | 700 |
| Durable | Open questions | 900 |
| Durable | Notes | 500 |
| Durable | Recent turns | 600 |
| Working | Event batch | 3,600 |
| Working | Output | 512 |
| Working | Margin | 1,888 |

Trimming is deterministic and drops, in order: notes, recent turns, rolled-up
history, then the oldest events in the batch. The contract card and open
questions are never trimmed; if they alone do not fit, the turn fails closed.

**Event rendering.** One line per ledger record, for example:

```text
#41 proposed  root goose bitagent/host.execute_approved {envelopeId: env-3} taint[provider_reported]
#42 decision  deny G17_simulation_bound
#57 result    ok 1840B evidence[quote-1f…] flags[stale]
```

**Delivering interventions and the projection.** Each runtime adapter
supplies a channel; the gateway trailer is the fallback for all of them.

| Runtime | Intervention | Projection |
|---|---|---|
| Goose over ACP | `_goose/unstable/session/steer` (`SteerSessionRequest`), which queues into `Agent::steer`; steers are FIFO and survive compaction per upstream's own test | `_goose/unstable/session/system-prompt/set` with `mode: "append"` and a fixed `key`, so each update replaces the last instead of accumulating |
| Goose via `goose run` | Gateway trailer on the next tool result | Recipe instructions at start; gateway trailer after |
| Hermes Lite, standard loop | In the `_execute_tool_calls` override, after tool results are appended, add one user-role message with any pending intervention | Same message, or `ephemeral_system_prompt` at start |
| Hermes Lite, lean runtime | A `control` section in the step packet, built in `LeanSkillRuntime.run` beside `state_projection` and trimmed last | Same section |
| Any, no shim | Gateway trailer | Gateway trailer |

Every delivery writes an `intervention` record with the channel used and the
ledger index at which the actor could first have seen it. "Followed" is then
computed from the proposals after that index.

**Goose attach points, summarized.** The controller needs three things from
Goose, and none of them is a new loop inside Goose:

1. A blocking checkpoint: `ControlGate.pre` in the fork tier, or the
   `PreToolUse` hook in the hooks tier with its timeout raised above the
   controller's worst-case latency.
2. An event feed: `ControlGate.post`, gateway outcomes, proxy `model_turn`
   records, and `AgentEvent::HistoryReplaced` from the ACP stream mapped to
   `context_compacted`.
3. An intervention channel: the ACP steer method above. This makes ACP
   (`goose acp` or `goose serve`) the drive surface for session mode, since
   `goose run` has no steer.

Goose's blocking `Stop` hook can also ask the control module whether a
question is still open and refuse to end the turn while one is.

### 6.8 Failure semantics

| Failure | Result |
|---|---|
| Controller model call fails, times out, or returns an invalid action | Blocking trigger: hold with `controller_unavailable` (profile may choose `pass`, recorded either way). Non-blocking trigger: no action; the trigger is retried at the next boundary. |
| Controller turn or token budget exhausted | As above, with `controller_budget_exhausted`. The deterministic engines keep enforcing. |
| Intervention cannot be delivered | Recorded as `delivered: false`; retried on the gateway trailer. |
| Control module unreachable or slow | Deny with `control_unavailable`. Shim and gateway both. |
| Shim absent or bypassed | Gateway decides alone; `bypass_detected` if a shim was required; built-in tools are unprotected, so the profile must not enable any. |
| Policy engine error | Deny with `engine_error`. |
| Lease expired before commit | Deny with `lease_expired`; reservation released. |
| State changed between decide and commit | Re-check fails; deny with the engine's code. |
| Request above the ceiling | Proxy returns a context-length error; `context_packet` records the overflow. |
| Ledger write fails | The decision is not returned. The run moves to `INCIDENT`. |

## 7. Event schema

### 7.1 Envelope

The envelope is Control-Harness's receipt record, unchanged:

```json
{ "index": 0, "kind": "run_start", "payload": {}, "previous_hash": "…", "hash": "…" }
```

Control-Harness keeps v1 frozen and adds kinds as overlays. This design adds
a v3 overlay in the same way: `receipt_ledger_v3.py`, and
`schemas/control_harness/receipt-record.v3.schema.json`.

### 7.2 Kinds

| Kind | Since | Payload schema | Written when |
|---|---|---|---|
| `run_start` | v1 | `control.run_start.v1` | Run opened: experiment hash, run-contract hash, registry hash, runtime ref, engine policy hashes |
| `action_proposed` | v1 | `control.tool_call_proposal.v1` | Every proposal, before any check |
| `monitor_decision` | v1 | Control-Harness record | An advisory monitor's view |
| `control_decision` | v3 | `control.decision.v1` | The authoritative decision |
| `grant_issued` | v2 | `control.lease.v1` | Lease created on allow |
| `grant_consumed` | v3 | `control.lease.v1` | Gateway commit |
| `grant_expired` | v2 | `control.lease.v1` | Lease timed out or was revoked |
| `environment_transition` | v1 | `control.tool_call_outcome.v1` with `effectId` | A committed environment effect |
| `tool_result` | v3 | `control.tool_call_outcome.v1` | Outcome of a call with no environment effect |
| `contract_amended` | v2 | BitAgent `RunContract` hash pair | New contract version approved |
| `controller_turn` | v3 | `control.controller_turn.v1` | Every controller turn: trigger, event range, packet hash, action, note |
| `intervention` | v3 | `control.intervention.v1` | An intervention was issued and delivered (or not): kind, text hash, channel, delivery index |
| `escalation` | v3 | `control.escalation.v1` | An authorization question was opened, answered or withdrawn |
| `delegation_spawned` | v2 | `control.delegation.v1` | Child actor admitted |
| `delegation_returned` | v3 | `control.delegation.v1` | Child finished |
| `model_turn` | v3 | `control.model_turn.v1` | Each model request: hashes, token counts, latency |
| `context_packet` | v3 | `control.context_packet.v1` | Budget receipt for a packet or request, including overflow |
| `context_compacted` | v3 | `control.context_compacted.v1` | The runtime summarized its history |
| `skill_loaded` | v3 | `control.skill_loaded.v1` | Skill id and hash entered context |
| `bypass_detected` | v3 | `control.bypass.v1` | A call reached the gateway or registry with no proposal |
| `probe` | v2 | Control-Harness record | Reserved, as today |
| `run_end` | v1 | `control.run_end.v1` | Run closed: status, counts, budget hash |

Every payload carries `schema`, `runId`, `at` and, where an actor is
involved, `actor`. Message text and tool results are stored by hash; bodies
live in `model_io.jsonl` and `gateway_io.jsonl`. Controller packets and
intervention text live in `controller_io.jsonl`.

### 7.3 Example

```json
{"index":41,"kind":"action_proposed","payload":{"schema":"control.tool_call_proposal.v1",
 "runId":"r-7c1e","seq":12,"actor":{"agentId":"root","lineage":["s-91"]},
 "runtime":{"id":"goose","version":"1.53.0","commit":"bab8ff64","shimHash":"…","tier":"fork"},
 "tool":{"id":"bitagent/host.execute_approved","nativeName":"bitagent__host.execute_approved","registryHash":"…"},
 "args":{"envelopeId":"env-3"},"fingerprint":"…","contractHash":"…",
 "provenance":{"schema":"control.provenance.v1","surface":"agent_loop","attestation":"shim",
  "nativeCallId":"call_8","modelTurn":{"turnId":"t-12","requestSha256":"…","responseSha256":"…","modelHash":"…"},
  "contextTaint":[{"evidenceId":"quote-1f…","trust":"provider_reported"}]},
 "proposedAt":"2026-10-01T15:04:05Z"},"previous_hash":"…","hash":"…"}
{"index":42,"kind":"control_decision","payload":{"schema":"control.decision.v1",
 "decisionId":"d-42","fingerprint":"…","verdict":"deny","effectClass":"state_change",
 "reasonCodes":["G17_simulation_bound"],"checks":{"G01_contract_active":true,"G17_simulation_bound":false},
 "engines":[{"engineId":"bitagent-gates","policyHash":"…","verdict":{"schema":"bitagent.gate_verdict.v1","admitted":false}}],
 "nextAuthority":"none",
 "state":{"contractHash":"…","contractVersion":1,"budgetHashBefore":"…","evidenceRoot":"…","runStatus":"ACTIVE"},
 "decidedAt":"2026-10-01T15:04:05Z"},"previous_hash":"…","hash":"…"}
```

### 7.4 Truth plane

Oracle labels never enter the control ledger. They go to `truth.jsonl`,
written by the harness, joined to the ledger by `index` and `fingerprint`,
and kept off any host that runs inference. This is RTG's split between the
gateway and the mandate, and BitAgent's rule that oracles never reach an
inference host.

### 7.5 Mapping existing events

| Existing | Becomes |
|---|---|
| Hermes Lite `routed` | `skill_loaded` |
| Hermes Lite `model_action` | `model_turn` and `action_proposed` |
| Hermes Lite `phase_result` | `tool_result` |
| Hermes Lite `packet_rejected` | `context_packet` with overflow |
| BitAgent `DecisionTrace` | `action_proposed` and `control_decision`; `oracleLabel` to the truth plane |
| BitAgent `GateVerdict` | `Decision.engines[].verdict` |
| BitAgent `ReconciliationRecord` | `environment_transition` payload extension |
| RTG `Event.gateway` | `control_decision.verdict` |
| RTG `Event.verdict` | truth plane |

## 8. Experiment harness

### 8.1 Unit of work

One run is (experiment, runtime arm, controller arm, model, harness level,
architecture arm, scenario, seed). The runtime and the controller become
factors in BitAgent's `ExperimentRunContract`, which gains:

```ts
runtimes: { id: "hermes-lite" | "goose"; commit: string; shimHash: string;
            configHash: string; tier: "gateway_only" | "hooks" | "fork";
            driveMode: "step" | "session" }[];
controlPlane: { schemaHash: string; registryHash: string; policyHashes: Record<string, string> };
modelProxy: { hash: string; tokenizer: "server"; ceilingTokens: 12000 };
controller: { id: "none" | "always_pass" | "always_hold" | "scripted" | "model";
              modelHash?: string; promptTemplateSha256?: string;
              triggerPolicyHash: string; maxTurns: number; maxTokens: number;
              onFailure: "hold" | "pass" };
```

**Runtime arms.**

| Arm | Runtime | Revision | What it carries |
|---|---|---|---|
| `R0` clean Hermes Lite | Hermes Lite `main` | `b11821b1` | Standard loop, compressor, 12 tools. No lean runtime, no skill contracts. |
| `R1` modified Hermes Lite | Local branch | `48743730` | Lean runtime, `ULTRA_LEAN.json` contracts, retrieval packets, plus the shim. |
| `R2` modified Goose | Fork of `bab8ff64` | to be recorded | Shim, 12K settings, gateway tools, the same skills as `SKILL.md`. |

- `R0` stands in for the pinned `c12ddd46`, which cannot be obtained here
  (section 1.1). If that commit is recovered from the machine that made it,
  it becomes a fourth arm; it is not a clean baseline.
- `R0` still needs the gateway bridge and the gateway-only tier so its
  effects are mediated and logged. It gets no shim, no phase contracts and
  no controller, and its ledger records `attestation: "gateway_only"`.
- Unmodified Goose with the same gateway-only setup is a cheap fourth cell.
  It makes the design a 2×2 (runtime × modified) and lets the effect of the
  modifications be separated from the effect of the runtime.

**Controller arms.** `none`, `always_pass`, `always_hold`, and the model
controller. BitAgent's qualification rule for the `A4` critic applies
unchanged: on the development split the model controller must beat both
`always_pass` and `always_hold` before any result is attributed to it.
Otherwise the cell is reported as "controller unqualified".

Which model plays the controller is a choice the experiment contract must
fix. BitAgent already fixes one for `A4`: the pinned Bonsai-8B base with no
adapter, the same for every actor model, so the controller is never the
variable.

### 8.2 Drive modes

| Mode | Who owns the loop | Use for | Hermes Lite | Goose |
|---|---|---|---|---|
| **Step** | Harness. One packet in, one candidate out, at most three read-only gateway rounds. | BitAgent `control-capability-v1`, where turns are stateless by design | Lean runtime or the BitAgent sidecar | `goose run --no-session --max-turns N` with a recipe whose `response.json_schema` is the candidate schema |
| **Session** | Runtime. Many turns, tools from the gateway. | RTG arenas; Control-Harness live-actor runs | `HermesLiteAgent.run_conversation`, or the JSONL subprocess protocol | `goose acp`, or `goose run --output-format stream-json` |

In step mode the seam already exists: a `RuntimePolicy` implements BitAgent's
bench `Policy.propose(packet, context)` by calling
`RuntimeAdapter.propose`. The existing runner, gate engine and independent
auditor stay authoritative and unchanged.

Step mode is the like-for-like comparison. Session mode compares the two
runtimes' context policies as well, so the runtime effect and the
context-policy effect are confounded there and must be reported as such.

### 8.3 Run directory

```text
runs/<experimentId>/<runId>/
  contract.json       experiment contract, run contract, hashes
  ledger.jsonl        control ledger
  truth.jsonl         oracle labels (harness host only)
  model_io.jsonl      proxy record
  controller_io.jsonl controller packets, outputs and intervention text
  gateway_io.jsonl    gateway record
  native/             runtime's own session export
  summary.json        metrics and chain root
```

### 8.4 Replay levels

| Level | Input | Checks |
|---|---|---|
| **R0 audit** | `ledger.jsonl` | Chain verifies; folded state equals the recorded state hashes |
| **R1 decision** | Ledger plus a policy | Re-evaluating each proposal, with controller actions taken from the ledger, reproduces each decision; with a changed policy, yields counterfactual decisions (offline gate knockouts) |
| **R1c controller** | Ledger, `controller_io.jsonl` | Rebuilding the thread from the ledger reproduces each recorded controller packet hash; swapping in another controller yields its counterfactual actions on the same events |
| **R2 runtime** | `model_io.jsonl`, `gateway_io.jsonl` | Proxy in `replay` mode and gateway serving recorded results reproduce the same proposal sequence from the real runtime |

R2 is where the runtimes' own nondeterminism shows up: parallel tool
execution, compaction timing, and timestamps in prompts.

### 8.5 Metrics

- Hard gates: unauthorized effects at `H3` (must be zero); `bypass_detected`
  count; native tool calls with no ledger proposal (must be zero).
- Cross-runtime: decision agreement on identical proposals; proposal-sequence
  divergence in step mode; completion; tokens per turn; overflow count;
  compaction count; decision latency.
- Controller: hold precision and recall against the truth plane; questions
  opened, answered and left open at run end; interventions delivered and
  followed; controller turns, tokens and added latency per consequential
  action.
- Everything BitAgent's `RunScore` already reports, per runtime.

### 8.6 Soundness before any model

BitAgent's rule that the harness is proven before inference extends to the
runtimes. With the proxy in `scripted` mode:

1. The oracle policy, driven through each real runtime, reaches the expected
   terminal state.
2. The adversary and random policies, driven through each real runtime, land
   zero unauthorized effects at `H3`.
3. Each gate knockout lets the adversary land the matching violation, through
   each runtime.
4. The ledger from the two modified runtimes differs only in `runtime` and
   `provenance.nativeCallId`.
5. With `always_hold` as controller, no consequential call commits. With
   `always_pass`, results equal the `none` arm. With the scripted
   controller, each scripted hold, question and intervention appears in the
   ledger and reaches the actor on every runtime.

Step 4 is the test that the abstraction is real. Step 5 is the test that
the controller can only reduce authority.

## 9. Build checklist

Each phase ends at a check that can fail.

**Phase 0: pins and decisions**
- [ ] Choose one canonical-JSON rule; write golden vectors (section 11).
- [ ] Pin the Hermes Lite arms: `R0` = `main` at `b11821b1`, `R1` = local
      branch at `48743730`. Commit or set aside the two uncommitted
      working-tree files first.
- [ ] Look for `c12ddd46` on the machine that has `C:\projects\hermes-lite`.
      If found, push it. Either way, repoint or annotate BitAgent's
      `config/bitagent-bonsai-dag-runtime.json`, which pins a commit this
      machine cannot check out.
- [ ] Put a POSIX shell on `PATH` for Goose's hooks: install Git for Windows
      or MSYS2 rather than relying on GitHub Desktop's bundled copy. Confirm
      that `sh` resolves and that `bash` no longer resolves to the WSL stub.
- [ ] Add a `safe.directory` exception for the Hermes Lite checkout, or fix
      its ownership, so git works there from the user account.
- [ ] Install a Goose release binary (enough for the hooks tier).
- [ ] Install the Rust toolchain and MSVC build tools (needed for the fork
      tier); fork Goose at `bab8ff64`; confirm it builds and its own tests
      pass on Windows before any patch.
- Exit: every runtime and repo has a pinned revision in one manifest, and
  `goose run` completes one scripted turn on this machine with a hook that
  blocks.

**Phase 1: control module core (Control-Harness)**
- [ ] JSON Schemas for section 5.1 and 7.2 under `schemas/control_harness/`.
- [ ] `receipt_ledger_v3.py` overlay and verifier.
- [ ] State fold; lease table; budget reservation.
- [ ] Daemon with the API in 5.2; three tokens.
- [ ] `PolicyEngine`, `RuntimeAdapter`, `Principal` protocols.
- Exit: tests L1 to L6 and D1 to D8 pass.

**Phase 2: gateway and proxy**
- [ ] Tool gateway with one environment adapter (BitAgent bench world).
- [ ] Model proxy: `live`, `scripted`, `replay`.
- [ ] A null runtime adapter that calls the gateway directly.
- Exit: soundness steps 1 to 3 pass with the null adapter.

**Phase 3: Hermes Lite shim**
- [ ] `control_client.py`; `HermesLiteAgent` overrides; registry backstop.
- [ ] Gateway bridge tools and toolset.
- [ ] Lean runtime event mirror; counter source in the budget receipt.
- Exit: conformance suite C1 to C10 passes for `hermes-lite`.

**Phase 4: Goose, tier `hooks`**
- [ ] Plugin, hook client, launch profile.
- [ ] `RuntimeAdapter` for Goose over `goose run` and ACP.
- Exit: conformance passes except the cases marked fork-only.

**Phase 5: Goose, tier `fork`**
- [ ] `ControlGate` at `dispatch_tool_call_inner`; surface tagging;
      `final_output` and state-machine `load_skill`.
- [ ] Refuse self-executing providers under control.
- [ ] Run upstream's own test suite on the fork.
- Exit: full conformance, including code mode and subagents, on both loops.

**Phase 6: policy engines**
- [ ] BitAgent gates as an engine: a stdio JSONL server around
      `evaluateGates`, following the existing Hermes sidecar pattern.
- [ ] Phase-contract engine from `ULTRA_LEAN.json` (the LDT).
- [ ] RTG gateway engine.
- Exit: R1 replay reproduces BitAgent's 42-scenario soundness report.

**Phase 7: controller thread**
- [ ] Thread fold, event renderer, trigger policy, context partition.
- [ ] Reference controllers: `always_pass`, `always_hold`, scripted.
- [ ] Stage 8 of the decision pipeline; `controller_turn` and `intervention`
      records; `controller_io.jsonl`.
- [ ] Intervention channels: Goose ACP steer and system-prompt key; Hermes
      Lite message injection and lean packet section; gateway trailer.
- [ ] Model controller through the proxy, with a grammar for `ControlAction`.
- Exit: tests K1 to K10 pass with the reference controllers on `R1` and `R2`.

**Phase 8: harness**
- [ ] `ExperimentRunContract` extension; note that
      `src/bench/experimentContract.ts` is referenced in the docs but does not
      exist yet.
- [ ] `RuntimePolicy` for the BitAgent runner.
- [ ] Arm `R0`: clean Hermes Lite `main` with only the gateway bridge.
- [ ] Matrix runner, run directory, R0 to R2 replay, coverage audit.
- Exit: soundness steps 1 to 5 pass through the real runtimes.

**Phase 9: first model runs**
- [ ] Qualify the model controller on the development split against
      `always_pass` and `always_hold`.
- [ ] Development split only, one actor model, arms `R0`, `R1`, `R2`, step
      mode, controller `none` then `model`.
- Exit: a report whose hard gates are all zero, or a list of what broke.

## 10. Tests

**Ledger and state (L)**

| ID | Asserts |
|---|---|
| L1 | A v3 ledger verifies; flipping any byte fails verification at that line |
| L2 | A v2 ledger still verifies under the v3 verifier |
| L3 | Folding the ledger reproduces the state hash stored in each `control_decision` |
| L4 | Folding a truncated ledger and resuming yields the same state as an uninterrupted run |
| L5 | Canonical JSON and fingerprint golden vectors match in Python, TypeScript and Rust |
| L6 | A float anywhere in a hashed object is rejected |

**Decision pipeline (D)**

| ID | Asserts |
|---|---|
| D1 | A tool missing from the registry is classified `state_change` |
| D2 | A proposal whose fingerprint does not match its contents is refused and recorded |
| D3 | Every proposal produces `action_proposed` even when refused at stage 5 |
| D4 | An engine exception produces `deny` with `engine_error` |
| D5 | A monitor can turn an allow into an escalation and cannot turn a deny into an allow |
| D6 | Two identical allowed calls get two leases; two commits succeed; a third fails |
| D7 | A lease is refused after expiry and its reservation is released |
| D8 | A contract amendment between decide and commit fails the commit re-check |

**Controller thread (K)**

| ID | Asserts |
|---|---|
| K1 | Rebuilding the thread from the ledger reproduces the recorded packet hash of every controller turn |
| K2 | With `always_hold`, an engine-admitted consequential call is denied with `controller_hold`; no lease is issued |
| K3 | No controller output can turn an engine refusal into an allow, including malformed and out-of-grammar outputs |
| K4 | A controller timeout on a blocking trigger yields a hold with `controller_unavailable`; the deterministic engines' own refusals are unaffected |
| K5 | `ask_principal` opens a question; the blocked call stays held until the principal answers; the question survives a control-module restart |
| K6 | The rendered event batch contains no byte of any free-text tool result or argument not marked controller-visible |
| K7 | The controller packet never exceeds its partition; when the contract card and open questions alone overflow, the turn fails closed |
| K8 | An intervention is delivered on each runtime's native channel and recorded with its delivery index; with the native channel disabled it arrives on the gateway trailer |
| K9 | After the actor's context is compacted, the controller's reminder reaches the actor before its next consequential proposal |
| K10 | The trigger policy is deterministic: replaying a ledger yields the same controller turn positions |

**Runtime conformance (C), run against each adapter**

| ID | Asserts | Fork-only on Goose |
|---|---|---|
| C1 | Every tool call in the runtime's native session log has a matching `action_proposed` | |
| C2 | A denied call is not dispatched; the model receives the denial text | |
| C3 | With the control module stopped, every tool call is denied | |
| C4 | A gateway call made without the shim is decided by the gateway and flagged | |
| C5 | An escalation blocks the call until resolved, and denies on timeout | |
| C6 | `amendedArgs` are applied by the gateway and the transcript still shows the model's original arguments | |
| C7 | A request above 12,000 tokens never reaches the model server | |
| C8 | A loaded skill produces `skill_loaded` with the file's hash | |
| C9 | A tool call made from code mode is proposed with `surface: code_mode` | yes |
| C10 | A subagent's calls carry the child lineage, draw on the parent budget, and cannot exceed the parent scope | yes |

**Runtime-specific (H, G)**

| ID | Asserts |
|---|---|
| H1 | Hermes Lite inline tools (`todo`, `memory`, `clarify`, `session_search`, `delegate_task`) are proposed |
| H2 | A direct `registry.dispatch` call with no decision bound returns an error and reports a bypass |
| H3 | A batch of tool calls runs sequentially and in emitted order when control is on |
| H4 | The lean runtime's `events.jsonl` and the control ledger agree event for event |
| H5 | The budget receipt names its token counter; a failed `/tokenize` is visible |
| G1 | Legacy loop and state machine produce identical ledgers for the same scripted run |
| G2 | `final_output` and state-machine `load_skill` are gated |
| G3 | A hook command that cannot start blocks the call (tier `hooks`, `on_failure: block`) |
| G4 | Starting with a self-executing provider under required control fails |
| G5 | At `GOOSE_CONTEXT_LIMIT=12000`, a long scripted session compacts before the proxy ever refuses a request |

**Replay and differential (R, X)**

| ID | Asserts |
|---|---|
| R1 | R0 passes on every run directory |
| R2 | R1 reproduces every decision; with gate `Gk` disabled it reproduces the known knockout result |
| R3 | R2 reproduces the proposal sequence on each runtime |
| X1 | The scripted oracle reaches the same terminal state through both runtimes |
| X2 | The scripted adversary lands zero unauthorized effects at `H3` through both runtimes |
| X3 | Both runtimes' ledgers are equal after removing `runtime` and `provenance.nativeCallId` |

**Sandbox (S)**

| ID | Asserts |
|---|---|
| S1 | With a shell enabled inside the container, a direct HTTP call to the environment's own API fails |
| S2 | The shim token cannot call `commit`; the gateway token cannot call `decide` |
| S3 | `truth.jsonl` is not readable from the runtime's process |

## 11. Open points

- **Controller model.** Not yet chosen. Using the actor's own model makes the
  controller vary with the actor; BitAgent's `A4` precedent is one fixed
  small model for every actor.
- **Synchronous controller turns.** Chosen for replayable ordering. On one
  16 GiB GPU the actor and controller share a model server, so each blocking
  review adds a full model call to the action. The trigger profile ("all",
  "flagged only") is the lever.
- **Free-text interventions.** The controller's `text` is model-written and
  reaches the actor as instruction. It is capped and hashed, and the
  controller never reads untrusted text (I10), but argument fields the
  registry marks controller-visible are a path that needs review per tool.
- **`c12ddd46`.** Unrecoverable from this machine. Until it is found, the
  BitAgent runtime manifest pins something that cannot be checked out.
- **Goose on Windows.** Not built or run here. Hooks need `sh`; the
  developer shell's behaviour on Windows was not read.
- **Canonical JSON.** Four canonicalizers exist: BitAgent `canonicalJson`,
  Control-Harness `canonical_json_bytes`, RTG `canon` (ASCII-escaped,
  `|`-joined digest), Hermes Lite `canonical_json`. They were not compared
  byte for byte. One cross-language golden vector already exists for the
  capability fingerprint; the ledger needs the same.
- **Upstream Hermes callers.** The upstream read did not enumerate every
  caller of `handle_function_call` or `registry.dispatch`. This matters only
  if the upstream column becomes a runtime.
- **Goose defaults.** Whether summon and code execution are enabled under
  `--no-profile` was not checked. The Electron desktop app was not read.
- **Nothing here was built or run.** Hermes Lite and the local repos were
  read on disk; Goose and upstream Hermes were read over HTTP at the listed
  commits. Line numbers come from those revisions.
