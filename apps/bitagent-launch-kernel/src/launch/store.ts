import fs from "node:fs/promises";
import path from "node:path";
import type { BitAgentWorkflowState, WorkflowStore } from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryWorkflowStore implements WorkflowStore {
  private readonly states = new Map<string, BitAgentWorkflowState>();

  async get(id: string) {
    const state = this.states.get(id);
    return state ? clone(state) : null;
  }

  async save(state: BitAgentWorkflowState) {
    this.states.set(state.id, clone(state));
  }

  async list() {
    return [...this.states.values()].map(clone);
  }
}

export class FileWorkflowStore implements WorkflowStore {
  private operation = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async readAll(): Promise<Record<string, BitAgentWorkflowState>> {
    try {
      return JSON.parse(await fs.readFile(this.filePath, "utf8")) as Record<string, BitAgentWorkflowState>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  async get(id: string) {
    const state = (await this.readAll())[id];
    return state ? clone(state) : null;
  }

  async save(state: BitAgentWorkflowState) {
    this.operation = this.operation.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const all = await this.readAll();
      all[state.id] = clone(state);
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(all, null, 2)}\n`, "utf8");
      await fs.rename(temporary, this.filePath);
    });
    return this.operation;
  }

  async list() {
    return Object.values(await this.readAll()).map(clone);
  }
}
