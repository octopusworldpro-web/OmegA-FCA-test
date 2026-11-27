# OmegA-FCA E2EE — Current Implementation Status

**Canonical plan:** [E2EE-ROADMAP.md](E2EE-ROADMAP.md)  
**Version:** `0.2.3-beta.3`  
**Branch:** `feature/release-0.2.3-beta.3`

This file records source-level implementation evidence and its limits. The four-step roadmap is the sole authority for scope and completion criteria.

## Overall

**Step 1 is verified complete for local Signal runtime and FCA login lifecycle integration. Steps 2–4 remain in progress. Live Facebook/Messenger interoperability is not established.**

| Step | Status | Implemented evidence | Main remaining work |
|---|---|---|---|
| 1. E2EE Engine & Login Integration | Verified complete (local boundary) | Pinned libsignal 0.70.0; authenticated UID validation; account-local bootstrap and encrypted store; automatic identity/device metadata; restart support; fail-open login integration | No remaining work within the stated local-engine/login boundary. Do not interpret this as server registration or native Messenger support |
| 2. Facebook Device Registration & Key Sync | In progress | Login calls ICDC registration when Facebook app/category options are supplied; authenticated cookies/user agent are passed internally; device metadata persistence/idempotency; WA-binary prekey IQ builder and ACK validation | No live Facebook acceptance evidence; publication requires caller-provided authenticated Messenger Noise `sendIQ`; default FCA login does not create that transport; no verified Kyber upload format |
| 3. E2EE Messaging & Group System | In progress | Signal direct-message primitives; injected peer/bundle interfaces; Sender Key/SKDM persistence/retry; application-level group envelope orchestration | Native peer discovery/bundle exchange and direct/group Messenger MQTT wire integration; real compatible-device tests |
| 4. Encrypted Media & Full Compatibility Test | In progress | Direct/group media crypto helpers and application-level group-media orchestration | Native Messenger media upload/download, real media interoperability, EryXen comparison, authorized real-account acceptance |

## Implemented components and boundaries

- `src/domains/e2ee/bootstrap.ts`: creates account-scoped local identity metadata and automatically generates/reuses a local encryption key and device ID. No E2EE environment variable or manual key setup is required for the default local bootstrap.
- `src/domains/e2ee/signal-key-store.ts`: encrypted persistence for Signal identity/session/prekey/group state and device metadata.
- `src/domains/e2ee/libsignal-adapter.ts`: adapter boundary for the selected libsignal implementation.
- `src/domains/e2ee/runtime.ts`: initializes local Signal identity, signed prekey, one-time EC prekeys, and Kyber prekeys when the installed libsignal module supports KEM generation. Runtime comments explicitly limit this to local identity/prekey initialization.
- `src/domains/e2ee/login-integration.ts`: opt-in login lifecycle. It initializes the local runtime; if `facebook.appId` and `facebook.fbCat` are configured, it calls the ICDC helper using the authenticated session cookie header and user agent. If `facebook.sendIQ` is also supplied, it invokes the prekey publisher. Errors close the partial runtime and return a failed E2EE result.
- `src/core/login-helper.impl.ts`: invokes `initializeE2EEForLogin` after authenticated UID validation and ordinary FCA/MQTT setup. It passes the active cookie header and configured user agent. It passes an empty factory-dependency object; it does not create a Messenger Noise IQ adapter. E2EE failures are logged and normal FCA login still succeeds.
- `src/core/state.ts`: exposes the opt-in `e2ee` option and optional `facebook.sendIQ` callback. The callback contract explicitly requires an already-authenticated Messenger Noise IQ transport; ordinary MQTT JSON is incompatible.
- `src/domains/e2ee/device-registration.ts`: ICDC request construction, response validation, and persisted device metadata. Its tests use a mocked fetcher; they do not demonstrate Facebook server acceptance.
- `src/domains/e2ee/prekey-publisher.ts`: builds the WA-binary `encrypt` IQ for identity, signed prekey, and one-time Curve25519 prekeys. It requires an injected `sendIQ` function and checks the matching IQ result acknowledgement. Tests use a simulated adapter response, not a live Noise socket.
- `src/domains/e2ee/direct-messages.ts` and `src/domains/e2ee/peer-manager.ts`: Signal direct-message primitives and transport-neutral peer/bundle interfaces. No native Facebook peer discovery or MQTT envelope integration is established.
- `src/domains/e2ee/group-key-manager.ts` and `src/domains/e2ee/sender-keys.ts`: group Sender Key/SKDM handling and delivery state.
- `src/domains/e2ee/group-messaging.ts`: application-level encrypted group-message envelope orchestration over an injected authenticated transport.
- `src/domains/e2ee/encrypted-media.ts`, `src/domains/e2ee/encrypted-group-media.ts`, and `src/domains/e2ee/group-media-messaging.ts`: local media crypto and application-level group-media orchestration; not native Facebook media transport.

