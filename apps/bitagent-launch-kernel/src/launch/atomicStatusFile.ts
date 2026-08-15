import { promises as fs } from "node:fs";
import path from "node:path";

type Rename = typeof fs.rename;

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : undefined;
}

export async function writeAtomicStatusFile(
  outputPath: string,
  value: unknown,
  options: {
    maxRenameAttempts?: number;
    retryDelayMs?: number;
    rename?: Rename;
  } = {}
): Promise<void> {
  const maxRenameAttempts = options.maxRenameAttempts ?? 8;
  const retryDelayMs = options.retryDelayMs ?? 25;
  if (!Number.isSafeInteger(maxRenameAttempts) || maxRenameAttempts < 1 || maxRenameAttempts > 20) {
    throw new Error("maxRenameAttempts must be between 1 and 20");
  }
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 1_000) {
    throw new Error("retryDelayMs must be between 0 and 1000");
  }
  const rename = options.rename || fs.rename;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    for (let attempt = 1; attempt <= maxRenameAttempts; attempt += 1) {
      try {
        await rename(temporary, outputPath);
        return;
      } catch (error) {
        const transient = ["EPERM", "EBUSY", "EACCES"].includes(errorCode(error) || "");
        if (!transient || attempt === maxRenameAttempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}
