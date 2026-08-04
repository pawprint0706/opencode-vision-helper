#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import sharp from "sharp";

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
    if (argument === "--go-model" || argument === "--zen-model") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      options[argument === "--go-model" ? "goModel" : "zenModel"] = value;
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
  return options;
}

async function createFixture(path) {
  const overlay = Buffer.from(`
    <svg width="960" height="640" xmlns="http://www.w3.org/2000/svg">
      <rect width="960" height="640" fill="#f4f7fb"/>
      <rect x="24" y="24" width="912" height="72" rx="12" fill="#172033"/>
      <text x="52" y="69" font-family="Arial" font-size="28" fill="white">Synthetic Settings</text>
      <rect x="24" y="120" width="210" height="496" rx="12" fill="#dce5f2"/>
      <text x="48" y="168" font-family="Arial" font-size="22" fill="#26364d">General</text>
      <text x="48" y="210" font-family="Arial" font-size="22" fill="#26364d">Appearance</text>
      <rect x="258" y="120" width="678" height="496" rx="12" fill="white"/>
      <text x="294" y="174" font-family="Arial" font-size="30" fill="#172033">Appearance</text>
      <text x="294" y="232" font-family="Arial" font-size="20" fill="#40526d">Theme</text>
      <rect x="294" y="252" width="590" height="54" rx="8" fill="#eef2f8"/>
      <text x="314" y="286" font-family="Arial" font-size="20" fill="#172033">Dark</text>
      <text x="294" y="370" font-family="Arial" font-size="20" fill="#40526d">Preview</text>
      <rect x="294" y="392" width="590" height="126" rx="8" fill="#e9eef6"/>
      <rect x="846" y="548" width="160" height="48" rx="8" fill="#246bfe"/>
      <text x="882" y="579" font-family="Arial" font-size="20" fill="white">Save changes</text>
    </svg>
  `);
  await sharp(overlay).png().toFile(path);
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
  await createFixture(imagePath);
  const results = [];
  for (const model of [options.goModel, options.zenModel]) {
    results.push(await analyze(imagePath, model));
  }
  process.stdout.write(
    `${JSON.stringify({ status: "ok", fixture: "synthetic", results }, null, 2)}\n`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
