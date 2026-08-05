# OpenCode native tool

The optional OpenCode adapter exposes one tool named `vision_analyze`. It uses
the SDK client for the OpenCode server that loaded the plugin, so authentication,
provider configuration, and model routing remain owned by OpenCode.

The adapter and ownership-safe lifecycle commands are implemented. The scoped public
package metadata is prepared but the package is still unpublished. Installation from
the packed artifact is covered by the package verification suite.

Before using either the CLI or native tool, connect OpenCode Go or Zen through
OpenCode's `/connect` flow and choose an image-capable `opencode-go/*` or
`opencode/*` model. This helper never reads, imports, copies, or changes the
resulting credentials.

After registry publication, the recommended global installation flow is:

```powershell
npm install -g @pawprint0706/opencode-vision-helper
opencode-vision-helper setup
```

Setup saves the versioned cloud-upload consent and selected vision model in
`~/.config/opencode-vision-helper/config.json`. It then shows and atomically merges
only `@pawprint0706/opencode-vision-helper` and `permission.vision_analyze` into the
existing global `opencode.json` or `opencode.jsonc`. Existing comments and unrelated
settings are preserved. Restart OpenCode afterward.

Run `opencode-vision-helper doctor --json` to inspect the saved consent/model, the
model's current provider connection and image capability, npm or legacy-wrapper
registration, duplicate loading, and the global permission value. Doctor never reads
credential contents or calls a billed model. Project and agent permissions may
override the global value; current OpenCode APIs do not reliably expose whether a
restart is pending, so that field is reported as `unknown`.

Inspect or withdraw the saved cloud-upload consent with:

```powershell
opencode-vision-helper config show --json
opencode-vision-helper config reset-consent
```

Resetting consent preserves the configured model and OpenCode permission. It does
not edit OpenCode configuration or unregister the plugin. The native tool then
returns `CONSENT_REQUIRED` until setup is completed again.

Remove a direct registration created by setup before uninstalling the npm package:

```powershell
opencode-vision-helper unregister
npm uninstall -g @pawprint0706/opencode-vision-helper
```

`unregister` validates the ownership manifest and current owned values. It removes
only a plugin entry that setup added and restores only the previous
`permission.vision_analyze` value recorded by setup. Other plugins, permissions,
settings, JSONC comments, credentials, and the helper config/consent remain intact.
If ownership is missing or an owned value has drifted, it refuses the removal.
Restart OpenCode after a successful unregister. `--json` provides a stable result
for scripts.

## Adapter installation

Build this repository first:

```powershell
npm run build
node .\dist\cli.js setup --config-only
```

Install the adapter for the current project or the global OpenCode configuration:

```powershell
npm run adapter:install -- --scope project
npm run adapter:install -- --scope global
```

`project` targets `<current-directory>/.opencode`. `global` uses the documented
`~/.config/opencode` location. Use `--target <absolute-directory>` for a custom
configuration root. The current development package defaults to a `file:`
dependency on this checkout; override the printed dependency with
`--package-spec <npm-version-or-file-spec>` when appropriate.

`setup --config-only` is for this development/legacy wrapper path. It saves the same
explicit consent and model selection but does not add the npm plugin to the global
OpenCode config, preventing the wrapper and direct package from loading together.

The installer creates only:

- `plugins/vision-helper.ts`
- `.opencode-vision-helper-install.json`

It refuses an existing unowned plugin, validates the exact content hash on repeat
installs, and rolls back a plugin created by the current run if manifest creation
fails. It does not edit OpenCode configuration, package configuration, credentials,
agents, or other plugins.

The installer prints the exact package and permission merge targets. For project
scope, merge the package snippet into `<project>/.opencode/package.json` and the
permission into `<project>/opencode.json`. For global scope, the corresponding
targets are `~/.config/opencode/package.json` and
`~/.config/opencode/opencode.json`. For a checkout at
`D:/DEV/PP/opencode-vision-helper`, the package snippet is equivalent to:

```json
{
  "dependencies": {
    "@pawprint0706/opencode-vision-helper": "file:D:/DEV/PP/opencode-vision-helper"
  }
}
```

