import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";
import { type CliServices, isEntrypoint, main, parseAnalyzeArgs } from "../src/cli.js";
import {
  CLOUD_UPLOAD_NOTICE_VERSION,
  HELPER_CONFIG_SCHEMA,
  type HelperConfig,
} from "../src/config.js";
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
    const isolatedHome = join(projectRoot, "tests", "fixtures", "missing-cli-home");
    const environment = {
      ...process.env,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      NO_COLOR: "1",
    };
    delete environment.OPENCODE_VISION_MODEL;
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
      cwd: projectRoot,
      env: environment,
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

function acceptedConfig(model = "opencode-go/stored-vision"): HelperConfig {
  return {
    schema: HELPER_CONFIG_SCHEMA,
    consent: {
      cloudUpload: true,
      noticeVersion: CLOUD_UPLOAD_NOTICE_VERSION,
      acceptedAt: "2026-08-05T00:00:00.000Z",
    },
    openCode: { permission: "ask", model },
  };
}

describe("CLI entrypoint", () => {
  it("recognizes the same file through a symlinked directory", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "vision-cli-entrypoint-"));
    try {
      const realDirectory = join(temporaryRoot, "real");
      const linkedDirectory = join(temporaryRoot, "linked");
      await mkdir(realDirectory);
      const cliPath = join(realDirectory, "cli.js");
      await writeFile(cliPath, "export {};\n");
      await symlink(
        realDirectory,
        linkedDirectory,
        process.platform === "win32" ? "junction" : "dir",
      );

      expect(isEntrypoint(pathToFileURL(cliPath).href, join(linkedDirectory, "cli.js"))).toBe(true);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

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
      helper_config: {
        status: "valid",
        path: "config.json",
        consent_valid: true,
        model: "opencode-go/vision",
        provider: "opencode-go",
        provider_connected: true,
        image_capable: true,
      },
      opencode_registration: {
        status: "valid",
        config_path: "opencode.json",
        plugin_registered: true,
        npm_plugin_entries: 1,
        legacy_wrapper_present: false,
        duplicate_registration: false,
        permission: "ask",
        permission_source: "vision_analyze",
        permission_matches_helper: true,
        ownership_manifest_present: true,
        project_or_agent_override_possible: true,
        restart_required: "unknown",
      },
      ok: true,
    }),
    runSetup: async () => ({
      status: "configured",
      changed: true,
      configPath: "config.json",
      consentReused: false,
      permission: "ask",
      model: "opencode-go/vision",
      openCodeRegistration: "registered",
      registrationChanged: true,
      openCodeConfigPath: "opencode.json",
    }),
    readConfig: async () => acceptedConfig(),
    readConfigState: async () => ({
      path: "config.json",
      revision: "revision",
      config: acceptedConfig(),
    }),
    resetConsent: async () => ({
      status: "reset",
      changed: true,
      path: "config.json",
      config: { ...acceptedConfig(), consent: { cloudUpload: false } },
    }),
    unregisterPlugin: async () => ({
      status: "unregistered",
      changed: true,
      configPath: "opencode.json",
      manifestPath: "opencode-registration.json",
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
    { args: ["analyze", "screen.png"], code: "CONSENT_REQUIRED" },
    {
      args: ["analyze", "screen.png", "--allow-upload"],
      code: "CONFIGURATION",
    },
    { args: ["doctor", "--unknown"], code: "BAD_REQUEST" },
    { args: ["setup"], code: "BAD_REQUEST" },
    { args: ["setup", "--unknown"], code: "BAD_REQUEST" },
    { args: ["unregister", "--unknown"], code: "BAD_REQUEST" },
    { args: ["config", "show"], code: "CONFIGURATION" },
    { args: ["config", "unknown"], code: "BAD_REQUEST" },
    { args: ["config", "show", "--unknown"], code: "BAD_REQUEST" },
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

  it("dispatches the interactive setup command", async () => {
    const runSetup = vi.fn(async () => ({
      status: "configured" as const,
      changed: false,
      configPath: "config.json",
      consentReused: true,
      permission: "ask" as const,
      model: "opencode-go/vision",
      openCodeRegistration: "already-registered" as const,
      registrationChanged: false,
      openCodeConfigPath: "opencode.json",
    }));

    await expect(main(["setup"], services({ runSetup }))).resolves.toBe(0);
    expect(runSetup).toHaveBeenCalledOnce();
  });

  it("dispatches config-only setup without OpenCode registration", async () => {
    const runSetup = vi.fn(async () => ({
      status: "configured" as const,
      changed: true,
      configPath: "config.json",
      consentReused: false,
      permission: "ask" as const,
      model: "opencode-go/vision",
      openCodeRegistration: "skipped" as const,
      registrationChanged: false,
    }));

    await expect(main(["setup", "--config-only"], services({ runSetup }))).resolves.toBe(0);
    expect(runSetup).toHaveBeenCalledWith({ registerOpenCode: false });
  });

  it("removes the owned registration and reports preserved helper settings", async () => {
    const unregisterPlugin = vi.fn(services().unregisterPlugin);
    const result = await captureMain(["unregister", "--json"], services({ unregisterPlugin }));

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      status: "unregistered",
      changed: true,
      config_path: "opencode.json",
      manifest_path: "opencode-registration.json",
      helper_config_preserved: true,
    });
    expect(result.stderr).toBe("");
    expect(unregisterPlugin).toHaveBeenCalledOnce();
  });

  it("prints an idempotent human unregister result", async () => {
    const result = await captureMain(
      ["unregister"],
      services({
        unregisterPlugin: async () => ({
          status: "not-registered",
          changed: false,
          configPath: "opencode.json",
          manifestPath: "opencode-registration.json",
        }),
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No helper-owned OpenCode registration");
    expect(result.stdout).toContain("cloud-upload consent were preserved");
  });

  it("shows the saved config without exposing unrelated data", async () => {
    const result = await captureMain(["config", "show", "--json"], services());

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      status: "ok",
      path: "config.json",
      schema: 1,
      cloud_upload_consent: {
        accepted: true,
        valid: true,
        notice_version: 1,
        accepted_at: "2026-08-05T00:00:00.000Z",
      },
      permission: "ask",
      model: "opencode-go/stored-vision",
    });
    expect(result.stderr).toBe("");
  });

  it("resets consent while reporting the native and one-invocation consequences", async () => {
    const resetConsent = vi.fn(services().resetConsent);
    const result = await captureMain(["config", "reset-consent"], services({ resetConsent }));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Cloud-upload consent reset");
    expect(result.stdout).toContain("CLI analysis now requires --allow-upload");
    expect(result.stdout).toContain("native tool fails until setup");
    expect(resetConsent).toHaveBeenCalledOnce();
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

  it("uses the saved model and consent when analyze has no overrides", async () => {
    const analyzeWithOpenCode = vi.fn(services().analyzeWithOpenCode);

    await expect(main(["analyze", "screen.png"], services({ analyzeWithOpenCode }))).resolves.toBe(
      0,
    );
    expect(analyzeWithOpenCode).toHaveBeenCalledWith(
      expect.objectContaining({ model: "opencode-go/stored-vision", uploadApproved: true }),
    );
  });

  it("uses explicit model, environment, then stored model precedence", async () => {
    const previous = process.env.OPENCODE_VISION_MODEL;
    process.env.OPENCODE_VISION_MODEL = "opencode/environment-vision";
    try {
      const explicitAnalyze = vi.fn(services().analyzeWithOpenCode);
      await main(
        ["analyze", "screen.png", "--model", "opencode-go/explicit-vision"],
        services({ analyzeWithOpenCode: explicitAnalyze }),
      );
      expect(explicitAnalyze).toHaveBeenCalledWith(
        expect.objectContaining({ model: "opencode-go/explicit-vision" }),
      );

      const environmentAnalyze = vi.fn(services().analyzeWithOpenCode);
      await main(["analyze", "screen.png"], services({ analyzeWithOpenCode: environmentAnalyze }));
      expect(environmentAnalyze).toHaveBeenCalledWith(
        expect.objectContaining({ model: "opencode/environment-vision" }),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCODE_VISION_MODEL;
      } else {
        process.env.OPENCODE_VISION_MODEL = previous;
      }
    }
  });

  it("keeps --allow-upload as a one-invocation consent path without reading config", async () => {
    const readConfig = vi.fn(async () => {
      throw new Error("config should not be read");
    });

    await expect(
      main(
        ["analyze", "screen.png", "--model", "opencode-go/explicit-vision", "--allow-upload"],
        services({ readConfig }),
      ),
    ).resolves.toBe(0);
    expect(readConfig).not.toHaveBeenCalled();
  });

  it("fails before reading the image when saved consent is absent", async () => {
    const prepareImage = vi.fn(async () => preparedImage);
    const config = acceptedConfig();
    config.consent = { cloudUpload: false };

    await expect(
      main(
        ["analyze", "screen.png", "--model", "opencode-go/explicit-vision"],
        services({ prepareImage, readConfig: async () => config }),
      ),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    expect(prepareImage).not.toHaveBeenCalled();
  });

  it("rejects an unsupported model before reading the image", async () => {
    const prepareImage = vi.fn(async () => preparedImage);

    await expect(
      main(
        ["analyze", "screen.png", "--model", "openai/vision", "--allow-upload"],
        services({ prepareImage }),
      ),
    ).rejects.toMatchObject({ code: "CONFIGURATION" });
    expect(prepareImage).not.toHaveBeenCalled();
  });

  it("prints a structured success envelope for --json", async () => {
    const result = await captureMain(
      ["analyze", "screen.png", "--model", "opencode-go/vision", "--allow-upload", "--json"],
      services(),
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      status: "ok",
      model: "opencode-go/vision",
      report: { summary: "Looks good", issues: [] },
    });
    expect(result.stderr).toBe("");
  });

  it("handles a Unicode path with spaces before any OpenCode request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vision-cli-한글 "));
    const imagePath = join(directory, "깨진 화면.png");
    try {
      await writeFile(imagePath, "not an image");

      const result = await runCli([
        "analyze",
        imagePath,
        "--model",
        "opencode-go/vision",
        "--allow-upload",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toMatchObject({
        status: "error",
        error_code: "BAD_REQUEST",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
            helper_config: {
              status: "missing",
              path: "config.json",
              consent_valid: false,
            },
            opencode_registration: {
              status: "valid",
              config_path: "opencode.json",
              plugin_registered: false,
              npm_plugin_entries: 0,
              legacy_wrapper_present: false,
              duplicate_registration: false,
              permission_source: "unset",
              permission_matches_helper: false,
              ownership_manifest_present: false,
              project_or_agent_override_possible: true,
              restart_required: "unknown",
            },
            ok: false,
          };
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
    expect(result.stderr).toBe("");
  });

  it("prints helper and registration readiness for a healthy doctor check", async () => {
    const result = await captureMain(["doctor", "--json"], services());

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      helper_config: {
        status: "valid",
        consent_valid: true,
        provider_connected: true,
        image_capable: true,
      },
      opencode_registration: {
        status: "valid",
        plugin_registered: true,
        permission_matches_helper: true,
        project_or_agent_override_possible: true,
        restart_required: "unknown",
      },
      ok: true,
    });
  });
});
