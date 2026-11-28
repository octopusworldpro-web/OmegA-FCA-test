# E2EE Direct Message Inbox — Current Investigation

**Status:** Blocked during Messenger CAT acquisition; live DM receive/reply is not working or verified  
**Reviewed:** 2026-11-28  
**FCA branch:** `investigation/e2ee-dm-inbox`  
**Current FCA branch head at review:** `1f740e790388f538eebca9cbb1daf7bbdb4d81ab`  
**Deployed GoatBot branch:** `test/e2ee-inbox-0.2.4-beta`  
**Deployed GoatBot commit:** `712dd95`  
**Loaded package:** `@nirzon-islam/omega-fca@0.2.4-beta.1`  
**Railway deployment:** `011818ae-3dc6-4920-aea1-d032460c1078` (SUCCESS)

> This file is the current source of truth for the DM Inbox investigation. Historical implementation notes remain in [E2EE-ROADMAP.md](E2EE-ROADMAP.md); older release checklists and superseded plans are not current instructions.

## 1. User-visible symptom

A direct message sent to the bot account's Messenger Inbox does not produce a GoatBot reply. Ordinary MQTT/group activity can continue; that does not prove the separate native Messenger E2EE Inbox transport is initialized.

## 2. Runtime evidence

The latest inspected Railway deployment shows:

- The deployed package is `@nirzon-islam/omega-fca@0.2.4-beta.1`.
- GoatBot E2EE is enabled (`e2ee.enable = true`) and `antiInbox = false`.
- Login/appstate and the local E2EE identity bootstrap complete.
- FCA reaches Messenger CAT acquisition, then logs:
  - `E2EE initialization skipped: Messenger CAT request returned an unsupported response body`
  - `FCA initialization status: failed`
  - `Native Messenger Inbox transport is unavailable`
- No `NOISE_MESSAGE_RECEIVED`, `E2EE_RECIPIENT_MATCHED`, `E2EE_DECRYPT_SUCCEEDED`, or `FCA_INBOX_CALLBACK_INVOKED` stages were found in the inspected deployment logs.

**Conclusion:** the current demonstrated blocker is CAT response handling. The native Inbox transport never reaches the stage where incoming DM delivery can be tested. The earlier `EISDIR` Signal-store path issue is no longer the current observed blocker.

## 3. Source-level diagnosis (high confidence; exact runtime body shape not yet captured)

Files reviewed:

- `src/core/login-helper.impl.ts`
- `src/domains/e2ee/messenger-cat.ts`
- `test/e2ee-cat.test.cjs`

The login adapter extracts `response.data ?? response.body ?? response` from the HTTP client and passes the result to the CAT parser. The parser currently accepts text strings and wrappers containing text, but rejects an already-parsed JavaScript object. The current test covers a string body, not an Axios-style parsed GraphQL object.

This is consistent with the runtime error, but the exact response shape, HTTP status, content type, GraphQL envelope, and error fields have not yet been safely captured. Do not state that Facebook definitely returned parsed JSON until diagnostics confirm it.

## 4. Required work, in order

1. **Normalize CAT responses:** accept supported text and parsed-object forms without changing existing valid behavior.
2. **Add CAT tests:** raw text, parsed GraphQL object, GraphQL errors, malformed response, missing CAT, and unsupported body.
3. **Add safe diagnostics:** record response type, HTTP status, content type, safe key names, and sanitized GraphQL error metadata. Never log CAT, cookies, tokens, raw response bodies, or message content.
4. **Verify device registration:** confirm the ICDC registration/reuse response and resulting WA device identity.
5. **Verify Noise transport:** confirm WebSocket connection, Noise handshake, and IQ acknowledgement.
6. **Verify prekeys:** confirm prekey publication acknowledgement and persisted state.
7. **Verify inbound delivery:** observe `NOISE_MESSAGE_RECEIVED`, recipient match, Signal decrypt, and application event.
8. **Verify FCA callback:** observe exactly one `FCA_INBOX_CALLBACK_INVOKED` for the test message.
9. **Verify GoatBot and encrypted reply:** confirm command execution and exactly one `sendDirectText` reply to the originating thread.
10. **Run live acceptance:** authorized real Messenger DM → one encrypted GoatBot reply, with duplicate/retry and normal MQTT regression checks.

No downstream stage (device registration through encrypted reply) is currently proven by the latest runtime logs. Source fixtures or a successful deployment alone do not count as live acceptance.

## 5. GoatBot source review

The test branch has E2EE-aware event handling, bypasses the ordinary anti-inbox filter for E2EE events, and routes known E2EE-thread replies through `sendDirectText` rather than falling back to plaintext MQTT. Static review did not identify GoatBot command handling as the current primary blocker. Runtime handler execution remains unverified because CAT fails first.

The test branch uses the npm `beta` dist-tag and its Docker install flow resolves the beta package; Railway logs confirmed the actual installed version above. Do not merge this branch into GoatBot main without separate explicit authorization.

## 6. Separate security actions — urgent

A previous repository review found session-cookie material tracked in `account.txt` and credential-like values in `config.json` on the GoatBot test branch. Treat any live credentials in those files as exposed:

- Revoke the Facebook session / log out other sessions.
- Rotate affected OAuth, Pastebin, and database credentials.
- Move secrets to Railway environment variables.
- Remove secret-bearing files from tracking and purge exposed values from Git history.

No credential values are reproduced here. These actions are separate from the CAT bug and have not been performed by this documentation update.

## 7. Current status and change boundary

- The CAT response mismatch is a source-level diagnosis, not yet a code fix.
- No source code, tests, package version, npm dist-tag, release tag, Railway deployment, GoatBot main branch, or production configuration was changed as part of this report update.
- Do not claim E2EE Inbox/DM success until the live end-to-end acceptance test passes.
- Next implementation work is limited to the FCA branch `investigation/e2ee-dm-inbox`; inspect the current source again before editing and obtain approval before any code change or commit.
