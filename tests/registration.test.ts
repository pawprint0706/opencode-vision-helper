import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { parse } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createOpenCodeManualRegistrationPlan,
  diagnoseOpenCodeRegistration,
  inspectOpenCodeRegistration,
  OPENCODE_PLUGIN_PACKAGE,
  pluginSpecifier,
  registerOpenCodePlugin,
  unregisterOpenCodePlugin,
  verifyOpenCodeManualRegistration,
} from "../src/registration.js";

let temporaryRoot: string;

function paths(extension = "json") {
  return {
    configPath: join(temporaryRoot, ".config", "opencode", `opencode.${extension}`),
    manifestPath: join(temporaryRoot, ".config", "opencode-vision-helper", "registration.json"),
  };
}

beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "opencode-vision-registration-test-"));
});

afterEach(async () => {
  const expectedPrefix = resolve(tmpdir(), "opencode-vision-registration-test-");
  if (!resolve(temporaryRoot).startsWith(expectedPrefix)) {
    throw new Error(`Refusing to remove unexpected test path: ${temporaryRoot}`);
  }
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe("OpenCode global registration", () => {
  it("provides manual targets without choosing between two existing global configs", async () => {
    const directory = join(temporaryRoot, ".config", "opencode");
    await mkdir(directory, { recursive: true });
    const jsonPath = join(directory, "opencode.json");
    const jsoncPath = join(directory, "opencode.jsonc");
    await Promise.all([writeFile(jsonPath, "{}\n"), writeFile(jsoncPath, "{}\n")]);

    await expect(
      createOpenCodeManualRegistrationPlan("ask", { userHome: temporaryRoot }),
    ).resolves.toEqual({
      configPaths: [resolve(jsonPath), resolve(jsoncPath)],
      snippet: {
        plugin: [pluginSpecifier()],
        permission: { vision_analyze: "ask" },
      },
    });
  });

  it("verifies one exact manual registration and rejects ambiguity or a legacy wrapper", async () => {
    const directory = join(temporaryRoot, ".config", "opencode");
    await mkdir(directory, { recursive: true });
    const jsonPath = join(directory, "opencode.json");
    const jsoncPath = join(directory, "opencode.jsonc");
    await Promise.all([writeFile(jsonPath, "{}\n"), writeFile(jsoncPath, "{}\n")]);
    const plan = await createOpenCodeManualRegistrationPlan("ask", { userHome: temporaryRoot });

    await expect(
      verifyOpenCodeManualRegistration(plan, { userHome: temporaryRoot }),
    ).resolves.toMatchObject({ complete: false, reason: expect.stringContaining("More than one") });

    await rm(jsoncPath);
    await writeFile(
      jsonPath,
      `${JSON.stringify({ plugin: [OPENCODE_PLUGIN_PACKAGE], permission: { vision_analyze: "ask", bash: "deny" } }, null, 2)}\n`,
    );
    await expect(
      verifyOpenCodeManualRegistration(plan, { userHome: temporaryRoot }),
    ).resolves.toEqual({ complete: true });

    const wrapperPath = join(directory, "plugins", "vision-helper.ts");
    await mkdir(dirname(wrapperPath), { recursive: true });
    await writeFile(wrapperPath, "// legacy\n");
    await expect(
      verifyOpenCodeManualRegistration(plan, { userHome: temporaryRoot }),
    ).resolves.toMatchObject({
      complete: false,
      reason: expect.stringContaining("legacy wrapper"),
    });
  });

  it("creates the limited global config entries and an ownership manifest", async () => {
    const location = paths();
    const plan = await inspectOpenCodeRegistration("ask", location);
    expect(plan).toMatchObject({
      revision: null,
      pluginPresent: false,
      permissionChange: false,
      changesRequired: true,
    });

    const result = await registerOpenCodePlugin("ask", {
      ...location,
      expectedRevision: plan.revision,
    });
    expect(result).toMatchObject({ status: "registered", changed: true, permission: "ask" });
    expect(JSON.parse(await readFile(location.configPath, "utf8"))).toEqual({
      plugin: [pluginSpecifier()],
      permission: { vision_analyze: "ask" },
    });
    expect(JSON.parse(await readFile(location.manifestPath, "utf8"))).toMatchObject({
      schema: 1,
      owner: "opencode-vision-helper",
      configPath: resolve(location.configPath),
      plugin: { value: pluginSpecifier(), added: true },
      permission: { value: "ask", changed: true, previousPresent: false },
    });
  });

  it("preserves JSONC comments, trailing commas, BOM, CRLF, and unrelated settings", async () => {
    const location = paths("jsonc");
    await mkdir(dirname(location.configPath), { recursive: true });
    const original =
      '\uFEFF{\r\n  // keep this comment\r\n  "theme": "dark",\r\n  "plugin": ["other"],\r\n  "permission": {\r\n    "bash": "deny",\r\n  },\r\n}\r\n';
    await writeFile(location.configPath, original);

    await registerOpenCodePlugin("ask", location);

    const updated = await readFile(location.configPath, "utf8");
    expect(updated.startsWith("\uFEFF")).toBe(true);
    expect(updated).toContain("// keep this comment");
    expect(updated).toContain('"bash": "deny"');
    expect(updated).toContain("\r\n");
    expect(parse(updated.slice(1), undefined, { allowTrailingComma: true })).toMatchObject({
      theme: "dark",
      plugin: ["other", pluginSpecifier()],
      permission: { bash: "deny", vision_analyze: "ask" },
    });
  });

  it("is idempotent when the owned registration is unchanged", async () => {
    const location = paths();
    await registerOpenCodePlugin("ask", location);
    const configBefore = await readFile(location.configPath, "utf8");
    const manifestBefore = await readFile(location.manifestPath, "utf8");

    await expect(registerOpenCodePlugin("ask", location)).resolves.toMatchObject({
      status: "already-registered",
      changed: false,
    });
    expect(await readFile(location.configPath, "utf8")).toBe(configBefore);
    expect(await readFile(location.manifestPath, "utf8")).toBe(manifestBefore);
  });

  it("re-pins an unversioned plugin entry to the current versioned spec", async () => {
    const location = paths();
    await mkdir(dirname(location.configPath), { recursive: true });
    await writeFile(
      location.configPath,
      `${JSON.stringify({ plugin: [OPENCODE_PLUGIN_PACKAGE], permission: { vision_analyze: "ask" } }, null, 2)}\n`,
    );

    const plan = await inspectOpenCodeRegistration("ask", location);
    expect(plan).toMatchObject({ pluginPresent: true, changesRequired: true });

    await expect(
      registerOpenCodePlugin("ask", { ...location, expectedRevision: plan.revision }),
    ).resolves.toMatchObject({ status: "registered", changed: true });
    expect(JSON.parse(await readFile(location.configPath, "utf8"))).toEqual({
      plugin: [pluginSpecifier()],
      permission: { vision_analyze: "ask" },
    });
    expect(JSON.parse(await readFile(location.manifestPath, "utf8"))).toMatchObject({
      plugin: { value: pluginSpecifier(), added: false },
    });
  });

  it("re-pins an older versioned plugin entry to the current version", async () => {
    const location = paths();
    await mkdir(dirname(location.configPath), { recursive: true });
    const stale = pluginSpecifier("0.0.0");
    await writeFile(
      location.configPath,
      `${JSON.stringify({ plugin: [stale], permission: { vision_analyze: "ask" } }, null, 2)}\n`,
    );

    const plan = await inspectOpenCodeRegistration("ask", location);
    expect(plan).toMatchObject({ pluginPresent: true, changesRequired: true });

    await registerOpenCodePlugin("ask", { ...location, expectedRevision: plan.revision });
    expect(JSON.parse(await readFile(location.configPath, "utf8"))).toEqual({
      plugin: [pluginSpecifier()],
      permission: { vision_analyze: "ask" },
    });
  });

  it("treats an entry already pinned to the current version as unchanged", async () => {
    const location = paths();
    await mkdir(dirname(location.configPath), { recursive: true });
    await writeFile(
      location.configPath,
      `${JSON.stringify({ plugin: [pluginSpecifier()], permission: { vision_analyze: "ask" } }, null, 2)}\n`,
    );

    const plan = await inspectOpenCodeRegistration("ask", location);
    expect(plan).toMatchObject({ pluginPresent: true, changesRequired: false });
  });

  it("diagnoses direct registration and scalar global permission without writing", async () => {
    const location = paths();
    await mkdir(dirname(location.configPath), { recursive: true });
    await writeFile(
      location.configPath,
      JSON.stringify({ plugin: [OPENCODE_PLUGIN_PACKAGE], permission: "allow" }, null, 2),
    );

    await expect(diagnoseOpenCodeRegistration(location)).resolves.toMatchObject({
      npmPluginEntries: 1,
      legacyWrapperPresent: false,
      legacyWrapperOwned: false,
      pluginRegistered: true,
      duplicateRegistration: false,
      permission: "allow",
      permissionSource: "global",
      ownershipManifestPresent: false,
    });
  });

  it("distinguishes an owned legacy wrapper from an unowned local plugin", async () => {
    const location = paths();
    const wrapperPath = join(dirname(location.configPath), "plugins", "vision-helper.ts");
    const legacyManifestPath = join(
      dirname(location.configPath),
      ".opencode-vision-helper-install.json",
    );
    const wrapper =
      'export { VisionHelperPlugin } from "@pawprint0706/opencode-vision-helper/plugin";\n';
    await mkdir(dirname(wrapperPath), { recursive: true });
    await writeFile(location.configPath, '{"permission":{"vision_analyze":"ask"}}\n');
    await writeFile(wrapperPath, wrapper);

    await expect(diagnoseOpenCodeRegistration(location)).resolves.toMatchObject({
      legacyWrapperPresent: true,
      legacyWrapperOwned: false,
      pluginRegistered: false,
    });

    await writeFile(
      legacyManifestPath,
      `${JSON.stringify({
        schema: 1,
        owner: "opencode-vision-helper",
        version: "0.1.0",
        packageSpec: "file:test",
        files: [
          {
            path: "plugins/vision-helper.ts",
            sha256: createHash("sha256").update(wrapper).digest("hex"),
          },
        ],
      })}\n`,
    );
    await expect(diagnoseOpenCodeRegistration(location)).resolves.toMatchObject({
      legacyWrapperPresent: true,
      legacyWrapperOwned: true,
      pluginRegistered: true,
    });
  });

  it("diagnoses a project legacy wrapper loaded beside the global npm plugin", async () => {
    const location = paths();
    await mkdir(dirname(location.configPath), { recursive: true });
    await writeFile(
      location.configPath,
      `${JSON.stringify({ plugin: [OPENCODE_PLUGIN_PACKAGE], permission: { vision_analyze: "ask" } }, null, 2)}\n`,
    );
    const projectDirectory = join(temporaryRoot, "project");
    const projectRoot = join(projectDirectory, ".opencode");
    const wrapperPath = join(projectRoot, "plugins", "vision-helper.ts");
    const manifestPath = join(projectRoot, ".opencode-vision-helper-install.json");
    const wrapper =
      'export { VisionHelperPlugin } from "@pawprint0706/opencode-vision-helper/plugin";\n';
    await mkdir(dirname(wrapperPath), { recursive: true });
    await writeFile(wrapperPath, wrapper);
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        schema: 1,
        owner: "opencode-vision-helper",
        version: "0.1.0",
        packageSpec: "file:test",
        files: [
          {
            path: "plugins/vision-helper.ts",
            sha256: createHash("sha256").update(wrapper).digest("hex"),
          },
        ],
      })}\n`,
    );

    await expect(
      diagnoseOpenCodeRegistration({ ...location, projectDirectory }),
    ).resolves.toMatchObject({
      npmPluginEntries: 1,
      projectLegacyWrapperPresent: true,
      projectLegacyWrapperOwned: true,
      pluginRegistered: false,
      duplicateRegistration: true,
    });
  });

  it("requires explicit confirmation before replacing an existing tool permission", async () => {
    const location = paths();
    await mkdir(dirname(location.configPath), { recursive: true });
    await writeFile(
      location.configPath,
      JSON.stringify({ permission: { vision_analyze: "deny", bash: "ask" } }, null, 2),
    );
    const plan = await inspectOpenCodeRegistration("allow", location);
    expect(plan).toMatchObject({ currentPermission: "deny", permissionChange: true });

    await expect(
      registerOpenCodePlugin("allow", { ...location, expectedRevision: plan.revision }),
    ).rejects.toThrow(/explicit confirmation/);
    await registerOpenCodePlugin("allow", {
      ...location,
      expectedRevision: plan.revision,
      allowPermissionChange: true,
    });
    expect(JSON.parse(await readFile(location.configPath, "utf8"))).toMatchObject({
      permission: { vision_analyze: "allow", bash: "ask" },
    });
    expect(JSON.parse(await readFile(location.manifestPath, "utf8"))).toMatchObject({
      permission: { value: "allow", changed: true, previousPresent: true, previous: "deny" },
    });
  });

  it("retains the original permission when a later setup starts owning that value", async () => {
    const location = paths();
    await mkdir(dirname(location.configPath), { recursive: true });
    await writeFile(location.configPath, '{"permission":{"vision_analyze":"ask"}}\n');
    await registerOpenCodePlugin("ask", location);

    const plan = await inspectOpenCodeRegistration("allow", location);
    await registerOpenCodePlugin("allow", {
      ...location,
      expectedRevision: plan.revision,
      allowPermissionChange: true,
    });

    expect(JSON.parse(await readFile(location.manifestPath, "utf8"))).toMatchObject({
      plugin: { added: true },
      permission: { value: "allow", changed: true, previousPresent: true, previous: "ask" },
    });
  });

  it("refuses ambiguous config files, scalar permissions, and a legacy wrapper", async () => {
    const globalDirectory = join(temporaryRoot, ".config", "opencode");
    await mkdir(globalDirectory, { recursive: true });
    await Promise.all([
      writeFile(join(globalDirectory, "opencode.json"), "{}\n"),
      writeFile(join(globalDirectory, "opencode.jsonc"), "{}\n"),
    ]);
    await expect(inspectOpenCodeRegistration("ask", { userHome: temporaryRoot })).rejects.toThrow(
      /Both global OpenCode config files exist/,
    );

    await rm(join(globalDirectory, "opencode.jsonc"));
    await writeFile(join(globalDirectory, "opencode.json"), '{"permission":"allow"}\n');
    await expect(inspectOpenCodeRegistration("ask", { userHome: temporaryRoot })).rejects.toThrow(
      /must be merged manually/,
    );

    await writeFile(join(globalDirectory, "opencode.json"), "{}\n");
    const wrapper = join(globalDirectory, "plugins", "vision-helper.ts");
    await mkdir(dirname(wrapper), { recursive: true });
    await writeFile(wrapper, "// legacy\n");
    await expect(inspectOpenCodeRegistration("ask", { userHome: temporaryRoot })).rejects.toThrow(
      /legacy vision-helper wrapper/,
    );
  });

  it("refuses symlink config files and concurrent changes", async () => {
    const location = paths();
    const outside = join(temporaryRoot, "outside");
    await mkdir(outside, { recursive: true });
    await mkdir(dirname(dirname(location.configPath)), { recursive: true });
    await symlink(
      outside,
      dirname(location.configPath),
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeFile(join(outside, "opencode.json"), "{}\n");
    await expect(inspectOpenCodeRegistration("ask", location)).rejects.toThrow(
      /directory is not a regular/,
    );

    await rm(dirname(location.configPath));
    await mkdir(dirname(location.configPath));
    await writeFile(location.configPath, "{}\n");
    const plan = await inspectOpenCodeRegistration("ask", location);
    await expect(
      registerOpenCodePlugin("ask", {
        ...location,
        expectedRevision: plan.revision,
        beforeConfigCommit: async (path) => writeFile(path, '{"theme":"changed"}\n'),
      }),
    ).rejects.toThrow(/changed while registration/);
    expect(await readFile(location.configPath, "utf8")).toBe('{"theme":"changed"}\n');
  });

  it("rolls the OpenCode config back if manifest persistence fails", async () => {
    const location = paths();
    await mkdir(dirname(location.configPath), { recursive: true });
    const original = '{\n  "theme": "dark"\n}\n';
    await writeFile(location.configPath, original);

    await expect(
      registerOpenCodePlugin("ask", {
        ...location,
        beforeManifestCommit: async () => {
          throw new Error("injected manifest failure");
        },
      }),
    ).rejects.toThrow(/Could not register the OpenCode plugin/);
    expect(await readFile(location.configPath, "utf8")).toBe(original);
    await expect(readFile(location.manifestPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to trust a manifest after an owned value was changed", async () => {
    const location = paths();
    await registerOpenCodePlugin("ask", location);
    const config = JSON.parse(await readFile(location.configPath, "utf8"));
    config.permission.vision_analyze = "deny";
    await writeFile(location.configPath, `${JSON.stringify(config, null, 2)}\n`);

    await expect(inspectOpenCodeRegistration("ask", location)).rejects.toThrow(
      /changed outside setup/,
    );
  });
});

describe("OpenCode global unregistration", () => {
  it("removes only owned JSONC entries while preserving comments and unrelated settings", async () => {
    const location = paths("jsonc");
    await mkdir(dirname(location.configPath), { recursive: true });
    const original =
      '\uFEFF{\r\n  // keep root comment\r\n  "theme": "dark",\r\n  "plugin": [\r\n    "other", // keep plugin comment\r\n  ],\r\n  "permission": {\r\n    "bash": "deny",\r\n  },\r\n}\r\n';
    await writeFile(location.configPath, original);
    await registerOpenCodePlugin("ask", location);

    const registered = await readFile(location.configPath, "utf8");
    expect(registered).toContain("// keep plugin comment");
    await expect(unregisterOpenCodePlugin(location)).resolves.toMatchObject({
      status: "unregistered",
      changed: true,
    });

    const updated = await readFile(location.configPath, "utf8");
    expect(updated.startsWith("\uFEFF")).toBe(true);
    expect(updated).toContain("// keep root comment");
    expect(updated).toContain("// keep plugin comment");
    expect(updated).toContain("\r\n");
    expect(parse(updated.slice(1), undefined, { allowTrailingComma: true })).toEqual({
      theme: "dark",
      plugin: ["other"],
      permission: { bash: "deny" },
    });
    await expect(readFile(location.manifestPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("restores the exact permission that setup replaced", async () => {
    const location = paths();
    await mkdir(dirname(location.configPath), { recursive: true });
    await writeFile(
      location.configPath,
      JSON.stringify(
        {
          plugin: ["other"],
          permission: { vision_analyze: { "*": "deny" }, bash: "ask" },
        },
        null,
        2,
      ),
    );
    const plan = await inspectOpenCodeRegistration("allow", location);
    await registerOpenCodePlugin("allow", {
      ...location,
      expectedRevision: plan.revision,
      allowPermissionChange: true,
    });

    await unregisterOpenCodePlugin(location);

    expect(JSON.parse(await readFile(location.configPath, "utf8"))).toEqual({
      plugin: ["other"],
      permission: { vision_analyze: { "*": "deny" }, bash: "ask" },
    });
  });

  it("leaves a pre-existing npm plugin entry and restores only the owned permission", async () => {
    const location = paths();
    await mkdir(dirname(location.configPath), { recursive: true });
    await writeFile(
      location.configPath,
      `${JSON.stringify({ plugin: [OPENCODE_PLUGIN_PACKAGE], permission: { vision_analyze: "deny" } }, null, 2)}\n`,
    );
    const plan = await inspectOpenCodeRegistration("ask", location);
    await registerOpenCodePlugin("ask", {
      ...location,
      expectedRevision: plan.revision,
      allowPermissionChange: true,
    });

    await unregisterOpenCodePlugin(location);

    expect(JSON.parse(await readFile(location.configPath, "utf8"))).toEqual({
      plugin: [pluginSpecifier()],
      permission: { vision_analyze: "deny" },
    });
  });

  it("preserves unrelated plugin entries added after setup", async () => {
    const location = paths();
    await registerOpenCodePlugin("ask", location);
    const config = JSON.parse(await readFile(location.configPath, "utf8"));
    config.plugin.push("later-plugin");
    await writeFile(location.configPath, `${JSON.stringify(config, null, 2)}\n`);

    await unregisterOpenCodePlugin(location);

    expect(JSON.parse(await readFile(location.configPath, "utf8"))).toEqual({
      plugin: ["later-plugin"],
      permission: {},
    });
  });

  it("refuses changed owned values and unowned direct entries", async () => {
    const owned = paths();
    await registerOpenCodePlugin("ask", owned);
    const config = JSON.parse(await readFile(owned.configPath, "utf8"));
    config.permission.vision_analyze = "deny";
    await writeFile(owned.configPath, `${JSON.stringify(config, null, 2)}\n`);

    await expect(unregisterOpenCodePlugin(owned)).rejects.toThrow(/changed outside setup/);
    expect(JSON.parse(await readFile(owned.configPath, "utf8"))).toMatchObject({
      plugin: [pluginSpecifier()],
      permission: { vision_analyze: "deny" },
    });

    const unowned = {
      configPath: join(temporaryRoot, "unowned", "opencode.json"),
      manifestPath: join(temporaryRoot, "unowned", "registration.json"),
    };
    await mkdir(dirname(unowned.configPath), { recursive: true });
    await writeFile(
      unowned.configPath,
      `${JSON.stringify({ plugin: [OPENCODE_PLUGIN_PACKAGE] }, null, 2)}\n`,
    );
    await expect(unregisterOpenCodePlugin(unowned)).rejects.toThrow(/no helper ownership manifest/);
    expect(JSON.parse(await readFile(unowned.configPath, "utf8"))).toEqual({
      plugin: [OPENCODE_PLUGIN_PACKAGE],
    });
  });

  it("is idempotent once no owned registration remains", async () => {
    const location = paths();
    await registerOpenCodePlugin("ask", location);
    await unregisterOpenCodePlugin(location);
    const configBefore = await readFile(location.configPath, "utf8");

    await expect(unregisterOpenCodePlugin(location)).resolves.toMatchObject({
      status: "not-registered",
      changed: false,
    });
    expect(await readFile(location.configPath, "utf8")).toBe(configBefore);
  });

  it("rolls the config back if ownership manifest removal fails", async () => {
    const location = paths();
    await registerOpenCodePlugin("ask", location);
    const configBefore = await readFile(location.configPath, "utf8");
    const manifestBefore = await readFile(location.manifestPath, "utf8");

    await expect(
      unregisterOpenCodePlugin({
        ...location,
        beforeManifestRemove: async () => {
          throw new Error("injected removal failure");
        },
      }),
    ).rejects.toThrow(/Could not unregister the OpenCode plugin/);
    expect(await readFile(location.configPath, "utf8")).toBe(configBefore);
    expect(await readFile(location.manifestPath, "utf8")).toBe(manifestBefore);
  });

  it("does not overwrite a concurrent config edit during removal", async () => {
    const location = paths();
    await registerOpenCodePlugin("ask", location);

    await expect(
      unregisterOpenCodePlugin({
        ...location,
        beforeConfigCommit: async (path) => {
          await writeFile(
            path,
            `${JSON.stringify({ plugin: [OPENCODE_PLUGIN_PACKAGE], permission: { vision_analyze: "ask" }, theme: "changed" }, null, 2)}\n`,
          );
        },
      }),
    ).rejects.toThrow(/changed while removal/);
    expect(JSON.parse(await readFile(location.configPath, "utf8"))).toMatchObject({
      plugin: [OPENCODE_PLUGIN_PACKAGE],
      permission: { vision_analyze: "ask" },
      theme: "changed",
    });
    await expect(readFile(location.manifestPath, "utf8")).resolves.toContain(
      "opencode-vision-helper",
    );
  });
});
