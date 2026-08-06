# opencode-vision-helper

**[English](README.md) · [한국어](README.ko.md)**

An OpenCode-native vision fallback for models that cannot inspect local
images. It preprocesses one existing image and delegates analysis to an
image-capable OpenCode Go or Zen model through the OpenCode SDK.

## Status

The CLI and native `vision_analyze` plugin adapter are implemented and covered by
automated tests. A synthetic fixture has also been validated through the live OpenCode
Go and Zen paths, through the installed native tool in the OpenCode TUI for local
and external paths, through OpenCode's real message-file attachment path, and in the
OpenCode Desktop file picker and permission UI. Local TUI validation also confirms
that current OpenCode caller metadata permits an explicitly non-vision model and
rejects an image-capable caller before upload. Headless `opencode run` sessions on
CLI 1.18.13 reproduced both behaviors: a vision-limited `opencode-go/deepseek-v4-flash`
session delegated analysis to `opencode-go/gpt-5.6-luna`, and a forced
`opencode-go/gpt-5.6-luna` call was refused with `CALLER_VISION_CAPABLE`. The scoped
public package includes an isolated global CLI shim installation check on Windows,
macOS, and Linux on every CI run. Interactive
setup, saved consent/model selection, and ownership-tracked global registration are
implemented.

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

## Quick start

These commands are the intended flow after the first registry publication. Install
OpenCode first and use its `/connect` flow to connect OpenCode Go or Zen.

```powershell
npm install -g @pawprint0706/opencode-vision-helper
opencode-vision-helper setup
opencode-vision-helper doctor
opencode-vision-helper analyze .\screen.png
```

`setup` displays the cloud-upload notice, asks for `ask` or `allow`, selects a
connected image-capable model, saves the helper config, and merges only the npm
plugin entry and `permission.vision_analyze` into the global OpenCode config. Restart
OpenCode after setup. `ask` is recommended; `allow` permits future native tool calls
without a confirmation UI when no more specific OpenCode setting overrides it.
If the existing config cannot be edited safely, setup saves only the helper config
after approval and prints the exact target paths and mergeable snippet. It reports
setup as incomplete until the user confirms the manual merge and a read-only check
finds the exact package and permission in one config with no legacy-wrapper duplicate.

Node.js 20 or newer is required. OpenCode 1.18.13 is the tested SDK/plugin baseline;
run `doctor` after OpenCode upgrades and report compatibility regressions.

## CLI

```powershell
opencode-vision-helper doctor --json
opencode-vision-helper analyze .\screen.png --model opencode-go/<model-id> --allow-upload
opencode-vision-helper analyze .\screen.png --model opencode/<model-id> --prompt "Read the heading" --allow-upload
```

The model precedence is `--model`, `OPENCODE_VISION_MODEL`, then the model saved by
`setup`. Valid saved consent permits an explicit CLI `analyze` command without
repeating `--allow-upload`. That flag remains a one-invocation consent path and does
not write configuration. The default prompt uses a validated JSON report; `--prompt`
returns the provider's free-form text.

Successful results and help are written to stdout with exit code 0. Errors are
written as a stable JSON object to stderr with exit code 1. `doctor` reports OpenCode
health, helper consent/config validity, saved-model connection and image capability,
global plugin registration, and permission drift. It returns exit code 1 when any
required readiness check fails. It also checks the current project's ownership-aware
legacy wrapper and rejects loading it beside the global npm plugin. Project or agent
configuration can still override
the reported global permission, and restart necessity is reported as unknown when it
cannot be observed safely.

The complete interface is:

```text
opencode-vision-helper analyze <image> [--prompt <text>] [--model <provider/model>]
                                      [--json] [--allow-upload] [--keep-session]
                                      [--timeout <seconds>]
opencode-vision-helper doctor
opencode-vision-helper setup [--config-only]
opencode-vision-helper unregister [--json]
opencode-vision-helper config show [--json]
opencode-vision-helper config reset-consent [--json]
```

Only `opencode-go/<model-id>` and `opencode/<model-id>` model identifiers are
in scope. All OpenCode tools and session permissions are disabled for the
analysis session. MCP, screen capture, desktop control, and arbitrary provider
URLs are not part of v1.

`config show` reports only the helper-owned consent, permission, and model settings.
`config reset-consent` atomically changes only consent to `false`; it preserves the
selected model and permission. After reset, CLI analysis needs the one-invocation
`--allow-upload` flag, while the native tool remains disabled until setup is run
again.

Run `opencode-vision-helper unregister` before removing the global npm package. It
requires the setup-created ownership manifest and removes only the plugin entry and
permission value owned by that manifest. A replaced permission is restored to its
exact previous JSON value; unrelated plugins, settings, credentials, and JSONC
comments are preserved. The helper config, selected model, and cloud-upload consent
remain saved. If an owned value has changed or a direct plugin entry has no ownership
manifest, removal stops without claiming or deleting it. Restart OpenCode afterward,
then run `npm uninstall -g @pawprint0706/opencode-vision-helper` if desired.
There is no purge command in v1. After unregistering, you may separately delete the
exact helper-owned `~/.config/opencode-vision-helper/config.json` file if you also
want to erase the saved consent and model. Never remove OpenCode's config or auth
files as part of that cleanup.

