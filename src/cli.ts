#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createAbortScope,
  DEFAULT_ANALYSIS_TIMEOUT_MS,
  MAX_ANALYSIS_TIMEOUT_MS,
  MIN_ANALYSIS_TIMEOUT_MS,
} from "./abort.js";
import {
  hasValidCloudUploadConsent,
  readHelperConfig,
  readHelperConfigState,
  resetCloudUploadConsent,
  resolveConfiguredVisionModel,
} from "./config.js";
import { diagnoseInstallation } from "./diagnostics.js";
import { AppError, asAppError } from "./errors.js";
import { prepareImage } from "./imaging.js";
import { parseModelRef } from "./model.js";
import { type AnalysisResult, analyzeWithOpenCode } from "./opencode.js";
import { DEFAULT_PROMPT, formatReport } from "./report.js";
import { runInteractiveSetup } from "./setup.js";

type ParsedAnalyze = {
  image: string;
  prompt?: string;
  model?: string;
  json: boolean;
  allowUpload: boolean;
  keepSession: boolean;
  timeoutMs: number;
};

export type CliServices = {
  prepareImage: typeof prepareImage;
  analyzeWithOpenCode: typeof analyzeWithOpenCode;
  doctor: typeof diagnoseInstallation;
  runSetup: typeof runInteractiveSetup;
  readConfig: typeof readHelperConfig;
  readConfigState: typeof readHelperConfigState;
  resetConsent: typeof resetCloudUploadConsent;
};

const DEFAULT_SERVICES: CliServices = {
  prepareImage,
  analyzeWithOpenCode,
  doctor: diagnoseInstallation,
  runSetup: runInteractiveSetup,
  readConfig: readHelperConfig,
  readConfigState: readHelperConfigState,
  resetConsent: resetCloudUploadConsent,
};

const HELP = `opencode-vision-helper

Usage:
  opencode-vision-helper analyze <image> [--prompt <text>] [--model <provider/model>]
                                      [--json] [--allow-upload] [--keep-session]
                                      [--timeout <seconds>]
  opencode-vision-helper doctor [--json]
  opencode-vision-helper setup [--config-only]
  opencode-vision-helper config show [--json]
  opencode-vision-helper config reset-consent [--json]

Only opencode-go/<model> and opencode/<model> are supported.
Live analysis requires setup consent or --allow-upload because the selected image is sent to OpenCode Go/Zen.
The default analysis timeout is ${DEFAULT_ANALYSIS_TIMEOUT_MS / 1_000} seconds.
`;

function valueAfter(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new AppError("BAD_REQUEST", `${option} requires a value.`);
  }
  return value;
}

export function parseAnalyzeArgs(args: string[]): ParsedAnalyze {
  const image = args[0];
  if (!image || image.startsWith("--")) {
    throw new AppError("BAD_REQUEST", "analyze requires an image path.");
  }
  const parsed: ParsedAnalyze = {
    image,
    json: false,
    allowUpload: false,
    keepSession: false,
    timeoutMs: DEFAULT_ANALYSIS_TIMEOUT_MS,
  };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--prompt") {
      parsed.prompt = valueAfter(args, index, arg);
      index += 1;
    } else if (arg === "--model") {
      parsed.model = valueAfter(args, index, arg);
      index += 1;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--allow-upload") {
      parsed.allowUpload = true;
    } else if (arg === "--keep-session") {
      parsed.keepSession = true;
    } else if (arg === "--timeout") {
      const secondsText = valueAfter(args, index, arg);
      const seconds = Number(secondsText);
      const minimum = MIN_ANALYSIS_TIMEOUT_MS / 1_000;
      const maximum = MAX_ANALYSIS_TIMEOUT_MS / 1_000;
      if (!Number.isInteger(seconds) || seconds < minimum || seconds > maximum) {
        throw new AppError(
          "BAD_REQUEST",
          `--timeout must be an integer from ${minimum} to ${maximum} seconds.`,
        );
      }
      parsed.timeoutMs = seconds * 1_000;
      index += 1;
    } else {
      throw new AppError("BAD_REQUEST", `Unknown option: ${arg}`);
    }
  }
  return parsed;
}

