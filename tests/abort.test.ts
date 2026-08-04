import { afterEach, describe, expect, it, vi } from "vitest";

import { createAbortScope } from "../src/abort.js";
import { AppError, mapOpenCodeError } from "../src/errors.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("analysis cancellation", () => {
  it("propagates an explicit parent cancellation reason", () => {
    const parent = new AbortController();
    const scope = createAbortScope(5_000, parent.signal);
    const reason = new AppError("ANALYSIS_ABORTED", "Canceled by caller.");
    parent.abort(reason);
    expect(scope.signal.aborted).toBe(true);
    expect(mapOpenCodeError(new DOMException("aborted", "AbortError"), "PROVIDER_ERROR", scope.signal))
      .toBe(reason);
    scope.dispose();
  });

  it("aborts with a retryable timeout error", () => {
    vi.useFakeTimers();
    const scope = createAbortScope(1_000);
    vi.advanceTimersByTime(1_000);
    expect(scope.signal.reason).toMatchObject({
      code: "ANALYSIS_TIMEOUT",
      retryable: true,
    });
    scope.dispose();
  });

  it("rejects timeout values outside the supported range", () => {
    expect(() => createAbortScope(999)).toThrow(/timeout/);
  });

  it("maps named SDK errors without exposing their embedded messages", () => {
    expect(
      mapOpenCodeError(
        { name: "ProviderAuthError", data: { message: "secret auth detail" } },
        "PROVIDER_ERROR",
      ),
    ).toMatchObject({
      code: "PROVIDER_NOT_CONNECTED",
      message: "The selected OpenCode provider could not authenticate.",
    });
    expect(
      mapOpenCodeError(
        { name: "APIError", data: { isRetryable: false, responseBody: "secret" } },
        "PROVIDER_ERROR",
      ),
    ).toMatchObject({
      code: "PROVIDER_ERROR",
      retryable: false,
      message: "OpenCode provider request failed.",
    });
  });
});
