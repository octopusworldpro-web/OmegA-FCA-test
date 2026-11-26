# Architecture

**Checked baseline:** `@nirzon-islam/omega-fca@0.2.3-beta.3`, branch `feature/release-0.2.3-beta.3`.

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

## E2EE boundary

The current E2EE source is an opt-in set of components. The FCA login path can initialize the pinned libsignal runtime and account-scoped local key store after authenticated UID validation; initialization is fail-open for ordinary FCA login. Local direct-message primitives and peer/bundle interfaces exist, but they are not yet connected to Facebook peer discovery or Messenger MQTT encrypted envelopes.

`device-registration.ts` implements an ICDC registration helper, but the current login lifecycle does not yet invoke it. The four-step status and acceptance criteria are maintained only in [E2EE-ROADMAP.md](E2EE-ROADMAP.md) and [E2EE-STATUS.md](E2EE-STATUS.md).

## Tests

The repository's test scripts are local Node.js tests. E2EE tests use controlled dependencies/mocks; they verify local contracts, serialization, and helper behavior. They do not constitute a live Facebook or Messenger acceptance test.

Run:

```bash
npm ci
npm test
npm run lint
npm run typecheck
```

The exact commands available are defined in the root `package.json`. CI status must be checked independently for the commit being reviewed.
