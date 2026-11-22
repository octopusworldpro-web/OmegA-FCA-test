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
| `sessionGuard()` | Not present in uploaded source |
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
