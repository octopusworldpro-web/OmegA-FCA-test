# E2EE Direct-Message Inbox Investigation

**Status:** FCA callback bridge implemented; stage diagnostics added; GoatBot integration and live Inbox acceptance pending  
**Branch:** `investigation/e2ee-dm-inbox`  
**Base branch:** `feature/release-0.2.3-beta.3`  
**Base commit:** `d4c6acfefc4baad8ec54f8408d7a4db3a24e0f46`  
**Package under test:** `@nirzon-islam/omega-fca@0.2.3-beta.5`  
**Last documentation review:** 2026-11-28

## 1. Reported symptom

- E2EE reports as connected/ready on Railway.
- Group-chat traffic reaches GoatBot and produces normal reply-handler activity.
- A direct message sent to the bot account's Messenger Inbox produces no bot reply.

A connected E2EE socket is not proof that inbound messages are bridged into the FCA/GoatBot event callback. This report separates observed runtime evidence, source findings, proposed work, and unverified acceptance criteria.

## 2. Railway evidence observed

Deployment/runtime details previously inspected:

- Railway service: `OmegA-Goatbot`
- Repository/branch: `nirzon-islam/OmegA-Goatbot` / `agent-fca-compat-fix`
- Deployment status: `SUCCESS`
- Deployed commit: `2b9e69e7da8f3fedb7c163250c9a5944b084f80d`
- Runtime package: `@nirzon-islam/omega-fca@0.2.3-beta.5`
- Relevant config observed: `antiInbox: false`, `selfListen: true`, `selfListenEvent: true`

Observed log behaviour:

- MQTT `/t_ms` traffic was received.
- Group-chat messages generated `MESSAGE_REPLY` and `onReply` activity.
- In the inspected DM test window (`2026-11-27T19:28:00Z`–`19:34:00Z`), no matching DM `MESSAGE_REPLY`/`onReply` event was found. The window contained group-message activity earlier and session-guard snapshot saves later.
- This proves that the inspected logs did not show the DM reaching the normal reply pipeline. It does **not**, by itself, prove that Facebook failed to deliver the packet or that the Noise socket received nothing.

## 3. Source-level findings

### 3.1 MQTT subscriptions and message routing

In `src/transport/realtime/topics.ts`, the MQTT subscription list includes:

- `/t_ms`
- `/inbox`
- `/mercury`
- `/messaging_events`
- `/orca_message_notifications`

In `src/transport/realtime/connect-mqtt.ts`, the MQTT `message` handler explicitly processes `/t_ms` deltas, typing/presence topics, and `/ls_resp`. The other subscribed inbox/notification topics do not have explicit branches in that handler.

The E2EE Messenger service uses a separate authenticated Noise WebSocket transport; MQTT topic subscription alone therefore does not establish that the E2EE DM path is active.

### 3.2 Native E2EE service emits incoming messages

In `src/domains/e2ee/messenger-e2ee-service.ts`:

- `attachSocket()` registers the Noise socket's incoming node handler.
- `handleNode()` handles incoming `message` stanzas, finds the local device recipient, decrypts Signal ciphertext, decodes the transport payload, and dispatches decoded application payloads.
- `dispatchApplicationText()` emits an EventEmitter event named `message` with fields `id`, `threadId`, `senderJid`, `senderId`, `text`, and `timestampMs`.

This is a separate event shape from the normal FCA MQTT callback event.

### 3.3 Login integration exposes the service; the original callback gap is now bridged

In `src/core/login-helper.impl.ts`, `initializeE2EEForLogin()` initializes the E2EE service after authenticated user identity validation and exposes `api.e2ee.messenger`. The initial audit found no bridge from this EventEmitter into the ordinary FCA callback. That gap is now addressed in `src/domains/realtime/listener.ts`: when `listenMqtt()` starts, the listener attaches the E2EE bridge to the same middleware-wrapped callback used by MQTT events, and detaches it on listener stop/replacement.

### 3.4 GoatBot consumes the ordinary FCA callback; no separate GoatBot listener is intended

In `nirzon-islam/OmegA-Goatbot`, branch `agent-fca-compat-fix`:

