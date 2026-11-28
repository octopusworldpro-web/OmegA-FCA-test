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
| 7 | Implement one lifecycle-managed E2EE → FCA callback bridge | **Not started — approval required** | No runtime source has been changed |
| 8 | Add normalization, dedupe, ACK and lifecycle regression tests | **Not started** | Tests must cover direct Inbox event mapping, duplicate suppression, reconnect and listener teardown |
| 9 | Run GoatBot integration and regression tests | **Not started** | Prove event reaches existing handlers and does not alter ordinary MQTT/group behavior |
| 10 | Perform authorized live Messenger Inbox acceptance test | **Not started** | Verify a real DM is received, handled and answered exactly once |

**Progress summary:** 5 investigation items reviewed/identified; 1 contract-verification item pending; 4 implementation/validation items not started. This is a work-item count, not a percentage-complete claim. The runtime fix is not complete.

## 5. Proposed implementation details (not yet approved or applied)

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

## 6. Proposed source/test scope

These are candidate inspection/edit locations, not confirmation that every file must change. Final file selection depends on the callback-contract audit.

| Candidate file | Intended responsibility |
|---|---|
| `src/core/login-helper.impl.ts` or the actual active listener orchestration module | Own and lifecycle-manage the E2EE EventEmitter → FCA callback bridge |
| `src/domains/e2ee/messenger-e2ee-service.ts` | Change only if inspection shows payload/lifecycle behavior must be corrected; retain its native decrypt/dispatch responsibility |
| Existing FCA event normalization/dispatcher module | Reuse or extend the canonical event mapping instead of creating a parallel callback system |
| New or existing E2EE listener/normalization unit tests | Verify field mapping, DM classification, dedupe, and teardown |
| GoatBot integration test coverage | Verify delivery through the existing `listenMqtt` callback and normal handlers |

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

## 8. Current disposition and approval boundary

- The current branch contains documentation only: this report and its entry in the docs index. No runtime source code has been changed by this Inbox investigation.
- The likely missing E2EE-to-FCA callback bridge is a source-level finding, not yet a packet-level live diagnosis.
- The next safe engineering action is the callback-contract/lifecycle audit. Runtime implementation and any code commit require the user's explicit approval after the exact proposed source changes are presented.
- No production Railway variables, session files, E2EE identity files, or database state have been modified.
- Do not claim live E2EE DM compatibility or production readiness until the acceptance criteria above pass.

## 9. Source references

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
