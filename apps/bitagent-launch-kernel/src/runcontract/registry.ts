import { hashObject } from "../launch/canonical.js";
import { RunContractError } from "./errors.js";
import type {
  EvidenceFlag,
  EvidenceKind,
  EvidenceReceipt,
  EvidenceTrust,
  EvidenceTyped
} from "./types.js";

export type EvidenceInput = {
  kind: EvidenceKind;
  source: { id: string; trust: EvidenceTrust };
  chain?: string;
  observedAt: string;
  expiresAt?: string;
  sequence?: string;
  typed: EvidenceTyped;
  // Free text from outside the host, keyed by field path. Stored apart from the receipt.
  untrustedText?: Record<string, string>;
  flags?: EvidenceFlag[];
};

// Host-owned registry of observations. A fact is usable only if its receipt was issued here; the
// root is a hash chain over issued receipt IDs, so a receipt cannot be back-dated into a run.
export class EvidenceRegistry {
  private readonly receipts = new Map<string, EvidenceReceipt>();
  private readonly texts = new Map<string, Record<string, string>>();
  private rootHash: string;

  constructor(runId: string) {
    this.rootHash = hashObject({ schema: "bitagent.evidence_registry.v1", runId });
  }

  get root() {
    return this.rootHash;
  }

  register(input: EvidenceInput): EvidenceReceipt {
    if (!Number.isFinite(Date.parse(input.observedAt))) {
      throw new RunContractError("evidence_invalid", "Evidence observedAt must be an ISO timestamp");
    }
    const text = input.untrustedText && Object.keys(input.untrustedText).length > 0 ? input.untrustedText : undefined;
    const taintedText = text
      ? { fieldPaths: Object.keys(text).sort(), sha256: hashObject(text) }
      : undefined;
    const payloadSha256 = hashObject({
      kind: input.kind,
      source: input.source,
      chain: input.chain,
      observedAt: input.observedAt,
      expiresAt: input.expiresAt,
      sequence: input.sequence,
      typed: input.typed,
      taintedText
    });
    const id = `${input.kind}:${payloadSha256.slice(0, 24)}`;
    const existing = this.receipts.get(id);
    if (existing) return existing;
    const flags = new Set(input.flags || []);
    if (taintedText) flags.add("contains_untrusted_text");
    this.rootHash = hashObject({ previous: this.rootHash, id });
    const receipt: EvidenceReceipt = {
      schema: "bitagent.evidence_receipt.v1",
      id,
      kind: input.kind,
      source: { ...input.source },
      ...(input.chain ? { chain: input.chain } : {}),
      observedAt: input.observedAt,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      ...(input.sequence ? { sequence: input.sequence } : {}),
      typed: { ...input.typed },
      ...(taintedText ? { taintedText } : {}),
      flags: [...flags].sort(),
      payloadSha256,
      registryRoot: this.rootHash
    };
    this.receipts.set(id, receipt);
    if (text) this.texts.set(id, { ...text });
    return receipt;
  }

  resolve(id: string) {
    return this.receipts.get(id);
  }

  require(id: string) {
    const receipt = this.receipts.get(id);
    if (!receipt) throw new RunContractError("evidence_unregistered", `Evidence is not registered: ${id}`);
    return receipt;
  }

  untrustedText(id: string) {
    return this.texts.get(id);
  }

  list() {
    return [...this.receipts.values()];
  }
}
