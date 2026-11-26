# E2EE Step 1 — Local Runtime Setup

E2EE is opt-in. Existing FCA login and ordinary MQTT/message handling remain unchanged unless E2EE is explicitly enabled.

## Enable the local runtime

Set a stable secret in the process environment before starting the bot:

```bash
export OMEGA_FCA_E2EE_MASTER_KEY="replace-with-a-random-secret-at-least-32-bytes"
```

Keep this secret in your hosting provider's secret/environment-variable manager. Do not commit it, print it in logs, or share it. The same secret must be supplied after restarts and deployments so the encrypted Signal store can be reopened.

Then enable E2EE in FCA options:

```js
login(
  { appState: require("./appstate.json") },
  {
    listenEvents: true,
    e2ee: { enabled: true }
  },
  (error, api) => {
    if (error) return console.error(error);
    console.log("E2EE status:", api.e2ee.status);
  }
);
```

You can instead pass a stable e2ee.encryptionKey string/Buffer directly in options. Prefer an environment secret in production.

## Storage and failure behavior

- Per-account identity metadata and encrypted Signal state are stored under OMEGA_FCA_DATA_DIR (default: ./data/e2ee/).
- identity.json contains account-scoped metadata only; it does not contain the store encryption key.
- The key is required to decrypt the Signal store after restart. Losing it means the existing local E2EE state cannot be reopened.
- If the key is missing or runtime initialization fails, api.e2ee.status is failed and ordinary FCA login continues. E2EE is not active in that state.
- api.e2ee.close() closes the local E2EE store. Call it when explicitly shutting down the E2EE runtime.
- E2EE initialization does not send password, 2FA, AppState, or cookies to an external credential service.

## Existing legacy metadata

Older identity.json files may contain a plaintext encryptionKey. The new bootstrap rejects this legacy format rather than continuing to leave the key exposed. Back up the account's E2EE directory before attempting migration; do not delete the old store or metadata until a migration procedure has been applied.

## Scope boundary

This setup activates the local Signal engine and FCA login integration only. Facebook ICDC device registration/key publication and native Messenger encrypted MQTT interoperability are tracked in Steps 2 and 3 of E2EE-ROADMAP.md.
