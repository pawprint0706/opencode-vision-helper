import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, resolve } from "node:path";

import { applyEdits, modify, type ParseError, parse, printParseErrorCode } from "jsonc-parser";

import type { HelperPermission } from "./config.js";
import { AppError } from "./errors.js";

export const OPENCODE_PLUGIN_PACKAGE = "@pawprint0706/opencode-vision-helper";
export const REGISTRATION_MANIFEST_FILENAME = "opencode-registration.json";
const REGISTRATION_OWNER = "opencode-vision-helper";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type RegistrationManifest = {
  schema: 1;
  owner: typeof REGISTRATION_OWNER;
  configPath: string;
  plugin: { value: typeof OPENCODE_PLUGIN_PACKAGE; added: boolean };
  permission: {
    value: HelperPermission;
    changed: boolean;
    previousPresent: boolean;
    previous?: JsonValue;
  };
};

export type OpenCodeRegistrationOptions = {
  configPath?: string;
  manifestPath?: string;
  userHome?: string;
  expectedRevision?: string | null;
  allowPermissionChange?: boolean;
  beforeConfigCommit?: (path: string) => Promise<void>;
  beforeManifestCommit?: (path: string) => Promise<void>;
};

export type OpenCodeRegistrationPlan = {
  configPath: string;
  manifestPath: string;
  revision: string | null;
  pluginPresent: boolean;
  currentPermission?: JsonValue;
  permissionChange: boolean;
  changesRequired: boolean;
  snippet: {
    plugin: [typeof OPENCODE_PLUGIN_PACKAGE];
    permission: { vision_analyze: HelperPermission };
  };
};

export type OpenCodeRegistrationResult = {
  status: "registered" | "already-registered";
  changed: boolean;
  configPath: string;
  manifestPath?: string;
  permission: HelperPermission;
};

function registrationError(message: string, cause?: unknown): AppError {
  return new AppError("CONFIGURATION", message, cause === undefined ? undefined : { cause });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function lstatOptional(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readRegularFile(path: string, label: string): Promise<string | undefined> {
  let entry: Awaited<ReturnType<typeof lstatOptional>>;
  try {
    entry = await lstatOptional(path);
  } catch (error) {
    throw registrationError(`Could not inspect the ${label}: ${path}`, error);
  }
  if (!entry) {
    return undefined;
  }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw registrationError(`The ${label} is not a regular file: ${path}`);
  }
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw registrationError(`Could not read the ${label}: ${path}`, error);
  }
}

async function assertWritableFile(path: string, label: string): Promise<void> {
  if (!(await lstatOptional(path))) {
    return;
  }
  try {
    await access(path, constants.W_OK);
  } catch (error) {
    throw registrationError(`The ${label} is read-only and will not be changed: ${path}`, error);
  }
}

function assertConfigExtension(path: string): void {
  const extension = extname(path).toLowerCase();
  if (extension !== ".json" && extension !== ".jsonc") {
    throw registrationError("The OpenCode config target must end in .json or .jsonc.");
  }
}

async function resolveConfigPath(options: OpenCodeRegistrationOptions): Promise<string> {
  if (options.configPath) {
    const path = resolve(options.configPath);
    assertConfigExtension(path);
    return path;
  }
  const directory = resolve(options.userHome ?? homedir(), ".config", "opencode");
  const jsonPath = resolve(directory, "opencode.json");
  const jsoncPath = resolve(directory, "opencode.jsonc");
  const [jsonEntry, jsoncEntry] = await Promise.all([
    lstatOptional(jsonPath),
    lstatOptional(jsoncPath),
  ]);
  if (jsonEntry && jsoncEntry) {
    throw registrationError(
      `Both global OpenCode config files exist; merge manually before setup: ${jsonPath} and ${jsoncPath}`,
    );
  }
  return jsoncEntry ? jsoncPath : jsonPath;
}

function resolveManifestPath(options: OpenCodeRegistrationOptions): string {
  return resolve(
    options.manifestPath ??
      resolve(
        options.userHome ?? homedir(),
        ".config",
        "opencode-vision-helper",
        REGISTRATION_MANIFEST_FILENAME,
      ),
  );
}

