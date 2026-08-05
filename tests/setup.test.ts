import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const opencodeMocks = vi.hoisted(() => ({
  analyzeWithOpenCode: vi.fn(() => {
    throw new Error("Setup must not start image analysis.");
  }),
}));

vi.mock("../src/opencode.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/opencode.js")>()),
  analyzeWithOpenCode: opencodeMocks.analyzeWithOpenCode,
}));

import {
  CLOUD_UPLOAD_NOTICE_VERSION,
  HELPER_CONFIG_SCHEMA,
  type HelperConfig,
  readHelperConfig,
  readHelperConfigState,
  writeHelperConfig,
} from "../src/config.js";
import { AppError } from "../src/errors.js";
import {
  runInteractiveSetup,
  type SetupChoice,
  type SetupPrompter,
  type SetupServices,
  TerminalSetupPrompter,
} from "../src/setup.js";

let temporaryRoot: string;

class FakePrompter implements SetupPrompter {
  readonly writes: string[] = [];
  readonly selectCalls: Array<{ question: string; choices: SetupChoice[]; defaultValue: string }> =
    [];
  closed = false;

  constructor(
    readonly interactive: boolean,
    readonly confirmations: boolean[],
    readonly selections: string[],
  ) {}

  write(message: string): void {
    this.writes.push(message);
  }

  async confirm(): Promise<boolean> {
    const answer = this.confirmations.shift();
    if (answer === undefined) {
      throw new Error("Missing fake confirmation.");
    }
    return answer;
  }

  async select(question: string, choices: SetupChoice[], defaultValue: string): Promise<string> {
    this.selectCalls.push({ question, choices, defaultValue });
    const answer = this.selections.shift();
    if (!answer || !choices.some((choice) => choice.value === answer)) {
      throw new Error(`Invalid fake selection: ${String(answer)}`);
    }
    return answer;
  }

  close(): void {
    this.closed = true;
  }
}

function doctorResult() {
  return {
    opencode_version: "1.18.13",
    connected_providers: ["opencode-go", "opencode"],
    image_models: ["opencode-go/vision-a", "opencode-go/vision-b", "opencode/vision-zen"],
    ok: true,
  };
}

function setupServices(overrides: Partial<SetupServices> = {}): SetupServices {
  return {
    doctor: async () => doctorResult(),
    readConfigState: readHelperConfigState,
    writeConfig: writeHelperConfig,
    inspectRegistration: async (permission) => ({
      configPath: join(temporaryRoot, "opencode.json"),
      manifestPath: join(temporaryRoot, "registration.json"),
      revision: null,
      pluginPresent: false,
      permissionChange: false,
      changesRequired: true,
      snippet: {
        plugin: ["@pawprint0706/opencode-vision-helper"],
        permission: { vision_analyze: permission },
      },
    }),
    createManualRegistrationPlan: async (permission) => ({
      configPaths: [join(temporaryRoot, "opencode.json")],
      snippet: {
        plugin: ["@pawprint0706/opencode-vision-helper"],
        permission: { vision_analyze: permission },
      },
    }),
    verifyManualRegistration: async () => ({ complete: true }),
    registerPlugin: async (permission) => ({
      status: "registered",
      changed: true,
      configPath: join(temporaryRoot, "opencode.json"),
      manifestPath: join(temporaryRoot, "registration.json"),
      permission,
    }),
    now: () => new Date("2026-08-05T01:02:03.000Z"),
    ...overrides,
  };
}

function acceptedConfig(): HelperConfig {
  return {
    schema: HELPER_CONFIG_SCHEMA,
    consent: {
      cloudUpload: true,
      noticeVersion: CLOUD_UPLOAD_NOTICE_VERSION,
      acceptedAt: "2026-08-04T00:00:00.000Z",
    },
    openCode: { permission: "ask", model: "opencode/vision-zen" },
  };
}

beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "opencode-vision-setup-test-"));
  opencodeMocks.analyzeWithOpenCode.mockClear();
});