- `bot/login/fcaProvider.js` builds FCA login options and provisions local E2EE identity material.
- `bot/login/login.js` starts `api.listenMqtt(...)`; this is the callback path the FCA bridge now feeds.
- `bot/handler/handlerAction.js` exempts `event.isE2EE` events from anti-inbox filtering.
- `bot/handler/handlerEvents.js` contains E2EE-aware thread/user handling.
- A separate GoatBot-side `api.e2ee.messenger` listener is intentionally not added: the FCA bridge should preserve a single callback/event pipeline. Actual GoatBot handler execution remains unverified until its branch is tested with the updated FCA build.

### 3.5 Most likely failure boundary

**Original failure boundary:** the native E2EE EventEmitter was not connected to the FCA callback. The branch now contains that lifecycle-managed bridge, so the original source-level gap is addressed. Remaining uncertainty is upstream of and downstream from that bridge: whether a real Inbox DM is routed to the local device and decrypted, and whether the updated package is accepted by the GoatBot handler path. These require test evidence; they are not assumed.

## 4. Work progress

The statuses below track this Inbox-specific investigation/fix. They do not change the separate four-step E2EE implementation roadmap or claim live Messenger compatibility. The current branch contains the FCA bridge and privacy-safe stage diagnostics; these diagnostics are not yet live-runtime evidence.

| # | Work item | Status | Evidence / remaining work |
|---|---|---|---|
| 1 | Reproduce and document the Inbox no-reply symptom | **Observed** | Railway deployment and log window inspected; DM did not appear in the normal reply pipeline |
| 2 | Check MQTT Inbox topic subscriptions and routing | **Reviewed** | Subscriptions exist; inspected MQTT handler has no explicit branches for the other Inbox/notification topics |
| 3 | Trace native E2EE inbound message handling | **Source reviewed** | Noise node → recipient match → Signal decrypt → application dispatch → EventEmitter `message` |
| 4 | Check E2EE-to-FCA callback integration | **Implemented (source)** | Native message EventEmitter is now bridged into the active middleware-wrapped FCA `listenMqtt` callback, with listener lifecycle cleanup and pre-listener buffering |
| 5 | Check GoatBot listener/handler compatibility | **Source compatibility reviewed** | GoatBot `listenMqtt` callback path, `isE2EE` antiInbox exemption, and E2EE-safe thread/user fallback align with the normalized event; separate end-to-end adapter test remains pending |
| 6 | Verify exact active FCA callback contract and listener lifecycle | **Complete (source audit)** | `createRealtimeListener` owns the active callback; `api.e2ee.messenger` is an EventEmitter; stop/replacement lifecycle and middleware wrapping are confirmed |
| 7 | Implement one lifecycle-managed E2EE → FCA callback bridge | **Implemented — earlier CI verified; latest CI pending** | One bridge feeds the active middleware-wrapped FCA callback; stop/replacement detaches it; `selfListen` behavior is preserved; early DMs are buffered until callback attachment |
| 8 | Add normalization, dedupe, ACK and lifecycle regression tests | **Expanded tests added; latest CI pending** | Fixtures cover pre-listener queue flush, concurrent/replayed stanza dedupe, ACK-send retry without duplicate dispatch, participant/main-envelope identical-payload suppression, partial-decrypt retry, group exclusion, and DSM destination vs DM sender thread mapping |
| 9 | Run GoatBot integration and regression tests | **Source compatibility reviewed; runtime integration pending** | GoatBot's existing `listenMqtt` callback, E2EE antiInbox exemption and safe E2EE thread fallback are compatible by source inspection; package-level integration still needs verification |
| 10 | Perform authorized live Messenger Inbox acceptance test | **Not started** | Verify a real DM is received, handled and answered exactly once |

**Progress summary:** FCA callback bridge, pre-listener queue, direct/group separation, stanza dedupe, staged decrypt/dispatch, thread mapping, and retry handling are implemented at source level. Expanded regression fixtures are present; latest Node 20/22 CI is pending. GoatBot runtime integration and live Inbox acceptance remain outstanding. This is a work-item status, not a percentage-complete claim. The Inbox fix is not live-accepted yet.

## 5. Implementation details (current branch changes)

### 5.1 Verify the callback boundary first

