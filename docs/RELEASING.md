# Release process

This process separates local, repeatable checks from account-authenticated or public
registry actions. Never copy npm or OpenCode credentials into this repository.

## Version policy

- Use Semantic Versioning and tags named `v<version>`.
- Keep `package.json`, `package-lock.json`, the changelog heading, the annotated Git
  tag, and the GitHub Release version identical.
- Never overwrite a published version or move a published tag. Correct a bad release
  with a new patch version and deprecate the affected version with a clear message.
- `0.1.0` was the initial public release; `0.2.0` added Ollama Cloud support.

## Local release candidate gate

Run these commands from a clean `main` checkout:

```powershell
git status --short
npm ci
npm run verify
npm pack --dry-run --json
```

`verify:package` packs and installs the real artifact in a temporary consumer and an
isolated global npm prefix. It executes the platform CLI shim and exercises setup,
config inspection, direct unregister, CLI analysis against a loopback fake,
library/plugin imports, and the legacy adapter lifecycle. The content check rejects
test fixtures, internal sources/docs, logs, temporary or credential-shaped files,
absolute source-map paths, and embedded source content.

Before tagging, replace `Unreleased` in `CHANGELOG.md` with the UTC release date,
commit that change, rerun the gate, and confirm the worktree is clean. Create and push
an annotated `v<version>` tag only after the exact candidate commit is final.

## Registry authorization and publication

The maintainer must explicitly confirm the npm account/scope ownership, package-name
availability, and 2FA before any registry write. A public scoped first release uses:

```powershell
npm publish --access public
```

The package's `prepublishOnly` script reruns the complete gate. Current npm also
supports staged publication followed by an interactive 2FA approval. Either path is
an external write and must be chosen and authorized by the maintainer at release time.

Subsequent releases use npm trusted publishing from the GitHub-hosted workflow
`.github/workflows/publish.yml`. OIDC avoids a long-lived npm publish token and
automatically produces provenance for this public package and repository. The npm
package settings must use these exact, case-sensitive values:

```text
Publisher: GitHub Actions
Organization or user: pawprint0706
Repository: opencode-vision-helper
Workflow filename: publish.yml
Environment name: (empty)
Allowed action: npm publish
```

The workflow has only `contents: read` and `id-token: write`. It runs when a
non-prerelease GitHub Release is published, checks that its annotated `v<version>` tag
matches `package.json`, installs from the lockfile without a package-manager cache,
runs the complete release gate, and publishes without an npm token. Creating or
pushing a tag alone does not publish.

npm does not validate the trusted-publisher fields when they are saved. Treat the next
release as the first end-to-end OIDC test. Only after that succeeds should traditional
token publishing be disabled in npm package settings. Keep tag/release protection and
the rollback policy above in force.

Official npm references:

- [Publishing scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
- [Trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [Package provenance](https://docs.npmjs.com/generating-provenance-statements/)

## Post-publication verification

From a clean environment with no checkout dependency or warm package cache:

```powershell
npm view @pawprint0706/opencode-vision-helper version dist-tags engines repository dist.integrity
npm install -g @pawprint0706/opencode-vision-helper@<version>
opencode-vision-helper --help
opencode-vision-helper setup
opencode-vision-helper doctor --json
```

Record the registry version, integrity/provenance, clean-install platform, OpenCode
version, and synthetic smoke-test result in `docs/VALIDATION.md`. Live Go/Zen/Ollama
Cloud analysis requires separate explicit authorization. If rollback is necessary,
deprecate the bad version, publish a corrected patch, and document both; do not
unpublish or replace an artifact unless npm policy and a genuine security emergency
require it.