The installed wrapper is discovered automatically, so merge only its permission
into the printed config target:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "vision_analyze": "ask"
  }
}
```

Do not replace an existing `opencode.json` or `.opencode/package.json`; merge only
the printed dependency and permission key. Then run the exact dependency command
printed by the installer, for example:

```powershell
npm install --prefix .opencode --no-audit --no-fund
```

This explicit step makes plugin loading deterministic across the CLI, TUI, and
Desktop clients. Restart OpenCode after installing the wrapper or changing
dependencies.

## Adapter upgrade

An install is idempotent only when its owner, wrapper hash, package version, and
package spec exactly match. To upgrade or change a `file:`/registry source, first
run the ownership-checked uninstaller against the existing scope, then install the
new package and review the printed merge targets again:

```powershell
npm run adapter:uninstall -- --scope project
npm run adapter:install -- --scope project
```

The current uninstaller can remove an older manifest when the installed wrapper
still exactly matches that manifest. If either file was edited or ownership cannot
be proved, it stops instead of replacing it. Package and permission snippets remain
manual user-owned configuration and are never rewritten during an upgrade.

## Retired orca-vision-helper installations

The original `orca-vision-helper` project is deprecated, archived, and no longer
maintained. Do not install it for new use. An existing installation can still be
present because it uses a different command and configuration directory. This
installer does not inspect or alter that installation, its keyring entries, its
configuration, or any agent instructions it previously added.

Avoid routing the same analysis through both helpers: doing so can upload an image
twice and incur duplicate model cost. Remove or disable old `orca-vision-helper`
agent instructions so agents have one preferred path. Uninstalling the old package,
deleting its configuration, or removing its credentials is a separate operation
that requires explicit approval and must follow the archived project's
[ownership-aware removal instructions](https://github.com/pawprint0706/orca-vision-helper/blob/main/docs/AGENT_UNINSTALL.md).
No old provider credential is migrated; connect Go or Zen in OpenCode with
`/connect` instead.

The model precedence is a tool-call `model`, plugin option, `OPENCODE_VISION_MODEL`,
then the model saved by setup. Every native invocation also requires current saved
cloud-upload consent. As an
alternative to installing the wrapper, package-only registration can add
`["@pawprint0706/opencode-vision-helper", { "model": "opencode-go/<id>",
"timeoutMs": 120000 }]` to the existing `plugin` array. Do not use both registration
methods in the same configuration.

## Legacy adapter removal

```powershell
npm run adapter:uninstall -- --scope project
npm run adapter:uninstall -- --scope global
```

Removal requires the ownership manifest and an exact current hash match. If the
plugin was edited, removal stops without deleting either file. It never removes
package dependencies, permissions, agents, OpenCode configuration, or credentials;
remove previously merged snippets manually after reviewing unrelated settings.
If the owned plugin was already deleted, the uninstaller can remove the validated
stale manifest without touching anything else.

Only `opencode-go/*` and `opencode/*` models whose input capabilities include images
are accepted.

That model is the delegated analysis model, not the model calling the tool. At the
start of every native invocation, the adapter reads the caller identity from the
current OpenCode message and checks it against the loading server's provider model
metadata. The invocation proceeds only when the caller belongs to OpenCode Go or
Zen and its `capabilities.input.image` value is exactly `false`. A value of `true`
returns `CALLER_VISION_CAPABLE` with an instruction to analyze the image directly.
Missing models, unsupported providers, disconnected providers, and absent or
ambiguous image capability return `CALLER_MODEL_UNVERIFIED`. Both checks happen
before path resolution, image reads, permission prompts, or analysis cost.

`timeoutMs` is optional and defaults to 120000. It must be between 1000 and
1800000 milliseconds. Cancellation from OpenCode's tool context is propagated to
provider discovery, session creation, and prompting; failures abort and remove the
temporary analysis session on a best-effort basis.

If analysis succeeds but temporary-session deletion fails, the native tool preserves
the provider text exactly, changes its visible title to `Vision analysis (cleanup
warning)`, and includes the retained session ID and warning details in tool metadata.

## Permission policy

`vision_analyze` uploads the selected image to the configured OpenCode Go or Zen
cloud model. The adapter calls OpenCode's permission API immediately before cloud
analysis. `ask` is the recommended default because it presents an approval UI for
each model call. `deny` removes the tool from that agent's available tool set. Use
`allow` only in a trusted workflow where automatic image transmission is
intentional.

Saved helper consent and OpenCode permission are separate safeguards. Missing or
outdated helper consent returns `CONSENT_REQUIRED` before image access or the
permission UI. With valid consent, `ask` requests OpenCode approval for each model
call in normal mode, while `allow` can proceed without that UI.

Agent-specific rules can expose the tool only to a vision-limited agent:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "text-only": {
      "permission": {
        "vision_analyze": "ask"
      }
    },
    "vision-capable": {
      "permission": {
        "vision_analyze": "deny"
      }
    }
  }
}
```

The agent rule reduces tool exposure; the runtime metadata gate remains the
enforcement boundary if a vision-capable model can still invoke the tool.

Images outside the current worktree trigger an additional `external_directory`
permission request after symlinks are resolved. The adapter then preprocesses the
canonical file, sends only its basename as the SDK file-part filename, creates a
separate analysis session, disables every discovered tool, and deletes the analysis
session after completion.

When `image` is omitted, the adapter reads the tool-call message and its parent user
message through the current OpenCode server. Exactly one `image/*` attachment is
required. Local source paths and `file:` URLs use the same path checks; strict base64
`data:` URLs are decoded and normalized in memory. Remote HTTP/blob URLs are not
fetched, and multiple attachments require an explicit local `image` path.

## Tool arguments

```json
{
  "image": "optional absolute-or-session-relative-path",
  "prompt": "optional question",
  "model": "optional opencode-go/... or opencode/..."
}
```

Omitting `prompt` returns the validated UI issue report. A custom prompt returns
the model's text without trimming or reinterpretation. Omitting `image` selects the
current message's sole supported image attachment. Errors use the CLI's stable JSON
error fields.
