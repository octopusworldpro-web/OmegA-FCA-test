# GoatBot compatibility — OmegA-FCA 0.2.0

Target bot: [nirzon-islam/OmegA-Goatbot](https://github.com/nirzon-islam/OmegA-Goatbot), branch `main`.

## Confirmed from source inspection

The bot's current login path calls the FCA package in classic callback form:

```js
login(credentials, options, (error, api) => { /* ... */ });
```

The uploaded OmegA-FCA source exports that callback shape and provides these core methods used by the bot's login/listener path:

- `getCurrentUserID()`
- `listenMqtt(callback)`
- `stopListening(callback)`
- `getAppState()`
- `getCookies()`
- `sendMessage()`
- `setMessageReaction()`
- `unsendMessage()`
- `getThreadInfo()`
- `getUserInfo()`

The GoatBot login module also uses local humanizer wrapping around the listener. Its custom `humanize` login option is not part of OmegA-FCA's declared `FcaOptions`; the bot's own `applyHumanizerToApi()` wrapper must remain in place.

## Known blockers — do not switch the production dependency yet

| GoatBot requirement | OmegA-FCA source status |
|---|---|
| Classic callback login | Present; needs runtime regression test |
| AppState/Cookie login | Present; needs authorized live test |
| MQTT listener start/stop | Present; needs authorized live test |
| Common message/thread/user methods | Present in legacy API surface; test each signature |
| GoatBot humanizer | Bot-side wrapper exists; FCA option itself is not implemented |
| `sessionGuard()` / `stopSessionGuard()` | Implemented on the legacy API; account-bound atomic AppState saver with periodic writes and stop handle; requires live runtime validation |
| `api.e2ee` / Signal Protocol | Not present in uploaded source |
| Group E2EE / SKDM | Not present in uploaded source |
| `autoMarkDelivery` option | Not declared in uploaded `FcaOptions`; verify behavior before enabling |

## Integration acceptance checklist

- [ ] Install OmegA-FCA from a reproducible package source.
- [ ] Confirm CommonJS `require()` returns a callable login function.
- [ ] Run GoatBot's existing secure-session tests.
- [ ] Verify callback login receives a valid API object.
- [ ] Verify `getCurrentUserID()`, `getAppState()`, and `getCookies()` without logging secrets.
- [ ] Verify listener start, callback event shape, stop, and restart behavior.
- [ ] Verify message send, reaction, unsend, thread info, and user info signatures with an authorized test account.
- [ ] Keep sessionGuard and E2EE-dependent bot behavior disabled until equivalent implementations and tests exist.
- [ ] Run the bot's full test suite and Railway deployment test before changing its production dependency.

A source-level method match is not a live Facebook acceptance result. Do not mark the bot integration complete until every applicable item above passes.


## Task 4 — Account identity, session validation & SessionGuard

- Added `api.sessionGuard(accountFilePath, { interval, debounce })` and `api.stopSessionGuard()` to the legacy FCA API.
- The guard snapshots the active account's AppState periodically, checks that `c_user` matches the authenticated UID and that `xs` exists, limits cookie count and payload size, and accepts Facebook cookie domains only.
- Writes use a same-directory temporary file, restrictive `0600` permissions, fsync, and atomic rename. A rejected/mismatched snapshot leaves the previous account file untouched.
- The guard defaults to a 3-minute interval and a 30-second initial debounce; the caller can stop it during account switching or shutdown.
- Synthetic tests cover identity matching, atomic write, file permissions, and preserving the prior file when the UID does not match. Live Facebook rotation/refresh behavior remains to be validated with an authorized account.


## Task 5 — MQTT connection and listener lifecycle

- Fixed legacy API stop methods so `api.stopListening()` and `api.stopListeningAsync()` work when called through the API object or grouped realtime namespace; they no longer depend on an emitter-bound `this` value.
- Pending delayed reconnects are now tracked and cancelled by an explicit stop. A queued reconnect checks the stop state before requesting a new sequence ID.
- Preserved the configured `reconnectAfterStop` behavior: when enabled, an intentional stop can schedule a delayed reconnect; a subsequent stop cancels that pending reconnect.
- Added a deterministic lifecycle test that invokes the actual realtime listener, calls the legacy stop methods through the API object, and verifies that a queued reconnect is cancelled.
- GitHub Actions passed build/tests, TypeScript, lint, and package dry-run. Live Facebook MQTT reconnect behavior still requires a real authorized session to verify against the service.


## Task 6 — MQTT event handling and error recovery

- Added bounded exponential reconnect backoff with jitter. The attempt counter is reset only after the Messenger sync-ready signal (/t_ms), not merely when the WebSocket connects; the default maximum delay is 30 seconds and can be overridden with `maxReconnectDelayMs`.
- Reconnect scheduling and callback activity now respect an explicit stop request, preventing stale clients from reconnecting after shutdown.
- MQTT message frames are decoded through a safe JSON-object parser. Malformed JSON, arrays, primitives, and null frames are ignored with a warning rather than being processed as empty events.
- When the connection closes or disconnects while auto-reconnect is disabled, the listener receives a `stop_listen` event with a useful reason.
- Added deterministic tests for backoff growth/cap/jitter and valid/invalid payload decoding. CI passed build/tests, TypeScript, lint, and package dry-run.
- Live broker reconnect and real Messenger event-shape behavior still require authorized runtime validation.
