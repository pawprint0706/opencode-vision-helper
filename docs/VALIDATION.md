# Validation status

This document separates the completed offline migration evidence from checks that
must not run without explicit user authorization or external repository access.

## Offline gates

Run the complete local gate with:

```powershell
npm run verify
```

The gate performs:

- Biome formatting, lint, and import-order checks
- strict TypeScript checks for the library and OpenCode plugin wrapper
- unit, process-contract, generated-SDK HTTP, cancellation, path, and installer tests
- package build
- real `npm pack`, offline temporary-consumer installation, plugin import, generated
  CLI shim execution, fake-OpenCode structured analysis and timeout, and exact
  adapter install/uninstall lifecycle checks

The fake server binds only to `127.0.0.1`. The default gate does not start the real
OpenCode executable, inspect credentials, contact a provider, or upload an image.

## Requirement evidence

| Requirement | Offline evidence |
| --- | --- |
| Image size, pixel, format, animation, orientation, resize, and corruption boundaries | `tests/imaging.test.ts` |
| Go/Zen-only model prefix, connection, existence, and image modality | `tests/model.test.ts`, `tests/opencode.test.ts` |
| Strict report and free-form text preservation | `tests/report.test.ts`, `tests/opencode-http.test.ts` |
| SDK routes, file part, schema retry request, tool disabling, cleanup, errors, and cancellation | `tests/opencode-http.test.ts` |
| CLI stdout/stderr/exit, human/JSON/text output, Unicode paths, and timeout | `tests/cli.test.ts`, `scripts/verify-package.mjs` |
| Native tool registration, attachments, external-path permission, and approved core handoff | `tests/tool.test.ts`, `tests/attachment.test.ts` |
| Exact install ownership, symlink/junction containment, rollback, modification preservation, and recovery | `tests/install.test.ts`, `scripts/verify-package.mjs` |
| No OpenCode config/auth mutation during packaged adapter lifecycle | config/auth sentinels in `scripts/verify-package.mjs` |
| Windows, macOS, and Linux automation definition | `.github/workflows/ci.yml` |

The workflow matrix is configured for all three operating systems with Node.js 20
and 24. A successful remote CI run is still required as release evidence; this
local repository currently has no configured remote from which to inspect one.

## Explicitly authorized live validation

The following checks remain intentionally unexecuted:

1. Run `doctor` against an existing OpenCode installation after confirming Go and
   Zen were connected through `/connect`.
2. Upload one approved, non-sensitive fixture to an image-capable `opencode-go/*`
   model and one to an image-capable `opencode/*` model. Verify the structured and
   custom-text paths without reading credentials directly.
3. Install the adapter into an explicitly selected test project, merge only the
   printed package and permission snippets, and restart OpenCode.
4. From a vision-limited agent, verify `vision_analyze` with `ask`; separately
   verify intentional `allow` and a vision-capable agent's `deny` rule. Confirm the
   analysis session cannot call any tool, including `vision_analyze` recursively.
5. In the actual TUI/desktop client, verify local, external-directory, and attached
   image flows and their approval UI.
6. Observe a green Windows/macOS/Linux CI matrix for the release candidate.

These checks can transmit images, incur provider cost, inspect provider connection
state through OpenCode, or change OpenCode project configuration. They require the
user to approve the fixture, model IDs, installation scope, and permission policy
first. Credentials remain owned by OpenCode and must never be copied into this
project or recorded in validation output.

## Distribution decisions

The package remains `private` and unpublished. Before a release, choose local-only,
private-registry, public npm, or another artifact channel; then add the corresponding
repository metadata, version/provenance policy, and published-artifact smoke test.
The original `orca-vision-helper` maintenance/archive/deprecation decision is
separate and must not remove an existing installation or credential without its own
explicit approval.
