# E2EE Direct-Message Inbox Investigation

**Status:** Investigation documented; runtime fix not started  
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

The statuses below track this Inbox-specific investigation/fix. They do not change the separate four-step E2EE implementation roadmap or claim live Messenger compatibility.

| # | Work item | Status | Evidence / remaining work |
|---|---|---|---|
| 1 | Reproduce and document the Inbox no-reply symptom | **Observed** | Railway deployment and log window inspected; DM did not appear in the normal reply pipeline |
| 2 | Check MQTT Inbox topic subscriptions and routing | **Reviewed** | Subscriptions exist; inspected MQTT handler has no explicit branches for the other Inbox/notification topics |
| 3 | Trace native E2EE inbound message handling | **Source reviewed** | Noise node → recipient match → Signal decrypt → application dispatch → EventEmitter `message` |
| 4 | Check E2EE-to-FCA callback integration | **Gap identified** | No bridge found in the inspected login integration |
| 5 | Check GoatBot listener/handler compatibility | **Source reviewed** | Existing handler has E2EE-aware handling, but inspected login listener does not subscribe to the E2EE EventEmitter |
| 6 | Verify exact active FCA callback contract and listener lifecycle | **Pending** | Confirm callback signature, listener registration/stop/restart, reconnect and self-device semantics before implementation |
| 7 | Implement one lifecycle-managed E2EE → FCA callback bridge | **In progress — code committed** | New normalizer/bridge attaches to the active FCA callback; stop/replacement disposes the listener |
| 8 | Add normalization, dedupe, ACK and lifecycle regression tests | **In progress — unit test added** | Covers mapping, invalid payload rejection, delivery and detach; service-level retry/dedupe and reconnect still need verification |
| 9 | Run GoatBot integration and regression tests | **Pending CI** | Node 20/22 CI run started; GoatBot integration/live bot tests remain outstanding |
| 10 | Perform authorized live Messenger Inbox acceptance test | **Not started** | Verify a real DM is received, handled and answered exactly once |

**Progress summary:** 6/10 work items are complete or source-verified; bridge implementation and unit coverage are in progress; CI and GoatBot integration are pending; live Inbox acceptance is not started. This is a work-item status, not a percentage-complete claim. The Inbox fix is not complete until CI and live acceptance pass.

## 5. Implementation details (current branch changes)

### 5.1 Verify the callback boundary first

Before editing, inspect the actual `listenMqtt` implementation and its callback contract, including:

- callback event structure and required fields;
- how `listenMqtt` is started, stopped, and restarted;
- whether callbacks can be registered more than once;
- how reconnect replaces or retains the active listener;
- how self-device messages and own-account sender IDs are represented;
- whether an existing dedupe/ACK mechanism can be reused.

Do not assume that the proposed normalized shape below is accepted until the active callback contract is verified.

### 5.2 Normalize native E2EE DM events

The intended FCA-compatible event mapping is:

- `type: "message"`
- `threadID`: native `threadId`
- `messageID`: native `id`
- `senderID`: native `senderId`
- `body`: decrypted `text`
- `timestamp`: native `timestampMs`, converted only as required by the existing FCA contract
- `isGroup: false` for a one-to-one Inbox conversation
- `isE2EE: true` to retain the existing GoatBot E2EE-aware handler path

The exact mapping, optional fields, and group/thread classification must follow verified source contracts rather than assumptions.

### 5.3 Single-owner bridge and lifecycle

Preferred ownership is the FCA listener/integration layer, so GoatBot continues to consume one normal FCA callback contract. Avoid installing duplicate independent listeners in both FCA and GoatBot.

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

These are candidate inspection/edit locations, not confirmation that every file must change. Final file selection depends on the callback-contract audit.

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

## 8. Current disposition

- Runtime implementation has started with explicit user approval. All changes are isolated to `investigation/e2ee-dm-inbox`.
- The bridge is owned by the FCA realtime listener and feeds the existing middleware-wrapped callback; no second GoatBot-side listener is introduced.
- The normalized event includes `type: "message"`, `threadID`, `messageID`, `senderID`, `body`, `timestamp`, `isGroup: false`, and `isE2EE: true`.
- Listener stop and replacement detach the E2EE event listener. Existing service-level stanza dedupe and acknowledgement remain in the E2EE service.
- E2EE events skip the MQTT automatic receipt helper because the native Noise service already acknowledges inbound stanzas.
- No production Railway variables, session files, E2EE identity files, or database state have been modified.
- CI is running on Node 20 and 22. Do not claim live E2EE DM compatibility or production readiness until CI, GoatBot integration, and authorized live Inbox acceptance pass.

## 9. Implementation commits

- `9d3a660`: add E2EE Inbox event normalizer and lifecycle bridge helper.
- `aef16b7`: attach the bridge to the active FCA realtime callback and detach it on listener stop/replacement.
- `2fb39cb`: extend FCA message event typing with `isE2EE` / `isGroup`.
- `034f2db`: export the bridge utilities.
- `8bfa155`: add Inbox bridge unit tests and include them in `npm test`.
- `07927c7`: enable CI on `investigation/**` branches; Node 20 and 22 jobs have started.

## 10. Source references

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
