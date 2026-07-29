export type TreasuryAccount =
  | "available"
  | "reserved"
  | "unrealized"
  | "settled"
  | "infrastructure"
  | "protected_reserve"
  | "external";

export type LedgerPosting = {
  sequence: number;
  postingId: string;
  occurredAt: string;
  description: string;
  debit: TreasuryAccount;
  credit: TreasuryAccount;
  amountSats: string;
  evidenceRefs: string[];
  previousHash: string;
  hash: string;
};

export type TreasuryBalances = Record<TreasuryAccount, string>;