afterEach(async () => {
  const expectedPrefix = resolve(tmpdir(), "opencode-vision-setup-test-");
  if (!resolve(temporaryRoot).startsWith(expectedPrefix)) {
    throw new Error(`Refusing to remove unexpected test path: ${temporaryRoot}`);
  }
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe("interactive setup", () => {
  it("collects initial consent, ask permission, provider, and model before saving", async () => {
    const configPath = join(temporaryRoot, "config.json");
    const prompter = new FakePrompter(
      true,
      [true, true],
      ["ask", "opencode-go", "opencode-go/vision-b"],
    );

    const result = await runInteractiveSetup({
      configLocation: { configPath },
      prompter,
      services: setupServices(),
    });

    expect(result).toMatchObject({
      status: "configured",
      changed: true,
      consentReused: false,
      permission: "ask",
      model: "opencode-go/vision-b",
      openCodeRegistration: "registered",
      registrationChanged: true,
    });
    expect(await readHelperConfig({ configPath })).toEqual({
      schema: HELPER_CONFIG_SCHEMA,
      consent: {
        cloudUpload: true,
        noticeVersion: CLOUD_UPLOAD_NOTICE_VERSION,
        acceptedAt: "2026-08-05T01:02:03.000Z",
      },
      openCode: { permission: "ask", model: "opencode-go/vision-b" },
    });
    expect(prompter.selectCalls[0]?.defaultValue).toBe("ask");
    expect(prompter.writes.join("")).toContain("Setup itself sends no image");
    expect(prompter.writes.join("")).toContain("OpenCode plugin registered");
    expect(prompter.writes.join("")).toContain("Restart OpenCode");
    expect(opencodeMocks.analyzeWithOpenCode).not.toHaveBeenCalled();
    expect(prompter.closed).toBe(true);
  });

  it("handles a single connected provider and model without inventing another choice", async () => {
    const configPath = join(temporaryRoot, "config.json");
    const prompter = new FakePrompter(
      true,
      [true, true],
      ["ask", "opencode", "opencode/only-vision"],
    );

    await expect(
      runInteractiveSetup({
        configLocation: { configPath },
        prompter,
        services: setupServices({
          doctor: async () => ({
            ...doctorResult(),
            connected_providers: ["opencode"],
            image_models: ["opencode/only-vision"],
          }),
        }),
      }),
    ).resolves.toMatchObject({
      status: "configured",
      model: "opencode/only-vision",
    });
    expect(prompter.selectCalls[1]?.choices.map((choice) => choice.value)).toEqual(["opencode"]);
    expect(prompter.selectCalls[2]?.choices.map((choice) => choice.value)).toEqual([
      "opencode/only-vision",
    ]);
  });

  it("requires a second confirmation before saving allow", async () => {
    const configPath = join(temporaryRoot, "config.json");
    const declined = new FakePrompter(true, [true, false], ["allow"]);

    await expect(
      runInteractiveSetup({
        configLocation: { configPath },
        prompter: declined,
        services: setupServices(),
      }),
    ).resolves.toEqual({ status: "canceled", reason: "automatic-upload-declined" });
    await expect(readHelperConfig({ configPath })).resolves.toBeUndefined();

    const accepted = new FakePrompter(
      true,
      [true, true, true],
      ["allow", "opencode", "opencode/vision-zen"],
    );
    await expect(
      runInteractiveSetup({
        configLocation: { configPath },
        prompter: accepted,
        services: setupServices(),
      }),
    ).resolves.toMatchObject({ status: "configured", permission: "allow" });
    expect((await readHelperConfig({ configPath }))?.openCode.permission).toBe("allow");
  });

  it("does not write when cloud consent or final confirmation is declined", async () => {
    const consentPath = join(temporaryRoot, "consent-declined.json");
    const consentDeclined = new FakePrompter(true, [false], []);
    await expect(
      runInteractiveSetup({
        configLocation: { configPath: consentPath },
        prompter: consentDeclined,
        services: setupServices(),
      }),
    ).resolves.toEqual({ status: "canceled", reason: "cloud-upload-declined" });
    await expect(readHelperConfig({ configPath: consentPath })).resolves.toBeUndefined();

    const finalPath = join(temporaryRoot, "final-declined.json");
    const finalDeclined = new FakePrompter(
      true,
      [true, false],
      ["ask", "opencode-go", "opencode-go/vision-a"],
    );
    await expect(
      runInteractiveSetup({
        configLocation: { configPath: finalPath },
        prompter: finalDeclined,
        services: setupServices(),
      }),
    ).resolves.toEqual({ status: "canceled", reason: "final-confirmation-declined" });
    await expect(readHelperConfig({ configPath: finalPath })).resolves.toBeUndefined();
  });

  it("reuses current consent and defaults without rewriting unchanged configuration", async () => {
    const configPath = join(temporaryRoot, "config.json");
    const initial = await writeHelperConfig(acceptedConfig(), {
      configPath,
      expectedRevision: null,
    });
    const writeConfig = vi.fn(writeHelperConfig);
    const prompter = new FakePrompter(true, [true], ["ask", "opencode", "opencode/vision-zen"]);

    const result = await runInteractiveSetup({
      configLocation: { configPath },
      prompter,
      services: setupServices({ writeConfig }),
    });

    expect(result).toMatchObject({ status: "configured", changed: false, consentReused: true });
    expect(writeConfig).not.toHaveBeenCalled();
    expect((await readHelperConfigState({ configPath })).revision).toBe(initial.revision);
    expect(prompter.writes.join("")).toContain("will be retained");
    expect(prompter.selectCalls.map((call) => call.defaultValue)).toEqual([
      "ask",
      "opencode",
      "opencode/vision-zen",
    ]);
  });

  it("requires explicit approval before changing an existing OpenCode permission", async () => {
    const configPath = join(temporaryRoot, "config.json");
    const writeConfig = vi.fn(writeHelperConfig);
    const registerPlugin = vi.fn(setupServices().registerPlugin);
    const prompter = new FakePrompter(
      true,
      [true, false],
      ["ask", "opencode-go", "opencode-go/vision-a"],
    );
    const basePlan = await setupServices().inspectRegistration("ask");

    await expect(
      runInteractiveSetup({
        configLocation: { configPath },
        prompter,
        services: setupServices({
          writeConfig,
          registerPlugin,
          inspectRegistration: async () => ({
            ...basePlan,
            currentPermission: "deny",
            permissionChange: true,
          }),
        }),
      }),
    ).resolves.toEqual({ status: "canceled", reason: "permission-change-declined" });
    expect(writeConfig).not.toHaveBeenCalled();
    expect(registerPlugin).not.toHaveBeenCalled();
  });

  it("reports that helper config remains when OpenCode registration fails", async () => {
    const configPath = join(temporaryRoot, "config.json");
    const prompter = new FakePrompter(
      true,
      [true, true],
      ["ask", "opencode-go", "opencode-go/vision-a"],
    );

    await expect(
      runInteractiveSetup({
        configLocation: { configPath },
        prompter,
        services: setupServices({
          registerPlugin: async () => {
            throw new AppError("CONFIGURATION", "The OpenCode config changed.");
          },
        }),
      }),
    ).rejects.toMatchObject({
      code: "CONFIGURATION",
      stage: "opencode-registration",
      message: expect.stringContaining("Helper configuration was saved"),
    });
    await expect(readHelperConfig({ configPath })).resolves.toBeDefined();
  });

  it("falls back to a confirmed manual merge when automatic inspection is unsafe", async () => {
    const configPath = join(temporaryRoot, "config.json");
    const registerPlugin = vi.fn(setupServices().registerPlugin);
    const prompter = new FakePrompter(
      true,
      [true, true, true],
      ["ask", "opencode-go", "opencode-go/vision-a"],
    );

    const result = await runInteractiveSetup({
      configLocation: { configPath },
      prompter,
      services: setupServices({
        inspectRegistration: async () => {
          throw new AppError("CONFIGURATION", "The config contains unsupported JSONC.");
        },
        registerPlugin,
      }),
    });

    expect(result).toMatchObject({
      status: "configured",
      changed: true,
      openCodeRegistration: "manual",
      registrationChanged: false,
      openCodeConfigPath: join(temporaryRoot, "opencode.json"),
    });
    expect(registerPlugin).not.toHaveBeenCalled();
    await expect(readHelperConfig({ configPath })).resolves.toBeDefined();
    const output = prompter.writes.join("");
    expect(output).toContain("manual merge required");
    expect(output).toContain("unsupported JSONC");
    expect(output).toContain('"vision_analyze": "ask"');
    expect(output).toContain("Manual OpenCode registration confirmed");
  });

  it("saves helper config but reports incomplete setup until manual merge is confirmed", async () => {
    const configPath = join(temporaryRoot, "config.json");
    const prompter = new FakePrompter(
      true,
      [true, true, false],
      ["ask", "opencode", "opencode/vision-zen"],
    );

    const result = await runInteractiveSetup({
      configLocation: { configPath },
      prompter,
      services: setupServices({
        inspectRegistration: async () => {
          throw new AppError("CONFIGURATION", "Both global configs exist.");
        },
        createManualRegistrationPlan: async (permission) => ({
          configPaths: [
            join(temporaryRoot, "opencode.json"),
            join(temporaryRoot, "opencode.jsonc"),
          ],
          snippet: {
            plugin: ["@pawprint0706/opencode-vision-helper"],
            permission: { vision_analyze: permission },
          },
        }),
      }),
    });

    expect(result).toMatchObject({
      status: "manual-registration-required",
      changed: true,
      openCodeConfigPaths: [
        join(temporaryRoot, "opencode.json"),
        join(temporaryRoot, "opencode.jsonc"),
      ],
    });
    await expect(readHelperConfig({ configPath })).resolves.toBeDefined();
    expect(prompter.writes.join("")).toContain("Setup is incomplete");
  });

  it("does not report manual setup success when the confirmed merge cannot be verified", async () => {
    const configPath = join(temporaryRoot, "config.json");
    const prompter = new FakePrompter(
      true,
      [true, true, true],
      ["ask", "opencode-go", "opencode-go/vision-a"],
    );

    const result = await runInteractiveSetup({
      configLocation: { configPath },
      prompter,
      services: setupServices({
        inspectRegistration: async () => {
          throw new AppError("CONFIGURATION", "Automatic merge is unsafe.");
        },
        verifyManualRegistration: async () => ({
          complete: false,
          reason: "The exact npm plugin entry is missing.",
        }),
      }),
    });

    expect(result).toMatchObject({ status: "manual-registration-required", changed: true });
    expect(prompter.writes.join("")).toContain("could not be verified");
    expect(prompter.writes.join("")).toContain("exact npm plugin entry is missing");
  });

  it("supports config-only setup for an ownership-checked legacy wrapper", async () => {
    const configPath = join(temporaryRoot, "config.json");
    const inspectRegistration = vi.fn(setupServices().inspectRegistration);
    const registerPlugin = vi.fn(setupServices().registerPlugin);
    const prompter = new FakePrompter(
      true,
      [true, true],
      ["ask", "opencode-go", "opencode-go/vision-a"],
    );

    await expect(
      runInteractiveSetup({
        configLocation: { configPath },
        registerOpenCode: false,
        prompter,
        services: setupServices({ inspectRegistration, registerPlugin }),
      }),
    ).resolves.toMatchObject({
      status: "configured",
      openCodeRegistration: "skipped",
      registrationChanged: false,
    });
    expect(inspectRegistration).not.toHaveBeenCalled();
    expect(registerPlugin).not.toHaveBeenCalled();
    expect(prompter.writes.join("")).toContain("registration was skipped");
    await expect(readHelperConfig({ configPath })).resolves.toBeDefined();
  });

  it("fails before prompting when Go/Zen or image models are unavailable", async () => {
    const disconnected = new FakePrompter(true, [], []);
    await expect(
      runInteractiveSetup({
        prompter: disconnected,
        services: setupServices({
          doctor: async () => ({ ...doctorResult(), connected_providers: [], ok: false }),
        }),
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_CONNECTED" });
    expect(disconnected.closed).toBe(true);

    const noModels = new FakePrompter(true, [], []);
    await expect(
      runInteractiveSetup({
        prompter: noModels,
        services: setupServices({
          doctor: async () => ({ ...doctorResult(), image_models: [], ok: false }),
        }),
      }),
    ).rejects.toMatchObject({ code: "MODEL_NOT_FOUND" });
    expect(noModels.closed).toBe(true);
  });

  it("propagates a stable OpenCode timeout without saving setup state", async () => {
    const configPath = join(temporaryRoot, "config.json");
    const prompter = new FakePrompter(true, [], []);

    await expect(
      runInteractiveSetup({
        configLocation: { configPath },
        prompter,
        services: setupServices({
          doctor: async () => {
            throw new AppError("ANALYSIS_TIMEOUT", "OpenCode setup check timed out.");
          },
        }),
      }),
    ).rejects.toMatchObject({ code: "ANALYSIS_TIMEOUT", retryable: true });
    await expect(readHelperConfig({ configPath })).resolves.toBeUndefined();
    expect(prompter.closed).toBe(true);
    expect(opencodeMocks.analyzeWithOpenCode).not.toHaveBeenCalled();
  });

  it("rejects a non-interactive stream before contacting OpenCode", async () => {
    const doctor = vi.fn(async () => doctorResult());
    const prompter = new FakePrompter(false, [], []);

    await expect(
      runInteractiveSetup({ prompter, services: setupServices({ doctor }) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(doctor).not.toHaveBeenCalled();
    expect(prompter.closed).toBe(true);
  });
});

describe("terminal setup prompts", () => {
  it("turns input EOF into a stable setup cancellation", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const prompter = new TerminalSetupPrompter(input, output);

    const confirmation = prompter.confirm("Continue?", false);
    input.end();

    await expect(confirmation).rejects.toMatchObject({ code: "SETUP_CANCELED" });
    prompter.close();
  });

  it("turns terminal Ctrl+C into a stable setup cancellation", async () => {
    const input = new PassThrough() as PassThrough & {
      isTTY: boolean;
      setRawMode(value: boolean): PassThrough;
    };
    const output = new PassThrough() as PassThrough & { isTTY: boolean };
    input.isTTY = true;
    input.setRawMode = () => input;
    output.isTTY = true;
    const prompter = new TerminalSetupPrompter(input, output);

    const confirmation = prompter.confirm("Continue?", false);
    input.write("\u0003");

    await expect(confirmation).rejects.toMatchObject({ code: "SETUP_CANCELED" });
    prompter.close();
  });
});
