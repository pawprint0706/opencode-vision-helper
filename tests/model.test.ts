import type { Provider } from "@opencode-ai/sdk/v2";
import { describe, expect, it } from "vitest";

import { AppError } from "../src/errors.js";
import {
  imageModels,
  parseModelRef,
  requireNonVisionCaller,
  selectVisionModel,
} from "../src/model.js";

function provider(id: string, image: boolean): Provider {
  return {
    id,
    name: id,
    source: "api",
    env: [],
    options: {},
    models: {
      vision: {
        id: "vision",
        providerID: id,
        api: { id: "test", url: "https://example.invalid", npm: "test" },
        name: "Vision",
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: image,
          toolcall: true,
          input: { text: true, audio: false, image, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        limit: { context: 10_000, output: 1_000 },
        status: "active",
        options: {},
        headers: {},
        release_date: "2026-01-01",
      },
    },
  };
}

function thrownAppError(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected AppError");
}

describe("model selection", () => {
  it("accepts only OpenCode Go and Zen model identifiers", () => {
    expect(parseModelRef("opencode-go/vision")).toEqual({
      providerID: "opencode-go",
      modelID: "vision",
    });
    expect(() => parseModelRef("openai/gpt-5")).toThrow(AppError);
    expect(() => parseModelRef("opencode/")).toThrow(AppError);
  });

  it("requires a connected provider and image-capable model", () => {
    const ref = parseModelRef("opencode/vision");
    expect(() => selectVisionModel(ref, [provider("opencode", true)], [])).toThrow(/not connected/);
    expect(() => selectVisionModel(ref, [provider("opencode", false)], ["opencode"])).toThrow(
      /does not accept image/,
    );
    expect(selectVisionModel(ref, [provider("opencode", true)], ["opencode"]).id).toBe("vision");
  });

  it("allows the fallback only when caller metadata explicitly disables image input", () => {
    const ref = parseModelRef("opencode/vision");
    expect(requireNonVisionCaller(ref, [provider("opencode", false)], ["opencode"]).id).toBe(
      "vision",
    );
    expect(() => requireNonVisionCaller(ref, [provider("opencode", true)], ["opencode"])).toThrow(
      /Analyze the image directly/,
    );
  });

  it("fails closed when caller model metadata cannot be verified", () => {
    const ref = parseModelRef("opencode/vision");
    const incomplete = provider("opencode", false);
    Reflect.deleteProperty(incomplete.models.vision.capabilities.input, "image");
    expect(
      thrownAppError(() => requireNonVisionCaller(ref, [provider("opencode", false)], [])),
    ).toMatchObject({ code: "CALLER_MODEL_UNVERIFIED", retryable: false });
    expect(thrownAppError(() => requireNonVisionCaller(ref, [], ["opencode"]))).toMatchObject({
      code: "CALLER_MODEL_UNVERIFIED",
      retryable: false,
    });
    expect(
      thrownAppError(() => requireNonVisionCaller(ref, [incomplete], ["opencode"])),
    ).toMatchObject({ code: "CALLER_MODEL_UNVERIFIED", retryable: false });
  });

  it("lists only connected image models in allowed providers", () => {
    expect(
      imageModels(
        [provider("opencode", true), provider("other", true), provider("opencode-go", false)],
        ["opencode", "other", "opencode-go"],
      ),
    ).toEqual(["opencode/vision"]);
  });
});
