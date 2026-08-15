import { promises as fs } from "node:fs";
import path from "node:path";
import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";
import type { LedgerPosting, TreasuryAccount, TreasuryBalances } from "./types.js";

const GENESIS_HASH = "0".repeat(64);
const ACCOUNTS: TreasuryAccount[] = [
  "available",
  "reserved",
  "unrealized",
  "settled",
  "infrastructure",
  "protected_reserve",
  "external"
];

function amount(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) throw new IntegrationBoundaryError("ledger_error", "Ledger amount must be a positive integer string");
  return BigInt(value);
}

export function verifyLedger(postings: LedgerPosting[]): boolean {
  let previousHash = GENESIS_HASH;
  const ids = new Set<string>();
  for (let sequence = 0; sequence < postings.length; sequence += 1) {
    const posting = postings[sequence];
    if (!posting || posting.sequence !== sequence || posting.previousHash !== previousHash || ids.has(posting.postingId)) return false;
    if (posting.debit === posting.credit || posting.evidenceRefs.length === 0) return false;
    try {
      amount(posting.amountSats);
    } catch {
      return false;
    }
    const { hash, ...material } = posting;
    if (canonicalHash(material) !== hash) return false;
    ids.add(posting.postingId);
    previousHash = hash;
  }
  return true;
}

export class TreasuryLedger {
  private readonly postings: LedgerPosting[];
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly journalPath?: string, initialPostings: LedgerPosting[] = []) {
    if (!verifyLedger(initialPostings)) throw new IntegrationBoundaryError("ledger_error", "Initial treasury ledger failed verification");
    this.postings = [...initialPostings];
  }

  static async load(journalPath: string): Promise<TreasuryLedger> {
    try {
      const content = await fs.readFile(journalPath, "utf8");
      const postings = content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as LedgerPosting);
      return new TreasuryLedger(journalPath, postings);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return new TreasuryLedger(journalPath);
      throw new IntegrationBoundaryError("ledger_error", "Could not load treasury ledger", error);
    }
  }

  list(): LedgerPosting[] {
    return this.postings.map((posting) => ({ ...posting, evidenceRefs: [...posting.evidenceRefs] }));
  }

  balance(account: TreasuryAccount): bigint {
    return this.postings.reduce((total, posting) => {
      const value = BigInt(posting.amountSats);
      if (posting.debit === account) return total + value;
      if (posting.credit === account) return total - value;
      return total;
    }, 0n);
  }

  balances(): TreasuryBalances {
    return Object.fromEntries(ACCOUNTS.map((account) => [account, this.balance(account).toString()])) as TreasuryBalances;
  }

  post(input: Omit<LedgerPosting, "sequence" | "previousHash" | "hash">): Promise<LedgerPosting> {
    const operation = this.writeQueue.then(async () => {
      if (this.postings.some((posting) => posting.postingId === input.postingId)) {
        throw new IntegrationBoundaryError("ledger_error", "Duplicate ledger posting ID", { postingId: input.postingId });
      }
      if (input.debit === input.credit || input.evidenceRefs.length === 0) {
        throw new IntegrationBoundaryError("ledger_error", "Ledger posting requires distinct accounts and evidence");
      }
      amount(input.amountSats);
      const material = {
        ...input,
        sequence: this.postings.length,
        evidenceRefs: [...new Set(input.evidenceRefs)].sort(),
        previousHash: this.postings.at(-1)?.hash || GENESIS_HASH
      };
      const posting: LedgerPosting = { ...material, hash: canonicalHash(material) };
      if (this.journalPath) {
        await fs.mkdir(path.dirname(this.journalPath), { recursive: true });
        await fs.appendFile(this.journalPath, `${JSON.stringify(posting)}\n`, "utf8");
      }
      this.postings.push(posting);
      return { ...posting, evidenceRefs: [...posting.evidenceRefs] };
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  openAvailable(amountSats: string, evidenceRef: string, occurredAt: string): Promise<LedgerPosting> {
    return this.post({
      postingId: `open-available:${evidenceRef}`,
      occurredAt,
      description: "Recognize externally observed available treasury",
      debit: "available",
      credit: "external",
      amountSats,
      evidenceRefs: [evidenceRef]
    });
  }

  recognizeUnrealized(amountSats: string, evidenceRef: string, occurredAt: string): Promise<LedgerPosting> {
    return this.post({
      postingId: `unrealized:${evidenceRef}`,
      occurredAt,
      description: "Record projected revenue as non-spendable unrealized value",
      debit: "unrealized",
      credit: "external",
      amountSats,
      evidenceRefs: [evidenceRef]
    });
  }

  async settleRevenue(amountSats: string, evidenceRefs: string[], occurredAt: string): Promise<LedgerPosting> {
    if (this.balance("unrealized") < amount(amountSats)) {
      throw new IntegrationBoundaryError("ledger_error", "Settlement exceeds unrealized revenue");
    }
    return await this.post({
      postingId: `settled:${canonicalHash(evidenceRefs)}`,
      occurredAt,
      description: "Move chain-verified revenue from unrealized to settled",
      debit: "settled",
      credit: "unrealized",
      amountSats,
      evidenceRefs
    });
  }

  async releaseSettled(amountSats: string, evidenceRef: string, occurredAt: string): Promise<LedgerPosting> {
    if (this.balance("settled") < amount(amountSats)) {
      throw new IntegrationBoundaryError("ledger_error", "Release exceeds settled revenue");
    }
    return await this.post({
      postingId: `release:${evidenceRef}`,
      occurredAt,
      description: "Release reconciled settled revenue into available treasury",
      debit: "available",
      credit: "settled",
      amountSats,
      evidenceRefs: [evidenceRef]
    });
  }

  async spendInfrastructure(amountSats: string, evidenceRef: string, occurredAt: string): Promise<LedgerPosting> {
    if (this.balance("available") < amount(amountSats)) {
      throw new IntegrationBoundaryError("ledger_error", "Infrastructure spend exceeds available treasury");
    }
    return await this.post({
      postingId: `infrastructure:${evidenceRef}`,
      occurredAt,
      description: "Recognize an authorized infrastructure expense",
      debit: "infrastructure",
      credit: "available",
      amountSats,
      evidenceRefs: [evidenceRef]
    });
  }
}
