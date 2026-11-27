# OmegA-FCA E2EE — Current Implementation Status

**Canonical plan:** [E2EE-ROADMAP.md](E2EE-ROADMAP.md)  
**Version:** `0.2.3-beta.3`  
**Branch:** `feature/release-0.2.3-beta.3`

This file records current implementation evidence only. The four-step roadmap is the sole authority for scope and completion criteria.

## Overall

**Step 1 is verified complete at the local engine/login-integration boundary. Steps 2–4 remain in progress.**

| Step | Current status | Implemented evidence | Main remaining work |
|---|---|---|---|
| 1. E2EE Engine & Login Integration | Verified complete | Real libsignal 0.70 runtime; authenticated UID validation; encrypted account-scoped store; automatic account-local key/device bootstrap; restart/account-isolation tests; fail-open login integration | None within Step 1. Facebook ICDC/server key publication is Step 2; native Messenger MQTT wire integration is Step 3 |
| 2. Facebook Device Registration & Key Sync | In progress | Authenticated login now passes the active cookie header and user agent into the E2EE lifecycle; when `e2ee.facebook.appId` and `e2ee.facebook.fbCat` are configured, the ICDC fetch/register helper is invoked with the persisted Signal identity and signed prekey; device metadata is persisted and registration is idempotent | Validate ICDC against an authorized live account; the WA-binary Signed PreKey + One-time PreKey IQ encoder/publisher and login hook are implemented; the publisher requires an already-authenticated Messenger Noise `sendIQ` transport and rejects missing/error IQ acknowledgements. The current FCA MQTT JSON transport is not that Noise transport, so automatic server publication is still unverified/not wired to a live socket. Kyber publication is not part of Meta's published Messenger device-registration format; keep it local-only unless a current server protocol proves support |
| 3. E2EE Messaging & Group System | In progress | Signal direct-message primitives with injected peer/bundle interfaces; Group Sender Keys/SKDM persistence and restart-safe retry; application-level encrypted group messaging | Native Messenger MQTT envelope integration, Facebook peer/device discovery and bundle exchange, direct/group wire compatibility and real interoperability |
| 4. Encrypted Media & Full Compatibility Test | In progress | Direct/group media crypto helpers, group-media application-level orchestration, local transport tests | Native Facebook media transport, image/video/file interoperability, EryXen comparison, authorized real-account tests |

## Implemented components

- `src/domains/e2ee/bootstrap.ts`: creates account-scoped identity metadata and automatically generates/reuses a local encryption key and device ID; no E2EE environment variable or manual key setup is required.
- `src/domains/e2ee/signal-key-store.ts`: encrypted persistence for Signal identity/session/prekey/group state and device metadata.
- `src/domains/e2ee/libsignal-adapter.ts`: adapter boundary for the selected libsignal implementation.
- `src/domains/e2ee/device-registration.ts`: Facebook ICDC registration helper, now wired into authenticated login when explicit Facebook app/category parameters are configured. A successful local test only proves request construction and lifecycle wiring; it does not prove Facebook server acceptance.
- `src/domains/e2ee/prekey-publisher.ts`: WA-binary `encrypt` IQ builder for the persisted Signal identity, signed prekey, and persisted one-time prekeys; requires an established Messenger Noise IQ transport and only reports publication after a matching `iq type=result` acknowledgement. It is not connected to the existing MQTT JSON socket.
- `src/domains/e2ee/direct-messages.ts` and `src/domains/e2ee/peer-manager.ts`: Signal direct-message primitives and transport-neutral peer/bundle interfaces; no native Facebook peer discovery or MQTT integration is claimed.
- `src/domains/e2ee/group-key-manager.ts` and `src/domains/e2ee/sender-keys.ts`: group Sender Key/SKDM handling and delivery state.
- `src/domains/e2ee/group-messaging.ts`: application-level encrypted group-message envelope orchestration over an injected authenticated transport.
- `src/domains/e2ee/encrypted-media.ts`, `src/domains/e2ee/encrypted-group-media.ts`, and `src/domains/e2ee/group-media-messaging.ts`: local media crypto and application-level group-media orchestration.

Local cryptographic foundations include X3DH/PQXDH orchestration, XEdDSA verification, and an experimental Double Ratchet. These are not by themselves proof of official Signal conformance or Messenger interoperability.

## Kyber protocol boundary

Meta's published Messenger E2EE overview defines device registration as a Curve25519 Identity Key, a signed Curve25519 Signed Pre Key, and a batch of Curve25519 One-Time Pre Keys. It does not define a Kyber/PQ prekey field or Kyber upload stanza. Therefore OmegA must not send its locally generated Kyber key to Facebook or mark Kyber publication complete based on a guessed payload. Keep local Kyber material isolated until a current, authoritative Messenger protocol or an authorized server response establishes the supported format. Reference: [Meta Messenger E2EE Overview — Device Registration](https://engineering.fb.com/wp-content/uploads/2023/12/MessengerEnd-to-EndEncryptionOverview_12-6-2023.pdf#page=7).

## ICDC login configuration

Enable E2EE and provide the Facebook ICDC application parameters in the login options:

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

The authenticated FCA login supplies its active cookie header and user agent internally; callers should not copy session cookies into configuration. If the Facebook parameters are omitted, OmegA initializes the local Signal runtime only and does not claim device registration. To publish the prekey bundle, the caller must also provide `e2ee.facebook.sendIQ` as an adapter backed by an already-authenticated Messenger Noise socket; do not connect this to the ordinary MQTT JSON client.

## Local storage security note

The generated store key is persisted in the account's local `identity.json` so it is reused automatically after restart. File/directory permissions are restricted where supported; this does not protect the key from someone who can read the same account's local files.

## Important boundaries

- Application-level group messaging/media adapters are not the same as native Messenger MQTT wire integration.
- Synthetic/mock tests do not establish Facebook server acceptance or cross-device interoperability.
- A passing CI run does not mean Messenger E2EE is active.
- Do not report E2EE as production-ready until the four roadmap acceptance sections are satisfied.

## Latest repository validation

Code baseline covered by the recorded CI run: `55d02c7044938e68db9de87aee319831f68c8950`

[CI run 45860381188](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/45860381188): **success**.

See [E2EE-ROADMAP.md](E2EE-ROADMAP.md) for the only approved four-Step checklist and progress rules.
