import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AppError } from "../src/errors.js";
import { parseAnalyzeArgs } from "../src/cli.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

type CliResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

async function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", ...args],
      {
        cwd: projectRoot,
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

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

describe("CLI process contract", () => {
  it("prints help to stdout and exits successfully", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("opencode-vision-helper analyze <image>");
    expect(result.stderr).toBe("");
  });

  it.each([
    { args: ["unknown"], code: "BAD_REQUEST" },
    { args: ["analyze", "screen.png"], code: "UPLOAD_NOT_APPROVED" },
    {
      args: ["analyze", "screen.png", "--allow-upload"],
      code: "CONFIGURATION",
    },
    { args: ["doctor", "--unknown"], code: "BAD_REQUEST" },
  ])("prints $code as JSON on stderr and exits with failure", async ({ args, code }) => {
    const result = await runCli(args);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      status: "error",
      error_code: code,
      retryable: expect.any(Boolean),
      message: expect.any(String),
      next_action: expect.any(String),
    });
  });
});
