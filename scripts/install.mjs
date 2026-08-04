#!/usr/bin/env node

import { installAdapter, InstallError } from "./install-lib.mjs";

function parseArgs(args) {
  const options = {};
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--scope" || arg === "--target" || arg === "--package-spec") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new InstallError("BAD_ARGUMENT", `${arg} requires a value.`);
      }
      const key = arg === "--package-spec" ? "packageSpec" : arg.slice(2);
      options[key] = value;
      index += 1;
      continue;
    }
    throw new InstallError("BAD_ARGUMENT", `Unknown option: ${arg}`);
  }
  return { json, options };
}

try {
  const { json, options } = parseArgs(process.argv.slice(2));
  const result = await installAdapter(options);
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`OpenCode adapter ${result.status}: ${result.pluginPath}\n`);
    process.stdout.write("Merge these snippets; existing config files were not modified:\n");
    process.stdout.write(`${JSON.stringify(result.snippets, null, 2)}\n`);
  }
} catch (error) {
  const code = error instanceof InstallError ? error.code : "UNKNOWN";
  const message = error instanceof InstallError ? error.message : "Unexpected install failure.";
  process.stderr.write(`${JSON.stringify({ status: "error", error_code: code, message })}\n`);
  process.exitCode = 1;
}
