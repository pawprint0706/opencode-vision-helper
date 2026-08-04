# OpenCode native tool

The optional OpenCode adapter exposes one tool named `vision_analyze`. It uses
the SDK client for the OpenCode server that loaded the plugin, so authentication,
provider configuration, and model routing remain owned by OpenCode.

The adapter and ownership-safe lifecycle commands are implemented. The package is
still private and unpublished, but installation from the packed artifact is covered
by the offline verification suite.

Before using either the CLI or native tool, connect OpenCode Go or Zen through
OpenCode's `/connect` flow and choose an image-capable `opencode-go/*` or
`opencode/*` model. This helper never reads, imports, copies, or changes the
resulting credentials.

## Adapter installation

Build this repository first:

```powershell
npm run build
```

Install the adapter for the current project or the global OpenCode configuration:

```powershell
npm run adapter:install -- --scope project
npm run adapter:install -- --scope global
```

`project` targets `<current-directory>/.opencode`. `global` uses the documented
`~/.config/opencode` location. Use `--target <absolute-directory>` for a custom
configuration root. The current private development package defaults to a `file:`
dependency on this checkout; override the printed dependency with
`--package-spec <npm-version-or-file-spec>` when appropriate.

The installer creates only:

- `plugins/vision-helper.ts`
- `.opencode-vision-helper-install.json`

It refuses an existing unowned plugin, validates the exact content hash on repeat
installs, and rolls back a plugin created by the current run if manifest creation
fails. It does not edit OpenCode configuration, package configuration, credentials,
agents, or other plugins.

Merge the package snippet printed by the installer into `.opencode/package.json`.
For a checkout at `D:/DEV/PP/opencode-vision-helper`, it is equivalent to:

```json
{
  "dependencies": {
    "opencode-vision-helper": "file:D:/DEV/PP/opencode-vision-helper"
  }
}
```

The installed wrapper is discovered automatically, so merge only its permission
into that project's `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "vision_analyze": "ask"
  }
}
```

Do not replace an existing `opencode.json` or `.opencode/package.json`; merge only
the printed dependency and permission key. OpenCode installs dependencies from
`.opencode/package.json` when it starts. Restart OpenCode after installing the
wrapper or changing dependencies.

## Coexistence with orca-vision-helper

The original `orca-vision-helper` can remain installed during migration because it
uses a different command and configuration directory. This installer does not
inspect or alter that installation, its keyring entries, its configuration, or any
agent instructions it previously added.

Avoid routing the same analysis through both helpers: doing so can upload an image
twice and incur duplicate model cost. After validating `vision_analyze`, remove or
disable old `orca-vision-helper` agent instructions so agents have one preferred
path. Uninstalling the old package, deleting its configuration, or removing its
credentials is a separate operation that requires explicit approval and must follow
that project's ownership-aware removal instructions. No old provider credential is
migrated; connect Go or Zen in OpenCode with `/connect` instead.

The wrapper uses `OPENCODE_VISION_MODEL` unless the caller supplies `model`. As an
alternative to installing the wrapper, package-only registration can add
`["opencode-vision-helper/plugin", { "model": "opencode-go/<id>",
"timeoutMs": 120000 }]` to the existing `plugin` array. Do not use both registration
methods in the same configuration.

## Adapter removal

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

The model may be supplied on each tool call or through
`OPENCODE_VISION_MODEL`. Only `opencode-go/*` and `opencode/*` models whose input
capabilities include images are accepted.

`timeoutMs` is optional and defaults to 120000. It must be between 1000 and
1800000 milliseconds. Cancellation from OpenCode's tool context is propagated to
provider discovery, session creation, and prompting; failures abort and remove the
temporary analysis session on a best-effort basis.

## Permission policy

`vision_analyze` uploads the selected image to the configured OpenCode Go or Zen
cloud model. `ask` is the recommended default because the approval UI shows the
tool arguments before each call. Use `allow` only in a trusted workflow where
automatic image transmission is intentional.

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
