import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const OWNER = "opencode-vision-helper";
export const MANIFEST_FILENAME = ".opencode-vision-helper-install.json";
export const PLUGIN_RELATIVE_PATH = "plugins/vision-helper.ts";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export class InstallError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "InstallError";
    this.code = code;
  }
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function packageInfo(packageRoot = PACKAGE_ROOT) {
  const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  const plugin = await readFile(resolve(packageRoot, "opencode", "plugins", "vision-helper.ts"), "utf8");
  return {
    packageRoot,
    version: packageJson.version,
    plugin,
  };
}

export function resolveInstallTarget({
  scope = "project",
  target,
  cwd = process.cwd(),
  userHome = homedir(),
} = {}) {
  if (scope !== "project" && scope !== "global") {
    throw new InstallError("BAD_ARGUMENT", "--scope must be project or global.");
  }
  if (target) {
    return resolve(target);
  }
  if (scope === "project") {
    return resolve(cwd, ".opencode");
  }
  return resolve(userHome, ".config", "opencode");
}

function parseManifest(content) {
  let manifest;
  try {
    manifest = JSON.parse(content);
  } catch (error) {
    throw new InstallError("MANIFEST_INVALID", "The install manifest is not valid JSON.", {
      cause: error,
    });
  }
  const file = manifest?.files?.[0];
  if (
    manifest?.schema !== 1 ||
    manifest?.owner !== OWNER ||
    typeof manifest?.version !== "string" ||
    typeof manifest?.packageSpec !== "string" ||
    !Array.isArray(manifest?.files) ||
    manifest.files.length !== 1 ||
    file?.path !== PLUGIN_RELATIVE_PATH ||
    typeof file?.sha256 !== "string"
  ) {
    throw new InstallError(
      "MANIFEST_INVALID",
      "The install manifest does not exactly describe an opencode-vision-helper adapter.",
    );
  }
  return manifest;
}

function snippets(packageSpec) {
  return {
    package: {
      dependencies: {
        [OWNER]: packageSpec,
      },
    },
    permission: {
      permission: {
        vision_analyze: "ask",
      },
    },
  };
}

export async function installAdapter(options = {}) {
  const target = resolveInstallTarget(options);
  const info = await packageInfo(options.packageRoot);
  const packageSpec = options.packageSpec ?? `file:${info.packageRoot.replaceAll("\\", "/")}`;
  const pluginPath = resolve(target, PLUGIN_RELATIVE_PATH);
  const manifestPath = resolve(target, MANIFEST_FILENAME);
  const [existingPlugin, existingManifest] = await Promise.all([
    readOptional(pluginPath),
    readOptional(manifestPath),
  ]);

  if (existingManifest !== undefined) {
    const manifest = parseManifest(existingManifest);
    if (existingPlugin === undefined) {
      throw new InstallError(
        "OWNERSHIP_CONFLICT",
        `Owned manifest exists but its plugin is missing: ${pluginPath}`,
      );
    }
    const currentHash = sha256(existingPlugin);
    if (
      currentHash !== manifest.files[0].sha256 ||
      currentHash !== sha256(info.plugin) ||
      manifest.version !== info.version
    ) {
      throw new InstallError(
        "OWNERSHIP_CONFLICT",
        `Installed plugin differs from this package and will not be replaced: ${pluginPath}`,
      );
    }
    if (manifest.packageSpec !== packageSpec) {
      throw new InstallError(
        "OWNERSHIP_CONFLICT",
        "A different package spec is already installed; uninstall it before changing sources.",
      );
    }
    return {
      status: "already-installed",
      target,
      pluginPath,
      manifestPath,
      snippets: snippets(packageSpec),
    };
  }

  if (existingPlugin !== undefined) {
    throw new InstallError(
      "OWNERSHIP_CONFLICT",
      `An unowned plugin already exists and will not be replaced: ${pluginPath}`,
    );
  }

  const pluginHash = sha256(info.plugin);
  const manifest = {
    schema: 1,
    owner: OWNER,
    version: info.version,
    packageSpec,
    files: [{ path: PLUGIN_RELATIVE_PATH, sha256: pluginHash }],
  };

  let pluginCreated = false;
  try {
    await mkdir(dirname(pluginPath), { recursive: true });
    await writeFile(pluginPath, info.plugin, { encoding: "utf8", flag: "wx" });
    pluginCreated = true;
    await options.beforeManifestWrite?.({ pluginPath, manifestPath });
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  } catch (error) {
    if (pluginCreated) {
      const current = await readOptional(pluginPath);
      if (current !== undefined && sha256(current) === pluginHash) {
        await rm(pluginPath).catch(() => undefined);
      }
    }
    if (error instanceof InstallError) {
      throw error;
    }
    throw new InstallError("INSTALL_FAILED", "Could not install the OpenCode adapter safely.", {
      cause: error,
    });
  }

  return {
    status: "installed",
    target,
    pluginPath,
    manifestPath,
    snippets: snippets(packageSpec),
  };
}

export async function uninstallAdapter(options = {}) {
  const target = resolveInstallTarget(options);
  const pluginPath = resolve(target, PLUGIN_RELATIVE_PATH);
  const manifestPath = resolve(target, MANIFEST_FILENAME);
  const [existingPlugin, existingManifest] = await Promise.all([
    readOptional(pluginPath),
    readOptional(manifestPath),
  ]);

  if (existingManifest === undefined) {
    if (existingPlugin !== undefined) {
      throw new InstallError(
        "OWNERSHIP_CONFLICT",
        `An unowned plugin exists and will not be removed: ${pluginPath}`,
      );
    }
    return { status: "not-installed", target, pluginPath, manifestPath };
  }

  const manifest = parseManifest(existingManifest);
  if (existingPlugin === undefined) {
    await rm(manifestPath);
    return { status: "recovered-stale-manifest", target, pluginPath, manifestPath };
  }
  if (sha256(existingPlugin) !== manifest.files[0].sha256) {
    throw new InstallError(
      "OWNERSHIP_CONFLICT",
      `Installed plugin was modified and will not be removed: ${pluginPath}`,
    );
  }

  await rm(pluginPath);
  await rm(manifestPath);
  return { status: "uninstalled", target, pluginPath, manifestPath };
}

export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
