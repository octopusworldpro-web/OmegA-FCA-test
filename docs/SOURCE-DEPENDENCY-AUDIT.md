# OmegA-FCA Source & Dependency Audit

**Repository:** `octopusworldpro-web/OmegA-FCA-test`  
**Branch:** `main`  
**Package:** `@nirzon-islam/omega-fca@0.2.0`  
**Audit scope:** repository source and package metadata only; no ZIP source is used.

## Audit result

The source tree is structured as a TypeScript package with a CommonJS compatibility bridge and ESM/CJS bundles produced by tsup. The package declares Node.js 20 or newer. The current manifest and source configuration are internally aligned on the OmegA-FCA package name and npm registry.

This is a **static source audit**, not a successful dependency installation, compiler run, test run, vulnerability scan, or live Facebook acceptance test.

## Findings addressed in this audit

1. **Fresh-checkout test execution:** the test file imports `dist/index.js`, but `dist/` is generated and ignored. The `npm test` script now runs the build before executing the test suite. `test:build` delegates to `npm test` to avoid maintaining two different test paths.
2. **Lockfile tracking:** `package-lock.json` was ignored by Git. That ignore rule has been removed so a generated npm lockfile can be committed for deterministic installs. No lockfile is present yet; generate and commit it after registry access is available.
3. **CJS bridge branding:** the generated CommonJS bridge's failure message referenced the upstream package name. It now reports `@nirzon-islam/omega-fca`.
4. **Install instructions:** documentation should use `npm install` until a package lock is generated and committed; `npm ci` requires a lockfile.

## Dependency and runtime observations

| Area | Declared dependency / setting | Audit note |
|---|---|---|
| Runtime | Node.js `>=20.0.0` | Required by the current dependency set, including `ora@^9.3.0`. |
| Build | `tsup@^8.5.0`, TypeScript `^5.9.3` | Build emits CJS/ESM and declarations; the CJS bridge is generated after tsup. |
| HTTP | `axios@^1.13.5`, `axios-cookiejar-support@^5.0.5` | Major-version compatibility and cookie-jar integration need install/build tests. |
| HTML parsing | `cheerio@^1.0.0-rc.10` | Range permits later compatible 1.x releases; resolve and lock an exact version before release. |
| MQTT / sockets | `mqtt@^4.3.8`, `ws@^8.18.1` | Private Messenger protocol behavior still requires authorized live validation. |
| Database | `sequelize@^6.37.6`, `sqlite3@^5.1.7` | sqlite3 may require a compatible prebuilt binary or native build toolchain in deployment. |
| Proxy | `https-proxy-agent@^4.0.0` | Older major line; verify call-site compatibility before upgrading. |
| CLI | `ora@^9.3.0`, `picocolors@^1.1.1`, `gradient-string@^3.0.0` | ora 9 is ESM-oriented and Node 20+; verify CommonJS runtime paths in the actual build. |
| Testing | Node built-in assertions in `test/fca.test.cjs` | Test suite imports generated output, so test now builds first. |

Dependency ranges alone do not establish whether a release has known vulnerabilities. Run `npm audit` after generating the lockfile and installing dependencies; review findings before changing major versions.

## Validation gaps that remain open

- No `package-lock.json` is committed yet. Reproducible `npm ci` is not available until it is generated and committed.
- Dependency installation and package resolution were not completed in this environment.
- Full build, unit tests, lint, and TypeScript checks have not been run.
- The explicit exclusion for `src/core/login-helper.impl.ts` was removed from `tsconfig.typecheck.json`; the implementation is now included in the project typecheck graph. A passing CI run is still required to establish whether it typechecks cleanly.
- A Node.js 20 GitHub Actions workflow was added at `.github/workflows/ci.yml` to run install, build/tests, typecheck, lint, and package dry-run. No completed status check is available yet, so it is not counted as a pass.
- `npm pack --dry-run` and inspection of the actual tarball contents remain required before publishing.
- Live Facebook login, MQTT broker acceptance, message operations, and E2EE interoperability are outside this static audit.

## Release gate

Do not publish or enable automatic installation based only on this audit. Before release:

1. Generate and commit `package-lock.json`.
2. Run `npm ci`, `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`, and `npm audit`.
3. Resolve or explicitly document all build, typecheck, lint, and audit findings.
4. Run `npm pack --dry-run` and inspect the package file list for secrets and missing runtime files.
5. Validate the published package in a clean Node.js 20+ project.

Automatic update/install remains disabled by default until the updater is constrained to this package and its official npm registry, version parsing is validated, install failure handling is tested, and restart/rollback behavior is defined.


## Task 1 — OmegA-FCA / GoatBot compatibility audit

**Audit date:** 2026-11-22  
**GoatBot integration:** the inspected `OmegA-Goatbot` main-branch manifest currently declares an external FCA dependency.

### Confirmed from source

- OmegA-FCA exposes classic callback login and Promise login, with the callback receiving the flat API object; the Promise form returns an FCA context.
- The source includes cookie/appstate login plumbing, cookie normalization, session backup encryption helpers, MQTT compatibility, and a namespaced client facade.
- The MQTT adapter wraps the legacy `listenMqtt` callback and forwards events/errors. It also runs a periodic fb_dtsg refresh interval; lifecycle/cleanup behavior still needs runtime tests.
- The checked-in tests cover package entrypoints, CJS/ESM exports, config defaults/migration, and cookie/appstate credential-file parsing. They do not establish Facebook authentication, broker connectivity, or end-to-end message delivery.
- The CI workflow is configured for Node 20 and runs install, `npm test`, typecheck, lint, and `npm pack --dry-run`. No completed passing workflow run was available during this audit.

### Compatibility gap register

| Capability | OmegA-FCA source audit | Result |
|---|---|---|
| Classic callback login | Present | Source-confirmed |
| Promise login/context | Present | Source-confirmed |
| Cookie / appstate input | Present | Source-confirmed |
| MQTT listen adapter | Present | Source-confirmed; runtime pending |
| Namespaced client facade | Present | Source-confirmed |
| Session guard / corruption recovery parity | No equivalent full guard confirmed | Gap |
| sendBroadcast parity | Not confirmed in exported API/source audit | Gap |
| Signal Protocol E2EE | No implementation confirmed in this repository tree | Gap |
| Group Sender Keys / SKDM | No implementation confirmed | Gap |
| Encrypted group messaging/media | No implementation confirmed | Gap |
| Native E2EE media engine | No equivalent native engine confirmed | Gap |

Feature parity must be established by OmegA-FCA implementation and tests, not by documentation aliases.

### Login route finding

The OmegA-FCA source has a separately exposed `loginViaAPI` helper. Its implementation delegates to `authCore.loginViaAPI`; source comments in the login-helper implementation describe a default external API base. The ordinary `login({ appState })` path is distinct. For the user's current cookie/appstate-based test path, the external API login helper is not required and must remain disabled by default.

### External package source limitation

The compatibility review is limited to OmegA-FCA and GoatBot source manifests; no external source-level method parity claim is made.

### Task 1 conclusion

Static repository and integration audit is complete. No runtime pass is claimed. The remaining work is implementation/testing of the listed parity gaps, followed by CI and authorized live tests. This document is the baseline for the next checklist task.
