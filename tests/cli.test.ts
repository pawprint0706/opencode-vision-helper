import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";
import { type CliServices, main, parseAnalyzeArgs } from "../src/cli.js";
import { AppError } from "../src/errors.js";
import type { PreparedImage } from "../src/imaging.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

type CliResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

async function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
      cwd: projectRoot,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
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

const preparedImage: PreparedImage = {
  path: "screen.png",
  bytes: Buffer.from("image"),
  mime: "image/png",
  width: 1,
  height: 1,
  originalWidth: 1,
  originalHeight: 1,
};

function services(overrides: Partial<CliServices> = {}): CliServices {
  return {
    prepareImage: async () => preparedImage,
    analyzeWithOpenCode: async () => ({
      model: "opencode-go/vision",
      report: { summary: "Looks good", issues: [] },
    }),
    doctor: async () => ({
      opencode_version: "1.18.12",
      connected_providers: ["opencode-go"],
      image_models: ["opencode-go/vision"],
      ok: true,
    }),
    ...overrides,
  };
}

async function captureMain(args: string[], cliServices: CliServices): Promise<CliResult> {
  let stdout = "";
  let stderr = "";
  const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  try {
    const exitCode = await main(args, cliServices);
    return { exitCode, stdout, stderr };
  } finally {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  }
}

describe("CLI argument parsing", () => {
  it("parses an approved structured analysis", () => {
    expect(
      parseAnalyzeArgs(["shot.png", "--model", "opencode-go/vision", "--json", "--allow-upload"]),
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
    expect(() => parseAnalyzeArgs(["shot.png", "--timeout", "0"])).toThrow(/--timeout/);
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

  it("prints a structured human result and cleanup warning on separate streams", async () => {
    const result = await captureMain(
      ["analyze", "screen.png", "--model", "opencode-go/vision", "--allow-upload"],
      services({
        analyzeWithOpenCode: async () => ({
          model: "opencode-go/vision",
          report: { summary: "Looks good", issues: [] },
          session_id: "retained-session",
          warnings: [
            {
              code: "SESSION_CLEANUP_FAILED",
              message: "Temporary session remains.",
            },
          ],
        }),
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Summary: Looks good\nIssues: none\n");
    expect(result.stderr).toContain("Warning [SESSION_CLEANUP_FAILED]");
    expect(result.stderr).toContain("Session: retained-session.");
  });

  it("preserves custom provider text and adds only the CLI line terminator", async () => {
    const result = await captureMain(
      [
        "analyze",
        "screen.png",
        "--model",
        "opencode/vision",
        "--prompt",
        "Read it.",
        "--allow-upload",
      ],
      services({
        analyzeWithOpenCode: async () => ({
          model: "opencode/vision",
          text: "  exact provider text  ",
        }),
      }),
    );

    expect(result).toEqual({
      exitCode: 0,
      stdout: "  exact provider text  \n",
      stderr: "",
    });
  });

  it("returns exit code 1 for a completed but unhealthy doctor check", async () => {
    const result = await captureMain(
      ["doctor", "--json"],
      services({
        doctor: async (_directory, signal) => {
          expect(signal).toBeInstanceOf(AbortSignal);
          return {
            opencode_version: "1.18.12",
            connected_providers: [],
            image_models: [],
            ok: false,
          };
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
    expect(result.stderr).toBe("");
  });
});
