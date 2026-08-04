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
| Native tool registration, SDK client bridge, upload/external-path permissions, attachments, and approved core handoff | `tests/tool.test.ts`, `tests/attachment.test.ts` |
| Exact project/global install ownership, merge targets, symlink/junction containment, upgrade removal, rollback, modification preservation, and recovery | `tests/install.test.ts`, `scripts/verify-package.mjs` |
| No OpenCode config/auth mutation during packaged adapter lifecycle | config/auth sentinels in `scripts/verify-package.mjs` |
| Windows, macOS, and Linux automation definition | `.github/workflows/ci.yml` |

The workflow matrix is configured for all three operating systems with Node.js 20
and 24. A successful remote CI run is still required as release evidence; this
local repository currently has no configured remote from which to inspect one.

## Live validation record

On 2026-08-04, after explicit authorization, `doctor` confirmed OpenCode 1.18.12
with both `opencode-go` and `opencode` connected. The guarded live-smoke script sent
only its generated synthetic settings UI to:

- `opencode-go/gpt-5.6-luna`: structured report succeeded and found the intentionally
  clipped save button; observed cost `0.0006874`
- `opencode/gpt-5.6-luna`: structured report succeeded and found the same issue;
  observed cost `0.00135655`

These model IDs, costs, and response times are observations from one run, not stable
guarantees. The script deletes its temporary fixture and requires `--allow-live`,
`--go-model`, and `--zen-model`; it is excluded from the default test gate.

The project-scoped adapter was then installed from the local checkout and loaded by
OpenCode 1.18.12. A vision-limited `opencode-go/kimi-k2.7-code` TUI session called
`vision_analyze` for the same synthetic local fixture using
`opencode-go/gpt-5.6-luna`. The first implementation exposed a separately created
SDK client failure at the safe `provider discovery` stage; switching the adapter to
the authenticated client supplied by OpenCode resolved it. The final run verified:

- `ask` displayed `Permission required` before the analysis session was created
- `Allow once` completed analysis and found the intentionally clipped save button
- the child analysis session had wildcard tool permission set to `deny`
- a fresh session with `vision_analyze: deny` did not expose or invoke the tool
- an external synthetic path requested `external_directory` first and
  `vision_analyze` second, then completed after two one-time approvals
- `opencode run -i --file` selected the current message attachment when the tool's
  `image` argument was omitted; its default permission rejection returned
  `UPLOAD_NOT_APPROVED` before upload, and an explicitly authorized `--auto` rerun
  completed the attached-image analysis
- the ownership-checked uninstaller removed its wrapper and manifest afterward

Only the generated synthetic image was sent. The temporary project package/config,
OpenCode-installed dependencies, and persistent fixture were removed after the
test; no credential file was read or changed.

OpenCode Desktop 1.18.13 was then validated with the same synthetic fixture after
an explicit local `npm install --prefix .opencode` and restart. Its native file
picker displayed and attached the PNG. An explicit external path produced separate
`external_directory` and `vision_analyze` one-time permission prompts before the
native tool found the clipped button. In a fresh session, omitting the tool's
`image` argument resolved the sole GUI message attachment, requested only the
`vision_analyze` permission, and returned the same finding. The initial pre-install
attempt did not expose the native tool, which is why deterministic dependency
installation is now an explicit documented step.

A guarded native automation prototype was also exercised with `opencode run` in an
isolated project. On OpenCode CLI 1.18.12 it repeatedly stalled after the logged
`init` stage before any model call or stdout, including after explicit dependency
installation, same-volume placement, and Git initialization. Every attempt timed
out and removed its project successfully. The unreliable prototype is not shipped;
the successful TUI and Desktop checks above remain the native live evidence until
OpenCode's non-interactive plugin path can be reproduced reliably.

## Deferred validation

No required check remains for the `ask`-based local-only v1. The following checks
remain intentionally deferred:

1. Optionally verify an intentional persistent `allow` policy in a dedicated trusted test
   project; `ask` remains the recommended default.
2. Observe a green Windows/macOS/Linux CI matrix for the release candidate.

Live checks can transmit images, incur provider cost, inspect provider connection
state through OpenCode, or change OpenCode project configuration. Current work is
limited to the user's authorized synthetic fixtures, TUI-first validation, and local
distribution testing. Credentials remain owned by OpenCode and must never be copied
into this project or recorded in validation output.

## Distribution decision

The current distribution is local-only, and the package remains `private` and
unpublished. Before a later external release, choose private-registry, public npm,
or another artifact channel; then add the corresponding repository metadata,
version/provenance policy, and published-artifact smoke test. The original
`orca-vision-helper` maintenance/archive/deprecation decision is separate and must
not remove an existing installation or credential without its own explicit
approval.