The callback boundary was verified in `src/domains/realtime/listener.ts`: the active `globalCallback` is middleware-wrapped and owned by `createRealtimeListener`; the `api.e2ee.messenger` EventEmitter is available before the caller starts `listenMqtt`. The bridge is attached at listener start and disposed on stop/replacement. The ordinary MQTT `parseDelta` path filters own-account messages when `selfListen` is false; the E2EE bridge applies the same guard.

- callback event structure and required fields;
- how `listenMqtt` is started, stopped, and restarted;
- whether callbacks can be registered more than once;
- how reconnect replaces or retains the active listener;
- how self-device messages and own-account sender IDs are represented;
- whether an existing dedupe/ACK mechanism can be reused.

This uses the existing FCA callback shape rather than introducing a second GoatBot listener.

### 5.2 Normalize native E2EE DM events

The intended FCA-compatible event mapping is:

- `type: "message"`
- `threadID`: numeric account ID extracted from native `threadId` JID
- `messageID`: native `id`
- `senderID`: native `senderId`
- `body`: decrypted `text`
- `timestamp`: native `timestampMs` in milliseconds
- `isGroup: false` for a one-to-one Inbox conversation
- `isE2EE: true` to retain the existing GoatBot E2EE-aware handler path

The helper rejects missing IDs, non-numeric account IDs, and empty text. The native service continues to own stanza decryption, replay dedupe and ACK.

### 5.3 Single-owner bridge and lifecycle

Ownership is the FCA realtime listener, so GoatBot continues to consume one normal FCA callback contract. No parallel listener is installed in GoatBot.

The implementation must:

- register the E2EE message listener once for the active login/listener lifecycle;
- dispatch each accepted inbound message once;
- detach listeners on stop/logout/replacement;
- avoid duplicate registration after reconnect or listener restart;
- preserve pending/ACK semantics and safe error handling;
- avoid logging message bodies, cookies, keys, ciphertext, or full JIDs.

### 5.4 Preserve existing behavior

Do not replace or regress:

- ordinary MQTT `NewMessage` parsing;
- group-message handling and existing command/reply behavior;
- `selfListen` and `selfListenEvent` behavior;
- existing FCA Inbox/notification handling;
- existing GoatBot handler semantics.

No changes to production Railway variables, session files, E2EE identity files, or database state are part of this proposed source fix.

## 6. Actual source/test scope

The following files were changed for the bridge and its verification:

| File changed | Responsibility |
|---|---|
| `src/domains/realtime/e2ee-inbox-bridge.ts` | Validate and normalize decrypted native DM events; attach/dispose the EventEmitter listener |
| `src/domains/realtime/listener.ts` | Connect E2EE event bridge to the active, middleware-wrapped FCA callback; detach on stop/replacement; skip MQTT receipts for E2EE ACKed messages |
| `src/domains/e2ee/messenger-e2ee-service.ts` | Unchanged; its existing `message` event is consumed as the bridge source |
| `src/types/events.ts` and `src/index.ts` | Add typed E2EE metadata and export the bridge utility |
| `test/e2ee-inbox-bridge.test.cjs`, `test/e2ee-messenger-send.test.cjs`, and `package.json` | Add bridge lifecycle/error-propagation plus service-level pre-listener queue, duplicate, retry, envelope, and thread-mapping regression coverage |
| `.github/workflows/ci.yml` | Include `investigation/**` branches in CI push/PR triggers so this branch is validated on Node 20 and 22 |

GoatBot runtime files should remain unchanged unless tests prove the FCA callback bridge alone is insufficient and a separate adapter change is explicitly approved.

## 7. Validation and acceptance criteria

| Validation | Pass condition |
|---|---|
| Noise ingress trace | A real authorized Inbox DM reaches the expected inbound node handler; diagnostics contain no secrets or message content |
| Recipient/decrypt path | Correct local device recipient is selected and Signal decrypt succeeds |
| Application event | Native E2EE `message` event emits once with expected metadata |
| FCA callback bridge | The same message reaches the active FCA callback once with verified contract fields |
| GoatBot handler | Existing handler receives the event and processes a valid DM command |
| Reply | Bot sends one reply to the originating Inbox thread |
| Duplicate handling | Retries/replayed stanzas do not produce duplicate command execution or replies |
| Lifecycle | Stop/restart/reconnect does not leak listeners or duplicate delivery |
| Regression | Ordinary MQTT group and non-E2EE message behavior remains unchanged |
| Live acceptance | Authorized real Messenger Inbox DM → one GoatBot reply is observed end-to-end |

