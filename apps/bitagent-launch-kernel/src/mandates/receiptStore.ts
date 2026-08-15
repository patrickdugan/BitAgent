import fs from "node:fs/promises";
import path from "node:path";
import { StrategyMandateError } from "./errors.js";
import type { StrategyDecisionReceipt } from "./types.js";
import { verifyStrategyDecisionReceipt } from "./verifier.js";

export class FileStrategyReceiptStore {
  constructor(private readonly directory: string) {}

  async save(receipt: StrategyDecisionReceipt) {
    if (!verifyStrategyDecisionReceipt(receipt)) {
      throw new StrategyMandateError("candidate_invalid", "Decision receipt fingerprint is invalid");
    }
    await fs.mkdir(this.directory, { recursive: true });
    const target = path.join(this.directory, `${receipt.receiptId}.json`);
    const temporary = `${target}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      let existingText: string | undefined;
      try {
        existingText = await fs.readFile(target, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await fs.rename(temporary, target);
        return target;
      }
      let existing: StrategyDecisionReceipt;
      try {
        existing = JSON.parse(existingText) as StrategyDecisionReceipt;
      } catch (error) {
        throw new StrategyMandateError("candidate_invalid", `Existing receipt is corrupt: ${receipt.receiptId}`, error);
      }
      if (!verifyStrategyDecisionReceipt(existing) || existing.receiptHash !== receipt.receiptHash) {
        throw new StrategyMandateError("candidate_invalid", `Receipt ID collision or tampering: ${receipt.receiptId}`);
      }
      await fs.unlink(temporary);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    return target;
  }

  async list() {
    try {
      const names = (await fs.readdir(this.directory)).filter((name) => name.endsWith(".json")).sort();
      const receipts = await Promise.all(names.map(async (name) =>
        JSON.parse(await fs.readFile(path.join(this.directory, name), "utf8")) as StrategyDecisionReceipt));
      if (receipts.some((receipt) => !verifyStrategyDecisionReceipt(receipt))) {
        throw new StrategyMandateError("candidate_invalid", "Stored decision receipt failed verification");
      }
      return receipts;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
