import { ChatGptPluginError } from "./errors.js";

type Described = { description?: string };

export type Schema =
  | (Described & {
    type: "object";
    properties: Record<string, Schema>;
    required: string[];
    additionalProperties: false;
  })
  | (Described & { type: "string"; enum?: readonly string[]; pattern?: string; minLength?: number; maxLength?: number })
  | (Described & { type: "integer"; minimum?: number; maximum?: number })
  | (Described & { type: "boolean" })
  | (Described & { type: "array"; items: Schema; minItems?: number; maxItems?: number });

export type ObjectSchema = Extract<Schema, { type: "object" }>;

function invalid(path: string, message: string): never {
  throw new ChatGptPluginError("invalid_arguments", `${path} ${message}`);
}

// Enforces exactly the JSON Schema subset published to ChatGPT, so the
// advertised contract and the accepted input cannot drift apart.
export function assertMatches(schema: Schema, value: unknown, path = "arguments"): void {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path, "must be an object");
    const record = value as Record<string, unknown>;
    const unexpected = Object.keys(record).filter((key) => !(key in schema.properties));
    if (unexpected.length) invalid(path, `has unexpected fields: ${unexpected.join(", ")}`);
    const missing = schema.required.filter((key) => record[key] === undefined);
    if (missing.length) invalid(path, `is missing fields: ${missing.join(", ")}`);
    for (const [key, child] of Object.entries(schema.properties)) {
      if (record[key] !== undefined) assertMatches(child, record[key], `${path}.${key}`);
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) invalid(path, "must be an array");
    if (value.length < (schema.minItems ?? 0)) invalid(path, `needs at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) invalid(path, `allows at most ${schema.maxItems} items`);
    value.forEach((item, index) => assertMatches(schema.items, item, `${path}[${index}]`));
    return;
  }
  if (schema.type === "boolean") {
    if (typeof value !== "boolean") invalid(path, "must be true or false");
    return;
  }
  if (schema.type === "integer") {
    if (!Number.isSafeInteger(value)) invalid(path, "must be an integer");
    const number = value as number;
    if (schema.minimum !== undefined && number < schema.minimum) invalid(path, `must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && number > schema.maximum) invalid(path, `must be at most ${schema.maximum}`);
    return;
  }
  if (typeof value !== "string") invalid(path, "must be a string");
  if (value.length < (schema.minLength ?? 0)) invalid(path, `must be at least ${schema.minLength} characters`);
  if (schema.maxLength !== undefined && value.length > schema.maxLength) invalid(path, `must be at most ${schema.maxLength} characters`);
  if (schema.enum && !schema.enum.includes(value)) invalid(path, `must be one of: ${schema.enum.join(", ")}`);
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) invalid(path, "has an invalid format");
}
