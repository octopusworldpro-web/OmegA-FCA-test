# Architecture

**Checked package:** `@nirzon-islam/omega-fca@0.2.3-beta.3`  
**Checked branch:** `feature/release-0.2.3-beta.3`

## Runtime path

1. `src/index.ts` exposes the package entry points.
2. `src/core/auth.ts`, `src/core/auth-helpers.ts`, and `src/utils/loginParser/` normalize and validate login input.
3. `src/core/login-helper.impl.ts` assembles the authenticated context, API facade, legacy methods, and realtime integration.
4. `src/app/attach-legacy-api.ts` attaches FCA-style methods to the API object.
5. `src/domains/*` implements account, message, thread, user, realtime, and E2EE domain operations.
6. `src/transport/http/` and `src/transport/realtime/` contain HTTP/GraphQL and MQTT transport code.
7. `src/compat/` provides callback/Promise compatibility helpers.
8. `src/session/` and `src/core/session-guard.ts` contain session persistence/guard support.

## Realtime

`src/domains/realtime/listener.ts` owns MQTT listener lifecycle, reconnect behavior, checkpoint detection, and middleware dispatch. `src/domains/realtime/humanizer.ts` is a middleware controller: it can identify command events, apply per-thread/global limits, queue delays, and request a typing indicator while waiting.

The humanizer source default is **disabled** (`enabled: false`). A bot integration must explicitly enable it and supply appropriate command-detection options. It is not automatically active merely because the package is installed.

## E2EE architecture and integration boundary

E2EE is opt-in and has distinct local-engine, Facebook registration, prekey publication, messaging, and media layers.

- **Local engine:** `src/domains/e2ee/bootstrap.ts` provisions account-scoped storage metadata and loads the pinned libsignal package. `runtime.ts` creates/reuses local Signal identity and prekey material; `signal-key-store.ts` persists encrypted Signal state.
- **FCA login hook:** `src/core/login-helper.impl.ts` calls `initializeE2EEForLogin` only after authenticated UID validation and normal FCA/MQTT setup. It passes the current cookie header and user agent. E2EE errors are fail-open and do not fail ordinary FCA login.
- **ICDC registration:** when `e2ee.facebook.appId` and `e2ee.facebook.fbCat` are configured, `login-integration.ts` calls the ICDC registration helper using the authenticated session. This is conditional helper invocation; mocked tests do not prove that Facebook accepts the request.
- **Prekey publication:** when `e2ee.facebook.sendIQ` is supplied, the login integration calls the WA-binary prekey publisher. That callback must use an already-authenticated Messenger Noise IQ socket. The FCA login helper does not construct this transport, and the ordinary MQTT JSON client is not compatible.
- **Messaging:** direct Signal primitives and group Sender Key/SKDM orchestration exist behind transport-neutral/injected interfaces. They are not yet connected to native Messenger peer discovery, bundle exchange, or MQTT encrypted envelopes.
- **Media:** local direct/group media crypto helpers and application-level orchestration exist. Native Facebook media upload/download integration is not established.

The runtime can create local Kyber/PQ material when libsignal KEM support exists. No verified Messenger Kyber upload format is implemented; local generation must not be described as server publication.

The canonical scope, status, and acceptance criteria are maintained in [E2EE-ROADMAP.md](E2EE-ROADMAP.md) and [E2EE-STATUS.md](E2EE-STATUS.md). The former auto-integration plan is retired.

## Tests and validation

The repository's tests are local Node.js tests. E2EE tests use controlled dependencies and mocks where applicable; they verify local contracts, serialization, persistence, and helper behavior. In particular, a mocked ICDC fetch or simulated IQ acknowledgement does not constitute a live Facebook/Messenger acceptance test.

Run:

```bash
npm ci
npm test
npm run lint
npm run typecheck
```

The exact commands are defined in the root `package.json`. CI status must be checked independently for the exact commit under review. A successful build, test suite, or CI run does not prove native Messenger E2EE interoperability.
