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
- `tsconfig.typecheck.json` explicitly excludes `src/core/login-helper.impl.ts`; therefore a passing typecheck would not cover that file. The exclusion needs a separate remediation plan rather than being treated as full type safety.
- No CI workflow was found at `.github/workflows/ci.yml` during this audit.
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
