# Migration plan

> Source: `orca-vision-helper`
>
> Target: `opencode-vision-helper`
> Started: 2026-08-04
> Source retired: 2026-08-05 (`ace115f`, deprecated and archived)

## Goal

Create an independent OpenCode-only CLI and native tool that lets a model
without image input delegate one local image to an image-capable OpenCode Go,
Zen, or Ollama Cloud model. OpenCode must remain the source of truth for
authentication, provider configuration, model metadata, and model-specific wire
protocols.

## Decisions

- Keep a CLI as the public and diagnostic interface.
- Ship a thin OpenCode custom-tool or plugin adapter for model-driven calls.
- Prefer the OpenCode SDK/server over direct Zen/Go HTTP calls.
- Limit model IDs to `opencode-go/*`, `opencode/*`, and `ollama-cloud/*` and
  require image input modality.
- Gate native tool execution on the calling model recorded by OpenCode: only an
  explicit `capabilities.input.image: false` may use the fallback; capable and
  unverifiable callers are rejected before any image access.
- Run analysis in an isolated session with every tool disabled.
- Use SDK JSON Schema output for the default report; preserve free-form text
  exactly when a custom prompt is supplied.
- Do not store, update, delete, or print OpenCode credentials.
- Defer MCP until a non-OpenCode client or a multi-tool server is required.
- Treat public npm publication as a separately approved release phase. Registry
  writes require an explicit maintainer decision and must preserve the credential and
  lifecycle boundaries above.

## Migration phases

1. **Complete:** SDK image input and structured output were validated against live
   OpenCode Go and Zen with a generated non-sensitive fixture, without reading
   credentials directly. Offline SDK contracts, cancellation, and tool-free sessions
   remain in the default suite.
2. **Complete:** port image limits, resizing, report schema, trust instruction,
   and stable error output.
3. **Complete:** implement `analyze` and `doctor`; both provider identities passed
   the guarded live CLI smoke test.
4. **Complete for TUI and Desktop:** the `vision_analyze` plugin adapter reuses the
   authenticated client supplied by the current OpenCode server, requests upload
   permission before analysis, and resolves external paths through a separate
   permission request. A live TUI run verified the `ask` prompt, one-time approval,
   successful analysis, tool-free child session, and `deny` removal. The external
   path's two permission prompts and OpenCode's real message-file attachment path
   are also live-verified. OpenCode Desktop 1.18.13 additionally verified the native
   file picker, external-path and upload permission prompts, explicit-path analysis,
   and attachment resolution with the tool's `image` argument omitted.
   A subsequent TUI run verified the caller metadata gate with an explicit
   `image: false` Go model and an `image: true` Go model; the latter returned
   `CALLER_VISION_CAPABLE` before any upload permission or delegated analysis.
   Headless `opencode run` sessions on CLI 1.18.13 then reproduced the same two
   behaviors with `opencode-go/deepseek-v4-flash` (delegated analysis through
   `opencode-go/gpt-5.6-luna`) and a forced `opencode-go/gpt-5.6-luna` call
   (refused with `CALLER_VISION_CAPABLE`).
5. **Complete locally:** cross-platform Node install/uninstall commands use exact
   content hashes, preflight collision checks, current-run rollback, and preserve
   all OpenCode config/auth state. The packed artifact is installed into an
   clean temporary consumer and its plugin export and adapter lifecycle are verified.
6. **Complete release candidate:** the packaged CLI is validated end-to-end against a
   local fake OpenCode executable, and live Go/Zen CLI plus TUI and Desktop validation
   has passed. The remote Windows/macOS/Linux matrix also passes on Node.js 20 and 24,
   including an isolated global npm install and platform CLI shim execution. The
   target source repository is public. The original `orca-vision-helper` was marked
   deprecated and archived after its migration records and removal guidance were
   preserved. Initial public npm publication was separately approved and completed as
   `@pawprint0706/opencode-vision-helper@0.1.0` on 2026-08-05.

CI covers Windows, macOS, and Linux on the minimum Node.js 20 runtime and
Node.js 24. Every matrix job installs from the lockfile, runs type checks, unit and
contract tests, runs Biome formatting/lint checks, builds the package, and installs
the real packed artifact into a clean temporary consumer without starting
OpenCode or contacting a model provider.

## Current safety notes

- The core requires an explicit upload-approval flag even when it is called
  outside the CLI. The native adapter explicitly requests OpenCode's
  `vision_analyze` permission immediately before it supplies that approval.
- The native adapter resolves the caller from OpenCode's current message rather
  than trusting tool arguments. It compares that identity with current provider
  metadata and fails closed unless image input is explicitly disabled.
- Image paths are canonicalized before reading. Native calls request
  `external_directory` permission when the resolved target is outside the worktree.
- SDK file parts use only the local basename rather than transmitting an absolute
  local path as the filename.
- CLI and native calls have a bounded analysis timeout and propagate caller/SIGINT
  cancellation. A failed request aborts the server-side session before cleanup.
- SDK and provider failures are mapped to stable, sanitized errors. A cleanup
  failure after successful analysis returns a warning and retained session ID
  instead of hiding the orphaned session or encouraging a duplicate paid retry.
  Native failures also include a safe stage label without exposing provider URLs,
  credentials, or raw SDK error bodies.

## Source assets

Reuse or port:

- 50 MiB input limit and 80 million decoded-pixel limit
- long-edge downscaling and PNG/JPEG normalization
- UI analysis report fields and untrusted-image instruction
- retryable error output and local fake-provider testing approach

Remove rather than migrate:

- multi-provider catalog and provider CRUD
- keyring integration and credential deletion
- custom base URLs and keyless gateways
- Ollama, OpenAI, Anthropic, and OpenRouter backends
- Orca discovery rules and non-OpenCode harness instructions

## First milestone acceptance

- The repository builds and tests without live provider access.
- `doctor` can inspect OpenCode availability without exposing credentials.
- `analyze` validates and preprocesses an image before any provider call.
- One SDK-backed, tool-free session request can be constructed with an image
  part and strict report schema.
- No path can send a stored key to a caller-selected URL.

## References

- [OpenCode custom tools](https://opencode.ai/docs/custom-tools/)
- [OpenCode plugins](https://opencode.ai/docs/plugins/)
- [OpenCode SDK](https://opencode.ai/docs/sdk/)
- [OpenCode server](https://opencode.ai/docs/server/)
- [OpenCode providers](https://opencode.ai/docs/providers/)
- [OpenCode Zen endpoints](https://opencode.ai/docs/zen/)