function parseConfig(content: string | undefined, path: string): Record<string, unknown> {
  if (content === undefined) {
    return {};
  }
  const body = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const errors: ParseError[] = [];
  const value: unknown = parse(body, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    const first = errors[0];
    throw registrationError(
      `The OpenCode config cannot be merged safely (${first ? printParseErrorCode(first.error) : "parse error"}): ${path}`,
    );
  }
  if (!isRecord(value)) {
    throw registrationError(`The OpenCode config root must be an object: ${path}`);
  }
  return value;
}

function parseManifest(content: string, path: string): RegistrationManifest {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw registrationError(`The registration manifest is not valid JSON: ${path}`, error);
  }
  if (!isRecord(value) || !isRecord(value.plugin) || !isRecord(value.permission)) {
    throw registrationError(`The registration manifest has an unsupported shape: ${path}`);
  }
  const permission = value.permission;
  const previousValid =
    permission.previousPresent === false ||
    (permission.previousPresent === true &&
      "previous" in permission &&
      isJsonValue(permission.previous));
  if (
    value.schema !== 1 ||
    value.owner !== REGISTRATION_OWNER ||
    typeof value.configPath !== "string" ||
    value.plugin.value !== OPENCODE_PLUGIN_PACKAGE ||
    typeof value.plugin.added !== "boolean" ||
    (permission.value !== "ask" && permission.value !== "allow") ||
    typeof permission.changed !== "boolean" ||
    !previousValid
  ) {
    throw registrationError(`The registration manifest is not owned by this helper: ${path}`);
  }
  return value as RegistrationManifest;
}

function inspectConfig(
  config: Record<string, unknown>,
  permission: HelperPermission,
  configPath: string,
): Pick<
  OpenCodeRegistrationPlan,
  "pluginPresent" | "currentPermission" | "permissionChange" | "changesRequired"
> {
  const plugin = config.plugin;
  if (
    plugin !== undefined &&
    (!Array.isArray(plugin) || !plugin.every((item) => typeof item === "string"))
  ) {
    throw registrationError(
      `The existing OpenCode plugin setting is not a string array: ${configPath}`,
    );
  }
  const packageCount = Array.isArray(plugin)
    ? plugin.filter((item) => item === OPENCODE_PLUGIN_PACKAGE).length
    : 0;
  if (packageCount > 1) {
    throw registrationError(
      `The OpenCode plugin list contains duplicate helper entries: ${configPath}`,
    );
  }

  const permissionRoot = config.permission;
  if (permissionRoot !== undefined && !isRecord(permissionRoot)) {
    throw registrationError(
      `The existing OpenCode permission setting is not an object, so vision_analyze must be merged manually: ${configPath}`,
    );
  }
  const currentPermission = permissionRoot?.vision_analyze;
  if (currentPermission !== undefined && !isJsonValue(currentPermission)) {
    throw registrationError(
      `The current vision_analyze permission cannot be preserved: ${configPath}`,
    );
  }
  const permissionChange = currentPermission !== undefined && currentPermission !== permission;
  return {
    pluginPresent: packageCount === 1,
    ...(currentPermission !== undefined ? { currentPermission } : {}),
    permissionChange,
    changesRequired: packageCount === 0 || currentPermission !== permission,
  };
}

async function assertNoLegacyWrapper(configPath: string): Promise<void> {
  const wrapperPath = resolve(dirname(configPath), "plugins", "vision-helper.ts");
  if (await lstatOptional(wrapperPath)) {
    throw registrationError(
      `A legacy vision-helper wrapper is already present and would load beside the npm plugin. Remove it with the ownership-aware adapter uninstaller first: ${wrapperPath}`,
    );
  }
}

async function assertExistingConfigDirectoryIsRegular(configPath: string): Promise<void> {
  const directory = dirname(configPath);
  const entry = await lstatOptional(directory);
  if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) {
    throw registrationError(
      `The OpenCode config directory is not a regular directory: ${directory}`,
    );
  }
}

