import { describe, expect, it } from "vitest";

import { AppError } from "../src/errors.js";
import { parseAnalyzeArgs } from "../src/cli.js";

describe("CLI argument parsing", () => {
  it("parses an approved structured analysis", () => {
    expect(
      parseAnalyzeArgs([
        "shot.png",
        "--model",
        "opencode-go/vision",
        "--json",
        "--allow-upload",
      ]),
    ).toEqual({
      image: "shot.png",
      model: "opencode-go/vision",
      json: true,
      allowUpload: true,
      keepSession: false,
      timeoutMs: 120_000,
    });
  });

  it("keeps a custom prompt distinct from the structured default", () => {
    expect(parseAnalyzeArgs(["shot.png", "--prompt", "Read the title"]).prompt).toBe(
      "Read the title",
    );
  });

  it("rejects unknown options and missing image paths", () => {
    expect(() => parseAnalyzeArgs([])).toThrow(AppError);
    expect(() => parseAnalyzeArgs(["shot.png", "--wat"])).toThrow(/Unknown option/);
    expect(() => parseAnalyzeArgs(["shot.png", "--timeout", "0"])).toThrow(
      /--timeout/,
    );
  });

  it("parses an explicit analysis timeout", () => {
    expect(parseAnalyzeArgs(["shot.png", "--timeout", "300"]).timeoutMs).toBe(300_000);
  });
});
