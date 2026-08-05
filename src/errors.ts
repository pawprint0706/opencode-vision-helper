export type ErrorCode =
  | "BAD_REQUEST"
  | "CONFIGURATION"
  | "OPENCODE_UNAVAILABLE"
  | "PROVIDER_NOT_CONNECTED"
  | "MODEL_NOT_FOUND"
  | "MODEL_NOT_VISION_CAPABLE"
  | "CALLER_MODEL_UNVERIFIED"
  | "CALLER_VISION_CAPABLE"
  | "CONSENT_REQUIRED"
  | "SETUP_CANCELED"
  | "UPLOAD_NOT_APPROVED"
  | "ANALYSIS_ABORTED"
  | "ANALYSIS_TIMEOUT"
  | "STRUCTURED_OUTPUT_INVALID"
  | "PROVIDER_ERROR"
  | "UNKNOWN";

const RETRYABLE = new Set<ErrorCode>([
  "OPENCODE_UNAVAILABLE",
  "ANALYSIS_TIMEOUT",
  "PROVIDER_ERROR",
  "UNKNOWN",
]);

const NEXT_ACTION: Record<ErrorCode, string> = {
  BAD_REQUEST: "Check the image path, format, and command arguments.",
  CONFIGURATION:
    "Run opencode-vision-helper setup, pass --model opencode-go/<id> or opencode/<id>, or set OPENCODE_VISION_MODEL.",
  OPENCODE_UNAVAILABLE: "Install or start OpenCode, then retry.",
  PROVIDER_NOT_CONNECTED: "Connect OpenCode Go or Zen with /connect, then retry.",
  MODEL_NOT_FOUND: "Choose an available Go or Zen model shown by doctor.",
  MODEL_NOT_VISION_CAPABLE: "Choose a model whose input capabilities include images.",
  CALLER_MODEL_UNVERIFIED:
    "Use a connected OpenCode Go or Zen model whose metadata explicitly disables image input.",
  CALLER_VISION_CAPABLE: "Analyze the image directly with the calling model.",
  CONSENT_REQUIRED:
    "Run opencode-vision-helper setup to review and accept the cloud-upload notice.",
  SETUP_CANCELED: "Run opencode-vision-helper setup again when you are ready.",
  UPLOAD_NOT_APPROVED:
    "Review the image, then retry with --allow-upload in the CLI or approve the OpenCode permission.",
  ANALYSIS_ABORTED: "Retry only if image analysis is still needed.",
  ANALYSIS_TIMEOUT: "Retry with a longer --timeout or choose a faster vision model.",
  STRUCTURED_OUTPUT_INVALID: "Retry with another image-capable model.",
  PROVIDER_ERROR: "Check OpenCode provider status and retry.",
  UNKNOWN: "Retry; if the problem persists, report the sanitized error output.",
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly nextAction: string;
  readonly cause?: unknown;
  readonly stage?: string;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { cause?: unknown; retryable?: boolean; stage?: string },
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.retryable = options?.retryable ?? RETRYABLE.has(code);
    this.nextAction = NEXT_ACTION[code];
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
    if (options?.stage) {
      this.stage = options.stage;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      status: "error",
      error_code: this.code,
      retryable: this.retryable,
      message: this.message,
      next_action: this.nextAction,
      ...(this.stage ? { stage: this.stage } : {}),
    };
  }
}
export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  return new AppError("UNKNOWN", "Unexpected internal error.", { cause: error });
}

type NamedOpenCodeError = {
  name: string;
  data?: unknown;
};

function namedOpenCodeError(error: unknown): NamedOpenCodeError | undefined {
  const candidates: unknown[] = [];
  if (
    error instanceof Error &&
    error.cause &&
    typeof error.cause === "object" &&
    "body" in error.cause
  ) {
    candidates.push(error.cause.body);
  }
  candidates.push(error);
  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === "object" &&
      "name" in candidate &&
      typeof candidate.name === "string"
    ) {
      return {
        name: candidate.name,
        data: "data" in candidate ? candidate.data : undefined,
      };
    }
  }
  return undefined;
}

export function mapOpenCodeError(
  error: unknown,
  fallback: "OPENCODE_UNAVAILABLE" | "PROVIDER_ERROR",
  signal?: AbortSignal,
): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (signal?.aborted) {
    return signal.reason instanceof AppError
      ? signal.reason
      : new AppError("ANALYSIS_ABORTED", "Image analysis was canceled.", { cause: error });
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new AppError("ANALYSIS_ABORTED", "Image analysis was canceled.", { cause: error });
  }
  const named = namedOpenCodeError(error);
  if (named) {
    const { name } = named;
    if (name === "ProviderAuthError") {
      return new AppError(
        "PROVIDER_NOT_CONNECTED",
        "The selected OpenCode provider could not authenticate.",
        { cause: error },
      );
    }
    if (name === "StructuredOutputError") {
      return new AppError(
        "STRUCTURED_OUTPUT_INVALID",
        "OpenCode could not produce a valid structured vision report.",
        { cause: error },
      );
    }
    if (name === "MessageAbortedError") {
      return new AppError("ANALYSIS_ABORTED", "Image analysis was canceled.", {
        cause: error,
      });
    }
    if (name === "APIError") {
      const data = named.data && typeof named.data === "object" ? named.data : undefined;
      const retryable = Boolean(data && "isRetryable" in data && data.isRetryable);
      return new AppError("PROVIDER_ERROR", "OpenCode provider request failed.", {
        cause: error,
        retryable,
      });
    }
  }
  return new AppError(
    fallback,
    fallback === "OPENCODE_UNAVAILABLE"
      ? "Could not communicate with the OpenCode server."
      : "OpenCode could not complete image analysis.",
    { cause: error },
  );
}
