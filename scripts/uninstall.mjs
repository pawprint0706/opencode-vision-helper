#!/usr/bin/env node

import { InstallError, uninstallAdapter } from "./install-lib.mjs";

function parseArgs(args) {
  const options = {};
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--scope" || arg === "--target") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new InstallError("BAD_ARGUMENT", `${arg} requires a value.`);
      }
      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new InstallError("BAD_ARGUMENT", `Unknown option: ${arg}`);
  }
  return { json, options };
}

try {
  const { json, options } = parseArgs(process.argv.slice(2));
  const result = await uninstallAdapter(options);
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`OpenCode adapter ${result.status}: ${result.pluginPath}\n`);
    process.stdout.write(
      "OpenCode config, authentication, and package dependencies were not modified.\n",
    );
  }
} catch (error) {
  const code = error instanceof InstallError ? error.code : "UNKNOWN";
  const message = error instanceof InstallError ? error.message : "Unexpected uninstall failure.";
  process.stderr.write(`${JSON.stringify({ status: "error", error_code: code, message })}\n`);
  process.exitCode = 1;
}