The native tool can use an explicit local path or, when `image` is omitted, the
sole image attached to the current OpenCode user message. Local/file URL
attachments follow canonical path permissions; base64 image data is normalized
in memory without creating a temporary file. Before reading the image, the adapter
identifies the calling model from the current OpenCode message and checks the same
server's model metadata. It runs only when `capabilities.input.image` is explicitly
`false`; image-capable callers are told to analyze the image directly, while missing
or unverifiable metadata fails closed. The native tool also requires current saved
cloud-upload consent; missing or outdated consent returns `CONSENT_REQUIRED` before
image reads or permission prompts. Immediately before cloud analysis,
the tool requests OpenCode's `vision_analyze` permission for the selected model;
`ask` is the recommended policy and `deny` prevents the tool from being exposed.

Analysis times out after 120 seconds by default. `--timeout` accepts 1 to 1800
seconds. `Ctrl+C` aborts the provider operation, then the helper attempts to stop
and remove its temporary OpenCode session. If analysis succeeds but session
deletion fails, the result includes the retained session ID and a cleanup warning.
`doctor` uses the same default time bound and supports `Ctrl+C`, but never uploads
an image or starts a billed model prompt.

## Data handling and limits

Setup and doctor do not upload images or start billed model prompts. Analysis reads
only the selected image, normalizes it locally, and sends that normalized image plus
the prompt to the selected OpenCode Go or Zen cloud model. Provider charges and data
retention policies may apply. The helper stores only versioned consent, the selected
permission, and the model ID; OpenCode remains the credential owner.

PNG, JPEG, and WebP inputs up to 50 MiB and 80 million decoded pixels are accepted.
Animated and multi-page images are rejected. Images are orientation-corrected and
scaled to a 1568-pixel long edge by default, then encoded as PNG or JPEG. Temporary
analysis sessions are deleted on a best-effort basis; a cleanup failure returns the
session ID and warning, which may also appear in caller-managed logs. Do not submit
images or prompts containing data you are not authorized to transmit.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Go/Zen is disconnected | Use OpenCode `/connect`, rerun `setup`, then run `doctor --json`. The helper never repairs credentials itself. |
| The saved model disappeared or lost image capability | Rerun `setup` and select a currently listed image-capable model. |
| `vision_analyze` is missing | Restart OpenCode, run `doctor --json`, and resolve a reported global-direct/project-wrapper duplicate or a project/agent override. |
| Setup reports JSONC or two-config ambiguity | Follow the displayed manual fallback, preserve unrelated settings, and consolidate `opencode.json`/`opencode.jsonc` to one intended global file. |
| An `ask` prompt does not appear | Check saved consent with `config show`, resolved permission with `doctor`, and project/agent/managed overrides. OpenCode auto mode may approve according to its own policy. |
| `unregister` reports ownership drift | Do not force deletion. Restore the helper-owned value or review and remove only the intended snippet manually. |

For normal defects, use the repository's [issue tracker](https://github.com/pawprint0706/opencode-vision-helper/issues).
Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md),
not a public issue.

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

Live smoke testing is opt-in and always requires the explicit guard plus one Go and
one Zen model. It generates and deletes a synthetic fixture:

```powershell
npm run test:live -- --allow-live `
  --go-model opencode-go/<model-id> `
  --zen-model opencode/<model-id>
```

After building, save consent and a model without adding the public npm registration,
then install the development adapter for the current project:

```powershell
node .\dist\cli.js setup --config-only
npm run adapter:install -- --scope project
```

The installer writes only its plugin wrapper and ownership manifest. It prints
mergeable package and permission snippets and never edits `opencode.json`,
`.opencode/package.json`, or OpenCode authentication. After merging the dependency,
run the exact `npm install --prefix ...` command printed by the installer and restart
OpenCode. Remove the owned adapter files with
`npm run adapter:uninstall -- --scope project`. Global scope and exact ownership
behavior are documented in [docs/OPENCODE.md](docs/OPENCODE.md).

Tests use both focused fake clients and the generated SDK against a local fake
OpenCode server. They do not read OpenCode credentials or send an image to an
external provider. OpenCode remains the sole owner of provider authentication.

CI runs the same default verification on Windows, macOS, and Linux with Node.js
20 and 24. It packs the real artifact, installs it into a temporary consumer,
imports the plugin export, and exercises install/uninstall without changing the
consumer's config or auth sentinels. Live provider tests are intentionally excluded.

See [docs/MIGRATION.md](docs/MIGRATION.md) for the active migration plan.
See [docs/OPENCODE.md](docs/OPENCODE.md) for adapter lifecycle and permission
examples for the native tool.
See [docs/VALIDATION.md](docs/VALIDATION.md) for automated evidence and the explicitly
authorized live-release checklist.
See [docs/RELEASING.md](docs/RELEASING.md) for the version, tag, registry, provenance,
and post-publication process.

## Provenance

Image preprocessing constraints, the report shape, and the untrusted-image
boundary are derived from the MIT-licensed `orca-vision-helper` project. The
provider, credential, and lifecycle design has been replaced by an
OpenCode-native architecture.
