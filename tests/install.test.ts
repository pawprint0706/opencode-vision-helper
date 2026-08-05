import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  installAdapter,
  MANIFEST_FILENAME,
  PLUGIN_RELATIVE_PATH,
  pathExists,
  resolveInstallTarget,
  uninstallAdapter,
} from "../scripts/install-lib.mjs";

const packageRoot = resolve(".");
const execFileAsync = promisify(execFile);
let temporaryRoot: string;

type CommandFailure = Error & {
  code: number;
  stdout: string;
  stderr: string;
};

async function commandFailure(args: string[]): Promise<CommandFailure> {
  try {
    await execFileAsync(process.execPath, args, { cwd: packageRoot });
  } catch (error) {
    return error as CommandFailure;
  }
  throw new Error("Expected command to fail.");
}

beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "opencode-vision-helper-test-"));
});

afterEach(async () => {
  const expectedPrefix = resolve(tmpdir(), "opencode-vision-helper-test-");
  if (!resolve(temporaryRoot).startsWith(expectedPrefix)) {
    throw new Error(`Refusing to remove unexpected test path: ${temporaryRoot}`);
  }
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe("ownership-safe adapter lifecycle", () => {
  it("installs owned files without modifying OpenCode config", async () => {
    const target = join(temporaryRoot, ".opencode");
    const configPath = join(target, "opencode.json");
    await mkdir(target, { recursive: true });
    await writeFile(configPath, '{"permission":{"bash":"deny"}}\n');
    const originalConfig = await readFile(configPath, "utf8");

    const result = await installAdapter({
      target,
      packageRoot,
      packageSpec: "file:D:/helper",
    });

    expect(result.status).toBe("installed");
    expect(await readFile(configPath, "utf8")).toBe(originalConfig);
    expect(await pathExists(join(target, PLUGIN_RELATIVE_PATH))).toBe(true);
    const manifest = JSON.parse(await readFile(join(target, MANIFEST_FILENAME), "utf8"));
    expect(manifest).toMatchObject({
      schema: 1,
      owner: "opencode-vision-helper",
      packageSpec: "file:D:/helper",
      files: [{ path: PLUGIN_RELATIVE_PATH }],
    });
    expect(result.snippets).toMatchObject({
      package: {
        dependencies: { "@pawprint0706/opencode-vision-helper": "file:D:/helper" },
      },
      permission: { permission: { vision_analyze: "ask" } },
    });
    expect(result.mergeTargets).toEqual({
      packagePath: resolve(target, "package.json"),
      configPath: resolve(target, "opencode.json"),
    });
  });

  it("is idempotent only for the exact owned install", async () => {
    const target = join(temporaryRoot, ".opencode");
    const options = { target, packageRoot, packageSpec: "file:D:/helper" };
    await installAdapter(options);
    await expect(installAdapter(options)).resolves.toMatchObject({
      status: "already-installed",
    });
    await expect(
      installAdapter({ ...options, packageSpec: "file:D:/other" }),
    ).rejects.toMatchObject({ code: "OWNERSHIP_CONFLICT" });
  });

  it("refuses to replace an unowned plugin or trust a stale manifest", async () => {
    const target = join(temporaryRoot, ".opencode");
    const pluginPath = join(target, PLUGIN_RELATIVE_PATH);
    await mkdir(join(target, "plugins"), { recursive: true });
    await writeFile(pluginPath, "export default 'someone else'\n");
    await expect(installAdapter({ target, packageRoot })).rejects.toMatchObject({
      code: "OWNERSHIP_CONFLICT",
    });
    expect(await readFile(pluginPath, "utf8")).toBe("export default 'someone else'\n");

    await rm(pluginPath);
    await writeFile(join(target, MANIFEST_FILENAME), "{}\n");
    await expect(installAdapter({ target, packageRoot })).rejects.toMatchObject({
      code: "MANIFEST_INVALID",
    });
    expect(await pathExists(pluginPath)).toBe(false);
  });

  it("rolls back only the plugin created by a failed install run", async () => {
    const target = join(temporaryRoot, ".opencode");
    const pluginPath = join(target, PLUGIN_RELATIVE_PATH);
    const manifestPath = join(target, MANIFEST_FILENAME);
    await expect(
      installAdapter({
        target,
        packageRoot,
        beforeManifestWrite: async () => {
          await writeFile(manifestPath, "external race winner\n", { flag: "wx" });
        },
      }),
    ).rejects.toMatchObject({ code: "INSTALL_FAILED" });
    expect(await pathExists(pluginPath)).toBe(false);
    expect(await readFile(manifestPath, "utf8")).toBe("external race winner\n");
  });

  it("reports an incomplete rollback without deleting a concurrently changed plugin", async () => {
    const target = join(temporaryRoot, ".opencode");
    const pluginPath = join(target, PLUGIN_RELATIVE_PATH);
    await expect(
      installAdapter({
        target,
        packageRoot,
        beforeManifestWrite: async () => {
          await writeFile(pluginPath, "// changed during install\n");
          throw new Error("manifest write failed");
        },
      }),
    ).rejects.toMatchObject({ code: "ROLLBACK_INCOMPLETE" });
    expect(await readFile(pluginPath, "utf8")).toBe("// changed during install\n");
    expect(await pathExists(join(target, MANIFEST_FILENAME))).toBe(false);
  });

  it("refuses a plugin directory that resolves outside the selected target", async () => {
    const target = join(temporaryRoot, ".opencode");
    const outside = join(temporaryRoot, "outside");
    const pluginDirectory = join(target, "plugins");
    await mkdir(target, { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, pluginDirectory, process.platform === "win32" ? "junction" : "dir");

    await expect(installAdapter({ target, packageRoot })).rejects.toMatchObject({
      code: "OWNERSHIP_CONFLICT",
    });
    expect(await pathExists(join(outside, "vision-helper.ts"))).toBe(false);
    await expect(uninstallAdapter({ target })).rejects.toMatchObject({
      code: "OWNERSHIP_CONFLICT",
    });
  });

  it("refuses to remove a modified owned plugin", async () => {
    const target = join(temporaryRoot, ".opencode");
    const pluginPath = join(target, PLUGIN_RELATIVE_PATH);
    await installAdapter({ target, packageRoot });
    await writeFile(pluginPath, "// user modification\n");

    await expect(uninstallAdapter({ target })).rejects.toMatchObject({
      code: "OWNERSHIP_CONFLICT",
    });
    expect(await pathExists(pluginPath)).toBe(true);
    expect(await pathExists(join(target, MANIFEST_FILENAME))).toBe(true);
  });

  it("treats line-ending or BOM changes as user modifications", async () => {
    const target = join(temporaryRoot, ".opencode");
    const pluginPath = join(target, PLUGIN_RELATIVE_PATH);
    await installAdapter({ target, packageRoot });
    const installed = await readFile(pluginPath, "utf8");
    await writeFile(pluginPath, `\uFEFF${installed.replaceAll("\n", "\r\n")}`);

    await expect(uninstallAdapter({ target })).rejects.toMatchObject({
      code: "OWNERSHIP_CONFLICT",
    });
    expect(await readFile(pluginPath, "utf8")).toMatch(/^\uFEFF/);
  });

  it("removes only exact owned files and preserves unrelated state", async () => {
    const target = join(temporaryRoot, ".opencode");
    const unrelated = join(target, "plugins", "other.ts");
    await installAdapter({ target, packageRoot });
    await writeFile(unrelated, "export default {}\n");

    await expect(uninstallAdapter({ target })).resolves.toMatchObject({
      status: "uninstalled",
    });
    expect(await pathExists(join(target, PLUGIN_RELATIVE_PATH))).toBe(false);
    expect(await pathExists(join(target, MANIFEST_FILENAME))).toBe(false);
    expect(await readFile(unrelated, "utf8")).toBe("export default {}\n");
  });

  it("recovers a valid manifest after its owned plugin was already removed", async () => {
    const target = join(temporaryRoot, ".opencode");
    await installAdapter({ target, packageRoot });
    await rm(join(target, PLUGIN_RELATIVE_PATH));
    await expect(uninstallAdapter({ target })).resolves.toMatchObject({
      status: "recovered-stale-manifest",
    });
    expect(await pathExists(join(target, MANIFEST_FILENAME))).toBe(false);
  });

  it("allows the current uninstaller to remove an exact older owned install", async () => {
    const target = join(temporaryRoot, ".opencode");
    await installAdapter({ target, packageRoot, packageSpec: "file:D:/old-helper" });
    const manifestPath = join(target, MANIFEST_FILENAME);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.version = "0.0.0";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(uninstallAdapter({ target })).resolves.toMatchObject({
      status: "uninstalled",
    });
    expect(await pathExists(join(target, PLUGIN_RELATIVE_PATH))).toBe(false);
    expect(await pathExists(manifestPath)).toBe(false);
  });

  it("reports and recovers a partial uninstall after plugin removal", async () => {
    const target = join(temporaryRoot, ".opencode");
    const pluginPath = join(target, PLUGIN_RELATIVE_PATH);
    const manifestPath = join(target, MANIFEST_FILENAME);
    await installAdapter({ target, packageRoot });

    await expect(
      uninstallAdapter({
        target,
        beforeManifestRemove: async () => {
          throw new Error("simulated manifest removal failure");
        },
      }),
    ).rejects.toMatchObject({ code: "UNINSTALL_INCOMPLETE" });
    expect(await pathExists(pluginPath)).toBe(false);
    expect(await pathExists(manifestPath)).toBe(true);

    await expect(uninstallAdapter({ target })).resolves.toMatchObject({
      status: "recovered-stale-manifest",
    });
    expect(await pathExists(manifestPath)).toBe(false);
  });

  it("resolves project and global targets without inspecting credentials", () => {
    expect(resolveInstallTarget({ scope: "project", cwd: "D:/work" })).toBe(
      resolve("D:/work", ".opencode"),
    );
    expect(
      resolveInstallTarget({
        scope: "global",
        userHome: "D:/home",
      }),
    ).toBe(resolve("D:/home", ".config", "opencode"));
  });

  it("reports scope-specific package and config merge targets", async () => {
    const project = join(temporaryRoot, "project");
    const projectResult = await installAdapter({
      scope: "project",
      cwd: project,
      packageRoot,
    });
    expect(projectResult.mergeTargets).toEqual({
      packagePath: resolve(project, ".opencode", "package.json"),
      configPath: resolve(project, "opencode.json"),
    });

    const userHome = join(temporaryRoot, "home");
    const globalResult = await installAdapter({
      scope: "global",
      userHome,
      packageRoot,
    });
    expect(globalResult.mergeTargets).toEqual({
      packagePath: resolve(userHome, ".config", "opencode", "package.json"),
      configPath: resolve(userHome, ".config", "opencode", "opencode.json"),
    });
  });

  it("runs the cross-platform install and uninstall command entrypoints", async () => {
    const target = join(temporaryRoot, ".opencode");
    const installed = await execFileAsync(
      process.execPath,
      [
        resolve("scripts/install.mjs"),
        "--target",
        target,
        "--package-spec",
        "file:D:/helper",
        "--json",
      ],
      { cwd: packageRoot },
    );
    expect(JSON.parse(installed.stdout)).toMatchObject({ status: "installed" });

    const uninstalled = await execFileAsync(
      process.execPath,
      [resolve("scripts/uninstall.mjs"), "--target", target, "--json"],
      { cwd: packageRoot },
    );
    expect(JSON.parse(uninstalled.stdout)).toMatchObject({ status: "uninstalled" });
  });

  it("prints the exact dependency installation root in human output", async () => {
    const target = join(temporaryRoot, "target with spaces");
    const installed = await execFileAsync(
      process.execPath,
      [resolve("scripts/install.mjs"), "--target", target],
      { cwd: packageRoot },
    );

    expect(installed.stdout).toContain(
      `npm install --prefix ${JSON.stringify(resolve(target))} --no-audit --no-fund`,
    );
  });

  it("reports command ownership conflicts on stderr with exit code 1", async () => {
    const target = join(temporaryRoot, ".opencode");
    const pluginPath = join(target, PLUGIN_RELATIVE_PATH);
    await mkdir(dirname(pluginPath), { recursive: true });
    await writeFile(pluginPath, "// externally owned\n");

    const installFailure = await commandFailure([
      resolve("scripts/install.mjs"),
      "--target",
      target,
      "--json",
    ]);
    expect(installFailure.code).toBe(1);
    expect(installFailure.stdout).toBe("");
    expect(JSON.parse(installFailure.stderr)).toMatchObject({
      status: "error",
      error_code: "OWNERSHIP_CONFLICT",
    });

    const uninstallFailure = await commandFailure([
      resolve("scripts/uninstall.mjs"),
      "--target",
      target,
      "--json",
    ]);
    expect(uninstallFailure.code).toBe(1);
    expect(uninstallFailure.stdout).toBe("");
    expect(JSON.parse(uninstallFailure.stderr)).toMatchObject({
      status: "error",
      error_code: "OWNERSHIP_CONFLICT",
    });
  });
});
