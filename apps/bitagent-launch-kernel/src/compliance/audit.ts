import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { complianceAuditPath } from "../config.js";
import { complianceHash } from "./policy.js";

export const COMPLIANCE_AUDIT_EVENT_TYPES = [
  "jurisdiction_policy_checked",
  "product_allowed",
  "product_blocked",
  "leverage_cap_applied",
  "referral_created",
  "referral_rebound",
  "referral_expired",
  "contact_permission_granted",
  "contact_permission_revoked",
  "agent_assisted_message_prepared",
  "human_send_confirmed",
  "financial_vulnerability_triggered",
  "agent_provenance_changed",
  "stego_hive_review_triggered",
  "manual_override_used"
] as const;

export type ComplianceAuditEventType = (typeof COMPLIANCE_AUDIT_EVENT_TYPES)[number];

export type ComplianceAuditEvent = Readonly<{
  schema: "bitagent_compliance_audit_event_v1";
  sequence: number;
  event_id: string;
  event_type: ComplianceAuditEventType;
  occurred_at: string;
  policy_version?: string;
  principal_id?: string;
  metadata: Readonly<Record<string, unknown>>;
  previous_hash: string;
  hash: string;
}>;

export type ComplianceAuditAppendInput = {
  event_type: ComplianceAuditEventType;
  policy_version?: string;
  principal_id?: string;
  metadata?: Record<string, unknown>;
};

const FORBIDDEN_AUDIT_KEY = /(?:full[_-]?name|phone|email|photo|contact[_-]?notes?|address|raw[_-]?contact|contact[_-]?graph|message[_-]?(?:text|content|body)|wallet[_-]?(?:key|secret)|seed|mnemonic|private[_-]?key)/i;
const HASH = /^[0-9a-f]{64}$/;

function sanitizeMetadata(value: unknown, path = "metadata"): unknown {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => sanitizeMetadata(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") throw new Error(`${path} contains an unsupported audit value`);
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_AUDIT_KEY.test(key)) throw new Error(`${path}.${key} is prohibited in compliance audit metadata`);
    result[key] = sanitizeMetadata(item, `${path}.${key}`);
  }
  return result;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}

export class InMemoryComplianceAuditLog {
  private readonly events: ComplianceAuditEvent[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  append(input: ComplianceAuditAppendInput): ComplianceAuditEvent {
    const event = createComplianceAuditEvent({
      input,
      sequence: this.events.length,
      previousHash: this.events.at(-1)?.hash || "0".repeat(64),
      now: this.now
    });
    this.events.push(event);
    return event;
  }

  list(): ComplianceAuditEvent[] {
    return [...this.events];
  }
}

export function createComplianceAuditEvent(options: {
  input: ComplianceAuditAppendInput;
  sequence: number;
  previousHash: string;
  now?: () => Date;
}): ComplianceAuditEvent {
    const input = options.input;
    if (!COMPLIANCE_AUDIT_EVENT_TYPES.includes(input.event_type)) {
      throw new Error("Unknown compliance audit event type");
    }
    if (!Number.isSafeInteger(options.sequence) || options.sequence < 0 || !HASH.test(options.previousHash)) {
      throw new Error("Invalid compliance audit chain position");
    }
    const occurredAt = (options.now || (() => new Date()))();
    if (!(occurredAt instanceof Date) || !Number.isFinite(occurredAt.getTime())) {
      throw new Error("Compliance audit clock returned an invalid date");
    }
    const metadata = sanitizeMetadata(input.metadata || {}) as Record<string, unknown>;
    if (input.event_type === "manual_override_used") {
      if (
        typeof metadata.human_administrative_principal_id !== "string"
        || !String(metadata.human_administrative_principal_id).trim()
        || typeof metadata.approval_receipt_hash !== "string"
        || !HASH.test(metadata.approval_receipt_hash)
      ) {
        throw new Error("Manual override audit requires a human administrative principal and approval receipt hash");
      }
    }
    const material = {
      schema: "bitagent_compliance_audit_event_v1" as const,
      sequence: options.sequence,
      event_id: randomUUID(),
      event_type: input.event_type,
      occurred_at: occurredAt.toISOString(),
      policy_version: input.policy_version,
      principal_id: input.principal_id,
      metadata,
      previous_hash: options.previousHash
    };
    return deepFreeze({ ...material, hash: complianceHash(material) });
}

export function verifyComplianceAuditLog(events: ComplianceAuditEvent[]) {
  let previousHash = "0".repeat(64);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const { hash, ...material } = event;
    if (event.sequence !== index || event.previous_hash !== previousHash || complianceHash(material) !== hash) return false;
    previousHash = hash;
  }
  return true;
}

export class FileComplianceAuditLog {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath = complianceAuditPath,
    private readonly now: () => Date = () => new Date()
  ) {}

  async list(): Promise<ComplianceAuditEvent[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const events = raw.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line) as ComplianceAuditEvent;
      } catch {
        throw new Error(`Compliance audit contains invalid JSON at line ${index + 1}`);
      }
    });
    if (!verifyComplianceAuditLog(events)) {
      throw new Error("Compliance audit failed hash-chain integrity verification");
    }
    return events.map((event) => deepFreeze(event));
  }

  append(input: ComplianceAuditAppendInput): Promise<ComplianceAuditEvent> {
    const operation = this.queue.then(async () => {
      const events = await this.list();
      const event = createComplianceAuditEvent({
        input,
        sequence: events.length,
        previousHash: events.at(-1)?.hash || "0".repeat(64),
        now: this.now
      });
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const handle = await fs.open(this.filePath, "a");
      try {
        await handle.appendFile(`${JSON.stringify(event)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return event;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
