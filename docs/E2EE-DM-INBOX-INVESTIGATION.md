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

### 3.3 Login integration exposes the service but no callback bridge was found

In `src/core/login-helper.impl.ts` around the E2EE login integration (approximately lines 1020–1090):

- `initializeE2EEForLogin()` initializes the E2EE service after authenticated user identity validation.
- The result is exposed as `api.e2ee`, including `messenger` and send/receive helper methods.
- In the inspected integration block, no `messenger.on("message", ...)` bridge into the standard `listenMqtt`/global callback was found.

### 3.4 GoatBot adapter does not currently attach an E2EE message listener

In `nirzon-islam/OmegA-Goatbot`, branch `agent-fca-compat-fix`:

- `bot/login/fcaProvider.js` builds FCA login options and provisions local E2EE identity material; it does not attach a listener to `api.e2ee.messenger`.
- `bot/login/login.js` starts the ordinary `api.listenMqtt(...)` callback path. The inspected listener setup does not attach a separate `api.e2ee.messenger.on("message", ...)` handler.
- `bot/handler/handlerAction.js` exempts `event.isE2EE` events from anti-inbox filtering.
- `bot/handler/handlerEvents.js` has safe handling for `event.isE2EE` thread/user data, but that code only helps after an E2EE event reaches the handler.

### 3.5 Most likely failure boundary

**High-confidence source-level lead:** the native E2EE service can emit a decrypted `message` event, but the inspected login integration and GoatBot adapter do not bridge that EventEmitter event into the callback consumed by GoatBot's existing `listenMqtt` pipeline.

That gap is a strong explanation for “E2EE connected, group bot works, E2EE DM does not reply.” It is not yet live packet-level proof: the next validation must establish whether a DM stanza arrives at `handleNode()`, is decrypted, emits `message`, and then reaches the normal FCA callback exactly once.

## 4. Work progress

The statuses below track this Inbox-specific investigation/fix. They do not change the separate four-step E2EE implementation roadmap or claim live Messenger compatibility. The current branch contains the FCA bridge and privacy-safe stage diagnostics; these diagnostics are not yet live-runtime evidence.

| # | Work item | Status | Evidence / remaining work |
|---|---|---|---|
| 1 | Reproduce and document the Inbox no-reply symptom | **Observed** | Railway deployment and log window inspected; DM did not appear in the normal reply pipeline |
| 2 | Check MQTT Inbox topic subscriptions and routing | **Reviewed** | Subscriptions exist; inspected MQTT handler has no explicit branches for the other Inbox/notification topics |
| 3 | Trace native E2EE inbound message handling | **Source reviewed** | Noise node → recipient match → Signal decrypt → application dispatch → EventEmitter `message` |
| 4 | Check E2EE-to-FCA callback integration | **Gap identified** | No bridge found in the inspected login integration |
| 5 | Check GoatBot listener/handler compatibility | **Source reviewed** | Existing handler has E2EE-aware handling, but inspected login listener does not subscribe to the E2EE EventEmitter |
| 6 | Verify exact active FCA callback contract and listener lifecycle | **Complete (source audit)** | `createRealtimeListener` owns the active callback; `api.e2ee.messenger` is an EventEmitter; stop/replacement lifecycle and middleware wrapping are confirmed |
| 7 | Implement one lifecycle-managed E2EE → FCA callback bridge | **Implemented — CI verified** | One bridge feeds the active middleware-wrapped FCA callback; stop/replacement detaches it; `selfListen` behavior is preserved |
| 8 | Add normalization, dedupe, ACK and lifecycle regression tests | **Partial — bridge unit test and CI passed** | Mapping, invalid payload rejection, delivery, diagnostic forwarding and detach are covered by the bridge test; service-level replay/reconnect and participant/main-envelope duplicate behavior still need targeted coverage |
| 9 | Run GoatBot integration and regression tests | **FCA CI passed; GoatBot integration pending** | Node 20 and 22 build, full npm test, typecheck, lint and package dry-run all passed; end-to-end GoatBot handler validation remains |
| 10 | Perform authorized live Messenger Inbox acceptance test | **Not started** | Verify a real DM is received, handled and answered exactly once |

**Progress summary:** 7/10 work items are complete or source-verified; bridge unit coverage is passing but replay/reconnect-specific coverage remains; FCA CI is green on Node 20/22; GoatBot integration and live Inbox acceptance remain outstanding. This is a work-item status, not a percentage-complete claim. The Inbox fix is not live-accepted yet.

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
| `test/e2ee-inbox-bridge.test.cjs` and `package.json` | Add normalizer/attach/detach regression coverage to the test suite |
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

The FCA service now emits privacy-safe `inbox_diagnostic` stages without message bodies, JIDs, message IDs, ciphertext, cookies, or key material. The bridge forwards stage names to the configured logger and records when the normal FCA callback is invoked. Stages currently instrumented: `NOISE_MESSAGE_RECEIVED`, `DUPLICATE_STANZA_SUPPRESSED`, `E2EE_RECIPIENT_MATCHED`, `E2EE_DECRYPT_SUCCEEDED`, `E2EE_TRANSPORT_DECODED`, `E2EE_MESSAGE_EMITTED`, `E2EE_NODE_PROCESSING_FAILED`, and `FCA_INBOX_CALLBACK_INVOKED`. These indicate code-path progress only; absence/presence must be observed during an authorized live DM test to localize the runtime failure. `GOATBOT_HANDLER_RECEIVED` and reply confirmation require GoatBot-side/runtime evidence and are not claimed by FCA logs.

**Additional source-level risk retained for verification:** participant-device payload handling can dispatch an application payload before the stanza-level `seenIncoming` ID is added; if a stanza also contains a main `enc` payload, both paths may dispatch. The exact Messenger envelope semantics and whether these are distinct logical payloads are not proven by current fixtures. Participant-path `threadId` is taken from `destinationJid || from`; its direct-thread meaning also needs a fixture/live observation. No speculative behavior change is made until that contract is established.

## 9. Current disposition

- Runtime implementation has started with explicit user approval. All changes are isolated to `investigation/e2ee-dm-inbox`.
- The bridge is owned by the FCA realtime listener and feeds the existing middleware-wrapped callback; no second GoatBot-side listener is introduced.
- The normalized event includes `type: "message"`, `threadID`, `messageID`, `senderID`, `body`, `timestamp`, `isGroup: false`, and `isE2EE: true`.
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
- `f43eaa8`: correct the event-union type guard identified by the first CI attempt.\n- `6862da2`: preserve ordinary FCA `selfListen` filtering and thread-count update behavior for E2EE DMs.\n- `1e48fc6`: update this investigation report with callback audit and CI correction status.\n- `d11df94`: add privacy-safe inbound E2EE service-stage diagnostics.\n- `b5fdf6d`: forward diagnostic stages through the FCA inbox bridge and log callback invocation.\n- `fc5b40c`: update investigation status, unresolved envelope risks, and diagnostic-stage documentation.\n- `90809b8`: refresh documentation index.\n- `e952280`: test diagnostic logging and bridge listener cleanup.\n- `08051b9`: trace inbound node-processing failures without exposing payload data.\n- Pending commit: finalize callback-invocation log ordering and report formatting.

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
