# OmegA-FCA 0.2.3-beta.5 pre-release

- Package: `@nirzon-islam/omega-fca`
- Version: `0.2.3-beta.5`
- Intended npm dist-tag: `beta`
- Source branch: `feature/release-0.2.3-beta.3`
- Release type: beta pre-release (not stable)

## Release checks

- [x] Update `package.json` version to `0.2.3-beta.5`.
- [x] Synchronize the root `package-lock.json` package/version fields.
- [x] Update README version, release status, license, and E2EE scope statements.
- [x] Record beta.5 changes and the beta.3/beta.4 release history in `CHANGELOG.md`.
- [x] Update the E2EE status/roadmap version references and documentation index.
- [x] Configure CI to run the full validation pipeline on Node.js 20 and 22.
- [x] GitHub Actions passed on beta.5 candidate commit `805ee04cac0dd51f3bd57dc402fee997348c9615` for both Node.js versions (run [46051824966](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46051824966)).
- [ ] Dependency/security audit, build, full tests, TypeScript check, lint, and `npm pack --dry-run` pass on this exact commit for Node.js 20 and 22.
- [x] Removed `docs/` from the npm `files` allowlist; documentation remains in the GitHub repository but is excluded from the published tarball.
- [x] Reviewed package metadata, AGPL-3.0-or-later LICENSE, upstream/Signal notices, README, and package file allowlist. Beta.5's project license differs from beta.4; review the license change before upgrading.

## Interoperability boundary

- Native Messenger E2EE Steps 1–4 are complete for the documented offline source/integration/fixture/CI scope.
- Authorized live Facebook login, bot acceptance, peer-device round trips, and media-CDN interoperability remain separate, deferred checks. Passing synthetic tests does not prove live-service compatibility.
- Do not describe this beta as stable or production-ready.

## Publish safety

- [ ] Obtain explicit release authorization before publishing.
- [ ] Only after final CI and package review, create the `v0.2.3-beta.5` tag and publish with the npm `beta` dist-tag.
- [ ] The repository's tag-triggered publish workflow runs `npm publish --tag beta --provenance --access public`; creating the version tag can publish to npm. Do not create the tag as part of preparation alone.