Local cryptographic foundations include X3DH/PQXDH orchestration, XEdDSA verification, and an experimental Double Ratchet. Their presence is not, by itself, proof of official Signal conformance or Messenger interoperability.

## Kyber / post-quantum boundary

The current source generates and stores local Kyber material only when the libsignal KEM API is available. The documented Messenger device-registration format describes a Curve25519 identity key, signed Curve25519 Signed Pre Key, and Curve25519 One-Time Pre Keys; it does not specify a Kyber upload field or stanza. OmegA must not upload a guessed Kyber payload or label Kyber publication complete. Keep the local PQ material isolated unless a current authoritative Messenger protocol or an authorized server response establishes the supported format.

Reference: [Meta Messenger E2EE Overview — Device Registration](https://engineering.fb.com/wp-content/uploads/2023/12/Messenger-End-to-EndEncryptionOverview_12-6-2023.pdf#page=7).

## ICDC and prekey configuration

Enable the local runtime and optionally configure ICDC registration through login options:

```js
{
  e2ee: {
    enabled: true,
    facebook: {
      appId: "<verified Messenger app ID>",
      fbCat: "<verified Facebook category>"
    }
  }
}
```

When the Facebook parameters are present, the authenticated FCA login supplies its active cookie header and user agent internally. Do not copy session cookies into configuration. If the Facebook parameters are omitted, OmegA initializes only the local Signal runtime and does not attempt ICDC registration.

Prekey publication is a separate conditional operation. Supply `facebook.sendIQ` only if the caller has a real, already-authenticated Messenger Noise IQ transport. The ordinary FCA MQTT JSON client is not a valid implementation of that callback. A successful mocked IQ test proves only the publisher's local contract, not server publication.

## Local storage security note

The generated store key is persisted in the account's local `identity.json` so it is reused automatically after restart. File/directory permissions are restricted where supported; this does not protect the key from someone who can read the same account's local files.

## Important boundaries

- ICDC helper invocation is not equivalent to successful Facebook device registration.
- A generated WA-binary prekey stanza is not proof of server acceptance.
- Application-level group messaging/media adapters are not native Messenger MQTT/media integration.
- Synthetic/mock tests do not establish Facebook server acceptance or cross-device interoperability.
- A passing CI run does not mean Messenger E2EE is active.
- Do not report E2EE as production-ready until all four roadmap acceptance sections are satisfied.

## Validation record

The previously recorded CI run [45860381188](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/45860381188) covered baseline commit `55d02c7044938e68db9de87aee319831f68c8950` and reported success. This historical result is not validation of the current branch head, and it does not establish live Facebook/Messenger interoperability.

See [E2EE-ROADMAP.md](E2EE-ROADMAP.md) for the only approved four-Step checklist and progress rules.


## Progress log

### 2026-11-27 — Initial documentation baseline review

**Scope:** Start tracking E2EE implementation work on `feature/release-0.2.3-beta.3`. The canonical four-Step scope in [E2EE-ROADMAP.md](E2EE-ROADMAP.md) is preserved; this log does not introduce or replace the approved roadmap.

**Source review findings**
- Step 1 remains verified complete within its documented local Signal runtime and FCA login lifecycle boundary: automatic local bootstrap, encrypted account-scoped storage, libsignal runtime setup, and fail-open login integration are present.
- Step 2 has implementation groundwork only: conditional ICDC registration and a WA-binary prekey publisher exist, but the login helper does not provide a native authenticated Messenger Noise `sendIQ` transport. Live Facebook registration/publication is not evidenced.
- Step 3 has local Signal direct/group primitives and transport-neutral orchestration, but native Messenger peer/bundle discovery and MQTT encrypted-envelope integration are not evidenced.
- Step 4 has local direct/group media cryptography and application-level orchestration, but native Messenger media transport and real-device acceptance are not evidenced.

**Validation**
- Repository test scripts include E2EE unit/integration tests, including login integration and real-libsignal runtime tests.
- Tests were **not run as part of this documentation review**. No new test-pass claim is made.
- No live Facebook/Messenger acceptance test was run. No server interoperability claim is made.
- No source-code changes were made in this baseline documentation update.

**Next work:** Continue with the canonical roadmap's next incomplete requirement. After each implementation task, update this status log with exact files changed, test commands/results, evidence, and remaining blockers before claiming progress.


### 2026-11-27 — Follow-up source audit

**Audit result:** The four-step status table above remains accurate. Step 1 is verified complete only for the local Signal engine and FCA login lifecycle boundary. Steps 2–4 contain implementation groundwork but do not meet their full acceptance criteria.

**Step 1 evidence rechecked**
- `bootstrap.ts` and `signal-key-store.ts`: automatic account-scoped bootstrap, generated/reused local device metadata, encrypted persistence, and restart support.
- `runtime.ts` and `libsignal-adapter.ts`: pinned libsignal integration and local identity/registration ID/Signed PreKey/One-time EC PreKey setup; Kyber generation is conditional on KEM support.
- `login-integration.ts`, `login-helper.impl.ts`, and `state.ts`: opt-in E2EE lifecycle after authenticated FCA login, authenticated session context passed internally, and fail-open handling so E2EE initialization failure does not abort ordinary login.

**Test files reviewed (not executed in this audit)**
- `test/e2ee-bootstrap.test.cjs`: automatic key persistence and account isolation.
- `test/e2ee-runtime-real.test.cjs`: installed libsignal runtime, prekey generation, persistence/restart reuse, and account isolation.
- `test/e2ee-login-integration.test.cjs`: disabled/ready/failed lifecycle paths, authenticated context forwarding, and cleanup on failure.
- `test/e2ee-runtime.test.cjs`: runtime lifecycle and restart persistence using a test Signal adapter.
- `test/signal-key-store.test.cjs`: encrypted state persistence, account binding, and key/session/prekey operations.

**Remaining gaps confirmed**
- Step 2: ICDC and PreKey helper implementations exist, but the standard FCA login path does not construct/provide the authenticated Messenger Noise `sendIQ` transport. No live Facebook registration or PreKey acceptance evidence was obtained.
- Step 3: direct/group Signal primitives and injected transport orchestration exist, but native Messenger peer/device discovery, bundle exchange, and MQTT encrypted send/receive integration remain unverified.
- Step 4: direct/group media cryptography and callback-based upload/download composition exist, but native Messenger media transport, real-device interoperability, and EryXen comparison remain outstanding.

**Validation limits**
- No test suite, build, typecheck, or lint command was run during this source audit.
- The queried combined CI status for commit `2a04b6cf87ac05ae41c22e1da6e6ff9ca8c8752e` was an empty status list (`[]`), not a passing check.
- No authorized live Facebook/Messenger account or cross-device acceptance test was performed.
- No source-code files were modified by this audit; this update records findings only.

**Conclusion:** Keep Step 1 verified complete at its stated local-engine/login boundary. Keep Steps 2, 3, and 4 in progress. Do not interpret the existing helper modules or test files as proof of live Messenger E2EE interoperability.


## 2026-11-27 — Step 2 recheck report

**Reviewed branch head:** `f94a6633934e1303bb06a43915acf531a2adae82`  
**Source changes in this recheck:** none; documentation report only.

### Findings

- ICDC registration is conditional on explicitly supplied `e2ee.facebook` options. The helper posts to `fb_icdc_fetch` and `fb_register_v2` and validates a particular response shape, but no live Facebook response was observed. Treat endpoint and payload compatibility as unverified.
- PreKey publication is conditional on a caller-provided authenticated `facebook.sendIQ` adapter. The regular login path passes no such adapter and does not create a Messenger Noise IQ connection.
- The runtime restores the full stored EC prekey list, and the publisher sends the full list whenever invoked. The key store does not persist which EC prekeys have been acknowledged by the server. Startup replenishment exists only as local count-based generation; no background replenishment or signed-prekey rotation policy is implemented.
- Kyber key material remains local-only. No server-side Kyber format is established by the checked implementation.

### Verification

- GitHub Actions [run 45963767306](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/45963767306) passed on the reviewed branch head. The job passed dependency/security audit, build and tests, TypeScript check, lint, and package dry run.
- CI success is not live Facebook ICDC acceptance and does not prove Messenger Noise transport or key publication interoperability.
- No authorized live-account test was run during this recheck.

### Next implementation targets

1. Integrate a real authenticated Messenger Noise IQ transport into the existing login session without routing through ordinary MQTT JSON.
2. Verify ICDC endpoint fields and response contract against an authorized live account before changing the registration payload.
3. Add persisted server-acknowledgement/publication state for EC prekeys, and make upload/retry idempotent.
4. Add a bounded replenishment and signed-prekey rotation/retirement policy, with restart/recovery tests.
5. Verify each behavior against the real server; keep E2EE failures fail-open for ordinary FCA login.

**Step 2 status: In progress — not complete.**
