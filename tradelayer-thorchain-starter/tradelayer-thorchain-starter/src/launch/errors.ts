import type { LaunchErrorCode } from "./types.js";

export class LaunchKernelError extends Error {
  readonly code: LaunchErrorCode;
  readonly details?: unknown;

  constructor(code: LaunchErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "LaunchKernelError";
    this.code = code;
    this.details = details;
  }
}

export function errorResult(error: unknown) {
  if (error instanceof LaunchKernelError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "execution_failed" as const,
    message: error instanceof Error ? error.message : "Unknown launch-kernel failure"
  };
}
