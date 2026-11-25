# Integration compatibility notes

This document records the integration-facing API contract verified from the current source tree.

## Confirmed login contract

```js
login(credentials, options, (error, api) => {
  if (error) return;
  // api is the flat compatibility API
});
```

The callback receives the flat API object, not the Promise context. Promise login remains available through `loginAsync()`.

## Core methods

- `getCurrentUserID()`
- `getAppState()`
- `getCookies()`
- `listenMqtt(callback)`
- `stopListening()`
- `stopListeningAsync()`
- `sendMessage()`
- `setMessageReaction()`
- `unsendMessage()`
- `getThreadInfo()`
- `getUserInfo()`

## Session persistence

The legacy API exposes `sessionGuard(accountFilePath, { interval, debounce })` and `stopSessionGuard()`. The guard binds saved AppState data to the authenticated account UID, validates the session cookie set, and writes through a restrictive temporary file followed by atomic rename. Synthetic tests cover identity matching and safe file replacement. Live cookie rotation remains unverified.

## Realtime lifecycle

The listener supports callback delivery and an emitter handle. Explicit stop cancels pending reconnect work and typing-indicator timers. MQTT readiness, reconnect acceptance, and real event payloads still require an authorized live session.

## Acceptance checklist

- [ ] Confirm CommonJS `require()` returns a callable login function.
- [ ] Confirm callback login receives a flat API object.
- [ ] Verify session getters without logging secrets.
- [ ] Verify listener start, callback event shape, stop, and restart.
- [ ] Verify send, reaction, unsend, thread-info, and user-info signatures.
- [ ] Run the consuming application's regression tests before switching dependencies.
- [ ] Perform authorized live-session validation separately from synthetic CI.

Source-level method presence and synthetic tests do not establish live service acceptance.