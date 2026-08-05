# Validation status

This document separates the completed automated migration evidence from checks that
must not run without explicit user authorization or external repository access.

## Automated gates

Run the complete local gate with:

```powershell
npm run verify
```

The gate performs:

- Biome formatting, lint, and import-order checks
- strict TypeScript checks for the library and OpenCode plugin wrapper
- unit, process-contract, generated-SDK HTTP, cancellation, path, and installer tests
- package build
- real `npm pack`, clean temporary-consumer installation, plugin import, generated
  CLI shim presence, installed CLI execution, fake setup/config/direct-unregister
  lifecycle, fake-OpenCode structured analysis and timeout, and exact legacy adapter
  install/uninstall lifecycle checks

The fake server binds only to `127.0.0.1`. The temporary consumer may contact the npm
registry to resolve the packed artifact's declared dependencies. The default gate does
not start the real OpenCode executable, inspect credentials, contact a model provider,
or upload an image.

The 2026-08-05 `npm pack --dry-run --json` review confirmed the `files` allowlist
excludes source, tests, fixtures, internal docs, GitHub metadata, logs, temporary
files, and credential-shaped files. Runtime source maps are retained for debugging;
the package verifier requires relative `../src/` references and rejects embedded
`sourcesContent` or absolute source paths. README, license, changelog, and security
policy are included. These content invariants now run in `verify:package` rather than
remaining a one-time manual observation.

## Requirement evidence

| Requirement | Automated evidence |
| --- | --- |
| Image size, pixel, format, animation, orientation, resize, and corruption boundaries | `tests/imaging.test.ts` |
| Go/Zen-only model prefix, connection, existence, and image modality | `tests/model.test.ts`, `tests/opencode.test.ts` |
| Strict report and free-form text preservation | `tests/report.test.ts`, `tests/opencode-http.test.ts` |
| SDK routes, file part, schema retry request, tool disabling, cleanup, errors, and cancellation | `tests/opencode-http.test.ts` |
| CLI stdout/stderr/exit, human/JSON/text output, Unicode paths, and timeout | `tests/cli.test.ts`, `scripts/verify-package.mjs` |
| Setup consent/model matrix, EOF/Ctrl+C/timeout handling, no-analysis regression, manual fallback verification, JSONC-preserving global registration/removal, global-direct/project-wrapper duplicate detection, ownership drift, and readiness diagnostics | `tests/config.test.ts`, `tests/setup.test.ts`, `tests/registration.test.ts`, `tests/diagnostics.test.ts` |
| Native caller identity and fail-closed image-capability gate, tool registration, SDK client bridge, upload/external-path permissions, attachments, and approved core handoff | `tests/model.test.ts`, `tests/tool.test.ts`, `tests/attachment.test.ts` |
| Exact project/global install ownership, merge targets, symlink/junction containment, upgrade removal, rollback, modification preservation, and recovery | `tests/install.test.ts`, `scripts/verify-package.mjs` |
| No OpenCode config/auth mutation during packaged adapter lifecycle | config/auth sentinels in `scripts/verify-package.mjs` |
| Windows, macOS, and Linux automation definition | `.github/workflows/ci.yml` |

The diagnostics tests also keep the reported global permission distinct from the
warning that project, agent, or managed configuration can override it. The helper
does not claim to observe OpenCode's final merged permission when that API is not
available.

The workflow matrix is configured for all three operating systems with Node.js 20
and 24. The matrix passed for commit `44e9114` in
[CI run 30934005206](https://github.com/pawprint0706/opencode-vision-helper/actions/runs/30934005206).

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

On 2026-08-05, after the caller-capability gate was added, the project-scoped
adapter was installed again and tested in the OpenCode 1.18.12 TUI with a newly
generated copy of the same synthetic settings image:

- `opencode-go/deepseek-v4-flash` reported
  `capabilities.input.image: false`. It invoked `vision_analyze`, displayed the
  `vision_analyze` permission prompt, and completed after `Allow once` using
  `opencode-go/gpt-5.6-luna`. The delegated result identified the intentionally
  clipped **Save changes** button. The observed caller-session cost was
  `0.0014200816`, and the delegated tool metadata reported cost `0.000546125`.
- `opencode-go/gpt-5.6-luna` reported
  `capabilities.input.image: true`. Its forced test invocation returned
  `CALLER_VISION_CAPABLE` in 3 ms with the instruction to analyze the image
  directly. No upload permission prompt, delegated model cost, or additional
  analysis session was observed.
- An initial `opencode-go/kimi-k3` rejection attempt did not begin producing a
  model response within the test window during uneven provider service. It was
  aborted and was not counted as gate evidence; the successful Luna invocation
  exercised the same `image: true` branch.

The disabled free-model attempt, successful DeepSeek and Luna sessions, and aborted
Kimi session were deleted. The adapter wrapper and manifest, installed dependency
directory, temporary OpenCode package/config files, and synthetic image were also
removed. No credential file was read or changed.

A guarded native automation prototype was also exercised with `opencode run` in an
isolated project. On OpenCode CLI 1.18.12 it repeatedly stalled after the logged
`init` stage before any model call or stdout, including after explicit dependency
installation, same-volume placement, and Git initialization. Every attempt timed
out and removed its project successfully. The unreliable prototype is not shipped;
the successful TUI and Desktop checks above remain the native live evidence until
OpenCode's non-interactive plugin path can be reproduced reliably.

On 2026-08-05, a headless `opencode run` session succeeded on macOS with OpenCode
1.18.13, resolving the stalled-prototype gap. The adapter was installed from the
local checkout into an isolated temporary project with `--target`, the exact
printed `file:` dependency was merged and installed with
`npm install --prefix <project>/.opencode`, and `vision_analyze` was set to
`allow` in that throwaway project's config (explicitly authorized live test, not
the recommended `ask` policy). No existing OpenCode configuration or credentials
were touched. A synthetic PNG (800x400: blue-bordered card, red circle, green
square, "HELLO 42" heading) was generated with sharp and analyzed twice:

- `opencode run -m opencode-go/deepseek-v4-flash` invoked `vision_analyze` with
  `model: opencode-go/gpt-5.6-luna`. The delegated analysis correctly described
  the card, shapes, and text and flagged the heading overflow; the tool reported
  delegated cost `0.000611425`, and the caller step reported `0.001218`.
- `opencode run -m opencode-go/gpt-5.6-luna` deliberately forced
  `vision_analyze` with the same model argument. The tool refused in 2 ms with
  `CALLER_VISION_CAPABLE`, returning
  "OpenCode reports that the calling model 'opencode-go/gpt-5.6-luna' accepts
  image input. Analyze the image directly instead of calling vision_analyze."
  before any upload permission prompt, delegated cost, or analysis session.

Both sessions, the temporary project, the installed dependency, and the synthetic
image were removed afterward. The headless path is now reproduced on CLI 1.18.13;
the earlier 1.18.12 stall is attributed to that version's non-interactive plugin
path rather than to the adapter.

## macOS package gate fix

During the 2026-08-05 macOS verification, `npm run verify:package` failed in the
temporary-consumer step with npm `ETARGET`:
"No matching version found for @opencode-ai/plugin@1.18.12", even though the
version exists on the registry. `npm view` confirmed `1.18.12` and `1.18.13` are
published, and a direct `npm install` in a fresh consumer succeeded. The failing
install used `--prefer-offline` (introduced as the CI-safe replacement for
`--offline` in commit `ccc2a17`): npm revalidates neither metadata nor tarballs
with that flag, so a stale local packument for `@opencode-ai/plugin` resolved
against nothing and produced `ETARGET`. `scripts/verify-package.mjs` now passes
`--prefer-online`, which revalidates registry metadata while still falling back
to the cache when the network is unavailable. After the change,
`npm run verify` completed on macOS: Biome, strict TypeScript, 102 Vitest tests,
the package build, and the packed-artifact install/lifecycle checks all passed.

## OpenCode SDK baseline

The exact `@opencode-ai/plugin` and `@opencode-ai/sdk` runtime dependencies were
updated together from 1.18.12 to 1.18.13 on 2026-08-05. The strict library and
adapter type checks, 102 Vitest tests, build, and packed-artifact consumer and
adapter-lifecycle checks pass with that baseline. This is a dependency compatibility
check and does not repeat the already completed live model calls.

## npm 0.1.0 publication

The initial public package was published manually on 2026-08-05 as
`@pawprint0706/opencode-vision-helper@0.1.0` with public access after the maintainer
confirmed the matching npm account and `auth-and-writes` 2FA. Annotated tag `v0.1.0`
points to release commit `2b838591633fff77cfd50805fb7eacf4430fa12a`.

The release commit and tag each passed Windows, macOS, and Linux CI on Node.js 20 and
24: [release-commit run](https://github.com/pawprint0706/opencode-vision-helper/actions/runs/30975436035)
and [tag run](https://github.com/pawprint0706/opencode-vision-helper/actions/runs/30975710211).
The public registry reports:

- version and `latest` dist-tag: `0.1.0`
- engine: Node.js `>=20`
- repository: `git+https://github.com/pawprint0706/opencode-vision-helper.git`
- integrity: `sha512-iFS64fGA2m9WtnBS0YP29U8f4TDHBvYnG279i4mHwpY14eDeIQs1+YkOHJx6MuQM32mkIHdC4n8r6cWMK0TnQA==`
- shasum: `b6470d36e9438d7db3d6276c95d7ad5172c0f5e4`
- provenance: no registry attestation is present for this manually published initial
  version; trusted publishing with provenance remains the preferred follow-up path

A clean Windows consumer using Node.js 24.15.0 and npm 12.0.2 installed the exact
registry version into an isolated global prefix with a separate empty HOME, npm user
config, and cache. The generated `.cmd` shim executed `--help` successfully. This
post-publication smoke test did not inspect OpenCode credentials, discover provider
models, or perform a live image analysis.

## Deferred validation

No required check remains for the `ask`-based local-only v1. An intentional
persistent `allow` policy could optionally be exercised in a dedicated trusted test
project, but the headless temporary-project path has already exercised `allow`, and
`ask` remains the recommended default. This is not a release requirement.

Live checks can transmit images, incur provider cost, inspect provider connection
state through OpenCode, or change OpenCode project configuration. Current live
evidence is limited to the user's authorized synthetic fixtures and the previously
completed TUI/Desktop/headless validation. Credentials remain owned by OpenCode and
must never be copied into this project or recorded in validation output.

## Distribution decision

The GitHub source repository and npm package
`@pawprint0706/opencode-vision-helper@0.1.0` are public. Interactive setup,
ownership-tracked global registration, release policy, packed-artifact installation,
and the isolated cross-platform global CLI shim gate are complete. The maintainer
confirmed the matching npm account, `auth-and-writes` 2FA, and the manual initial
publish path on 2026-08-05. The registry metadata, integrity, and clean-install result
are recorded above. The original
`orca-vision-helper` was marked deprecated in commit
`ace115f` and archived on 2026-08-05 after its historical migration records and
ownership-aware removal guidance were preserved. That repository retirement did not
remove any existing installation or credential.
