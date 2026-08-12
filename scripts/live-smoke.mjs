#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createSyntheticUiFixture } from "./live-fixture.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(args) {
  const options = { allowLive: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--allow-live") {
      options.allowLive = true;
      continue;
    }
    if (argument === "--go-model" || argument === "--zen-model" || argument === "--ollama-model") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      options[
        argument === "--go-model"
          ? "goModel"
          : argument === "--zen-model"
            ? "zenModel"
            : "ollamaModel"
      ] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }
  if (!options.allowLive) {
    throw new Error(
      "Live smoke testing is disabled. Pass --allow-live only after approving image upload and cost.",
    );
  }
  if (!options.goModel?.startsWith("opencode-go/")) {
    throw new Error("--go-model must use the opencode-go/<id> prefix.");
  }
  if (!options.zenModel?.startsWith("opencode/")) {
    throw new Error("--zen-model must use the opencode/<id> prefix.");
  }
  if (options.ollamaModel && !options.ollamaModel.startsWith("ollama-cloud/")) {
    throw new Error("--ollama-model must use the ollama-cloud/<id> prefix.");
  }
  return options;
}

async function analyze(imagePath, model) {
  const result = await execFileAsync(
    process.execPath,
    [
      resolve(packageRoot, "dist", "cli.js"),
      "analyze",
      imagePath,
      "--model",
      model,
      "--allow-upload",
      "--json",
      "--timeout",
      "180",
    ],
    { cwd: packageRoot, maxBuffer: 10 * 1024 * 1024 },
  );
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.model, model);
  if (model.startsWith("ollama-cloud/")) {
    assert.equal(typeof parsed.text, "string");
    assert.ok(parsed.text.trim().length > 0);
    return {
      model: parsed.model,
      cost: parsed.cost,
      text: parsed.text.slice(0, 120),
    };
  }
  assert.equal(typeof parsed.report?.summary, "string");
  assert.ok(Array.isArray(parsed.report?.issues));
  return {
    model: parsed.model,
    cost: parsed.cost,
    summary: parsed.report.summary,
    issue_count: parsed.report.issues.length,
  };
}

const options = parseArgs(process.argv.slice(2));
const temporaryRoot = await mkdtemp(join(tmpdir(), "opencode-vision-live-"));
try {
  const imagePath = join(temporaryRoot, "synthetic-ui.png");
  await createSyntheticUiFixture(imagePath);
  const results = [];
  const models = [options.goModel, options.zenModel];
  if (options.ollamaModel) {
    models.push(options.ollamaModel);
  }
  for (const model of models) {
    results.push(await analyze(imagePath, model));
  }
  process.stdout.write(
    `${JSON.stringify({ status: "ok", fixture: "synthetic", results }, null, 2)}\n`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
