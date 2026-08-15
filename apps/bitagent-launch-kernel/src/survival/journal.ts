import fs from "node:fs/promises";
import path from "node:path";
import { survivalJournalPath } from "../config.js";
import { canonicalHash } from "./policy.js";
import type { SurvivalJournalRecord } from "./types.js";

const GENESIS_HASH = "0".repeat(64);
let appendQueue: Promise<unknown> = Promise.resolve();

async function loadRecords(): Promise<SurvivalJournalRecord[]> {
  try {
    const raw = await fs.readFile(survivalJournalPath, "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SurvivalJournalRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function verifySurvivalJournal(records: SurvivalJournalRecord[]): boolean {
  let previousHash = GENESIS_HASH;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.sequence !== index || record.previousHash !== previousHash) return false;
    const { hash, ...material } = record;
    if (canonicalHash(material) !== hash) return false;
    previousHash = hash;
  }
  return true;
}

export async function appendSurvivalEvent(input: {
  type: SurvivalJournalRecord["type"];
  occurredAt?: string;
  intentId?: string;
  payload: unknown;
}): Promise<SurvivalJournalRecord> {
  const operation = appendQueue.then(async () => {
    const records = await loadRecords();
    if (!verifySurvivalJournal(records)) throw new Error("Financial survival journal failed integrity verification");
    const material = {
      sequence: records.length,
      eventId: canonicalHash({ type: input.type, intentId: input.intentId, payload: input.payload, sequence: records.length }),
      type: input.type,
      occurredAt: input.occurredAt || new Date().toISOString(),
      intentId: input.intentId,
      payloadHash: canonicalHash(input.payload),
      previousHash: records.at(-1)?.hash || GENESIS_HASH
    };
    const record: SurvivalJournalRecord = { ...material, hash: canonicalHash(material) };
    await fs.mkdir(path.dirname(survivalJournalPath), { recursive: true });
    await fs.appendFile(survivalJournalPath, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  });
  appendQueue = operation.catch(() => undefined);
  return operation;
}

export async function resetSurvivalJournal() {
  await fs.mkdir(path.dirname(survivalJournalPath), { recursive: true });
  await fs.writeFile(survivalJournalPath, "", "utf8");
}

export async function readSurvivalJournal() {
  return loadRecords();
}
