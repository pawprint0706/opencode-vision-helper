# Changelog

All notable changes to this project are documented here. The project follows
Semantic Versioning; while the major version is `0`, minor releases may still
contain intentional interface changes that are called out below.

## [0.2.2] - 2026-08-13

### Changed

- Register the OpenCode plugin with a version-pinned specifier
  (`@pawprint0706/opencode-vision-helper@<version>`) and re-pin it on every
  setup run. OpenCode caches npm plugins by resolved specifier, so a bare
  package name was pinned to `latest` once and never refreshed, leaving the
  plugin stuck on an older version after `npm update -g`. A versioned specifier
  gives each release its own cache entry, so setup refreshes it deterministically.
- Existing unversioned or older plugin entries are migrated to the current
  versioned specifier during setup.

## [0.2.1] - 2026-08-13

### Fixed

- Spawn the OpenCode server on a free port in the 10000-50000 range instead of the
  SDK's fixed default 4096, retrying on conflict. This avoids clashing with an
  already-running OpenCode desktop-app server on Windows, which previously made
  `doctor` and `setup` fail with `OPENCODE_UNAVAILABLE`.
- Strip the inherited `OPENCODE_SERVER_PASSWORD`/`OPENCODE_SERVER_USERNAME`
  environment variables while spawning the isolated analysis server and restore
  them afterwards. Without this, a server spawned from the desktop-app process
  tree required Basic auth and the SDK client received 401.

## [0.2.0] - 2026-08-13

### Added

- Ollama Cloud (`ollama-cloud/*`) as a third supported provider for model
  discovery, vision-capability checks, delegated analysis, and caller validation.
- Ollama Cloud models fall back to free-form text analysis when structured
  output is requested; live verification confirmed ollama-cloud does not support
  json_schema structured output.

### Changed

- Cloud-upload consent notice version raised to 2; existing v1 consent requires
  re-acceptance through setup because the recipient set now includes Ollama Cloud.

## [0.1.0] - 2026-08-05

### Added

- OpenCode Go/Zen-only CLI image analysis with strict model and image validation.
- Native `vision_analyze` plugin with caller-capability, consent, permission, tool
  disabling, and temporary-session cleanup safeguards.
- Interactive setup with saved model/consent, ownership-tracked global registration,
  JSONC-preserving manual fallback, doctor diagnostics, and config inspection.
- Exact ownership-based direct registration and legacy adapter removal.
- Packed-artifact, fake-OpenCode, cross-platform CI, and guarded live validation.

### Security

- OpenCode remains the sole credential owner; helper sessions disable every tool and
  treat image contents and provider output as untrusted data.