Do not mark the Inbox fix complete based only on compilation, unit tests, CI, E2EE connection status, or group-chat replies. Live acceptance requires the end-to-end DM and reply.

## 8. Diagnostic instrumentation added (source-level; not yet live-verified)

The FCA service now emits privacy-safe `inbox_diagnostic` stages without message bodies, JIDs, message IDs, ciphertext, cookies, or key material. The bridge forwards stage names to the configured logger and records when the normal FCA callback is invoked. Stages currently instrumented: `NOISE_MESSAGE_RECEIVED`, `DUPLICATE_STANZA_SUPPRESSED`, `DUPLICATE_STANZA_IN_FLIGHT_SUPPRESSED`, `E2EE_RECIPIENT_MATCHED`, `E2EE_RECIPIENT_NOT_MATCHED`, `E2EE_DECRYPT_SUCCEEDED`, `E2EE_PARTICIPANT_TRANSPORT_DECODED`, `E2EE_TRANSPORT_DECODED`, `DUPLICATE_APPLICATION_PAYLOAD_SUPPRESSED`, `E2EE_MESSAGE_QUEUED_NO_CONSUMER`, `E2EE_MESSAGE_EMITTED`, `E2EE_NODE_PROCESSING_FAILED`, and `FCA_INBOX_CALLBACK_INVOKED`. These indicate code-path progress only; absence/presence must be observed during an authorized live DM test to localize the runtime failure. `GOATBOT_HANDLER_RECEIVED` and reply confirmation require GoatBot-side/runtime evidence and are not claimed by FCA logs.

**Source-level risks addressed in this pass:** incoming stanza IDs are now tracked while processing as well as after successful dispatch, preventing concurrent duplicate decrypt/dispatch. Messages received before an FCA callback is attached are queued (bounded to 1,000 events) and flushed when the listener starts, rather than being silently emitted to zero listeners and then acknowledged. Decrypted application payloads are staged until every present envelope has decrypted successfully; identical participant/main application payload bytes are dispatched once. The direct-message thread ID uses the remote sender JID (`from`), not DSM destination metadata, and tests deliberately provide a different DSM destination. Successfully dispatched stanza IDs are remembered before ACK transmission so an ACK-send failure can be retried without re-running the bot callback. A repeated processed stanza is re-ACKed, preserving the stanza participant attribute when present.

**Remaining protocol uncertainty:** if a stanza contains two *different* application payloads in participant and main envelopes, both are currently dispatched after successful decryption. The exact Messenger semantics of that uncommon envelope combination are not established by the available fixtures; no content is discarded merely because it differs. Real Messenger envelope capture is still required to confirm the expected wire shape.

## 9. Current disposition

- Runtime implementation has started with explicit user approval. All changes are isolated to `investigation/e2ee-dm-inbox`.
- The bridge is owned by the FCA realtime listener and feeds the existing middleware-wrapped callback; no second GoatBot-side listener is introduced.
- The normalized event includes `type: "message"`, `threadID`, `messageID`, `senderID`, `body`, `timestamp`, `isGroup: false`, and `isE2EE: true`.
- Native E2EE message events now carry an explicit `isGroup` marker; the FCA Inbox bridge ignores group events even if a group JID happens to look numeric.
- Inbound processing now suppresses same-ID concurrent/replayed stanzas; identical app payloads across participant and main envelopes are dispatched once.
- App dispatch is deferred until all present encrypted envelopes decrypt successfully, avoiding partial callback delivery followed by a later envelope failure.
- If an E2EE DM arrives after login but before `listenMqtt()` has attached a consumer, the decrypted message is retained in a bounded in-memory queue and flushed when the FCA bridge attaches; the bridge also retries flushing pending items before dispatching a newer event.
- The direct-message thread is derived from the remote sender JID; regression fixtures set a conflicting DSM destination to guard against routing a DM to the wrong thread.
- Group text events carry `isGroup: true` and are explicitly ignored by the DM bridge, preventing numeric-looking group IDs from being misrouted as one-to-one conversations.
- FCA callback dispatch errors propagate back into the native E2EE processing path so retry handling can run; the bridge unit test covers this behavior.
- Listener stop and replacement detach the E2EE event listener. Existing service-level stanza dedupe and acknowledgement remain in the E2EE service.
- E2EE events skip the MQTT automatic receipt helper because the native Noise service already acknowledges inbound stanzas.
- No production Railway variables, session files, E2EE identity files, or database state have been modified.
- The first CI attempt exposed a TypeScript union-narrowing error in the receipt guard; this was corrected. Earlier CI run `46107206071` passed on both Node 20 and Node 22, including build, full `npm test`, typecheck, lint and package dry-run. The new diagnostic commits were pushed after that run and therefore still require a fresh CI result. GoatBot integration and authorized live Inbox acceptance are still pending; do not claim live E2EE DM compatibility or production readiness yet.