function printJson(value: unknown, stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function runAnalyze(args: string[], services: CliServices): Promise<number> {
  const parsed = parseAnalyzeArgs(args);
  const overrideModel = parsed.model ?? process.env.OPENCODE_VISION_MODEL;
  const config =
    parsed.allowUpload && overrideModel !== undefined ? undefined : await services.readConfig();
  const uploadApproved =
    parsed.allowUpload || (config !== undefined && hasValidCloudUploadConsent(config));
  if (!uploadApproved) {
    throw new AppError(
      "CONSENT_REQUIRED",
      "Live analysis requires valid setup consent or --allow-upload for this invocation.",
    );
  }
  const model = resolveConfiguredVisionModel(
    config,
    parsed.model,
    process.env.OPENCODE_VISION_MODEL,
  );
  if (!model) {
    throw new AppError("CONFIGURATION", "No vision model was selected.");
  }
  parseModelRef(model);
  const image = await services.prepareImage(parsed.image);
  const structured = parsed.prompt === undefined;
  const interrupt = new AbortController();
  const onInterrupt = () => {
    interrupt.abort(new AppError("ANALYSIS_ABORTED", "Image analysis was canceled by SIGINT."));
  };
  process.once("SIGINT", onInterrupt);
  const abortScope = createAbortScope(parsed.timeoutMs, interrupt.signal);
  let result: AnalysisResult;
  try {
    result = await services.analyzeWithOpenCode({
      directory: process.cwd(),
      image,
      model,
      prompt: parsed.prompt ?? DEFAULT_PROMPT,
      structured,
      uploadApproved,
      keepSession: parsed.keepSession,
      signal: abortScope.signal,
    });
  } finally {
    abortScope.dispose();
    process.removeListener("SIGINT", onInterrupt);
  }
  if (parsed.json) {
    printJson({ status: "ok", ...result });
  } else if (result.report) {
    process.stdout.write(`${formatReport(result.report)}\n`);
  } else {
    process.stdout.write(`${result.text ?? ""}\n`);
  }
  for (const warning of result.warnings ?? []) {
    const session = result.session_id ? ` Session: ${result.session_id}.` : "";
    process.stderr.write(`Warning [${warning.code}]: ${warning.message}${session}\n`);
  }
  return 0;
}

async function runDoctor(args: string[], services: CliServices): Promise<number> {
  const unknown = args.filter((arg) => arg !== "--json");
  if (unknown.length > 0) {
    throw new AppError("BAD_REQUEST", `Unknown option: ${unknown[0]}`);
  }
  const interrupt = new AbortController();
  const onInterrupt = () => {
    interrupt.abort(
      new AppError("ANALYSIS_ABORTED", "OpenCode doctor check was canceled by SIGINT."),
    );
  };
  process.once("SIGINT", onInterrupt);
  const abortScope = createAbortScope(
    DEFAULT_ANALYSIS_TIMEOUT_MS,
    interrupt.signal,
    "OpenCode doctor check",
  );
  try {
    const result = await services.doctor(resolve(process.cwd()), abortScope.signal);
    printJson(result);
    return result.ok ? 0 : 1;
  } finally {
    abortScope.dispose();
    process.removeListener("SIGINT", onInterrupt);
  }
}

async function runSetup(args: string[], services: CliServices): Promise<number> {
  const configOnly = args.length === 1 && args[0] === "--config-only";
  if (args.length > 0 && !configOnly) {
    throw new AppError("BAD_REQUEST", `Unknown option: ${args[0]}`);
  }
  const result = await services.runSetup(configOnly ? { registerOpenCode: false } : undefined);
  return result.status === "configured" ? 0 : 1;
}

function parseOptionalJson(args: string[]): boolean {
  const unknown = args.filter((arg) => arg !== "--json");
  if (unknown.length > 0) {
    throw new AppError("BAD_REQUEST", `Unknown option: ${unknown[0]}`);
  }
  return args.includes("--json");
}

async function runConfig(args: string[], services: CliServices): Promise<number> {
  const action = args[0];
  const json = parseOptionalJson(args.slice(1));
  if (action === "show") {
    const state = await services.readConfigState();
    if (!state.config) {
      throw new AppError("CONFIGURATION", "No helper configuration exists; run setup first.");
    }
    const consent = state.config.consent;
    const result = {
      status: "ok",
      path: state.path,
      schema: state.config.schema,
      cloud_upload_consent: {
        accepted: consent.cloudUpload,
        valid: hasValidCloudUploadConsent(state.config),
        ...(consent.cloudUpload
          ? {
              notice_version: consent.noticeVersion,
              accepted_at: consent.acceptedAt,
            }
          : {}),
      },
      permission: state.config.openCode.permission,
      model: state.config.openCode.model,
    };
    if (json) {
      printJson(result);
    } else {
      process.stdout.write(
        `Helper config: ${result.path}\n` +
          `Cloud upload consent: ${result.cloud_upload_consent.valid ? "valid" : "not accepted"}\n` +
          `OpenCode permission: ${result.permission}\n` +
          `Vision model: ${result.model}\n`,
      );
    }
    return 0;
  }
  if (action === "reset-consent") {
    const result = await services.resetConsent();
    if (json) {
      printJson({
        status: result.status,
        changed: result.changed,
        path: result.path,
        cloud_upload_consent: false,
      });
    } else {
      process.stdout.write(
        `Cloud-upload consent ${result.changed ? "reset" : "already reset"}: ${result.path}\n` +
          "CLI analysis now requires --allow-upload; the native tool fails until setup is run again.\n",
      );
    }
    return 0;
  }
  throw new AppError(
    "BAD_REQUEST",
    action ? `Unknown config action: ${action}` : "config requires an action.",
  );
}

export async function main(
  args = process.argv.slice(2),
  services: CliServices = DEFAULT_SERVICES,
): Promise<number> {
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === "analyze") {
    return runAnalyze(args.slice(1), services);
  }
  if (command === "doctor") {
    return runDoctor(args.slice(1), services);
  }
  if (command === "setup") {
    return runSetup(args.slice(1), services);
  }
  if (command === "config") {
    return runConfig(args.slice(1), services);
  }
  throw new AppError("BAD_REQUEST", `Unknown command: ${command}`);
}

export function isEntrypoint(moduleUrl: string, argument = process.argv[1]): boolean {
  if (!argument) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(argument));
  } catch {
    return moduleUrl === pathToFileURL(resolve(argument)).href;
  }
}

if (isEntrypoint(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      const appError = asAppError(error);
      printJson(appError.toJSON(), process.stderr);
      process.exitCode = 1;
    },
  );
}
