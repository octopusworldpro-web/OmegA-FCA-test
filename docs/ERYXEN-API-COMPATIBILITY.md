# EryXen API Compatibility Audit

Audit date: 2026-11-22

## Scope and source of truth

This document compares the public API described by the current `@eryxenx/fca` npm README (version 1.3.5 as listed on the audit date) with the APIs exposed by this repository's uploaded `@dongdev/fca-unofficial` v4.0.2-derived source. EryXen is a reference for compatibility expectations only; it is not an implementation dependency or an update source.

This is a static API/documentation comparison. It does not establish that private Facebook endpoints still work, nor does it establish live login, MQTT, delivery, or E2EE interoperability.

## Security exclusion

Do not add `@eryxenx/fca` as a runtime or development dependency. Public advisories report credential-relay/malicious-code behavior in versions 1.3.0, 1.3.1 and 1.3.2. The package README currently describes version 1.3.5, but a newer version number is not a substitute for independently auditing the exact tarball and its transitive/install-time behavior. OmegA-FCA must keep credentials local and must not silently send passwords or 2FA seeds to an unrelated service.

## Compatibility matrix

| API area | EryXen README reference | OmegA-FCA source status | Action |
| --- | --- | --- | --- |
| Classic login | `login(credentials, options, callback)` | Present; `login` supports callback and Promise overloads | Keep signature and test callback error/success paths |
| AppState / Cookie login | `appState`, cookie-based session | Present in login input and cookie normalization helpers | Test with owner-authorized sessions |
| Email/password provider login | EryXen documents login and token-provider behavior | Source contains optional provider integration; disabled by default and requires explicit HTTPS provider configuration | Keep opt-in, document remote trust boundary; never add silent default provider |
| MQTT listener | `listenMqtt`, `autoReconnect` | MQTT listener and reconnect option exist in source | Compare event shapes, stop/reconnect lifecycle and duplicate subscription behavior |
| Messages | send, edit, delete/unsend, get, reaction, typing, read/delivered | Core legacy methods and namespaced `messages` facade are present in source | Add signature and callback behavior tests per method |
| Attachments | upload/forward and media helpers | Upload/forward helpers and request multipart support exist | Validate each media type with live authorized account tests |
| Threads / groups | info/list/history, create group, group membership/admin/title/color/emoji/nickname, polls, pins | Thread facade exposes many matching legacy names; exact parity for every EryXen method is not established | Build per-method inventory from the live API object and test argument order |
| Users | get ID/info/friends, profile/public data, friend/block actions | User facade currently maps get ID/info/infoV2/friends; other EryXen-described methods are not confirmed by the facade | Add explicit mappings only after verifying underlying implementation |
| Account/session | current UID, appstate, options, logout, refresh DTSG | Account facade maps current UID, appstate, cookies, options, logout, refresh DTSG | Session guard/backup API is a gap; do not claim parity |
| HTTP helpers | httpGet/httpPost/httpPostFormData | HTTP facade maps get/post/postFormData | Test callback/promise behavior and multipart handling |
| High-level bot | MessengerBot | `MessengerBot` and `createMessengerBot` are exported | Compare middleware, context and launch/stop semantics |
| Namespaced client | `createFcaClient` with messages/threads/users/account | `createFcaClient` and `attachClientFacade` exported; includes realtime/http/scheduler namespaces | Keep additive; test facade binding and missing-method behavior |
| sessionGuard | EryXen documents save/backup/restore/stop | Not implemented in uploaded source | Separate implementation and tests required |
| sendBroadcast | EryXen documents rate-limited broadcast | Not confirmed in current OmegA-FCA public exports/facade | Not compatible yet; implement separately if required |
| Humanizer | EryXen documents GoatBot command anti-spam humanizer | Not part of FCA source archive; GoatBot has its own bot-side wrapper | Keep in bot integration layer unless separately specified |
| E2EE / Signal Protocol | EryXen README describes E2EE and optional native media engine | No Signal Protocol session store, E2EE listener, Group Sender Keys/SKDM, encrypted messaging/media in current source | Explicitly unsupported; do not expose placeholder methods or claim compatibility |

## Confirmed OmegA-FCA public exports

The current `src/index.ts` exports:
- `login`, `loginAsync`, `loginLegacy`
- `loginViaAPI`, `tokensViaAPI`, cookie normalization and jar helpers
- config, request, MQTT, and auth helper constructors
- `createFcaClient`, `attachClientFacade`
- `MessengerBot`, `createMessengerBot`, `MessengerContext`
- messages, threads, realtime, users, account, HTTP and scheduler domain constructors
- public types

The callback login contract returns the flat legacy API object (same object as `ctx.api`); Promise login returns the context. This distinction must remain explicit in documentation and tests.

## Acceptance criteria before claiming GoatBot drop-in compatibility