## 10. Implementation commits

- `9d3a660`: add E2EE Inbox event normalizer and lifecycle bridge helper.
- `aef16b7`: attach the bridge to the active FCA realtime callback and detach it on listener stop/replacement.
- `2fb39cb`: extend FCA message event typing with `isE2EE` / `isGroup`.
- `034f2db`: export the bridge utilities.
- `8bfa155`: add Inbox bridge unit tests and include them in `npm test`.
- `07927c7`: enable CI on `investigation/**` branches.
- `f43eaa8`: correct the event-union type guard identified by the first CI attempt.
- `6862da2`: preserve ordinary FCA `selfListen` filtering and thread-count update behavior for E2EE DMs.
- `1e48fc6`: update this investigation report with callback audit and CI correction status.
- `d11df94`: add privacy-safe inbound E2EE service-stage diagnostics.
- `b5fdf6d`: forward diagnostic stages through the FCA inbox bridge and log callback invocation.
- `fc5b40c`: update investigation status, unresolved envelope risks, and diagnostic-stage documentation.
- `90809b8`: refresh documentation index.
- `e952280`: test diagnostic logging and bridge listener cleanup.
- `08051b9`: trace inbound node-processing failures without exposing payload data.
- `3a8832e`: log FCA callback invocation after dispatch returns.
- `5c015e0`: correct report line breaks and refresh the implementation record.
- Latest source commits: `839641b` (test ACK retry without duplicate dispatch), `44a3f55` (document group isolation/startup queue), `21f5803` (mark native text event direct/group scope), `0cf3905` (exclude group messages from DM bridge), `9bb3584` and `3f5f9a5` (group-scope regression fixtures), `d5e9aa6` (clear queued payloads on service close), `95c69b4` (correct startup queue test expectations), `800eb22` (queue pre-listener DMs until FCA callback attaches), `ed0e45f` (flush pending DMs from the FCA bridge), `ad9e444` (test pre-listener queue delivery), `1723915` (in-flight dedupe and DM thread mapping), `4edead1` (defer application dispatch until stanza decrypt completes), `bf8865f` (duplicate/replay/dual-envelope tests), `ff72462` (partial-decrypt retry test), `dd65efc` (participant ACK addressing), `ce8f132` (remember processed messages before ACK), `e93858f` (propagate FCA callback failures), `7fa807f` (bridge error-propagation test), `da2ef6c` (recipient/participant decode diagnostics), and `a51960e` (DSM-vs-thread mapping fixture).

## 11. Source references

OmegA-FCA-test, branch `investigation/e2ee-dm-inbox`:

- `src/transport/realtime/topics.ts`
- `src/transport/realtime/connect-mqtt.ts`
- `src/domains/realtime/parse-delta.ts`
- `src/domains/e2ee/messenger-e2ee-service.ts`
- `src/domains/e2ee/login-integration.ts`
- `src/core/login-helper.impl.ts`

GoatBot, branch `agent-fca-compat-fix`:

- `bot/login/fcaProvider.js`
- `bot/login/login.js`
- `bot/handler/handlerAction.js`
- `bot/handler/handlerEvents.js`
