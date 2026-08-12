import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(resolve(moduleDirectory, "..", "package.json"), "utf8"),
) as { version?: unknown };

export const PACKAGE_VERSION: string =
  typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