1. Compare every method actually called by the target GoatBot branch against the runtime API object; do not infer compatibility from names alone.
2. Test callback login and Promise login using synthetic fixtures and an owner-authorized live session.
3. Verify listener event types and fields used by GoatBot commands.
4. Verify send, reply, unsend, edit, reaction, read/delivered, typing, attachment and group operations with exact argument order.
5. Verify reconnect, stop-listening, error callback and process shutdown behavior.
6. Implement and test any required `sessionGuard` contract independently.
7. Keep humanizer behavior in the bot layer unless a separate FCA API contract is approved.
8. Keep E2EE disabled/unavailable until a real Signal Protocol implementation, secure persistent key store, group key distribution, encrypted media path and interoperability tests exist.

## References

- `@eryxenx/fca` npm README and API reference: https://www.npmjs.com/package/@eryxenx/fca
- OpenAdvisories report MAL-2026-20276: https://www.openadvisories.org/malware/MAL-2026-20276
- OSV advisory: https://osv.dev/vulnerability/MAL-2026-20276
- OmegA-FCA exports: `src/index.ts`
- OmegA-FCA facade mapping: `src/app/create-client.ts` and `src/compat/api-registry.ts`


## 2026-11-22 cross-repository verification

### EryXen package identity and security decision

- npm package: `@eryxenx/fca`.
- npm search metadata surfaced version `1.3.5`; the package page's indexed README describes the NEXCA MQTT, Signal Protocol E2EE, `sessionGuard`, `sendBroadcast`, and 90+ method feature set.
- The package metadata identifies `EryXenX/fca-eryxenx` as its GitHub repository. That repository could not be read through the connected GitHub account during this audit, so the published source tree and exact tarball contents were not independently verified.
- OSV/OpenSSF advisory `MAL-2026-20276` reports malicious credential-relay code in published versions `1.3.0`, `1.3.1`, and `1.3.2`: the affected login flow sends the supplied Facebook email, password, and long-lived TOTP seed to `minhdong.site`. A separate package-risk index also flags `1.3.5`, while the primary OSV record names only `1.3.0–1.3.2`. This discrepancy means version-number-based trust is unsafe.
- **Decision:** do not install, execute, vendor, or add this package to OmegA-FCA's dependency tree. Use its public API documentation only as a compatibility checklist. Independently implement the required behavior using local credentials/session handling and inspect every source/dependency before adoption.

### OmegA-Goatbot main branch

Repository verified: `nirzon-islam/OmegA-Goatbot`, default branch `main`.

Its `package.json` confirms:
- package name `goatbot-pro`, version `7.1.5`;
- Node engine `20.x`;
- dependency `@eryxenx/fca: ^1.3.4`.

The OmegA-FCA target is therefore the existing GoatBot FCA contract, not the EryXen package's internal implementation or private endpoints. Keep the bot's current login/event lifecycle and replace only after acceptance tests pass. The GoatBot repository README in the OmegA-FCA audit identifies its custom humanizer as a bot-side wrapper; do not assume an FCA `humanize` option is required.

### OmegA-FCA source structure inspected

The following files were read from `octopusworldpro-web/OmegA-FCA-test@main`:
- `package.json`: `@nirzon-islam/omega-fca@0.2.0`, Node >=20, TypeScript/tsup CJS+ESM build, build/typecheck/test/lint scripts.
- `src/index.ts`: exports classic and Promise login, cookie helpers, MQTT, config/request/auth helpers, encrypted session-backup crypto, client facade, MessengerBot, domain constructors and types.
- `src/app/create-client.ts`: creates additive namespaces for messages, threads, users, account, realtime, HTTP and scheduler; methods are bound to the legacy API object.
- `src/compat/api-registry.ts`: attaches the client facade and only fills namespace properties when absent.

The current facade is a compatibility layer, not proof that every underlying method exists or works. Optional methods are omitted; live-bound methods throw when the legacy API method is missing. This must be covered by method-by-method tests.

### Task 1 audit conclusion

Static source and contract review is complete for the available OmegA-FCA files and GoatBot `main` manifest. EryXen's public API documentation has been inventoried, but its full repository/tarball could not be independently inspected; this is recorded as an explicit limitation, not treated as a successful source audit. The package is excluded for security reasons. No dependency was added and no credentials or live Facebook session were used.


## Task 2 — Login callback and Promise bridge

- `login(credentials, callback)` uses the classic FCA callback shape and returns no Promise.
- `login(credentials, options, callback)` applies supplied options and uses the same flat API callback result.
- `login(credentials, options?)` returns a Promise resolving to the OmegA-FCA context.
- `loginAsync(credentials, options?)` is the explicit Promise/context entry point.
- `loginLegacy` remains available for callers that expect a callback with the context object.
- CommonJS package root and `dist/cjs.cjs` expose callable default login plus named properties; ESM exposes default login and named exports.

**Fix in Task 2:** callback handlers previously used `.then(success).catch(failure)`. If user callback code threw, that exception could be mistaken for a login failure and invoke the callback a second time. The bridge now uses the Promise `.then(success, failure)` rejection branch, so callback exceptions are not fed back into the same callback as a second invocation.

**Validation boundary:** package export-shape tests and CI validate CJS/ESM entrypoints, build, typecheck and lint. Live success/failure login callback behavior still requires a controlled authenticated integration test; it is not claimed as live-verified here.
