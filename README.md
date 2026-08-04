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

Analysis times out after 120 seconds by default. `--timeout` accepts 1 to 1800
seconds. `Ctrl+C` aborts the provider operation, then the helper attempts to stop
and remove its temporary OpenCode session. If analysis succeeds but session
deletion fails, the result includes the retained session ID and a cleanup warning.

## Development

Requires Node.js 20+ and an existing OpenCode installation for live use.

```powershell
npm install
npm run check
npm test
npm run build
node .\dist\cli.js --help
```

Tests use a fake SDK client and do not read OpenCode credentials or send an
image. OpenCode remains the sole owner of provider authentication.

See [docs/MIGRATION.md](docs/MIGRATION.md) for the active migration plan.
See [docs/OPENCODE.md](docs/OPENCODE.md) for manual development registration and
permission examples for the native tool.

## Provenance

Image preprocessing constraints, the report shape, and the untrusted-image
boundary are derived from the MIT-licensed `orca-vision-helper` project. The
provider, credential, and lifecycle design has been replaced by an
OpenCode-native architecture.
