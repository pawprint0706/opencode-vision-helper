# Migration plan

> Source: `orca-vision-helper`
>
> Target: `opencode-vision-helper`
> Started: 2026-08-04

## Goal

Create an independent OpenCode-only CLI and native tool that lets a model
without image input delegate one local image to an image-capable OpenCode Go or
Zen model. OpenCode must remain the source of truth for authentication, provider
configuration, model metadata, and model-specific wire protocols.

## Decisions

- Keep a CLI as the public and diagnostic interface.
- Ship a thin OpenCode custom-tool or plugin adapter for model-driven calls.
- Prefer the OpenCode SDK/server over direct Zen/Go HTTP calls.
- Limit model IDs to `opencode-go/*` and `opencode/*` and require image input
  modality.
- Run analysis in an isolated session with every tool disabled.
- Use SDK JSON Schema output for the default report; preserve free-form text
  exactly when a custom prompt is supplied.
- Do not store, update, delete, or print OpenCode credentials.
- Defer MCP until a non-OpenCode client or a multi-tool server is required.

## Migration phases

1. **In progress:** validate SDK image/file input and structured output against
   live Go and Zen without reading credentials directly. Offline SDK contract
   construction, cancellation plumbing, and tool-free sessions are complete.
2. **Complete:** port image limits, resizing, report schema, trust instruction,
   and stable error output.
3. **Complete offline:** implement `analyze` and `doctor`; live account smoke
   testing remains intentionally pending.
4. **Complete offline:** the `vision_analyze` plugin adapter reuses the current
   OpenCode server, resolves external paths through permission requests, and has
   `ask`/`deny` examples. Live TUI and desktop validation remains pending.
5. **Complete offline:** cross-platform Node install/uninstall commands use exact
   content hashes, preflight collision checks, current-run rollback, and preserve
   all OpenCode config/auth state. Release-package validation remains pending.
6. **Pending:** validate CLI and desktop behavior, then decide the source repository's
   maintenance or archive policy separately.

## Current safety notes

- The core requires an explicit upload-approval flag even when it is called
  outside the CLI. The native adapter supplies it only after OpenCode has allowed
  the `vision_analyze` tool call.
- Image paths are canonicalized before reading. Native calls request
  `external_directory` permission when the resolved target is outside the worktree.
- SDK file parts use only the local basename rather than transmitting an absolute
  local path as the filename.
- CLI and native calls have a bounded analysis timeout and propagate caller/SIGINT
  cancellation. A failed request aborts the server-side session before cleanup.
- SDK and provider failures are mapped to stable, sanitized errors. A cleanup
  failure after successful analysis returns a warning and retained session ID
  instead of hiding the orphaned session or encouraging a duplicate paid retry.

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
