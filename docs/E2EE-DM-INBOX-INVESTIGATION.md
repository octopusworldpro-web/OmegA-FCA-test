# E2EE Direct-Message Inbox Investigation

**Status:** Investigation in progress  
**Branch:** `investigation/e2ee-dm-inbox`  
**Base branch:** `feature/release-0.2.3-beta.3`  
**Base commit:** `d4c6acfefc4baad8ec54f8408d7a4db3a24e0f46`  
**Package under test:** `@nirzon-islam/omega-fca@0.2.3-beta.5`

## 1. Reported symptom

- E2EE reports as connected/ready on Railway.
- Group-chat traffic reaches GoatBot and produces normal reply-handler activity.
- A direct message sent to the bot account's Messenger inbox produces no bot reply.

This report separates runtime observations from source-level findings. A connected E2EE socket is not proof that inbound messages are bridged into the FCA/GoatBot event callback.

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
- In the inspected DM test window (`2026-11-27T19:28:00Z`–`19:34:00Z`), no matching DM `MESSAGE_REPLY`/ `onReply` event was found. The window contained group-message activity earlier and session-guard snapshot saves later.
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

### 3.2 Native E2EE service does emit incoming messages

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

That gap is a strong explanation for “E2EE connected, group bot works, E2EE DM does not reply.” It is not yet a live packet-level proof: the next validation must establish whether a DM stanza arrives at `handleNode()`, is decrypted, emits `message`, and then reaches the normal FCA callback exactly once.

## 4. What is working vs not verified

| Area | Current evidence/status |
|---|---|
| Railway deployment | SUCCESS for the observed deployment |
| FCA MQTT connection | `/t_ms` traffic observed |
| Normal group-message callback/reply path | Observed working |
| E2EE Noise connection | Runtime reported connected/ready |
| E2EE inbound DM packet arrival | Not yet proven by safe runtime trace |
| Signal decrypt + application dispatch for live DM | Not yet proven |
| E2EE EventEmitter-to-FCA callback bridge | No bridge found in inspected integration |
| GoatBot E2EE DM handler execution | Not observed |
| Live Facebook/Messenger interoperability | Still requires live acceptance test |

## 5. Next investigation and implementation plan

1. **Trace ingress safely:** add/enable redacted diagnostic stages for Noise node arrival, stanza type, local-recipient match, decrypt success/failure, application dispatch, and emitted event. Never log message bodies, cookies, keys, ciphertext, or full JIDs.
2. **Verify event contract:** map native event fields to the FCA-compatible message shape: `type: "message"`, `threadID`, `messageID`, `senderID`, `body`, `timestamp`, `isGroup: false`, and an E2EE marker such as `isE2EE: true`. Confirm self-device fanout and duplicate suppression.
3. **Bridge once at the correct boundary:** prefer a single, lifecycle-managed bridge from `MessengerE2EEService` events into the active FCA listener callback, with teardown/reconnect handling. Avoid adding duplicate independent listeners in both FCA and GoatBot.
4. **Preserve ordinary MQTT behaviour:** do not change normal `NewMessage` parsing, group messages, `selfListen`, or existing inbox handling while adding the E2EE path.
5. **Add tests:** unit-test event normalization, direct-message thread/sender mapping, local-device fanout, duplicate ACK behaviour, decrypt failures, listener stop/restart, and reconnect replacement.
6. **Run GoatBot integration tests:** verify the same event reaches `handlerAction`, then `handlerEvents`, and a DM command produces a reply.
7. **Live acceptance test:** deploy only after approval, send a fresh DM to the bot account, and verify the redacted stage sequence plus one successful reply.

## 6. Change boundary / approval

- This branch currently contains only this investigation report; no runtime source code has been changed.
- No production Railway variables, session files, E2EE identity files, or database state have been modified.
- Before implementing a code fix or creating a deployment-triggering commit, present the proposed files/changes and obtain explicit approval.
- Do not mark live E2EE DM compatibility complete until a real Messenger DM is received, normalized, handled, and replied to successfully.

## 7. Source references

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
