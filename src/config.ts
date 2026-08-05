import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import { AppError } from "./errors.js";
import { parseModelRef } from "./model.js";

export const HELPER_CONFIG_SCHEMA = 1;
export const CLOUD_UPLOAD_NOTICE_VERSION = 1;
export const HELPER_CONFIG_DIRECTORY = "opencode-vision-helper";
export const HELPER_CONFIG_FILENAME = "config.json";

export type HelperPermission = "ask" | "allow";

export type CloudUploadConsent =
  | {
      cloudUpload: true;
      noticeVersion: number;
      acceptedAt: string;
    }
  | {
      cloudUpload: false;
    };

export type HelperConfig = {
  schema: typeof HELPER_CONFIG_SCHEMA;
  consent: CloudUploadConsent;
  openCode: {
    permission: HelperPermission;
    model: string;
  };
};

export type HelperConfigLocationOptions = {
  configPath?: string;
  userHome?: string;
};

export type HelperConfigState = {
  path: string;
  revision: string | null;
  config?: HelperConfig;
};

export type WriteHelperConfigOptions = HelperConfigLocationOptions & {
  expectedRevision: string | null;
};

function configurationError(message: string, cause?: unknown): AppError {
  return new AppError("CONFIGURATION", message, cause === undefined ? undefined : { cause });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isNormalizedTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function parseConsent(value: unknown): CloudUploadConsent {
  if (!isRecord(value) || typeof value.cloudUpload !== "boolean") {
    throw configurationError("The helper configuration has an invalid consent section.");
  }
  if (!value.cloudUpload) {
    if (!hasExactKeys(value, ["cloudUpload"])) {
      throw configurationError("The declined consent section contains unsupported fields.");
    }
    return { cloudUpload: false };
  }
  if (!hasExactKeys(value, ["cloudUpload", "noticeVersion", "acceptedAt"])) {
    throw configurationError("The accepted consent section is incomplete or unsupported.");
  }
  if (
    !Number.isInteger(value.noticeVersion) ||
    (value.noticeVersion as number) < 1 ||
    !isNormalizedTimestamp(value.acceptedAt)
  ) {
    throw configurationError("The accepted consent metadata is invalid.");
  }
  return {
    cloudUpload: true,
    noticeVersion: value.noticeVersion as number,
    acceptedAt: value.acceptedAt,
  };
}

function parseOpenCode(value: unknown): HelperConfig["openCode"] {
  if (!isRecord(value) || !hasExactKeys(value, ["permission", "model"])) {
    throw configurationError("The helper configuration has an invalid OpenCode section.");
  }
  if (value.permission !== "ask" && value.permission !== "allow") {
    throw configurationError("The OpenCode permission must be ask or allow.");
  }
  if (typeof value.model !== "string" || value.model !== value.model.trim()) {
    throw configurationError("The configured vision model is invalid.");
  }
  try {
    parseModelRef(value.model);
  } catch (error) {
    throw configurationError(
      "The configured vision model is not an OpenCode Go or Zen model.",
      error,
    );
  }
  return { permission: value.permission, model: value.model };
}

export function parseHelperConfig(content: string): HelperConfig {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw configurationError("The helper configuration is not valid JSON.", error);
  }
  if (!isRecord(value) || !hasExactKeys(value, ["schema", "consent", "openCode"])) {
    throw configurationError("The helper configuration has unsupported fields or missing fields.");
  }
  if (value.schema !== HELPER_CONFIG_SCHEMA) {
    throw configurationError(`Unsupported helper configuration schema: ${String(value.schema)}.`);
  }
  return {
    schema: HELPER_CONFIG_SCHEMA,
    consent: parseConsent(value.consent),
    openCode: parseOpenCode(value.openCode),
  };
}

export function hasValidCloudUploadConsent(config: HelperConfig): boolean {
  return (
    config.consent.cloudUpload &&
    config.consent.noticeVersion === CLOUD_UPLOAD_NOTICE_VERSION &&
    isNormalizedTimestamp(config.consent.acceptedAt)
  );
}

export function resolveHelperConfigPath(options: HelperConfigLocationOptions = {}): string {
  if (options.configPath) {
    return resolve(options.configPath);
  }
  return resolve(
    options.userHome ?? homedir(),
    ".config",
    HELPER_CONFIG_DIRECTORY,
    HELPER_CONFIG_FILENAME,
  );
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

function revision(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function readConfigContent(path: string): Promise<string | undefined> {
  let entry: Awaited<ReturnType<typeof lstatOptional>>;
  try {
    entry = await lstatOptional(path);
  } catch (error) {
    throw configurationError(`Could not inspect the helper configuration: ${path}`, error);
  }
  if (!entry) {
    return undefined;
  }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw configurationError(`The helper configuration is not a regular file: ${path}`);
  }
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw configurationError(`Could not read the helper configuration: ${path}`, error);
  }
}

export async function readHelperConfigState(
  options: HelperConfigLocationOptions = {},
): Promise<HelperConfigState> {
  const path = resolveHelperConfigPath(options);
  const content = await readConfigContent(path);
  if (content === undefined) {
    return { path, revision: null };
  }
  return { path, revision: revision(content), config: parseHelperConfig(content) };
}

export async function readHelperConfig(
  options: HelperConfigLocationOptions = {},
): Promise<HelperConfig | undefined> {
  return (await readHelperConfigState(options)).config;
}

async function ensureConfigDirectory(path: string): Promise<void> {
  const directory = dirname(path);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const entry = await lstat(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw configurationError(
        `The helper configuration directory is not a regular directory: ${directory}`,
      );
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw configurationError(
      `Could not prepare the helper configuration directory: ${directory}`,
      error,
    );
  }
}

async function acquireLock(path: string): Promise<{ lockPath: string; token: string }> {
  const lockPath = `${path}.lock`;
  const token = `${process.pid}:${randomUUID()}\n`;
  try {
    await writeFile(lockPath, token, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return { lockPath, token };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw configurationError(
        "Another helper configuration update is already in progress.",
        error,
      );
    }
    throw configurationError("Could not lock the helper configuration for writing.", error);
  }
}

async function releaseLock(lockPath: string, token: string): Promise<void> {
  try {
    const current = await readFile(lockPath, "utf8");
    if (current === token) {
      await rm(lockPath);
    }
  } catch {
    // A missing or externally changed lock is not owned by this write and is left untouched.
  }
}

export async function writeHelperConfig(
  config: HelperConfig,
  options: WriteHelperConfigOptions,
): Promise<HelperConfigState> {
  const path = resolveHelperConfigPath(options);
  await ensureConfigDirectory(path);
  const { lockPath, token } = await acquireLock(path);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const current = await readConfigContent(path);
    const currentRevision = current === undefined ? null : revision(current);
    if (currentRevision !== options.expectedRevision) {
      throw configurationError("The helper configuration changed before it could be saved.");
    }

    let validated: HelperConfig;
    try {
      validated = parseHelperConfig(JSON.stringify(config));
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw configurationError("The helper configuration could not be serialized.", error);
    }
    const content = `${JSON.stringify(validated, null, 2)}\n`;
    await writeFile(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });

    const beforeCommit = await readConfigContent(path);
    const beforeCommitRevision = beforeCommit === undefined ? null : revision(beforeCommit);
    if (beforeCommitRevision !== currentRevision) {
      throw configurationError("The helper configuration changed while it was being saved.");
    }
    await rename(temporaryPath, path);
    return { path, revision: revision(content), config: validated };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw configurationError(`Could not write the helper configuration: ${path}`, error);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    await releaseLock(lockPath, token);
  }
}
