import crypto from "node:crypto";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)])
    );
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(normalize(value));
}

export function hashObject(value: unknown) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function opaqueId(prefix: string, value: unknown) {
  return `${prefix}_${hashObject(value).slice(0, 24)}`;
}

export function formatUnits(value: bigint, decimals: number) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function parseDecimal(value: string, decimals: number, fieldName: string) {
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`${fieldName} must be a positive decimal`);
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) throw new Error(`${fieldName} supports at most ${decimals} decimals`);
  return BigInt(whole) * 10n ** BigInt(decimals)
    + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
}
