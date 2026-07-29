import fs from "node:fs/promises";
import path from "node:path";
import type { SignalWorkflowState, SignalWorkflowStore } from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemorySignalWorkflowStore implements SignalWorkflowStore {
  private readonly states = new Map<string, SignalWorkflowState>();

  async get(id: string) {
    const state = this.states.get(id);
    return state ? clone(state) : null;
  }

  async save(state: SignalWorkflowState) {
    this.states.set(state.id, clone(state));
  }

  async list() {
    return [...this.states.values()].map(clone);
  }
}

export class FileSignalWorkflowStore implements SignalWorkflowStore {
  private operation = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async readAll(): Promise<Record<string, SignalWorkflowState>> {
    try {
      return JSON.parse(await fs.readFile(this.filePath, "utf8")) as Record<string, SignalWorkflowState>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  async get(id: string) {
    const state = (await this.readAll())[id];
    return state ? clone(state) : null;
  }

  async save(state: SignalWorkflowState) {
    this.operation = this.operation.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const all = await this.readAll();
      all[state.id] = clone(state);
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(all, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporary, this.filePath);
    });
    return this.operation;
  }

  async list() {
    return Object.values(await this.readAll()).map(clone);
  }
}
