import crypto from "node:crypto";
import { hashObject } from "../launch/canonical.js";
import { SignalKernelError } from "./errors.js";
import type { AlgorithmicTradeSignal, SignalRiskPolicy } from "./types.js";

const SIGNAL_KEYS = new Set([
  "schema", "signalId", "codebase", "producerKeyId", "strategyId", "strategyVersion", "market", "side",
  "amountSats", "limitPriceUsd", "postOnly", "generatedAt", "expiresAt", "inputSnapshotHash", "payloadHash", "signature"
]);
const CODEBASE_KEYS = new Set(["codebaseId", "kind", "digest"]);
const SECRET_KEY = /private.?key|seed.?phrase|mnemonic|wif|api.?key|secret/i;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SignalKernelError("signal_schema_error", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectSecrets(value: unknown, path = "signal"): void {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) {
      throw new SignalKernelError("secret_material_prohibited", `Secret-bearing field is prohibited: ${path}.${key}`);
    }
    rejectSecrets(item, `${path}.${key}`);
  }
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, label: string) {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw new SignalKernelError("signal_schema_error", `${label} contains unexpected fields: ${unexpected.join(", ")}`);
  }
}

function text(value: unknown, field: string, pattern?: RegExp): string {
  if (typeof value !== "string" || !value || (pattern && !pattern.test(value))) {
    throw new SignalKernelError("signal_schema_error", `${field} is invalid`);
  }
  return value;
}

export function signalHashMaterial(signal: Omit<AlgorithmicTradeSignal, "payloadHash" | "signature">) {
  return signal;
}

export function createAlgorithmicTradeSignal(
  input: Omit<AlgorithmicTradeSignal, "payloadHash" | "signature">,
  signPayloadHash: (payloadHash: string) => string
): AlgorithmicTradeSignal {
  const payloadHash = hashObject(signalHashMaterial(input));
  return { ...input, payloadHash, signature: signPayloadHash(payloadHash) };
}

export function validateAlgorithmicTradeSignal(
  raw: unknown,
  policy: SignalRiskPolicy,
  now = new Date()
): AlgorithmicTradeSignal {
  rejectSecrets(raw);
  const value = record(raw, "signal");
  exactKeys(value, SIGNAL_KEYS, "signal");
  const codebase = record(value.codebase, "signal.codebase");
  exactKeys(codebase, CODEBASE_KEYS, "signal.codebase");

  const kind = text(codebase.kind, "codebase.kind");
  if (kind !== "git_commit" && kind !== "sha256_source_tree") {
    throw new SignalKernelError("signal_schema_error", "codebase.kind is unsupported");
  }
  const digest = text(
    codebase.digest,
    "codebase.digest",
    kind === "git_commit" ? /^[0-9a-f]{40}$/i : /^[0-9a-f]{64}$/i
  ).toLowerCase();
  const signal: AlgorithmicTradeSignal = {
    schema: text(value.schema, "schema") as AlgorithmicTradeSignal["schema"],
    signalId: text(value.signalId, "signalId", /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
    codebase: {
      codebaseId: text(codebase.codebaseId, "codebase.codebaseId", /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
      kind,
      digest
    },
    producerKeyId: text(value.producerKeyId, "producerKeyId", /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
    strategyId: text(value.strategyId, "strategyId", /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
    strategyVersion: text(value.strategyVersion, "strategyVersion", /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
    market: text(value.market, "market") as AlgorithmicTradeSignal["market"],
    side: text(value.side, "side") as AlgorithmicTradeSignal["side"],
    amountSats: text(value.amountSats, "amountSats", /^[1-9][0-9]*$/),
    limitPriceUsd: text(value.limitPriceUsd, "limitPriceUsd", /^[1-9][0-9]*(?:\.[0-9]{1,2})?$/),
    postOnly: value.postOnly as true,
    generatedAt: text(value.generatedAt, "generatedAt"),
    expiresAt: text(value.expiresAt, "expiresAt"),
    inputSnapshotHash: text(value.inputSnapshotHash, "inputSnapshotHash", /^[0-9a-f]{64}$/i).toLowerCase(),
    payloadHash: text(value.payloadHash, "payloadHash", /^[0-9a-f]{64}$/i).toLowerCase(),
    signature: text(value.signature, "signature", /^[A-Za-z0-9+/]+={0,2}$/)
  };

  if (signal.schema !== "bitagent_tradelayer_signal_v1"
    || signal.market !== "TLBTC/TLUSD"
    || !["buy_tlbtc", "sell_tlbtc"].includes(signal.side)
    || signal.postOnly !== true) {
    throw new SignalKernelError("signal_schema_error", "Signal must be a post-only TLBTC/TLUSD limit order");
  }
  const generatedAt = Date.parse(signal.generatedAt);
  const expiresAt = Date.parse(signal.expiresAt);
  if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt) || expiresAt <= generatedAt) {
    throw new SignalKernelError("signal_schema_error", "Signal timestamps are invalid");
  }
  if (generatedAt > now.getTime() + 5_000) {
    throw new SignalKernelError("signal_schema_error", "Signal generation time is in the future");
  }
  if (expiresAt <= now.getTime() || now.getTime() - generatedAt > policy.maxSignalAgeSeconds * 1_000) {
    throw new SignalKernelError("signal_expired", "Signal is expired or older than policy permits");
  }
  if (expiresAt - generatedAt > policy.maxSignalTtlSeconds * 1_000) {
    throw new SignalKernelError("signal_expired", "Signal validity window exceeds policy");
  }
  if (!policy.approvedStrategies.some(
    (item) => item.strategyId === signal.strategyId && item.strategyVersion === signal.strategyVersion
  )) {
    throw new SignalKernelError("strategy_unapproved", "Signal strategy and version are not operator-approved");
  }
  const { payloadHash: _ignored, signature: _signature, ...material } = signal;
  if (hashObject(signalHashMaterial(material)) !== signal.payloadHash) {
    throw new SignalKernelError("signal_schema_error", "Signal payload hash does not match its canonical contents");
  }
  const producer = policy.approvedProducers.find(
    (item) => item.producerKeyId === signal.producerKeyId && item.codebaseId === signal.codebase.codebaseId
  );
  if (!producer) {
    throw new SignalKernelError("signal_signature_invalid", "Signal producer key is not approved for this codebase");
  }
  try {
    const valid = crypto.verify(
      null,
      Buffer.from(signal.payloadHash, "hex"),
      producer.publicKeyPem,
      Buffer.from(signal.signature, "base64")
    );
    if (!valid) throw new Error("signature mismatch");
  } catch (error) {
    throw new SignalKernelError("signal_signature_invalid", "Signal producer signature is invalid", error);
  }
  return signal;
}
