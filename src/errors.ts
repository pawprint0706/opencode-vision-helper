export type ErrorCode =
  | "BAD_REQUEST"
  | "CONFIGURATION"
  | "OPENCODE_UNAVAILABLE"
  | "PROVIDER_NOT_CONNECTED"
  | "MODEL_NOT_FOUND"
  | "MODEL_NOT_VISION_CAPABLE"
  | "UPLOAD_NOT_APPROVED"
  | "STRUCTURED_OUTPUT_INVALID"
  | "PROVIDER_ERROR"
  | "UNKNOWN";

const RETRYABLE = new Set<ErrorCode>([
  "OPENCODE_UNAVAILABLE",
  "PROVIDER_ERROR",
  "UNKNOWN",
]);

const NEXT_ACTION: Record<ErrorCode, string> = {
  BAD_REQUEST: "Check the image path, format, and command arguments.",
  CONFIGURATION:
    "Pass --model opencode-go/<id> or opencode/<id>, or set OPENCODE_VISION_MODEL.",
  OPENCODE_UNAVAILABLE: "Install or start OpenCode, then retry.",
  PROVIDER_NOT_CONNECTED: "Connect OpenCode Go or Zen with /connect, then retry.",
  MODEL_NOT_FOUND: "Choose an available Go or Zen model shown by doctor.",
  MODEL_NOT_VISION_CAPABLE: "Choose a model whose input capabilities include images.",
  UPLOAD_NOT_APPROVED:
    "Review the image for sensitive content and retry with --allow-upload after approval.",
  STRUCTURED_OUTPUT_INVALID: "Retry with another image-capable model.",
  PROVIDER_ERROR: "Check OpenCode provider status and retry.",
  UNKNOWN: "Retry; if the problem persists, report the sanitized error output.",
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly nextAction: string;
  readonly cause?: unknown;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.retryable = RETRYABLE.has(code);
    this.nextAction = NEXT_ACTION[code];
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      status: "error",
      error_code: this.code,
      retryable: this.retryable,
      message: this.message,
      next_action: this.nextAction,
    };
  }
}
export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return new AppError("UNKNOWN", message, { cause: error });
}