function verifyOwnedState(
  manifest: RegistrationManifest,
  config: Record<string, unknown>,
  configPath: string,
): void {
  if (resolve(manifest.configPath) !== resolve(configPath)) {
    throw registrationError("The registration manifest belongs to a different OpenCode config.");
  }
  const plugin = Array.isArray(config.plugin) ? config.plugin : [];
  if (
    manifest.plugin.added &&
    plugin.filter((item) => item === OPENCODE_PLUGIN_PACKAGE).length !== 1
  ) {
    throw registrationError("The helper-owned OpenCode plugin entry changed outside setup.");
  }
  const permissionRoot = isRecord(config.permission) ? config.permission : undefined;
  if (manifest.permission.changed && permissionRoot?.vision_analyze !== manifest.permission.value) {
    throw registrationError("The helper-owned vision_analyze permission changed outside setup.");
  }
}

export async function inspectOpenCodeRegistration(
  permission: HelperPermission,
  options: OpenCodeRegistrationOptions = {},
): Promise<OpenCodeRegistrationPlan> {
  const configPath = await resolveConfigPath(options);
  const manifestPath = resolveManifestPath(options);
  const [content, manifestContent] = await Promise.all([
    readRegularFile(configPath, "OpenCode config"),
    readRegularFile(manifestPath, "registration manifest"),
  ]);
  await Promise.all([
    assertWritableFile(configPath, "OpenCode config"),
    assertWritableFile(manifestPath, "registration manifest"),
  ]);
  const config = parseConfig(content, configPath);
  await assertExistingConfigDirectoryIsRegular(configPath);
  await assertNoLegacyWrapper(configPath);
  if (manifestContent !== undefined) {
    verifyOwnedState(parseManifest(manifestContent, manifestPath), config, configPath);
  }
  return {
    configPath,
    manifestPath,
    revision: content === undefined ? null : sha256(content),
    ...inspectConfig(config, permission, configPath),
    snippet: {
      plugin: [OPENCODE_PLUGIN_PACKAGE],
      permission: { vision_analyze: permission },
    },
  };
}

function formattingOptions(content: string) {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const indent = content.match(/\r?\n([\t ]+)\S/)?.[1] ?? "  ";
  return {
    eol,
    insertSpaces: !indent.includes("\t"),
    tabSize: indent.includes("\t") ? 1 : indent.length,
  };
}

function mergeConfig(
  content: string | undefined,
  config: Record<string, unknown>,
  permission: HelperPermission,
): string {
  const bom = content?.startsWith("\uFEFF") ? "\uFEFF" : "";
  let body = content === undefined ? "{}\n" : bom ? content.slice(1) : content;
  const format = formattingOptions(body);
  const plugin = Array.isArray(config.plugin) ? [...config.plugin] : [];
  if (!plugin.includes(OPENCODE_PLUGIN_PACKAGE)) {
    plugin.push(OPENCODE_PLUGIN_PACKAGE);
    body = applyEdits(body, modify(body, ["plugin"], plugin, { formattingOptions: format }));
  }
  body = applyEdits(
    body,
    modify(body, ["permission", "vision_analyze"], permission, { formattingOptions: format }),
  );
  return `${bom}${body}`;
}

