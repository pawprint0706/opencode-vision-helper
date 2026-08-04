#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmExecPath = process.env.npm_execpath;
const temporaryRoot = await mkdtemp(join(tmpdir(), "opencode-vision-package-"));

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
}

async function runNpm(args, options = {}) {
  return npmExecPath
    ? run(process.execPath, [npmExecPath, ...args], options)
    : run(npmCommand, args, options);
}

try {
  const packed = await runNpm(
    ["pack", "--json", "--pack-destination", temporaryRoot],
    { cwd: packageRoot },
  );
  const packResult = JSON.parse(packed.stdout);
  const artifacts = Array.isArray(packResult) ? packResult : Object.values(packResult);
  assert.equal(artifacts.length, 1, "npm pack must produce exactly one artifact");
  const tarball = resolve(temporaryRoot, artifacts[0].filename);
  const consumer = join(temporaryRoot, "consumer with space-한글");
  await mkdir(consumer, { recursive: true });
  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify({ name: "vision-helper-package-consumer", private: true }, null, 2)}\n`,
  );
  await runNpm(
    [
      "install",
      tarball,
      "--save-exact",
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: consumer },
  );

  await run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "const plugin = await import('opencode-vision-helper/plugin'); " +
        "if (typeof plugin.VisionHelperPlugin !== 'function') process.exit(1);",
    ],
    { cwd: consumer },
  );

  const installedPackage = join(consumer, "node_modules", "opencode-vision-helper");
  const target = join(consumer, "OpenCode Config", ".opencode");
  const configPath = join(target, "opencode.json");
  const authPath = join(target, "auth.json");
  await mkdir(target, { recursive: true });
  await writeFile(configPath, '{"permission":{"bash":"deny"}}\n');
  await writeFile(authPath, '{"untouched":"sentinel"}\n');
  const packageJsonPath = join(consumer, "package.json");
  const before = {
    config: await readFile(configPath, "utf8"),
    auth: await readFile(authPath, "utf8"),
    packageJson: await readFile(packageJsonPath, "utf8"),
  };
  const packageSpec = `file:${tarball.replaceAll("\\", "/")}`;
  const installed = await run(
    process.execPath,
    [
      join(installedPackage, "scripts", "install.mjs"),
      "--target",
      target,
      "--package-spec",
      packageSpec,
      "--json",
    ],
    { cwd: consumer },
  );
  assert.equal(JSON.parse(installed.stdout).status, "installed");
  assert.equal(
    await readFile(join(target, "plugins", "vision-helper.ts"), "utf8"),
    'export { VisionHelperPlugin } from "opencode-vision-helper/plugin";\n',
  );
  assert.equal(await readFile(configPath, "utf8"), before.config);
  assert.equal(await readFile(authPath, "utf8"), before.auth);
  assert.equal(await readFile(packageJsonPath, "utf8"), before.packageJson);

  const uninstalled = await run(
    process.execPath,
    [
      join(installedPackage, "scripts", "uninstall.mjs"),
      "--target",
      target,
      "--json",
    ],
    { cwd: consumer },
  );
  assert.equal(JSON.parse(uninstalled.stdout).status, "uninstalled");
  assert.equal(await readFile(configPath, "utf8"), before.config);
  assert.equal(await readFile(authPath, "utf8"), before.auth);
  assert.equal(await readFile(packageJsonPath, "utf8"), before.packageJson);

  process.stdout.write("Packed package import and adapter lifecycle verified.\n");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
