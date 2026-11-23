# GoatBot compatibility — OmegA-FCA 0.2.1-beta.1

Target bot: [nirzon-islam/OmegA-Goatbot](https://github.com/nirzon-islam/OmegA-Goatbot), branch `fca-migration-cleanup`.

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
- Implemented `shareLink` as an URL-bearing Messenger send through the existing message sender; `reactToPost` is exposed as an alias of the existing `setPostReaction` GraphQL command.
- Added `postComment`, `reactToComment` and `sharePost` GraphQL commands using the Comet mutation contracts documented by public request examples. Comment creation uses `useCometUFICreateCommentMutation` (`33964973576450400`); comment reaction uses `CometUFIFeedbackReactMutation` (`7616998081714004`); post sharing uses `ComposerStoryCreateMutation` (`26264075519853494`). These identifiers/payloads are version-sensitive community-observed contracts, not official stable APIs.
- Exposed the methods on the legacy API and `createFcaClient` message/account namespaces. Added synthetic tests for mutation IDs, payload fields, ID normalization, reaction mapping, URL validation, and sender delegation.
- `createPost` is outside this task's compatibility target.
- **Validation boundary:** CI verifies local request construction, callback/Promise plumbing and API exposure. Live Facebook acceptance of these private GraphQL mutations, share previews and read/delivery receipts remains unverified.

## Task 18 — Incoming media, quoted replies and GoatBot message API

- Added a shared incoming-attachment normalizer for MQTT delta attachments and GraphQL getMessage results. It accepts Mercury JSON strings, Mercury-wrapped attachments and GraphQL blob_attachment records.
- Normalized photo, video, audio, file, sticker, animated-image and extensible/share attachments through the existing legacy formatter. If optional or malformed media metadata prevents full formatting, the event retains a safe unknown attachment record with available ID/URL/filename and a diagnostic string instead of dropping the entire incoming message.
- Incoming NewMessage events retain the legacy message fields: type, senderID, threadID, messageID, body, args, attachments, mentions, timestamp, isGroup, participantIDs and isUnread. A quoted message is exposed as event.messageReply and the event type is message_reply.
- MQTT deltaMessageReply now uses the same quoted-message formatter for both the replying message and its quoted parent. If the inline quoted object is missing its thread metadata, the existing GraphQL forced-fetch path remains available; fetched blob attachments also use the resilient normalizer.
- getMessage(threadID, messageID) now returns the same message/reply structure with normalized media, args, mention maps, participant IDs and messageReply.
- GoatBot compatibility is covered through the raw getMessage API and client.messages.get, client.messages.uploadAttachment and client.messages.forwardAttachment facade mappings. Synthetic tests cover incoming photo/video/audio/file media, malformed Mercury JSON, mentions, participants, quote metadata and GoatBot reply event fields.
- **Validation boundary:** build, tests, TypeScript, lint and package dry-run validate local parsing and API shape. Real Facebook attachment payload variations, CDN URL resolution, forced-fetch reply lookup and end-to-end GoatBot command handling still require an authorized live session.


## Task 19 — Signal key material and session persistence

- Added an account-bound Signal key store for identity key pairs, registration IDs, signed prekeys, one-time prekeys, serialized per-device sessions and trusted remote identities.
- Key/session records are opaque base64-encoded bytes. This layer does not generate Signal keys, implement X3DH/Double Ratchet, or claim Messenger interoperability; those cryptographic operations must be supplied by a compatible Signal Protocol implementation.
- The local store is encrypted with AES-256-GCM. A caller-provided secret of at least 32 bytes is key-derived with scrypt; each save uses a fresh salt and nonce. Files are written with restrictive permissions and same-directory atomic rename.
- Store state is bound to the configured account ID. Opening it for another account or with the wrong secret fails closed. One-time prekeys, sessions and trusted identities have explicit store/load/remove operations.
- Added tests for persistence/reopen, encrypted-at-rest output, account isolation, wrong-key rejection, prekey removal, session removal and trust identity updates.
- The Signal library currently published by Signal is `@signalapp/libsignal-client`; it is an official-client library whose APIs are subject to change and whose upstream project explicitly says use outside Signal is unsupported. OmegA-FCA has not yet integrated or validated its Node bindings against Messenger's private provisioning and device protocol.
- **Validation boundary:** this task delivers encrypted key/session storage only. Signal key generation, prekey bundle exchange, session establishment, encrypt/decrypt interoperability, device sync and Facebook live acceptance remain open for later E2EE tasks.


### Task 19 protocol adapter update

- Added `createLibsignalStores(signal, store)`, implementing the current official TypeScript libsignal abstract stores: SessionStore, IdentityKeyStore, PreKeyStore, SignedPreKeyStore and KyberPreKeyStore.
- Added `ensureSignalIdentity`, `createSignalSignedPreKey`, `createSignalPreKey` and `createSignalKyberPreKey`. All cryptographic key generation and signatures are delegated to the injected libsignal implementation; OmegA-FCA does not implement Signal primitives itself.
- Session records and prekey records are persisted as libsignal-serialized bytes inside the encrypted account store. Kyber prekey usage records include signed-prekey ID and base key to detect reuse.
- The libsignal package is deliberately not bundled as a mandatory dependency: the official npm package is AGPL-3.0-only and Signal documents that use outside official Signal clients is unsupported. Applications must review the license and explicitly install/inject a compatible version.
- This adapter provides the local protocol state and native libsignal store boundary. Messenger-specific device discovery, key-bundle retrieval/publication, provisioning, sealed-sender certificates and message envelope transport remain outside this task and are required before Facebook E2EE interoperability can be claimed.


## Task 20 — Encrypted direct messages

- Added a 1:1 direct-message protocol layer on top of the injected official libsignal implementation and Task 19 encrypted stores. It exposes outgoing session establishment from a native PreKeyBundle, direct-message encryption, and direct-message decryption.
- Session operations are scoped to the remote account/device ProtocolAddress and local account/device ProtocolAddress. Encryption returns the native libsignal ciphertext type plus base64 serialized body for transport; plaintext is accepted as UTF-8 text or bytes.
- Inbound PreKeySignalMessage uses libsignal's prekey decrypt path with the persisted EC, signed and Kyber prekey stores; regular Whisper messages use the established Double Ratchet session decrypt path. Unsupported ciphertext types are rejected rather than mis-decoded.
- Added deterministic injected-module tests for session setup, encryption, first-message prekey decryption, subsequent whisper decryption, address routing and invalid message types. No crypto primitives are reimplemented in OmegA-FCA.
- **Validation boundary:** This is the Signal 1:1 protocol engine boundary, not yet a Messenger-ready feature. Messenger-specific device discovery, remote bundle fetch/parse, key publication, sealed-sender certificates, Facebook envelope serialization/routing and actual E2EE thread acceptance remain unverified and must be completed in subsequent integration work. The official libsignal project states external use is unsupported and its APIs may change; consumers must explicitly provide a compatible module and review its AGPL-3.0-only license.


## Task 21 — Encrypted direct-message media

- Added binary media encryption using a fresh random 64-byte attachment key per file. The media body is encrypted locally with AES-256-CBC; HMAC-SHA256 (truncated to 10 bytes) authenticates IV and ciphertext, and SHA-256 digest plus size metadata detect corruption.
- The attachment key is never uploaded in plaintext: it is wrapped as a Signal 1:1 direct message through the Task 20 session. The upload helper sends only the ciphertext as an opaque application/octet-stream payload and returns transport metadata separately from the encrypted descriptor.
- Decryption unwraps the key through the peer Signal session, validates dimensions and digest, verifies the MAC using timing-safe comparison, then decrypts the bytes and checks the resulting size.
- Tests cover ciphertext/key separation, round-trip binary content, digest tampering, MAC tampering, and upload callback receiving ciphertext only.
- **Validation boundary:** this is a local encrypted-media primitive and upload adapter, not yet Facebook Messenger E2EE media interoperability. Messenger-specific attachment CDN upload, encrypted attachment descriptor fields, key/digest placement, envelope serialization and recipient retrieval remain private/version-sensitive and require live account acceptance. The helper deliberately accepts an upload callback rather than pretending ordinary FCA upload is Messenger E2EE transport.


## Task 22 — E2EE actions and encrypted mark-as-read

- Added `createSignalE2EEActions` with encrypted 1:1 read-receipt application actions carried inside the Task 20 Signal direct-message ciphertext envelope.
- A read receipt contains a versioned action kind, thread ID, deduplicated message IDs and read timestamp. Inputs are validated and capped at 500 message IDs; decoded payloads are validated before being returned to application code.
- The action helper calls only the injected Signal encrypt/decrypt operations. It does not call legacy `markAsRead`, `markAsReadAll`, `markAsSeen` or publish the ordinary `/mark_thread` read status. Existing normal read-receipt behavior is unchanged.
- Exported the helper and public types from the package root. Synthetic tests cover encrypted envelope handoff, deduplication, payload validation and malformed payload rejection.
- **Validation boundary:** this is an encrypted application-level read-receipt action over an established 1:1 Signal session. It is not evidence that Messenger's private E2EE receipt/action wire format is compatible. Messenger device routing, remote receipt semantics, delivery/seen action parity and live Facebook acceptance still require authorized runtime validation; group E2EE actions are addressed by later group tasks.


## Task 23 — Group Sender Keys and SKDM

- Extended the encrypted account-bound Signal store with per-group/per-sender SenderKeyRecord persistence. Sender-key records are stored inside the existing AES-256-GCM encrypted envelope and support load/remove across restarts.
- Added an optional libsignal SenderKeyStore adapter without making existing direct-message store construction depend on group support.
- Added `createSignalSenderKeyGroups`: generate a Sender Key Distribution Message (SKDM), process a peer's distribution, encrypt group payloads with the sender-key cipher and decrypt received sender-key messages.
- Sender identity is scoped by group ID plus the sender's Signal ProtocolAddress/device ID. Distribution and ciphertext payloads carry the group ID and sender address for routing; malformed base64 and missing group/sender fields are rejected.
- Tests cover SKDM creation/processing, group encrypt/decrypt, invalid inputs and encrypted persistence/reopen/removal of sender-key records.
- **Validation boundary:** this is the libsignal Sender Keys protocol layer and local persistence, not Messenger's full group-device fanout. Messenger-specific distribution fanout to every device, membership/epoch changes, sender-key rotation/revocation, SKDM envelope transport and live Facebook group E2EE acceptance remain unverified and require authorized runtime integration.


## Task 24 — Encrypted group messaging and media

- Group text/binary payload encryption and decryption use the Task 23 libsignal Sender Keys group cipher; each payload is scoped to a group ID and sender device. SKDM distribution must be processed before decrypting messages from a sender.
- Added `createSignalEncryptedGroupMedia`. Each attachment receives a fresh random 64-byte key; media bytes are encrypted locally with AES-256-CBC and authenticated with truncated HMAC-SHA256 plus a SHA-256 ciphertext digest. The attachment key is wrapped inside a Sender Keys group ciphertext.
- The upload helper sends only encrypted bytes as `application/octet-stream`, using an `.enc` filename, and returns the group-safe descriptor separately. Decryption validates group/sender routing, dimensions, digest and MAC before returning plaintext.
- Tests cover group key wrapping, media round-trip, upload ciphertext isolation, routing mismatch and tampering.
- **Validation boundary:** this is a reusable Signal Sender Keys and encrypted-media layer. It does not claim Messenger-compatible private E2EE group envelope or media CDN interoperability. Per-device SKDM fanout, group membership/epoch lifecycle, Messenger's attachment metadata and transport, and live Facebook group E2EE acceptance remain unverified.


## API parity verification — Step 1

Repository references used for this audit:

- OmegA-FCA: `octopusworldpro-web/OmegA-FCA-test`, branch `main`.
- GoatBot: `nirzon-islam/OmegA-Goatbot`, branch `fca-migration-cleanup`.
- GoatBot installs `@nirzon-islam/omega-fca@0.2.1-beta.1` and its provider requires a callable CommonJS login export.

The legacy API surface attached by `attachLegacyApiSurface()` includes the following compatibility groups:

- Login/account: current user ID, AppState/cookie access, options, logout, profile/account actions, session guard and stop.
- Realtime: `listenMqtt`, listener stop methods, humanizer and middleware controls.
- Messages: send, edit, delete, unsend, reactions, typing, mark-read/seen/delivered, attachment upload/forward and media shortcuts.
- Threads: list/info/history/pictures, group creation and membership/admin actions, title/color/emoji/nickname, archive/mute/delete, polls and search.
- Users: ID lookup, profile lookup (including V2) and friends list.
- HTTP/scheduler: HTTP get/post/form-data and scheduler facade.

The namespace facade maps the flat FCA names into `client.messages`, `client.threads`, `client.users`, `client.account`, `client.realtime` and `client.http`. The parity test now checks the mapped methods and representative calls against a GoatBot-style flat API mock.

### Step 1 result

- [x] Confirm package name/version and CommonJS callable-export contract from both repositories.
- [x] Confirm the GoatBot branch used for this migration.
- [x] Expand synthetic legacy-to-namespaced API parity coverage.
- [ ] Execute the expanded test suite and CI on GitHub Actions.
- [ ] Validate actual Facebook API acceptance with an authorized live session.

A passing synthetic parity test proves only local method mapping and call forwarding. It does not prove private Facebook endpoints or live MQTT/message operations. Do not treat this step as fully complete until the test/CI checks above are green.


## Step 2 — Message delivery and read receipts

Implemented in the FCA package:

- `autoMarkDelivery` is a new opt-in login option and defaults to `false`.
- Existing `autoMarkRead` is now wired to incoming MQTT `NewMessage` events; it remains opt-in and defaults to `false`.
- When enabled, standard Messenger delivery acknowledgement calls `markAsDelivered(threadID, messageID)`.
- When enabled, standard Messenger read acknowledgement calls `markAsRead(threadID, true)`.
- Receipt dispatch is best-effort: it does not block incoming event delivery, and failures are logged as warnings.
- Synthetic tests cover enabled/disabled behavior, missing identifiers, and transport failures.

Example:

```js
login(credentials, {
  autoMarkDelivery: true,
  autoMarkRead: true
}, callback);
```

**E2EE distinction:** these are standard Messenger receipts. The existing Signal read-receipt payload helper is not yet connected to the authenticated E2EE session or MQTT transport. Encrypted E2EE read receipts remain pending for the E2EE integration/action steps and are not claimed complete here.

Validation status: source and test changes committed; GitHub Actions/local test execution still pending. Live Facebook receipt behavior has not been verified.


## Step 3 — Opt-in E2EE core runtime

- Added `createSignalE2EERuntime` to assemble the encrypted account-bound key store, libsignal store adapters, identity initialization, signed-prekey persistence, direct-message operations, encrypted action helpers and group Sender Keys operations.
- Login accepts an explicit `e2ee` option. When `enabled: true`, a verified account UID, encrypted-store path, 32-byte-minimum secret, positive local Signal device ID and caller-supplied compatible libsignal module are required. The runtime is attached as both `ctx.e2ee` and `api.e2ee`.
- E2EE remains disabled by default. Existing FCA login behavior is unchanged unless explicitly enabled. If opted-in initialization fails, login reports the E2EE initialization error rather than silently presenting an uninitialized E2EE API.
- `api.e2ee.close()` closes the encrypted key store. The runtime initializes local Signal state only; it does not register a Facebook device, fetch/publish Messenger prekey bundles, route Messenger E2EE envelopes, or claim live Messenger interoperability.
- The libsignal module is injected by the application; no mandatory dependency or license choice is imposed by OmegA-FCA. Consumers must review the chosen implementation's license and platform support.

Example:

```js
const ctx = await login(credentials, {
  e2ee: {
    enabled: true,
    storagePath: "./private-data/account.signal",
    encryptionKey: process.env.OMEGA_SIGNAL_STORE_KEY,
    localDeviceId: 1,
    signalModule: require("@signalapp/libsignal-client")
  }
});
const api = ctx.api;
await api.e2ee.close();
```

Use a unique secret per deployment/account, keep the store file and secret out of Git, and provision the local device ID according to the selected Messenger registration flow. Do not use the example device ID without verifying it for your registered device.

Validation boundary: an injected-module lifecycle test is included. Local npm build/test/typecheck, CI, actual libsignal native-module compatibility, Facebook device registration, Messenger E2EE envelope exchange and authorized live interoperability remain unverified.


## Step 4 — Direct-message peer and multi-device session management

- Added a transport-neutral peer manager on top of the existing Signal direct-message engine.
- The application supplies a trusted peer-device directory and a PreKeyBundle fetch/parse provider. The manager validates peer/device identity, rejects duplicate device IDs, establishes missing sessions per device, reuses persisted sessions, and encrypts one outgoing copy for each active peer device.
- Incoming decryption is explicitly scoped to the sender's device address.
- No Messenger private endpoint, device-directory response shape or envelope format is guessed. The adapter boundary is ready for the authenticated Messenger transport once its protocol is verified.
- Added synthetic tests for device ordering, per-device session establishment/reuse, multi-device encryption, sender-device decrypt routing and duplicate-device rejection.

**Validation boundary:** source and tests are committed, but no local npm build/test/typecheck, GitHub Actions run, real libsignal native-module test, Messenger bundle transport, or live Facebook E2EE acceptance has been executed. This step is protocol orchestration scaffolding, not proof of Messenger interoperability.


### Step 4 hardening

- Bundle transport is now split into explicit `fetchPreKeyBundle` and `parsePreKeyBundle` providers. The parser must return the native libsignal PreKeyBundle object; transport JSON is never passed directly into libsignal by assumption.
- Session preparation is serialized per peer/device inside the manager, preventing concurrent sends from racing to establish the same missing session.
- After session establishment, the manager verifies that the session store now contains the device session before allowing message encryption.
- Tests now cover native-bundle parsing handoff and concurrent preparation deduplication in addition to multi-device routing and duplicate-device rejection.


## Step 5 — Group Sender Keys and SKDM lifecycle

- Added a group-key manager around the existing libsignal Sender Keys primitives and encrypted SenderKeyStore persistence.
- Local Sender Key Distribution Messages (SKDMs) are sent privately to every active remote group-member device through an injected authenticated direct-message transport. The manager excludes the local device and rejects malformed/duplicate device directories.
- Incoming SKDMs are passed to libsignal's distribution processor before group decrypt operations.
- Distribution payloads are cached across partial transport failures; successful recipient deliveries are remembered so retries continue without resending to already-confirmed devices.
- Group membership synchronization rotates the local Sender Key, clears old delivery state and distributes the new key to the current member-device set. Explicit rotation is also available.
- Added tests for SKDM fanout, partial-send retry, distribution reuse, incoming distribution processing, group encrypt/decrypt delegation, membership-triggered rotation and duplicate-device rejection.
- SenderKeyRecord persistence remains in the encrypted account-bound Signal store and is covered by the key-store persistence test.

**Validation boundary:** this is the Signal Sender Keys/SKDM lifecycle plus injected transport orchestration. Messenger-specific private group membership/device discovery, authenticated SKDM envelope transport, multi-device group fanout acceptance and live Facebook group E2EE remain unverified. No local npm build/test/typecheck or GitHub Actions run has been executed.


## Step 6 — Encrypted group messaging hardening

- Group encryption/decryption continues to use the libsignal Sender Keys primitives; incoming SKDM processing remains a prerequisite for decrypting a sender's group messages.
- Group-key manager decryption now accepts optional expected group and sender-device context and rejects mismatches before invoking the Signal decryptor. This prevents application routing metadata from silently selecting an unexpected group or sender-key record.
- Fixed the SKDM distribution cache-key initialization order so the key is defined before cache lookup.
- Added tests for expected group and sender-device mismatch rejection.
- Replay/duplicate ciphertext rejection is delegated to the selected libsignal GroupCipher/SenderKeyRecord implementation and its sender-key iteration state. OmegA-FCA does not add a separate replay cache or claim replay resistance until this behavior is verified against the exact injected libsignal version with repeat-message tests.

**Validation boundary:** source and synthetic test updates are committed. Local npm build/test/typecheck, CI, native libsignal duplicate/replay behavior, and authorized Facebook Messenger group E2EE interoperability have not been executed. Messenger group envelope transport and private membership protocol remain unimplemented/unverified.

## Step 7 — Encrypted group media

- Hardened `createSignalEncryptedGroupMedia` with strict descriptor, size, digest, IV/MAC, and wrapped-key routing validation. Malformed or missing wrapped sender metadata is rejected before the Signal decryptor is called.
- Added optional expected group and sender-device context checks. Applications can bind media decryption to the group and authenticated sender expected by the surrounding message event.
- Added `downloadAndDecrypt(descriptor, download, expectedContext)` to compose retrieval of opaque media bytes with the same integrity verification and key unwrap/decryption path. The download callback is not invoked when expected routing context is already invalid.
- Upload continues to send ciphertext only as `application/octet-stream`; the descriptor carries the wrapped Sender Key media key and integrity metadata separately. Upload/download callbacks are transport adapters and do not pretend to implement Messenger's private media CDN protocol.
- Added a dedicated test covering binary round-trip, ciphertext-only upload, download/decrypt, expected group/sender rejection, digest tampering, MAC tampering, wrapped-key routing, malformed metadata, and transport callback failures.

**Validation boundary:** implementation and synthetic tests are committed. CI must pass before this step is marked verified. Messenger-specific encrypted attachment descriptor/envelope format, CDN upload/download behavior, native libsignal interoperability, and authorized live Facebook group-media acceptance remain unverified; no live Messenger E2EE media claim is made.

## Step 8 — Encrypted E2EE actions and receipts

- Extended the Signal application-action layer with encrypted read receipts, delivery receipts, typing start/stop and presence states (`online`, `away`, `busy`, `offline`).
- Receipt message IDs are validated, trimmed and deduplicated (maximum 500). Typing actions carry a bounded expiry (10 seconds for active typing; immediate expiry for stop) so stale indicators can be discarded by consumers.
- Added a single `decryptAction` decoder that validates action version, kind, identifiers, timestamps and typing expiry. The existing `decryptReadReceipt` API remains backward-compatible and rejects other action kinds.
- Exported the action payload types and added a dedicated automated test covering round-trip encrypted payloads, receipt deduplication, typing lifecycle, presence validation and malformed payload rejection.
- These are encrypted application-level Signal actions. They do not call ordinary Messenger `markAsRead`, `markAsDelivered`, `sendTypingIndicator` or presence endpoints, and they do not claim compatibility with Messenger's private E2EE action envelope.

**Validation boundary:** implementation and synthetic tests are committed; CI verification is pending. Messenger-specific device routing, authenticated envelope delivery/receipt synchronization and live Facebook E2EE action acceptance remain unverified.
