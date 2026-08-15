import type { SignalErrorCode } from "./types.js";

export class SignalKernelError extends Error {
  readonly code: SignalErrorCode;
  readonly details?: unknown;

  constructor(code: SignalErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "SignalKernelError";
    this.code = code;
    this.details = details;
  }
}

export function sanitizedSignalError(error: unknown) {
  if (error instanceof SignalKernelError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "execution_failed" as const,
    message: error instanceof Error ? error.message : "Unknown committed-signal failure"
  };
}
