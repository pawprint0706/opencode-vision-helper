# Changelog

All notable changes to this project are documented here. The project follows
Semantic Versioning; while the major version is `0`, minor releases may still
contain intentional interface changes that are called out below.

## [0.1.0] - Unreleased

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
