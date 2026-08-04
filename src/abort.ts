import { AppError } from "./errors.js";

export const DEFAULT_ANALYSIS_TIMEOUT_MS = 120_000;
export const MIN_ANALYSIS_TIMEOUT_MS = 1_000;
export const MAX_ANALYSIS_TIMEOUT_MS = 30 * 60_000;

export type AbortScope = {
  signal: AbortSignal;
  dispose(): void;
};

export function createAbortScope(
  timeoutMs = DEFAULT_ANALYSIS_TIMEOUT_MS,
  parent?: AbortSignal,
  operation = "Image analysis",
): AbortScope {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < MIN_ANALYSIS_TIMEOUT_MS ||
    timeoutMs > MAX_ANALYSIS_TIMEOUT_MS
  ) {
    throw new AppError(
      "BAD_REQUEST",
      `Analysis timeout must be between ${MIN_ANALYSIS_TIMEOUT_MS} and ${MAX_ANALYSIS_TIMEOUT_MS} milliseconds.`,
    );
  }

  const controller = new AbortController();
  const abortFromParent = () => {
    controller.abort(
      parent?.reason instanceof AppError
        ? parent.reason
        : new AppError("ANALYSIS_ABORTED", `${operation} was canceled.`),
    );
  };
  if (parent?.aborted) {
    abortFromParent();
  } else {
    parent?.addEventListener("abort", abortFromParent, { once: true });
  }

  const timer = setTimeout(() => {
    controller.abort(
      new AppError(
        "ANALYSIS_TIMEOUT",
        `${operation} exceeded the ${timeoutMs} millisecond timeout.`,
      ),
    );
  }, timeoutMs);
  timer.unref?.();

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}
