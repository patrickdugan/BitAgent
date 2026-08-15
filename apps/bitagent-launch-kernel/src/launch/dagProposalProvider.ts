import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { delimiter, resolve } from "node:path";
import { createInterface } from "node:readline";
import { hashObject } from "./canonical.js";
import type { buildDagCandidateTask } from "./dagCandidate.js";
import { LaunchKernelError } from "./errors.js";

const REQUEST_SCHEMA = "hermes.bitagent_dag_model_request.v1";
const RESPONSE_SCHEMA = "hermes.bitagent_dag_model_response.v1";
const MAX_LINE_BYTES = 1024 * 1024;

type DagTaskPacket = ReturnType<typeof buildDagCandidateTask>["packet"];

export type DagProposal = {
  candidate: unknown;
  toolCallsUsed: number;
  toolRoundsUsed: number;
  authority: "candidate_only_no_effect";
  authorization: false;
  signing: false;
  execution: false;
  broadcast: false;
  secretAccess: false;
  source: string;
};

export interface DagProposalProvider {
  readonly source: string;
  propose(task: DagTaskPacket): Promise<DagProposal>;
  close?(): Promise<void>;
}

type Pending = {
  resolve: (value: DagProposal) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export class UnavailableDagProposalProvider implements DagProposalProvider {
  readonly source = "unavailable";

  async propose(): Promise<DagProposal> {
    throw new LaunchKernelError(
      "provider_unavailable",
      "Hermes/Bonsai DAG proposal runtime is not configured"
    );
  }
}

export class HermesStdioDagProposalProvider implements DagProposalProvider {
  readonly source = "hermes_lite_owned_stdio";
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private stderr = "";

  constructor(private readonly options: {
    cwd: string;
    python?: string;
    config?: string;
    timeoutMs?: number;
  }) {
    if (!options.cwd) throw new Error("Hermes Lite cwd is required");
  }

  private start() {
    if (this.child) return;
    const cwd = resolve(this.options.cwd);
    const python = this.options.python || "python";
    const config = this.options.config || "configs/bitagent_dag_model_sidecar_v1.json";
    const env = {
      ...process.env,
      PYTHONPATH: process.env.PYTHONPATH
        ? `${resolve(cwd, "src")}${delimiter}${process.env.PYTHONPATH}`
        : resolve(cwd, "src")
    };
    this.stderr = "";
    const child = spawn(
      python,
      ["-m", "agent.bitagent_dag_model_sidecar_v1", "--config", config, "serve"],
      {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
    this.child = child;
    createInterface({ input: child.stdout }).on("line", (line) => this.receive(line));
    child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-4_000);
    });
    child.once("error", () => this.rejectAll("Hermes DAG sidecar failed to start"));
    child.once("exit", () => {
      if (this.child === child) this.child = null;
      this.rejectAll("Hermes DAG sidecar exited before returning a candidate");
    });
  }

  async propose(task: DagTaskPacket): Promise<DagProposal> {
    this.start();
    const child = this.child;
    if (!child) throw new LaunchKernelError("provider_unavailable", "Hermes DAG sidecar did not start");
    const requestId = randomUUID();
    const value = {
      schema: REQUEST_SCHEMA,
      request_id: requestId,
      operation: "propose",
      task
    };
    const line = JSON.stringify(value);
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
      throw new LaunchKernelError("validation_error", "Hermes DAG sidecar request exceeds 1 MiB");
    }
    return new Promise<DagProposal>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        rejectPromise(new LaunchKernelError("provider_unavailable", "Hermes DAG sidecar timed out"));
      }, this.options.timeoutMs || 480_000);
      this.pending.set(requestId, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timer
      });
      child.stdin.write(`${line}\n`, "utf8", (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(requestId);
        rejectPromise(new LaunchKernelError("provider_unavailable", "Hermes DAG sidecar write failed"));
      });
    });
  }

  private receive(line: string) {
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) return;
    let value: Record<string, unknown>;
    try {
      value = record(JSON.parse(line));
    } catch {
      return;
    }
    if (value.schema !== RESPONSE_SCHEMA || typeof value.request_id !== "string") return;
    const pending = this.pending.get(value.request_id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(value.request_id);
    const core = {
      request_id: value.request_id,
      ok: value.ok,
      authority: value.authority,
      result: value.result ?? null,
      error: value.error ?? null
    };
    if (value.response_sha256 !== hashObject(core)) {
      pending.reject(new LaunchKernelError("provider_unavailable", "Hermes DAG response hash mismatch"));
      return;
    }
    if (value.ok !== true) {
      if (value.authority !== "no_effect") {
        pending.reject(new LaunchKernelError("provider_unavailable", "Hermes DAG error authority mismatch"));
        return;
      }
      const error = record(value.error);
      const code = typeof error.code === "string" ? error.code : "sidecar_error";
      pending.reject(new LaunchKernelError(
        "provider_unavailable",
        code === "runtime_not_ready"
          ? "Hermes/Bonsai DAG runtime is not operator-promoted to ready"
          : "Hermes DAG sidecar rejected the proposal request"
      ));
      return;
    }
    const result = record(value.result);
    const toolCallsUsed = Number(result.tool_calls_used);
    const toolRoundsUsed = Number(result.tool_rounds_used);
    if (value.authority !== "candidate_only_no_effect"
      || result.authority !== "candidate_only_no_effect"
      || result.authorization !== false
      || result.signing !== false
      || result.execution !== false
      || result.broadcast !== false
      || result.secret_access !== false
      || !Number.isSafeInteger(toolCallsUsed)
      || toolCallsUsed < 0
      || toolCallsUsed > 6
      || !Number.isSafeInteger(toolRoundsUsed)
      || toolRoundsUsed < 0
      || toolRoundsUsed > 3
      || !("candidate" in result)) {
      pending.reject(new LaunchKernelError("provider_unavailable", "Hermes DAG authority boundary mismatch"));
      return;
    }
    pending.resolve({
      candidate: result.candidate,
      toolCallsUsed,
      toolRoundsUsed,
      authority: "candidate_only_no_effect",
      authorization: false,
      signing: false,
      execution: false,
      broadcast: false,
      secretAccess: false,
      source: this.source
    });
  }

  private rejectAll(message: string) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new LaunchKernelError("provider_unavailable", message));
    }
    this.pending.clear();
  }

  async close() {
    const child = this.child;
    if (!child) return;
    child.stdin.end();
    await new Promise<void>((resolvePromise) => {
      const timer = setTimeout(() => {
        if (this.child === child) child.kill();
        resolvePromise();
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
  }
}

export function defaultDagProposalProvider(): DagProposalProvider {
  const cwd = String(process.env.BITAGENT_HERMES_ROOT || "").trim();
  if (!cwd) return new UnavailableDagProposalProvider();
  const timeoutText = String(process.env.BITAGENT_HERMES_TIMEOUT_MS || "").trim();
  const timeoutMs = timeoutText ? Number(timeoutText) : undefined;
  if (timeoutMs !== undefined
    && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000)) {
    throw new Error("BITAGENT_HERMES_TIMEOUT_MS must be 1000 to 600000 milliseconds");
  }
  return new HermesStdioDagProposalProvider({
    cwd,
    python: String(process.env.BITAGENT_HERMES_PYTHON || "").trim() || undefined,
    config: String(process.env.BITAGENT_HERMES_DAG_CONFIG || "").trim() || undefined,
    timeoutMs
  });
}
