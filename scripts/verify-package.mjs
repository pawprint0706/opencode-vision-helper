#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
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

async function failedRun(command, args, options = {}) {
  try {
    await run(command, args, options);
  } catch (error) {
    return error;
  }
  throw new Error("Expected npm command to fail.");
}

try {
  const packed = await runNpm(["pack", "--json", "--pack-destination", temporaryRoot], {
    cwd: packageRoot,
  });
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
      "--prefer-online",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: consumer },
  );

  const installedPackage = join(
    consumer,
    "node_modules",
    "@pawprint0706",
    "opencode-vision-helper",
  );
  const cliEntry = join(installedPackage, "dist", "cli.js");
  const installedManifest = JSON.parse(
    await readFile(join(installedPackage, "package.json"), "utf8"),
  );
  assert.equal(installedManifest.name, "@pawprint0706/opencode-vision-helper");
  assert.equal(installedManifest.publishConfig?.access, "public");
  assert.equal(installedManifest.scripts?.postinstall, undefined);
  const cliShim = join(
    consumer,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "opencode-vision-helper.cmd" : "opencode-vision-helper",
  );
  await access(cliShim);
  const runInstalledCli = (args, options = {}) =>
    run(process.execPath, [cliEntry, ...args], { cwd: consumer, ...options });

  const cli = await runInstalledCli(["--help"]);
  assert.match(cli.stdout, /opencode-vision-helper analyze <image>/);
  await run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "const core = await import('@pawprint0706/opencode-vision-helper'); " +
        "if (typeof core.parseHelperConfig !== 'function' || " +
        "typeof core.runInteractiveSetup !== 'function' || " +
        "typeof core.registerOpenCodePlugin !== 'function' || " +
        "typeof core.diagnoseInstallation !== 'function') process.exit(1);",
    ],
    { cwd: consumer },
  );

  const fakeBin = join(temporaryRoot, "fake opencode bin");
  const fakeServer = join(packageRoot, "tests", "fixtures", "fake-opencode.mjs");
  await mkdir(fakeBin);
  if (process.platform === "win32") {
    await writeFile(
      join(fakeBin, "opencode.cmd"),
      `@echo off\r\n"${process.execPath}" "${fakeServer}" %*\r\n`,
    );
  } else {
    const executable = join(fakeBin, "opencode");
    await writeFile(executable, `#!/bin/sh\nexec "${process.execPath}" "${fakeServer}" "$@"\n`);
    await chmod(executable, 0o755);
  }
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const fakeEnvironment = {
    ...process.env,
    [pathKey]: `${fakeBin}${delimiter}${process.env[pathKey] ?? ""}`,
  };
  const imagePath = join(consumer, "screen 한글.png");
  const sourceFixture = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await writeFile(imagePath, sourceFixture);
  const analyzed = await runInstalledCli(
    ["analyze", imagePath, "--model", "opencode-go/vision", "--allow-upload", "--json"],
    { cwd: consumer, env: fakeEnvironment },
  );
  assert.deepEqual(JSON.parse(analyzed.stdout), {
    status: "ok",
    model: "opencode-go/vision",
    cost: 0.003,
    report: { summary: "Packaged CLI result", issues: [] },
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  const timedOut = await failedRun(
    process.execPath,
    [
      cliEntry,
      "analyze",
      imagePath,
      "--model",
      "opencode-go/vision",
      "--allow-upload",
      "--timeout",
      "1",
    ],
    {
      cwd: consumer,
      env: { ...fakeEnvironment, FAKE_OPENCODE_DELAY_MS: "1100" },
    },
  );
  assert.equal(timedOut.code, 1);
  assert.equal(timedOut.stdout, "");
  assert.match(timedOut.stderr, /"error_code": "ANALYSIS_TIMEOUT"/);

  await run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "const plugin = await import('@pawprint0706/opencode-vision-helper/plugin'); " +
        "if (typeof plugin.VisionHelperPlugin !== 'function') process.exit(1);",
    ],
    { cwd: consumer },
  );
  await run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "const plugin = await import('@pawprint0706/opencode-vision-helper/server'); " +
        "if (typeof plugin.VisionHelperPlugin !== 'function') process.exit(1);",
    ],
    { cwd: consumer },
  );

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
    'export { VisionHelperPlugin } from "@pawprint0706/opencode-vision-helper/plugin";\n',
  );
  assert.equal(await readFile(configPath, "utf8"), before.config);
  assert.equal(await readFile(authPath, "utf8"), before.auth);
  assert.equal(await readFile(packageJsonPath, "utf8"), before.packageJson);

  const uninstalled = await run(
    process.execPath,
    [join(installedPackage, "scripts", "uninstall.mjs"), "--target", target, "--json"],
    { cwd: consumer },
  );
  assert.equal(JSON.parse(uninstalled.stdout).status, "uninstalled");
  assert.equal(await readFile(configPath, "utf8"), before.config);
  assert.equal(await readFile(authPath, "utf8"), before.auth);
  assert.equal(await readFile(packageJsonPath, "utf8"), before.packageJson);

  const temporaryHome = join(temporaryRoot, "isolated global home");
  const globalTarget = join(temporaryHome, ".config", "opencode");
  const globalConfigPath = join(globalTarget, "opencode.json");
  const globalAuthPath = join(globalTarget, "auth.json");
  const globalPackagePath = join(globalTarget, "package.json");
  await mkdir(globalTarget, { recursive: true });
  await writeFile(globalConfigPath, '{"permission":{"bash":"deny"}}\n');
  await writeFile(globalAuthPath, '{"untouched":"global-auth-sentinel"}\n');
  await writeFile(globalPackagePath, '{"private":true,"dependencies":{"kept":"1.0.0"}}\n');
  const globalBefore = {
    config: await readFile(globalConfigPath, "utf8"),
    auth: await readFile(globalAuthPath, "utf8"),
    packageJson: await readFile(globalPackagePath, "utf8"),
  };
  const globalEnvironment = {
    ...process.env,
    HOME: temporaryHome,
    USERPROFILE: temporaryHome,
  };
  const globalInstalled = await run(
    process.execPath,
    [
      join(installedPackage, "scripts", "install.mjs"),
      "--scope",
      "global",
      "--package-spec",
      packageSpec,
      "--json",
    ],
    { cwd: consumer, env: globalEnvironment },
  );
  const globalInstallResult = JSON.parse(globalInstalled.stdout);
  assert.equal(globalInstallResult.status, "installed");
  assert.equal(resolve(globalInstallResult.target), resolve(globalTarget));
  assert.deepEqual(globalInstallResult.mergeTargets, {
    packagePath: resolve(globalPackagePath),
    configPath: resolve(globalConfigPath),
  });
  assert.equal(
    await readFile(join(globalTarget, "plugins", "vision-helper.ts"), "utf8"),
    'export { VisionHelperPlugin } from "@pawprint0706/opencode-vision-helper/plugin";\n',
  );
  assert.equal(await readFile(globalConfigPath, "utf8"), globalBefore.config);
  assert.equal(await readFile(globalAuthPath, "utf8"), globalBefore.auth);
  assert.equal(await readFile(globalPackagePath, "utf8"), globalBefore.packageJson);

  const globalRepeated = await run(
    process.execPath,
    [
      join(installedPackage, "scripts", "install.mjs"),
      "--scope",
      "global",
      "--package-spec",
      packageSpec,
      "--json",
    ],
    { cwd: consumer, env: globalEnvironment },
  );
  assert.equal(JSON.parse(globalRepeated.stdout).status, "already-installed");

  const globalUninstalled = await run(
    process.execPath,
    [join(installedPackage, "scripts", "uninstall.mjs"), "--scope", "global", "--json"],
    { cwd: consumer, env: globalEnvironment },
  );
  assert.equal(JSON.parse(globalUninstalled.stdout).status, "uninstalled");
  assert.equal(await readFile(globalConfigPath, "utf8"), globalBefore.config);
  assert.equal(await readFile(globalAuthPath, "utf8"), globalBefore.auth);
  assert.equal(await readFile(globalPackagePath, "utf8"), globalBefore.packageJson);

  process.stdout.write("Packed package import and adapter lifecycle verified.\n");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
