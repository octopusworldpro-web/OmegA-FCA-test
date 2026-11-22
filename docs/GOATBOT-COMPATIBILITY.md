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


## GoatBot login and recovery compatibility

The current GoatBot main login flow depends on the following FCA contract:

- Callback login: `login({ appState }, options, callback)` returns the flat legacy API as the callback's second argument.
- Account identity and session access: `getCurrentUserID()`, `getAppState()`, and `getCookies()` are available on the legacy API.
- Session persistence: `sessionGuard(accountFilePath, { interval, debounce })` and `stopSessionGuard()` support the existing periodic AppState save and account-switch lifecycle.
- Listener readiness and recovery: `listenMqtt(callback)` returns a listener handle; `stopListening()` and `stopListeningAsync()` can stop it. The listener callback accepts both the classic two-argument `(error, event)` form and the one-argument event form used by readiness notifications.
- The test suite now verifies the callback-compatible API's session getters, database backup accessors, and EventEmitter methods used by the GoatBot login/recovery path.

This is a synthetic API-contract check; an actual account login, MQTT-ready transition, account replacement and rollback still require an authorized runtime test in the GoatBot deployment.


## Native HTTP transport and cookie management

- Response `Set-Cookie` persistence accepts both single and multi-value headers, resolves relative request URLs against `baseURL`, and isolates malformed cookie failures so one bad cookie does not discard the rest of the response.
- AppState collection queries the supported Facebook web/mobile host variants and deduplicates cookies by name, domain and path, preserving host-scoped cookies.
- HTTP 4xx/5xx responses now enter the request retry handler instead of being treated as successful Axios responses. The retry policy can retry 429 and transient 5xx/network failures while returning ordinary non-retryable 4xx responses to legacy callers.
- Added synthetic tests for Set-Cookie handling, relative URL resolution, multi-host AppState collection, deduplication, and 429 retry behavior.
- These tests validate the local transport contract; authenticated Facebook requests and proxy behavior still require authorized runtime testing.


## Task 8 — MQTT connection and WebSocket handshake

- MQTT transport continues to use the Facebook Messenger WebSocket endpoint with MQTT 3.1 (`MQIsdp`, protocol version 3), clean sessions, 30-second keepalive, and a bounded 12-second connection timeout.
- The WebSocket URL builder now parses the server-provided endpoint, preserves existing query parameters, replaces `sid`/`cid` without duplicate parameters, removes fragments, and normalizes HTTPS endpoints to WSS.
- Server-provided endpoints are accepted only for Facebook-owned hostnames and secure `https:`/`wss:` schemes. Invalid or non-Facebook endpoints fail before session cookies are attached to a WebSocket request.
- The HTTP `Host` handshake header is derived from the actual validated endpoint rather than being hard-coded to `edge-chat.facebook.com`.
- Synthetic tests cover endpoint normalization, regional fallback, existing query preservation, duplicate parameter replacement, host derivation, and rejection of untrusted/insecure endpoints.
- This validates local URL/handshake construction. A live Facebook MQTT CONNACK and authenticated socket handshake still need an authorized account runtime test.


## Task 9 — MQTT subscriptions and event sync

- The MQTT listener now validates the SUBACK grant for every required Messenger topic and rejects missing/rejected QoS grants instead of assuming a successful subscribe callback.
- Initial sync queue creation vs. diff resumption is normalized and tested, including `entity_fbid`, JSON encoding, sequence ID, sync token, and expected topic selection.
- The initial queue, foreground state, and client settings are published sequentially only after successful subscriptions; each publish acknowledgement is checked and failures trigger reconnect or a stop event.
- `/t_ms` sequence IDs are accepted only as non-negative safe integers; invalid values cannot poison the stored sequence state. Valid sync tokens and sequence updates are retained, and malformed delta collections are ignored.
- `/ls_resp` accepts JSON text or an already-decoded object and ignores invalid payload shapes.
- Synthetic protocol tests cover complete/rejected SUBACKs, fresh/resumed sync queues, and valid/invalid sequence state. Live Facebook subscription grants and event delivery still require authorized runtime verification.


## Task 10 — Reconnect, retry, jitter and readiness

- MQTT reconnect scheduling now checks stop/ending state and an existing timer before incrementing the attempt counter, so duplicate close/error/disconnect notifications cannot inflate backoff attempts.
- Reconnect delay uses bounded exponential backoff with jitter and a strict configured maximum, including the jitter component. The default remains 30 seconds.
- Sequence-ID bootstrap failures use the same bounded exponential retry policy, retain their own attempt counter, avoid duplicate retry timers, and reset the counter after successful bootstrap. Stop/shutdown clears the retry timer and counter.
- MQTT reconnect attempts are reset only after the `/t_ms` sync-ready response; a raw WebSocket/MQTT connect does not count as ready.
- Synthetic tests cover exponential growth, jitter bounds, strict maximum cap, and existing stop-cancels-reconnect behavior. Actual broker outages, `/t_ms` readiness and reconnect recovery still require authorized live-session verification.
