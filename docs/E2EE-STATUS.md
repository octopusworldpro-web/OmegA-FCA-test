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
