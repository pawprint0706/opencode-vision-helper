import { describe, expect, it } from "vitest";

import { AppError } from "../src/errors.js";
import { formatReport, parseVisionReport } from "../src/report.js";

describe("report validation", () => {
  it("accepts the strict report contract", () => {
    const report = parseVisionReport({
      summary: "Button is clipped",
      issues: [
        {
          severity: "high",
          region: "footer",
          element: "submit button",
          description: "The right edge is hidden.",
          css_hint: "Check overflow and width.",
        },
      ],
    });
    expect(report.issues[0]?.severity).toBe("high");
    expect(formatReport(report)).toContain("[high] footer");
  });

  it.each([
    {},
    { answer: "hello" },
    { summary: "ok", issues: "not-an-array" },
    { summary: "ok", issues: [{ severity: "critical" }] },
  ])("rejects malformed structured output %#", (value) => {
    expect(() => parseVisionReport(value)).toThrow(AppError);
  });

  it.each([
    {
      summary: "ok",
      issues: [],
      explanation: "not in the contract",
    },
    {
      summary: "ok",
      issues: [
        {
          severity: "low",
          region: "header",
          element: "logo",
          description: "Looks fine.",
          css_hint: "None.",
          confidence: 0.9,
        },
      ],
    },
  ])("rejects additional properties excluded by the schema %#", (value) => {
    expect(() => parseVisionReport(value)).toThrow(/unexpected field/);
  });
});
