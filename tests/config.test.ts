import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CLOUD_UPLOAD_NOTICE_VERSION,
  HELPER_CONFIG_SCHEMA,
  type HelperConfig,
  hasValidCloudUploadConsent,
  parseHelperConfig,
  readHelperConfig,
  readHelperConfigState,
  resolveConfiguredVisionModel,
  resolveHelperConfigPath,
  writeHelperConfig,
} from "../src/config.js";

let temporaryRoot: string;

function acceptedConfig(overrides: Partial<HelperConfig["openCode"]> = {}): HelperConfig {
  return {
    schema: HELPER_CONFIG_SCHEMA,
    consent: {
      cloudUpload: true,
      noticeVersion: CLOUD_UPLOAD_NOTICE_VERSION,
      acceptedAt: "2026-08-05T00:00:00.000Z",
    },
    openCode: {
      permission: "ask",
      model: "opencode-go/vision",
      ...overrides,
    },
  };
}

beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "opencode-vision-config-test-"));
});

afterEach(async () => {
  const expectedPrefix = resolve(tmpdir(), "opencode-vision-config-test-");
  if (!resolve(temporaryRoot).startsWith(expectedPrefix)) {
    throw new Error(`Refusing to remove unexpected test path: ${temporaryRoot}`);
  }
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe("helper configuration", () => {
  it("uses a helper-owned path below the supplied home directory", () => {
    expect(resolveHelperConfigPath({ userHome: temporaryRoot })).toBe(
      resolve(temporaryRoot, ".config", "opencode-vision-helper", "config.json"),
    );
    expect(resolveHelperConfigPath({ configPath: join(temporaryRoot, "custom.json") })).toBe(
      resolve(temporaryRoot, "custom.json"),
    );
  });

  it("parses the exact versioned schema and recognizes current consent", () => {
    const config = acceptedConfig();
    expect(parseHelperConfig(JSON.stringify(config))).toEqual(config);
    expect(hasValidCloudUploadConsent(config)).toBe(true);

    const declined: HelperConfig = {
      ...config,
      consent: { cloudUpload: false },
    };
    expect(parseHelperConfig(JSON.stringify(declined))).toEqual(declined);
    expect(hasValidCloudUploadConsent(declined)).toBe(false);

    const oldNotice: HelperConfig = {
      ...config,
      consent: { ...config.consent, noticeVersion: CLOUD_UPLOAD_NOTICE_VERSION + 1 },
    };
    expect(parseHelperConfig(JSON.stringify(oldNotice))).toEqual(oldNotice);
    expect(hasValidCloudUploadConsent(oldNotice)).toBe(false);
  });

  it("selects explicit and environment overrides before the saved model", () => {
    const config = acceptedConfig({ model: "opencode-go/stored" });
    expect(resolveConfiguredVisionModel(config, "opencode-go/explicit", "opencode/env")).toBe(
      "opencode-go/explicit",
    );
    expect(resolveConfiguredVisionModel(config, undefined, "opencode/env")).toBe("opencode/env");
    expect(resolveConfiguredVisionModel(config, undefined, undefined)).toBe("opencode-go/stored");
    expect(resolveConfiguredVisionModel(undefined, undefined, undefined)).toBeUndefined();
  });

  it("fails closed for malformed, future, or unsupported configuration", () => {
    expect(() => parseHelperConfig("{")).toThrow(/not valid JSON/);
    expect(() =>
      parseHelperConfig(JSON.stringify({ ...acceptedConfig(), schema: HELPER_CONFIG_SCHEMA + 1 })),
    ).toThrow(/Unsupported helper configuration schema/);
    expect(() =>
      parseHelperConfig(JSON.stringify({ ...acceptedConfig(), unexpected: true })),
    ).toThrow(/unsupported fields/);
    expect(() =>
      parseHelperConfig(
        JSON.stringify({
          ...acceptedConfig(),
          consent: {
            cloudUpload: true,
            noticeVersion: CLOUD_UPLOAD_NOTICE_VERSION,
            acceptedAt: "2026-08-05",
          },
        }),
      ),
    ).toThrow(/consent metadata/);
    expect(() =>
      parseHelperConfig(
        JSON.stringify({
          ...acceptedConfig(),
          openCode: { permission: "deny", model: "opencode-go/vision" },
        }),
      ),
    ).toThrow(/permission/);
    expect(() =>
      parseHelperConfig(
        JSON.stringify({
          ...acceptedConfig(),
          openCode: { permission: "ask", model: "openai/vision" },
        }),
      ),
    ).toThrow(/Go or Zen/);
  });

  it("returns an empty revision when no configuration exists", async () => {
    const configPath = join(temporaryRoot, "config", "config.json");
    await expect(readHelperConfig({ configPath })).resolves.toBeUndefined();
    await expect(readHelperConfigState({ configPath })).resolves.toEqual({
      path: resolve(configPath),
      revision: null,
    });
  });

  it("writes, reads, and updates configuration with revision checks", async () => {
    const configPath = join(temporaryRoot, "config", "config.json");
    const first = await writeHelperConfig(acceptedConfig(), {
      configPath,
      expectedRevision: null,
    });
    expect(first.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(await readHelperConfig({ configPath })).toEqual(acceptedConfig());
    expect((await readFile(configPath, "utf8")).endsWith("\n")).toBe(true);
    if (process.platform !== "win32") {
      expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    }

    const updated = acceptedConfig({ permission: "allow", model: "opencode/vision" });
    const second = await writeHelperConfig(updated, {
      configPath,
      expectedRevision: first.revision,
    });
    expect(second.revision).not.toBe(first.revision);
    expect(await readHelperConfig({ configPath })).toEqual(updated);

    await expect(
      writeHelperConfig(acceptedConfig(), {
        configPath,
        expectedRevision: first.revision,
      }),
    ).rejects.toMatchObject({ code: "CONFIGURATION" });
    expect(await readHelperConfig({ configPath })).toEqual(updated);
  });

  it("rejects corrupted and non-regular configuration files", async () => {
    const corrupted = join(temporaryRoot, "corrupted", "config.json");
    await mkdir(resolve(corrupted, ".."), { recursive: true });
    await writeFile(corrupted, "not json\n");
    await expect(readHelperConfig({ configPath: corrupted })).rejects.toMatchObject({
      code: "CONFIGURATION",
    });

    const directoryPath = join(temporaryRoot, "not-a-file", "config.json");
    await mkdir(directoryPath, { recursive: true });
    await expect(readHelperConfig({ configPath: directoryPath })).rejects.toThrow(/regular file/);
  });

  it("refuses a helper configuration directory symlink", async () => {
    const outside = join(temporaryRoot, "outside");
    const linked = join(temporaryRoot, "linked-config");
    await mkdir(outside);
    await symlink(outside, linked, process.platform === "win32" ? "junction" : "dir");
    const configPath = join(linked, "config.json");

    await expect(
      writeHelperConfig(acceptedConfig(), { configPath, expectedRevision: null }),
    ).rejects.toThrow(/not a regular directory/);
    await expect(readFile(join(outside, "config.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not take over an existing writer lock", async () => {
    const configPath = join(temporaryRoot, "locked", "config.json");
    await mkdir(resolve(configPath, ".."), { recursive: true });
    const lockPath = `${configPath}.lock`;
    await writeFile(lockPath, "another writer\n");

    await expect(
      writeHelperConfig(acceptedConfig(), { configPath, expectedRevision: null }),
    ).rejects.toThrow(/already in progress/);
    expect(await readFile(lockPath, "utf8")).toBe("another writer\n");
  });
});
