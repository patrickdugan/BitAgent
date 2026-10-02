export type ChatGptPluginErrorCode =
  | "unknown_tool"
  | "invalid_arguments"
  | "secret_material_prohibited"
  | "practice_unavailable"
  | "practice_rejected"
  | "resource_not_found"
  | "internal_error";

export class ChatGptPluginError extends Error {
  constructor(
    readonly code: ChatGptPluginErrorCode,
    message: string,
    readonly detailCode?: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "ChatGptPluginError";
  }
}

export function pluginErrorResult(error: unknown) {
  if (error instanceof ChatGptPluginError) {
    return { code: error.code, detailCode: error.detailCode, message: error.message };
  }
  // Never surface an unclassified message: it may carry host paths or state.
  return { code: "internal_error" as const, detailCode: undefined, message: "BitAgent could not complete this request" };
}
