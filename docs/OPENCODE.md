# OpenCode native tool

The optional OpenCode adapter exposes one tool named `vision_analyze`. It uses
the SDK client for the OpenCode server that loaded the plugin, so authentication,
provider configuration, and model routing remain owned by OpenCode.

The adapter is implemented but not installed automatically. The package is still
private and no ownership-safe installer is available yet.

## Development registration

Build this repository first:

```powershell
npm run build
```

In the OpenCode configuration directory for the project that will use the tool,
merge a local package dependency into `.opencode/package.json`. Replace the path
with the absolute path to this checkout:

```json
{
  "dependencies": {
    "opencode-vision-helper": "file:D:/DEV/PP/opencode-vision-helper"
  }
}
```

Then merge the plugin and model selection into that project's `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-vision-helper/plugin",
      { "model": "opencode-go/<image-capable-model-id>" }
    ]
  ],
  "permission": {
    "vision_analyze": "ask"
  }
}
```

Do not replace an existing `opencode.json` or `.opencode/package.json`; merge only
the new dependency, plugin entry, and permission key. OpenCode installs dependencies
from `.opencode/package.json` when it starts. Restart OpenCode after changing plugin
registration.

The model may instead be supplied on each tool call or through
`OPENCODE_VISION_MODEL`. Only `opencode-go/*` and `opencode/*` models whose input
capabilities include images are accepted.

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

## Tool arguments

```json
{
  "image": "absolute-or-session-relative-path",
  "prompt": "optional question",
  "model": "optional opencode-go/... or opencode/..."
}
```

Omitting `prompt` returns the validated UI issue report. A custom prompt returns
the model's text without trimming or reinterpretation. Errors use the CLI's stable
JSON error fields. Desktop attachment discovery is not implemented; v1 currently
requires an existing local path.
