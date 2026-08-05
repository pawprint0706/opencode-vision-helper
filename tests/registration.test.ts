import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { parse } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  inspectOpenCodeRegistration,
  OPENCODE_PLUGIN_PACKAGE,
  registerOpenCodePlugin,
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
      plugin: [OPENCODE_PLUGIN_PACKAGE],
      permission: { vision_analyze: "ask" },
    });
    expect(JSON.parse(await readFile(location.manifestPath, "utf8"))).toMatchObject({
      schema: 1,
      owner: "opencode-vision-helper",
      configPath: resolve(location.configPath),
      plugin: { value: OPENCODE_PLUGIN_PACKAGE, added: true },
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
      plugin: ["other", OPENCODE_PLUGIN_PACKAGE],
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
