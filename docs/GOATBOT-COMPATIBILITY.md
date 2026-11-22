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


## Task 11 — Listener recovery and stability

- getSeqIDWrapper now uses a per-context single-flight promise. Concurrent bootstrap calls share the same request; a pending retry timer is not cancelled by another caller.
- Retry timers are cleared on shutdown/teardown and are unref()'d where supported.
- Listener stop is idempotent: concurrent stop calls share one teardown and each supplied callback is completed once.
- MQTT client end now has a bounded cleanup timeout, so a missing end callback cannot leave teardown permanently pending.
- Forced cycling is skipped during another lifecycle transition and only schedules a reconnect after cleanup completes.
- Pending MQTT request tasks are rejected during teardown; /ls_resp consumes matching tasks before invoking callbacks, preventing duplicate callback delivery and stale map entries. Unknown/expired request IDs are ignored.
- Synthetic tests cover one-shot task response consumption and unknown request IDs. Authenticated live listener recovery still requires a real session runtime test.


## Task 12 — Message send/receive request lifecycle

- Hardened the shared MQTT `/ls_req` → `/ls_resp` acknowledgement helper used by message sending. It now validates request IDs and timeouts, matches only the corresponding response, handles Buffer/string payloads, and rejects on MQTT error/close/offline/end instead of waiting for a timeout.
- Publish exceptions and publish callback errors settle the request and remove every registered listener/timer. The timeout is installed before publish, avoiding a synchronous publish-error timer leak.
- Added synthetic tests for matching ACKs, cleanup, synchronous publish failures, connection loss and invalid timeout values. Existing send-message payload construction and receive-event dispatch remain wired through the legacy API and grouped `client.messages` namespace; authenticated Facebook send/receive still needs a live account test.


## Task 13 — Text, reply, unsend and edit

- Text sends now allocate monotonically increasing request and task IDs from the FCA context instead of using a small random request-ID range and fixed task IDs.
- Reply metadata is carried from either the legacy fourth `replyToMessage` argument or the structured payload's `replyToMessage` field into Messenger's `reply_metadata` structure.
- Added synthetic MQTT-ACK tests covering text body, thread routing, reply metadata, callback-once behavior, ID progression, and listener cleanup.
- The edit and unsend command paths remain exposed through the legacy API and grouped message domain; authenticated Facebook-side edit/unsend semantics still require a live session test.


## Task 14 — Media and file attachments

- Attachment upload command and HTTP transport are exported for direct integration/testing.
- Existing upload input normalization supports Buffer, readable streams, local file paths, HTTPS/HTTP URL downloads, data URLs, and descriptor objects containing buffer/data/stream/url/path plus filename/content type.
- Upload transport uses the active Facebook cookie jar, obtains/caches upload form tokens, posts multipart data to the Mercury upload endpoint, maps returned image/video/audio/file IDs and metadata, and detects checkpoint responses.
- Message send tests cover Buffer upload handoff, caption preservation, uploaded attachment ID serialization, and pre-uploaded attachment tuple handling without a redundant upload.
- Multi-file transport and authenticated Facebook upload/send still require a live account test; CI verifies the synthetic command contract only.


## Task 15 — Group and thread management

- Group creation now normalizes participant IDs, removes duplicates and the authenticated account itself, and requires at least two distinct other participants before issuing the GraphQL mutation.
- Add-member input IDs are normalized and deduplicated; invalid empty IDs are rejected.
- Remove-member, admin-role, title and quick-reaction/emoji MQTT mutations now use the request-ID-matched `/ls_resp` acknowledgement helper instead of treating a successful publish as a completed server mutation.
- These mutations allocate monotonically increasing request/task IDs from the FCA context; admin batches use a distinct task ID per member.
- Added synthetic tests for remove-member callback-once/ACK cleanup, admin batch IDs/ACK, title and emoji ACK, and group-creation participant validation.
- Group creation and other thread mutations still require an authenticated Facebook runtime test to verify current server-side GraphQL/MQTT protocol acceptance.


## Task 16 — User, friend and thread information

- User profile cache entries are now reused only while their database `updatedAt` is within a 10-minute freshness window; missing/invalid timestamps trigger a refresh. Empty and duplicate profile IDs are normalized before lookup.
- Typeahead user-ID lookup returns an empty list for blank names, validates the response shape, and skips records without a usable UID. Partial entries are normalized with stable defaults instead of throwing.
- Friend-list formatting skips malformed records without IDs and validates the payload container before mapping. Existing FCA output fields are retained.
- Thread-history pagination now validates thread ID, positive message count and integer/null cursor before transport. The GraphQL batch envelope and `message_thread.messages.nodes` are checked before parsing; optional mention/reaction structures are handled without failing the whole response.
- Shared thread-photo pagination validates offset/limit and safely handles missing nested photo detail structures.
- Added synthetic tests for friend/profile normalization, malformed thread-history response, empty history and invalid pagination.
- Facebook profile fields, thread history and shared photos still require authenticated live-session checks for current server response parity.

- Thread-info lookups now trim and deduplicate IDs, and return the legacy empty result (`null` for one ID, `{}` for a list) without making a network request when no usable ID is supplied.

## Task 17 — Facebook post, comment, share and read/delivery parity audit

- Audited the exported legacy API surface and the message/account command implementations for post creation, comments, link/contact sharing, reactions, read receipts and delivery receipts.
- `markAsRead`, `markAsReadAll`, `markAsSeen` and `markAsDelivered` are present on the legacy API and grouped message namespace. Read status uses the existing Mercury/page transport when selected, otherwise the Messenger realtime mark-thread transport; seen/delivered use the Mercury transport.
- Contact sharing is now request/response correlated: it allocates monotonic request/task IDs from the FCA context and waits for its matching `/ls_resp`, with timeout/error cleanup inherited from the shared acknowledgement helper. Blank contact/thread identifiers are rejected before publish.
- Added synthetic tests for the contact-share payload, request/task ID progression, matching ACK, listener cleanup and invalid identifiers.
- **Remaining parity gap:** the EryXen package API reference lists `shareLink`, `postComment`, `reactToComment`, `sharePost` and `reactToPost`; the current OmegA-FCA source does not implement or expose those methods. A `createPost` method is not listed in that reference. These social operations are not implemented or verified; no guessed Facebook mutation IDs or payloads were added. Therefore Task 17 is not fully complete until the listed operations are implemented against verified FCA-compatible transport contracts.
- CI verifies the local command contract only; real Facebook read/delivery/contact-share operations still require an authorized runtime test.