async function ensureRegularDirectory(path: string, label: string): Promise<void> {
  const directory = dirname(path);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const entry = await lstat(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw registrationError(`The ${label} directory is not a regular directory: ${directory}`);
    }
    await access(directory, constants.W_OK);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw registrationError(`Could not prepare the ${label} directory: ${directory}`, error);
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function createManifest(
  oldManifest: RegistrationManifest | undefined,
  configPath: string,
  config: Record<string, unknown>,
  permission: HelperPermission,
  pluginPresent: boolean,
): RegistrationManifest {
  const permissionRoot = isRecord(config.permission) ? config.permission : undefined;
  const previous = permissionRoot?.vision_analyze;
  const permissionPreviouslyOwned = oldManifest?.permission.changed === true;
  const changed = permissionPreviouslyOwned || previous !== permission;
  const previousPresent = permissionPreviouslyOwned
    ? oldManifest.permission.previousPresent
    : previous !== undefined;
  const previousValue = permissionPreviouslyOwned
    ? oldManifest.permission.previous
    : (previous as JsonValue | undefined);
  return {
    schema: 1,
    owner: REGISTRATION_OWNER,
    configPath,
    plugin: {
      value: OPENCODE_PLUGIN_PACKAGE,
      added: oldManifest?.plugin.added === true || !pluginPresent,
    },
    permission: {
      value: permission,
      changed,
      previousPresent,
      ...(previousPresent ? { previous: previousValue as JsonValue } : {}),
    },
  };
}

async function restoreConfig(
  path: string,
  original: string | undefined,
  written: string,
): Promise<void> {
  const current = await readRegularFile(path, "OpenCode config");
  if (current !== written) {
    throw registrationError(
      "The OpenCode config changed before registration could be rolled back.",
    );
  }
  if (original === undefined) {
    await rm(path);
  } else {
    await writeAtomic(path, original);
  }
}

export async function registerOpenCodePlugin(
  permission: HelperPermission,
  options: OpenCodeRegistrationOptions = {},
): Promise<OpenCodeRegistrationResult> {
  const plan = await inspectOpenCodeRegistration(permission, options);
  if (options.expectedRevision !== undefined && options.expectedRevision !== plan.revision) {
    throw registrationError("The OpenCode config changed after the setup summary was displayed.");
  }
  if (plan.permissionChange && !options.allowPermissionChange) {
    throw registrationError(
      `The existing vision_analyze permission (${JSON.stringify(plan.currentPermission)}) differs from ${permission}; explicit confirmation is required.`,
    );
  }
  if (!plan.changesRequired) {
    return {
      status: "already-registered",
      changed: false,
      configPath: plan.configPath,
      ...((await lstatOptional(plan.manifestPath)) ? { manifestPath: plan.manifestPath } : {}),
      permission,
    };
  }

  await Promise.all([
    ensureRegularDirectory(plan.configPath, "OpenCode config"),
    ensureRegularDirectory(plan.manifestPath, "registration manifest"),
  ]);
  const lockPath = `${plan.configPath}.opencode-vision-helper.lock`;
  let locked = false;
  try {
    await writeFile(lockPath, `${process.pid}:${randomUUID()}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    locked = true;
  } catch (error) {
    throw registrationError("Another OpenCode registration update is already in progress.", error);
  }

  let original: string | undefined;
  let merged: string | undefined;
  try {
    const [content, manifestContent] = await Promise.all([
      readRegularFile(plan.configPath, "OpenCode config"),
      readRegularFile(plan.manifestPath, "registration manifest"),
    ]);
    await Promise.all([
      assertWritableFile(plan.configPath, "OpenCode config"),
      assertWritableFile(plan.manifestPath, "registration manifest"),
    ]);
    const currentRevision = content === undefined ? null : sha256(content);
    if (currentRevision !== plan.revision) {
      throw registrationError("The OpenCode config changed before registration could be saved.");
    }
    const config = parseConfig(content, plan.configPath);
    const inspection = inspectConfig(config, permission, plan.configPath);
    const oldManifest = manifestContent
      ? parseManifest(manifestContent, plan.manifestPath)
      : undefined;
    if (oldManifest) {
      verifyOwnedState(oldManifest, config, plan.configPath);
    }
    const manifest = createManifest(
      oldManifest,
      plan.configPath,
      config,
      permission,
      inspection.pluginPresent,
    );
    original = content;
    merged = mergeConfig(content, config, permission);
    await options.beforeConfigCommit?.(plan.configPath);
    const beforeCommit = await readRegularFile(plan.configPath, "OpenCode config");
    if ((beforeCommit === undefined ? null : sha256(beforeCommit)) !== currentRevision) {
      throw registrationError("The OpenCode config changed while registration was being saved.");
    }
    await writeAtomic(plan.configPath, merged);
    try {
      await options.beforeManifestCommit?.(plan.manifestPath);
      const latestManifest = await readRegularFile(plan.manifestPath, "registration manifest");
      if (latestManifest !== manifestContent) {
        throw registrationError("The registration manifest changed while setup was running.");
      }
      await writeAtomic(plan.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    } catch (error) {
      try {
        await restoreConfig(plan.configPath, original, merged);
      } catch (rollbackError) {
        throw registrationError(
          `Registration failed and the OpenCode config could not be rolled back safely: ${plan.configPath}`,
          new AggregateError([error, rollbackError]),
        );
      }
      throw error;
    }
    return {
      status: "registered",
      changed: true,
      configPath: plan.configPath,
      manifestPath: plan.manifestPath,
      permission,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw registrationError(`Could not register the OpenCode plugin: ${plan.configPath}`, error);
  } finally {
    if (locked) {
      await rm(lockPath, { force: true }).catch(() => undefined);
    }
  }
}
