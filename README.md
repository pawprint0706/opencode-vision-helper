# opencode-vision-helper

An OpenCode-native vision fallback for models that cannot inspect local
images. It preprocesses one existing image and delegates analysis to an
image-capable OpenCode Go or Zen model through the OpenCode SDK.

## Status

The CLI and native `vision_analyze` plugin adapter are implemented and covered by
offline tests. No installer is published, and the SDK request has not yet been
validated against a live Go or Zen account.

The target flow is:

```text
OpenCode model without image input
  -> opencode-vision-helper CLI
  -> isolated OpenCode session using an image-capable Go or Zen model
  -> text or validated structured report
```

OpenCode remains the owner of authentication, model routing, and provider
configuration. This project will not store API keys or offer arbitrary provider
URLs.

## CLI

```powershell
opencode-vision-helper doctor --json
opencode-vision-helper analyze .\screen.png --model opencode-go/<model-id> --allow-upload
opencode-vision-helper analyze .\screen.png --model opencode/<model-id> --prompt "Read the heading" --allow-upload
```

The model can alternatively be supplied through `OPENCODE_VISION_MODEL`.
Analysis is refused unless `--allow-upload` is present because the image will
leave the local machine. The default prompt uses a validated JSON report;
`--prompt` returns the provider's free-form text.

Successful results and help are written to stdout with exit code 0. Errors are
written as a stable JSON object to stderr with exit code 1. `doctor` also returns
exit code 1 when its checks complete but no connected Go/Zen image model is
available.

The complete interface is:

```text
opencode-vision-helper analyze <image> [--prompt <text>] [--model <provider/model>]
                                      [--json] [--allow-upload] [--keep-session]
                                      [--timeout <seconds>]
opencode-vision-helper doctor
```

Only `opencode-go/<model-id>` and `opencode/<model-id>` model identifiers are
in scope. All OpenCode tools and session permissions are disabled for the
analysis session. MCP, screen capture, desktop control, and arbitrary provider
URLs are not part of v1.

The native tool can use an explicit local path or, when `image` is omitted, the
sole image attached to the current OpenCode user message. Local/file URL
attachments follow canonical path permissions; base64 image data is normalized
in memory without creating a temporary file.

Analysis times out after 120 seconds by default. `--timeout` accepts 1 to 1800
seconds. `Ctrl+C` aborts the provider operation, then the helper attempts to stop
and remove its temporary OpenCode session. If analysis succeeds but session
deletion fails, the result includes the retained session ID and a cleanup warning.
`doctor` uses the same default time bound and supports `Ctrl+C`, but never uploads
an image or starts a billed model prompt.

## Development

Requires Node.js 20+ and an existing OpenCode installation for live use.

```powershell
npm install
npm run check
npm test
npm run build
npm run verify
node .\dist\cli.js --help
```

After building, install the native adapter for the current project with:

```powershell
npm run adapter:install -- --scope project
```

The installer writes only its plugin wrapper and ownership manifest. It prints
mergeable package and permission snippets and never edits `opencode.json`,
`.opencode/package.json`, or OpenCode authentication. Remove the owned adapter
files with `npm run adapter:uninstall -- --scope project`. Global scope and exact
ownership behavior are documented in [docs/OPENCODE.md](docs/OPENCODE.md).

Tests use a fake SDK client and do not read OpenCode credentials or send an
image. OpenCode remains the sole owner of provider authentication.

CI runs the same offline verification on Windows, macOS, and Linux with Node.js
20 and 24. It packs the real artifact, installs it into a temporary consumer,
imports the plugin export, and exercises install/uninstall without changing the
consumer's config or auth sentinels. Live provider tests are intentionally excluded.

See [docs/MIGRATION.md](docs/MIGRATION.md) for the active migration plan.
See [docs/OPENCODE.md](docs/OPENCODE.md) for adapter lifecycle and permission
examples for the native tool.

## Provenance

Image preprocessing constraints, the report shape, and the untrusted-image
boundary are derived from the MIT-licensed `orca-vision-helper` project. The
provider, credential, and lifecycle design has been replaced by an
OpenCode-native architecture.
