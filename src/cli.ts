#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createAbortScope,
  DEFAULT_ANALYSIS_TIMEOUT_MS,
  MAX_ANALYSIS_TIMEOUT_MS,
  MIN_ANALYSIS_TIMEOUT_MS,
} from "./abort.js";
import { AppError, asAppError } from "./errors.js";
import { prepareImage } from "./imaging.js";
import { analyzeWithOpenCode, doctor } from "./opencode.js";
import { DEFAULT_PROMPT, formatReport } from "./report.js";

type ParsedAnalyze = {
  image: string;
  prompt?: string;
  model?: string;
  json: boolean;
  allowUpload: boolean;
  keepSession: boolean;
  timeoutMs: number;
};

const HELP = `opencode-vision-helper

Usage:
  opencode-vision-helper analyze <image> [--prompt <text>] [--model <provider/model>]
                                      [--json] [--allow-upload] [--keep-session]
                                      [--timeout <seconds>]
  opencode-vision-helper doctor [--json]

Only opencode-go/<model> and opencode/<model> are supported.
Live analysis requires --allow-upload because the selected image is sent to OpenCode Go/Zen.
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

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function runAnalyze(args: string[]): Promise<number> {
  const parsed = parseAnalyzeArgs(args);
  if (!parsed.allowUpload) {
    throw new AppError(
      "UPLOAD_NOT_APPROVED",
      "Live analysis is disabled until --allow-upload is provided.",
    );
  }
  const model = parsed.model ?? process.env.OPENCODE_VISION_MODEL;
  if (!model) {
    throw new AppError("CONFIGURATION", "No vision model was selected.");
  }
  const image = await prepareImage(parsed.image);
  const structured = parsed.prompt === undefined;
  const interrupt = new AbortController();
  const onInterrupt = () => {
    interrupt.abort(new AppError("ANALYSIS_ABORTED", "Image analysis was canceled by SIGINT."));
  };
  process.once("SIGINT", onInterrupt);
  const abortScope = createAbortScope(parsed.timeoutMs, interrupt.signal);
  let result;
  try {
    result = await analyzeWithOpenCode({
      directory: process.cwd(),
      image,
      model,
      prompt: parsed.prompt ?? DEFAULT_PROMPT,
      structured,
      uploadApproved: parsed.allowUpload,
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

async function runDoctor(args: string[]): Promise<number> {
  const unknown = args.filter((arg) => arg !== "--json");
  if (unknown.length > 0) {
    throw new AppError("BAD_REQUEST", `Unknown option: ${unknown[0]}`);
  }
  const result = await doctor(resolve(process.cwd()));
  printJson(result);
  return result.ok ? 0 : 1;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === "analyze") {
    return runAnalyze(args.slice(1));
  }
  if (command === "doctor") {
    return runDoctor(args.slice(1));
  }
  throw new AppError("BAD_REQUEST", `Unknown command: ${command}`);
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      const appError = asAppError(error);
      printJson(appError.toJSON());
      process.exitCode = 1;
    },
  );
}
