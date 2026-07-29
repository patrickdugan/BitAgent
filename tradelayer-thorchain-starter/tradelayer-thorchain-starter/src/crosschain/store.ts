import fs from "node:fs/promises";
import path from "node:path";
import type { NearDepositStore, NearDepositWorkflow } from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryNearDepositStore implements NearDepositStore {
  private readonly states = new Map<string, NearDepositWorkflow>();

  async get(id: string) {
    const state = this.states.get(id);
    return state ? clone(state) : null;
  }

  async save(state: NearDepositWorkflow) {
    this.states.set(state.id, clone(state));
  }
}

export class FileNearDepositStore implements NearDepositStore {
  private operation = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async readAll(): Promise<Record<string, NearDepositWorkflow>> {
    try {
      return JSON.parse(await fs.readFile(this.filePath, "utf8")) as Record<string, NearDepositWorkflow>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  async get(id: string) {
    const state = (await this.readAll())[id];
    return state ? clone(state) : null;
  }

  async save(state: NearDepositWorkflow) {
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
}
