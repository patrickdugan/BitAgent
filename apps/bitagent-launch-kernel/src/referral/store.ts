import path from "node:path";
import { promises as fs } from "node:fs";
import { writeAtomicStatusFile } from "../launch/atomicStatusFile.js";
import type { ReferralRegistryState } from "./types.js";

export function emptyReferralRegistryState(): ReferralRegistryState {
  return {
    schema: "bitagent_referral_registry_v1",
    bindings: [],
    invitations: [],
    accruals: [],
    vesting_assignments: [],
    fee_accumulators: {},
    recovery_actions: []
  };
}

export interface ReferralRegistryStore {
  load(): Promise<ReferralRegistryState>;
  save(state: ReferralRegistryState): Promise<void>;
}

export class InMemoryReferralRegistryStore implements ReferralRegistryStore {
  private state = emptyReferralRegistryState();

  async load() {
    return structuredClone(this.state);
  }

  async save(state: ReferralRegistryState) {
    this.state = structuredClone(state);
  }
}

export class FileReferralRegistryStore implements ReferralRegistryStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<ReferralRegistryState> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8")) as ReferralRegistryState;
      if (parsed.schema !== "bitagent_referral_registry_v1") throw new Error("Unsupported referral registry schema");
      return structuredClone(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyReferralRegistryState();
      throw error;
    }
  }

  async save(state: ReferralRegistryState) {
    this.queue = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await writeAtomicStatusFile(this.filePath, state);
    });
    return this.queue;
  }
}
