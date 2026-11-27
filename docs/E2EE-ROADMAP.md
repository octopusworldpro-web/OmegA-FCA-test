# OmegA-FCA — Canonical E2EE Completion Plan

**Version:** `0.2.3-beta.3`  
**Branch:** `feature/release-0.2.3-beta.3`  
**Authority:** This is the single source of truth for E2EE scope, acceptance criteria, and progress. The plan contains exactly four Steps. Older E2EE task lists and previous multi-step checklists are superseded.

## Overall status

**Step 1 is verified complete for the local Signal engine and FCA login lifecycle boundary. Step 2 is verified complete for the user-approved offline source/fixture scope. Step 3's native text messaging implementation is now integrated and covered by offline fixtures; live cross-device acceptance remains pending. Step 4 remains in progress. No live Facebook/Messenger interoperability or production readiness is claimed.**

- Step 1: Verified complete — local engine and fail-open FCA login lifecycle
- Step 2: Verified complete — automatic CAT/ICDC, authenticated Noise XX key-sync transport, acknowledged prekey publication, replenishment/rotation, bounded retry, restart recovery, and offline CI/fixture acceptance. Live Facebook acceptance was explicitly waived by the user.
- Step 3: Native text messaging, persistent encrypted outbox/restart replay, and automatic group member/device-change Sender Key rotation implemented; offline CI verification pending and authorized live acceptance remains separately pending
- Step 4: In progress — local media crypto helpers exist; native media transport and real-device acceptance remain

A Step is complete only after its code, tests, required integration, and acceptance evidence are present. Unit tests, mocks, helper modules, and CI success do not by themselves prove Messenger interoperability.

## Step 1 — E2EE Engine & Login Integration

**Scope**
- Automatic compatible libsignal engine setup.
- Reuse the existing authenticated FCA session; do not add an external credential relay.
- Account-scoped automatic identity and key-store bootstrap, with no new environment-variable or manual key setup.
- Fail-open behavior: E2EE initialization failure must not break ordinary FCA login, MQTT, humanizer, or regular messaging.
- Preserve the existing FCA login API and configuration.

**Implemented in the current source**
- `@signalapp/libsignal-client` is pinned to `0.70.0` and loaded by the E2EE bootstrap unless an explicit compatible module override is supplied.
- After authenticated UID validation and ordinary FCA/MQTT setup, `login-helper.impl.ts` calls `initializeE2EEForLogin` with that UID, the E2EE options, and the active cookie header/user agent.
- E2EE is opt-in. With `e2ee.enabled` absent/false, the E2EE lifecycle returns disabled.
- Local Signal runtime creates/reuses the identity, registration ID, signed prekey, one-time EC prekeys, and Kyber prekeys when the selected libsignal module exposes KEM generation.
- Account-specific storage directory, encryption key, and local device ID are provisioned automatically. The local store persists encrypted Signal state and supports restart reuse.
- E2EE initialization errors are caught and exposed as `api.e2ee.status === "failed"`; ordinary FCA login continues (fail-open).
- The E2EE login integration and real-libsignal runtime have repository tests. These verify local behavior, not Facebook acceptance.

**Storage security boundary**
- The automatically generated store key is persisted in the account's local `identity.json` to support restart without manual key setup. File/directory permissions are restricted where supported. This does not protect the key from someone who can read the same account's local files.

**Acceptance boundary**
- Step 1 covers local runtime creation and FCA login lifecycle integration only. It does not mean Facebook device registration, server key publication, native MQTT encryption, or end-to-end interoperability is complete.

## Step 2 — Facebook Device Registration & Key Sync

<badge label="Verified complete — offline scope" color="success"/>

**Scope**
- Facebook ICDC device registration.
- Persistent identity key and Facebook E2EE device ID/registration metadata.
- Signed PreKey and One-time PreKey publishing and synchronization using the authenticated Messenger Noise transport.
- Safe prekey replenishment, rotation, retry, and restart recovery.
- Keep Kyber/PQ material local unless an authoritative current Messenger protocol specifies a supported server format.

**Implemented**
- `messenger-cat.ts` retrieves the Messenger CAT from the authenticated FCA GraphQL request using the reverse-engineered `MAWCatQuery` document ID. CAT is fetched automatically; callers no longer need to paste it into configuration.
- `device-registration.ts` performs ICDC fetch/register, uses the audited Messenger E2EE app ID by default, converts CAT to the distinct fetch/register wire encodings, validates ICDC identity keys and response fields, and persists device metadata. Existing device records are reused idempotently.
- `messenger-noise.ts` implements the Noise XX handshake state machine, X25519 DH/HKDF/AES-GCM handshake operations, Messenger client payload encoding, encrypted frame counters, and strict certificate-chain verification through the existing verifier.
- `messenger-noise-socket.ts` opens the Messenger E2EE WebSocket endpoint, performs the authenticated handshake, waits for the server success stanza, encrypts/decrypts frames, decodes the IQ response node, and correlates IQ acknowledgements by request ID.
- `login-integration.ts` now obtains CAT, registers/reuses the device, opens the Noise socket by default, and publishes pending prekeys through that socket. A caller-supplied `sendIQ` remains available as an explicit test/custom transport override; it is not required by the standard path.
- Transient Noise connection failures receive up to three bounded attempts. When CAT was fetched automatically, it is refreshed before a retry. Certificate/verification failures are not treated as retryable network errors.
- `signal-key-store.ts` persists publication acknowledgements and a monotonic prekey ID high-water mark. Consumed key IDs are never reused, including after restart or when the published key record has been removed.
- `runtime.ts` replenishes the local one-time-prekey pool to its configured target and rotates an expired signed prekey while retaining the prior record. `prekey-publisher.ts` performs maintenance before upload and persists acknowledgement only after a matching `iq type=result`.
- The existing FCA behavior remains opt-in and fail-open. A failed E2EE initialization does not block ordinary FCA login.

**Offline verification evidence**
- CAT GraphQL request/response fixture and malformed/missing-token cases.
- ICDC identity decoding, request construction, response validation, idempotent device reuse, and CAT wire-encoding fixtures.
- Synthetic Messenger Noise server fixture verifies the XX state-machine transcript, client static-key binding, client payload, and directional encrypted-frame keys. The fixture injects a certificate-verifier seam; production uses the strict pinned-root verifier.
- Strict certificate-verifier negative tests cover missing, malformed, duplicate, and invalid-size certificate input. No captured valid live-server certificate chain was used.
- Messenger binary-node fixtures cover success and IQ-result parsing, request ID/type fields, and truncated input.
- Prekey IQ acknowledgement, duplicate suppression, persisted acknowledgement, monotonic ID reservation, local replenishment, signed-prekey rotation, retry, and restart recovery tests.
- Full repository CI for source commit `a8ac8ba135c42dfa10b63c9162ae5a8f363e6a02` passed: dependency/security audit, build and tests, TypeScript check, lint, and package dry run. See [Actions run 46031336965](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46031336965).

**Acceptance boundary and limitations**
- Step 2 is complete against the explicitly approved offline source/fixture criteria. The user explicitly waived a live Facebook account test; no live login, live ICDC acceptance, or real-server prekey acknowledgement was performed or claimed.
- The Noise handshake success fixture uses a synthetic server and injected certificate-verifier seam. The production verifier is strict and fail-closed, but a captured valid Messenger root-signed certificate fixture is not available in this repository.
- The long-lived incoming encrypted-message event loop, active-session reconnect handling, MQTT envelope integration, and E2EE message send/receive belong to Step 3; Step 2 establishes the authenticated key-sync transport and startup/restart path.
- Kyber/PQ material remains local-only. No verified Messenger Kyber upload field/stanza is implemented.
- A passing offline suite proves the implemented reverse-engineered contract and local state transitions only. It does not prove that Facebook currently accepts the unofficial wire format.

**Explicitly not required for Step 2 completion:** signing into a live Facebook account or performing a live server acceptance test. Live interoperability may be recorded later as an optional confidence check; it must never be fabricated or represented as having passed.
## Step 3 — E2EE Messaging & Group System

**Scope**
- Native Messenger E2EE Noise WebSocket encrypted send/receive and decrypt integration (separate from FCA's ordinary MQTT JSON event channel).
- Direct-message encryption and peer/device bundle exchange.
- Group Sender Keys/SKDM, encrypted group messaging, membership/device changes, and key rotation.
- Preserve ordinary non-E2EE message/event handling.

**Implemented — offline source scope**
- Full WA-binary decoder/encoder integration with recursive nodes and binary payload preservation; Noise socket dispatches unsolicited message/receipt nodes and correlates IQ replies without dropping unrelated events.
- Native Messenger device-directory and encrypt-IQ PreKeyBundle discovery, including conversion to libsignal's native PreKeyBundle and per-device session establishment.
- Direct text fanout to remote and own devices, including self-device DSM; incoming `msg`/`pkmsg` participant payloads are decrypted and decoded.
- Group Sender Key/SKDM distribution over encrypted direct sessions, group `skmsg` send/receive/decrypt, and an explicit membership-sync/key-rotation API.
- Server stanza acknowledgements, bounded retry receipts, inbound duplicate suppression, Noise reconnect with CAT refresh, and durable encrypted-stanza outbox replay after process restart until server acknowledgement.
- Encrypted outbox entries are stored in the existing account-scoped encrypted Signal store before transmission and removed only after a matching server message ACK.
- Group member/device snapshots are persisted. Group sends compare the current member-device directory with the prior snapshot and rotate Sender Keys when it changes; tracked groups are rechecked after reconnect and rotation is automatic.
- FCA login exposes `api.e2ee.sendDirectText()`, `api.e2ee.sendGroupText()`, `api.e2ee.syncGroupMembership()`, and the `api.e2ee.messenger` event emitter when `e2ee.facebook` is configured.
- Offline fixtures cover recursive WA-binary parsing, binary ciphertext/JID round-trips, peer/device and PreKeyBundle parsing, reconnect/outbox replay, and direct/group text send plus inbound decrypt/event delivery.

**Media event API**

The native Messenger service emits typed media events after decrypting the Signal application envelope:

```js
api.e2ee.messenger.on("direct_media", async (event) => {
  const bytes = await api.e2ee.downloadDirectMedia(event.envelope, event.sender);
});
api.e2ee.messenger.on("group_media", async (event) => {
  const bytes = await api.e2ee.downloadGroupMedia(event.envelope, {
    groupId: event.groupId,
    sender: event.sender
  });
});
```

Ordinary text continues to emit through `message`; media envelopes are not exposed as chat text.

**API usage**
Native Messenger transport is enabled by opting in with `e2ee: { enabled: true, facebook: {} }`. Omitting `facebook` intentionally creates only the local Signal runtime.

```js
await api.e2ee.sendDirectText("PEER_ID", "Hello");
await api.e2ee.sendGroupText("GROUP_JID@g.us", "Hello group");
api.e2ee.messenger.on("message", (message) => {
  // message: { id, threadId, senderJid, senderId, text, timestampMs }
});
await api.e2ee.syncGroupMembership("GROUP_JID@g.us");
```

**Still required for verified completion**
- Authorized live-account direct/group send/receive tests with compatible devices; no live server acceptance is claimed.
- Verify receipts, out-of-order delivery, and replay/recovery behavior on real Messenger devices.
- Media payloads and upload/download transport remain Step 4 scope.

**Acceptance**
- A real authorized test account exchanges encrypted direct messages with a compatible peer.
- Receiver decrypts successfully and session state remains consistent.
- Group messages work across authorized devices using Messenger-compatible wire formats.
- Ordinary FCA messaging remains backward-compatible.

## Step 4 — Encrypted Media & Full Compatibility Test

**Scope**
- Image/video/file encryption and decryption.
- Encrypted media upload/download transport and metadata integration.
- EryXen protocol comparison.
- Reconnect, restart, multi-device, and authorized real-account interoperability tests.

**Implemented groundwork**
- Direct and group media cryptographic helpers using a fresh 64-byte attachment key, AES-256-CBC encryption, and truncated HMAC-SHA256 authentication; the attachment key is wrapped in the recipient's Signal session or group Sender Key.
- Direct-media envelope orchestration now binds the wrapped key and encrypted metadata to the exact selected Signal recipient device. Group-media envelope orchestration sends its descriptor through the native group Signal text path.
- FCA login exposes opt-in `api.e2ee.sendDirectMedia` and `api.e2ee.sendGroupMedia`; both upload ciphertext only through the existing `api.uploadAttachment` path, then attach the returned pre-uploaded IDs to the target thread using the unchanged legacy `api.sendMessage` attachment tuple path. The Signal-encrypted envelope carries the attachment message reference and key metadata. `api.e2ee.downloadDirectMedia` and `downloadGroupMedia` resolve the attachment through `api.getMessage`, enforce HTTPS Facebook CDN host allowlists, and download bytes before verifying ciphertext digest, MAC, dimensions, and expected peer/group context.
- Added direct media upload/download/decrypt fixtures and included them in the full package test command. Existing group-media tests continue to cover ciphertext-only upload, receive/decrypt, and sender/group validation.

**Still required**
- Direct-media send now discovers every peer device and independently wraps the media key in each device's Signal session. Delivery continues when one device fails; successful device deliveries are returned, while partial failures emit `direct_media_partial_delivery` and per-device `e2ee_error`. Each device currently receives its own encrypted upload (correct but not bandwidth-optimal). Source commit: `d43411fc03451daab0c5553f87682ead064b9bc6`.
- The implemented media wire design deliberately uses the existing FCA/EryXen-compatible attachment upload/send/getMessage channel for ciphertext bytes; media key and descriptor travel only inside the Signal-encrypted application envelope. Incoming decrypted `direct_media` and `group_media` envelopes are now dispatched as typed `messenger` events rather than ordinary chat text. This is an application-envelope integration, not evidence of Meta's native encrypted-media stanza contract.
- Verify direct and group media interoperability with compatible Facebook E2EE devices.
- Complete the EryXen protocol/reference comparison and document observed differences; do not copy unverified assumptions.
- Run authorized real-account tests for fresh login, reconnect, restart, multiple devices, and recovery.
- Verify receipts and attachment lifecycle where supported by the target protocol.

**Acceptance**
- Encrypted media is sent and received across authorized compatible devices.
- EryXen comparison is documented with evidence.
- Real-account interoperability evidence is recorded separately from mock/unit tests.
- Full build, tests, typecheck, lint, and package validation pass.

## Verification record

The previously recorded CI run [45860381188](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/45860381188) covered baseline commit `55d02c7044938e68db9de87aee319831f68c8950` and reported success. This is historical repository-check evidence only; it is not evidence for the current branch head or for live Messenger interoperability.

A documentation-only commit does not rerun or certify the source test suite. Check CI for the exact commit under review before using it as current validation evidence.

## Reporting rules

- Report progress only against these four Steps.
- Use **Implemented**, **In progress**, **Blocked**, and **Verified complete** precisely.
- Do not mark a Step complete based only on helper code, mocked tests, or CI.
- Distinguish “login lifecycle invokes a configured helper” from “Facebook accepted the request”.
- Distinguish “publisher can encode/send through an injected adapter” from “a live Messenger Noise transport is integrated”.
- Do not reintroduce superseded Labyrinth backup/restore, key-transparency, alias-parity, or other older audit-list items into this four-Step plan unless the user explicitly changes the scope.


### 2026-11-27 — Follow-up source audit

- Rechecked the Step 1 scope against `bootstrap.ts`, `runtime.ts`, `signal-key-store.ts`, `libsignal-adapter.ts`, `login-integration.ts`, `login-helper.impl.ts`, and `state.ts`. The source contains automatic account-scoped local bootstrap, libsignal runtime initialization, persistent encrypted Signal state, authenticated FCA login lifecycle invocation, and fail-open handling.
- Reviewed the repository tests `e2ee-bootstrap.test.cjs`, `e2ee-runtime-real.test.cjs`, `e2ee-login-integration.test.cjs`, `e2ee-runtime.test.cjs`, and `signal-key-store.test.cjs`. These test files cover local bootstrap/account isolation, real libsignal runtime and restart reuse, login integration/fail-open behavior, and encrypted store persistence. They are test coverage evidence only; they were not executed during this audit.
- Step 2 source contains ICDC registration and WA-binary PreKey IQ helper code, but the normal FCA login path does not supply a native authenticated Messenger Noise IQ adapter. Mocked callback acknowledgement is not live server acceptance.
- Step 3 source contains direct-message and group Signal primitives/orchestration, but native Messenger peer/bundle discovery and MQTT encrypted-envelope integration remain unverified.
- Step 4 source contains direct/group media encryption and callback-based upload/download orchestration, but native Messenger media transport and real-device interoperability remain unverified.
- **Verification limitation:** no test command was executed in this audit. The queried combined status for documentation commit `2a04b6cf87ac05ae41c22e1da6e6ff9ca8c8752e` returned an empty status list; this is not a passing CI result and does not validate the current source head.
- **Conclusion:** retain Step 1 as verified complete only within its explicitly documented local-engine/FCA-login boundary. Steps 2–4 remain in progress. No live Facebook/Messenger acceptance or production-readiness claim is made.


### 2026-11-27 — Step 2 implementation recheck (branch head `f94a6633934e1303bb06a43915acf531a2adae82`)

- Rechecked `device-registration.ts`, `prekey-publisher.ts`, `login-integration.ts`, `login-helper.impl.ts`, `state.ts`, `runtime.ts`, `libsignal-adapter.ts`, `signal-key-store.ts`, and the E2EE test commands in `package.json`.
- Confirmed the ICDC helper is called only when `e2ee.facebook` is explicitly supplied. It posts to the hard-coded `fb_icdc_fetch` and `fb_register_v2` endpoints and accepts only the expected mocked `status === 200` response shape. This is source-level behavior, not evidence that the current Facebook service accepts those fields or responses.
- Confirmed the prekey publisher requires a caller-provided `facebook.sendIQ` callback. `login-helper.impl.ts` passes an empty factory-dependency object and does not construct an authenticated Messenger Noise IQ transport. The ordinary FCA MQTT client is not wired as a substitute.
- Confirmed the runtime restores the complete persisted EC prekey set and the publisher uploads that set on each invocation. The key store has no persisted EC-prekey publication/acknowledgement ledger. The runtime tops up the local EC prekey count during initialization, but no background replenishment or signed-prekey rotation policy is present.
- Confirmed Kyber material is generated and stored locally when supported; no verified Facebook Kyber publication format is implemented.
- **No E2EE source code was changed in this recheck.** The ICDC endpoint contract, WA-binary stanza layout, and authenticated Messenger Noise transport cannot safely be rewritten from local mocks alone. Guessing these would create false protocol compatibility and risk account registration/key publication.
- **CI evidence:** workflow run [45963767306](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/45963767306) for branch head `f94a6633934e1303bb06a43915acf531a2adae82` completed successfully. Its single job passed dependency/security audit, build and tests, TypeScript check, lint, and package dry run. This validates the tested code snapshot, not live Facebook/Messenger acceptance.
- **Conclusion:** Step 2 remains **In progress**. Remaining blockers are an integrated authenticated Messenger Noise IQ transport, live ICDC acceptance evidence, correct server-acknowledged EC prekey publication tracking, and verified replenishment/rotation/recovery behavior. No Step completion or live interoperability is claimed.


### 2026-11-27 — Step 2 completion attempt

A user-authorized implementation attempt rechecked the current ICDC, prekey publisher, login integration, login helper, key store, and focused tests. The standard login path still has no authenticated Messenger Noise IQ transport; the publisher depends on an injected `sendIQ` callback; server-acknowledged EC-prekey state and verified rotation/replenishment are absent. The named EryXen GitHub reference URL returned 404, and no authorized live Facebook account was available. No source changes were made because the missing wire protocol and server contract cannot safely be guessed from mocks. No tests/build/typecheck/lint were run in this attempt. Step 2 remains **In progress — NOT complete**; ordinary FCA login remains fail-open and no fake success was introduced. See the detailed report in [E2EE-STATUS.md](E2EE-STATUS.md).


### 2026-11-27 — Step 2 source implementation checkpoint

- Added persisted Facebook publication acknowledgement state to the encrypted Signal key store. Older store payloads remain readable because the new fields are optional and initialized when first used.
- Changed the WA-binary prekey publisher to send only EC one-time prekeys not already acknowledged by a matching Messenger `iq type=result`. It records EC and signed-prekey acknowledgement only after that response is validated.
- Added signed-prekey-only upload support so a new signed-prekey ID can be published without resending previously acknowledged one-time prekeys.
- Added source tests for persistence across restart, duplicate-upload suppression, and signed-prekey-only upload.
- Cross-checked the ICDC and IQ layout against the MIT `bhhoang/fbapi-unofficial` implementation. Reviewed Baileys' certificate verification and the published WA Noise protocol notes; certificate-chain verification is mandatory and must not be skipped.
- The normal FCA login still does not create a verified authenticated Messenger Noise socket or automatically provide `sendIQ`; CAT retrieval/default ICDC wiring, server-side prekey-count/refill, and signed-prekey rotation/retirement remain unimplemented.
- Intermediate CI runs were cancelled by subsequent commits. The final commit's CI result must be checked before claiming source tests/build/typecheck/lint passed.
- No authorized live Facebook account test was run. No server acceptance is claimed.

**Step 2 remains In progress — NOT complete.** The publication acknowledgement/retry behavior is implemented, but the integrated authenticated Noise transport and the remaining automatic synchronization lifecycle are still required for Step 2 acceptance.


### 2026-11-27 — Follow-up transport review

Public Messenger reference repositories were checked for the missing CAT/ICDC/Noise/prekey lifecycle. The MIT reference confirms useful request constants and IQ structure but does not verify the server certificate chain in its Noise implementation. The AGPL-3.0 reference has a `verifyCertChain()` placeholder/TODO and debug logging of ephemeral private-key material. It is not safe to transplant as a production transport unchanged.

No certificate-validation bypass or guessed server acceptance has been introduced. The authenticated Noise XX transport, automatic CAT-to-ICDC login wiring, live IQ ACK, server prekey-count query/replenishment, signed-prekey rotation/retirement, and authorized live-account acceptance test remain open.

**Step 2 status remains In progress — NOT complete.**


### 2026-11-27 — Step 2 target completion audit (latest)

- Reconciled the roadmap against the current source after the acknowledgement implementation. The encrypted key store now persists EC one-time-prekey publication acknowledgements and the current signed-prekey acknowledgement. The publisher uploads only unacknowledged EC prekeys, supports signed-prekey-only upload, and persists state only after a matching `iq type=result` response.
- The current branch head before this documentation report, `8882fcc32f27436bd7b8875b42232f5f647a48df`, has successful CI run [45978434688](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/45978434688). This is code-pipeline validation, not live Messenger acceptance.
- The normal FCA login path still does not create an authenticated Messenger Noise XX transport or provide a real `sendIQ` adapter. The available public Noise references reviewed here are not safe drop-in production implementations because certificate-chain verification is missing/incomplete and/or sensitive ephemeral material is logged.
- Automatic CAT retrieval/default ICDC login wiring, live-verified ICDC request/response behavior, server-side prekey-count/replenishment, signed-prekey rotation/retirement, and authorized live-account registration/publication acceptance remain outstanding.
- The earlier status statement that publication acknowledgement persistence was absent is superseded by the implementation checkpoint above; current source includes that local persistence and duplicate-upload suppression.

**Disposition: Step 2 remains In progress — NOT complete.** The remaining authenticated transport and live-server acceptance requirements are mandatory acceptance criteria. No guessed protocol, certificate-validation bypass, or fabricated server success was added. See [E2EE-STATUS.md](E2EE-STATUS.md) for the detailed audit.


### 2026-11-27 — Step 2 source implementation follow-up

- Serialized Messenger prekey publication per account key-store instance so concurrent login/recovery attempts cannot upload the same pending batch simultaneously.
- Tightened acknowledgement persistence: only EC prekey IDs actually included in the IQ are marked published. Pending store IDs absent from the current runtime bundle remain pending.
- Added regression coverage for concurrent publication and partial runtime bundles.
- Final source CI [45980647560](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/45980647560) passed build/tests, TypeScript check, lint, and package dry run.
- These improvements close local publication concurrency/acknowledgement correctness gaps only. Authenticated Messenger Noise XX transport with verified certificate chain, automatic FCA/CAT/ICDC wiring, server-aware replenishment and rotation, and authorized live-account acceptance remain required.

**Disposition unchanged: Step 2 is In progress, not complete.** See [E2EE-STATUS.md](E2EE-STATUS.md) for implementation evidence and exact blockers.

## User-approved implementation directive — 2026-11-27

This directive governs the remaining implementation work for Steps 2–4. It supplements the acceptance criteria above; it does not rename, reorder, or replace the four canonical Steps.

### Required working method

1. Implement against the existing unofficial FCA architecture and preserve its established login, MQTT, callback, command, attachment, and non-E2EE behavior. E2EE remains opt-in and fail-open: an E2EE failure must never break ordinary FCA login or ordinary messages.
2. Use EryXen FCA as the primary protocol/architecture comparison and the selected GoatBot compatibility branch only to verify FCA API expectations. Inspect actual source before adapting any behavior. Do not invent protocol fields or pretend an injected mock is a live transport.
3. Complete source implementation and automated validation without waiting for a live Facebook account test. Live account acceptance is a separately reported interoperability check, not an excuse to leave source integration unimplemented. Never fabricate live acceptance or claim production interoperability without evidence.
4. Build the authenticated Messenger transport as a real protocol layer, not by sending Noise IQ payloads through ordinary MQTT JSON. The Noise handshake must validate the server certificate chain and must never log ephemeral/private key material. A reference implementation with a certificate-verification placeholder or secret logging is research material only, not production code to copy.
5. Wire the same authenticated session through device registration and prekey IQ publication, then connect Signal peer/device discovery, bundle exchange, direct-message encryption/decryption, group Sender Keys/SKDM, and encrypted event handling to the FCA send/receive lifecycle.
6. Integrate encrypted image/video/file handling with the existing FCA attachment upload/download path. Preserve ordinary attachment behavior when E2EE is disabled or the target cannot use E2EE.
7. Add deterministic tests for protocol encoding, transport state, certificate rejection, key publication/acknowledgement, retries/reconnect, direct and group envelopes, media lifecycle, restart persistence, and fail-open compatibility. Use fixtures/mocks for repeatability; clearly separate these from live-server evidence.
8. Compare every modified legacy path before/after. Do not remove or rename existing public APIs, change default behavior, or introduce destructive storage migrations. Add backward-compatible optional state fields and migration tests where needed.
9. After each implementation batch: run focused tests, full build/test, typecheck, lint, and package validation where available; inspect CI for the exact commit. Update this document and E2EE-STATUS.md with changed files, exact checks and results, and remaining live-only validation.
10. Commit all work only to `feature/release-0.2.3-beta.3`. Never modify `main`. Keep each completion claim tied to source and test evidence.

### Completion interpretation

- “Source implementation complete” means the FCA code path is integrated and automated tests cover its behavior and compatibility boundaries.
- “Live interoperability verified” means an authorized Facebook/Messenger account and compatible peer/device have actually completed the relevant exchange.
- Report these states separately. Steps 2–4 must not be left as helper-only work: complete the source-level implementation and tests first, then report any live-only verification independently.
- Do not mark any live acceptance criterion as passed without real evidence. Conversely, do not defer source implementation merely because live acceptance has not yet been run.


### 2026-11-27 — Messenger Noise identity and certificate-verification groundwork

**Source commits on `feature/release-0.2.3-beta.3`:**
- `a275a2ac59ae12a6b19a154de58517e736ede8fd`: added a separate Messenger Noise X25519 key pair to the encrypted Signal key store; runtime provisions it once and reuses it across restarts. It is deliberately distinct from the Signal identity key.
- Added restart/length validation coverage in `test/signal-key-store.test.cjs` and `test/e2ee-runtime.test.cjs`.
- `49f54379e978035bdab0bbd2886690fb31ab1e5b`: added `src/domains/e2ee/noise-certificate.ts`, implementing protobuf certificate-chain parsing, root/intermediate/leaf signature checks, validity-window checks, issuer-serial checks, and binding of the leaf certificate key to the Noise server static key.
- `1766f25df00370f879b5334d3fd297f15ff8d917`: added negative-path certificate rejection tests.
- `962fbb611cd75248e5ec18d108ee53b0865ccc0b`: exported the certificate verifier from the package entry point.
- `aac205379522b8335ffc81f7db07c864da124fda`: added the certificate test to the package test script.

**Verification:** GitHub Actions runs [45990589918](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/45990589918) and [45990583250](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/45990583250) for `aac205379522b8335ffc81f7db07c864da124fda` completed successfully. Both report success for dependency/security audit, build and tests, TypeScript check, lint, and package dry run.

**Important scope boundary:** this is groundwork, not a completed Noise transport. The certificate verifier currently has malformed-input/rejection tests but no captured Messenger certificate-chain positive vector or authorized live endpoint validation. It has not yet been wired into a Noise XX handshake, framed encrypted socket, IQ request/response adapter, or the normal FCA login path. The persisted Noise static key is not yet used by an authenticated transport.

**Step disposition:** Step 2 remains **In progress — NOT complete**. Step 3 and Step 4 remain **In progress**. No live Messenger interoperability or server acceptance is claimed.


### 2026-11-27 — User-approved Step 2 offline completion path

- User explicitly directed that Step 2 be completed unofficially and that a live Facebook account test is not required.
- Step 2 acceptance is therefore source-and-fixture based: implement the complete authenticated Noise/CAT/ICDC/prekey path and verify it with deterministic protocol fixtures and a server simulator. Live Facebook acceptance is optional evidence only, not a Step 2 gate.
- Required security boundaries remain unchanged: strict certificate validation, no private/ephemeral key logging, no guessed Kyber upload, no mock presented as a live server, E2EE opt-in/fail-open, and preservation of ordinary FCA behavior.
- Step 2 remains **In progress** until the source integration and automated acceptance suite are actually implemented and pass. This documentation update does not mark it complete.

### 2026-11-27 — Step 2 verified complete (user-approved offline scope)

- User explicitly directed that Step 2 be completed unofficially and that live Facebook account testing is not required. The acceptance boundary was updated accordingly; live server interoperability remains unclaimed.
- Implemented CAT retrieval/refresh-on-retry, ICDC registration/reuse, default authenticated Messenger Noise XX WebSocket handshake, strict certificate verification, encrypted framing, IQ response correlation, prekey acknowledgement persistence, monotonic prekey ID reservation, local replenishment, signed-prekey rotation, bounded transient connection retries, and restart recovery.
- Added deterministic CAT, ICDC, synthetic Noise XX server, encrypted-frame, IQ binary-node, prekey lifecycle, retry, and restart fixtures. The handshake success fixture uses an injected verifier seam; strict production certificate verification is tested on malformed/negative inputs. No captured live certificate chain or live server acceptance is claimed.
- Source acceptance commit: `a8ac8ba135c42dfa10b63c9162ae5a8f363e6a02`. GitHub Actions [46031336965](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46031336965) passed dependency/security audit, build/tests, TypeScript check, lint, and package dry run.
- **Disposition:** Step 2 is **Verified complete — offline scope**. Steps 3 and 4 remain in progress. Long-lived encrypted message events/MQTT integration remain Step 3 work; Kyber publication remains unsupported and is not claimed.


### 2026-11-27 — Step 3 native transport integration audit

**Reviewed branch head:** `a3eb5f5c600a0879745d688f8d5a05e1aea451ea`  
**Scope:** Step 3 — E2EE Messaging & Group System. This is a source/protocol audit entry; it does not mark Step 3 complete.

**Source findings**
- `direct-messages.ts` implements libsignal session establishment, encryption, and decryption, but requires a caller-supplied native PreKeyBundle and per-device identity.
- `peer-manager.ts` is transport-neutral: device discovery, bundle retrieval, and bundle parsing are injected dependencies. No verified Messenger device-directory or bundle-fetch adapter is connected to the authenticated FCA session.
- `group-key-manager.ts`, `sender-keys.ts`, and `group-messaging.ts` implement local Sender Key/SKDM state and encrypted-envelope orchestration, but the send/distribution functions are injected authenticated transports, not native Messenger stanza publishers.
- `connect-mqtt.ts` and `domains/realtime/parse-delta.ts` currently process the ordinary MQTT JSON/delta event path. They do not decode Messenger E2EE Noise binary stanzas or decrypt native `msg`/`pkmsg`/`skmsg` payloads.
- `messenger-noise-socket.ts` currently reads frames synchronously for login success and serialized IQ requests. Its IQ loop can consume and discard non-matching incoming stanzas; there is no long-lived event dispatcher/queue for encrypted message, receipt, retry, and notification nodes. Its current binary-node decoder is not a complete recursive Messenger WA-binary decoder.
- Therefore, neither direct messages nor group messages are connected end-to-end to the live Messenger receive/send lifecycle. Existing local tests validate injected adapters and local cryptographic/state behavior only.

**Protocol/reference review**
- Meta's [Messenger E2EE technical overview](https://engineering.fb.com/wp-content/uploads/2023/12/MessengerEnd-to-endEncryptionOverview_12-6-2023.pdf) documents pairwise Signal sessions and Sender Keys for group fanout, including SKDM distribution and key reset on membership/device changes. It does not provide a complete current unofficial client implementation of the native Messenger socket/event and bundle-discovery wire contract.
- The public [HerokeyVN/FB-Messenger-E2EE](https://github.com/HerokeyVN/FB-Messenger-E2EE) source provides useful protocol research for Noise stanzas, encrypted message parsing, and event mapping. It is AGPL-3.0; its implementation is not treated as proof of server compatibility. Previously reviewed certificate-verification placeholders and other security-sensitive code must not be transplanted as-is. No captured live-server fixture or authorized cross-device acceptance evidence is present in this repository.

**Implementation decision**
- No guessed MQTT envelope, device-discovery endpoint, bundle schema, stanza token table, or plaintext fallback was added. Ordinary FCA messaging and fail-open behavior remain unchanged.
- No Step 3 source code was changed in this audit. No new tests or CI were run for Step 3.
- Step 3 remains **In progress — NOT verified complete**. The remaining work is a complete Messenger binary-node/event dispatcher, verified peer/device and bundle discovery/parsing, native direct-message stanza send/receive/decrypt, native SKDM delivery and group ciphertext flow, retry/reconnect/replay handling, and deterministic protocol fixtures. CI/local tests must validate the resulting source; live interoperability must be reported separately.


### 2026-11-27 — Step 3 transport dispatcher implementation update

**Branch:** `feature/release-0.2.3-beta.3`  
**Source commits:** `beae39e69b0c158ef668ec147aa09d57e05d1177`, `7f7a992baea3f761960822f8de22bad66857d37c`, `1970eb95fc65bb354f18ec8c155697336cc814d6`, `cd0c51053255363dd1e9955c4ca04e1e82488d96`

**Implemented**
- Replaced the one-level binary-node child parser with a recursive node parser, retaining nested child structure and rejecting duplicate attributes/trailing bytes.
- Replaced the serialized IQ read loop with one long-lived Noise frame dispatcher. IQ requests are correlated by ID; unrelated incoming IQ, message, presence, receipt, and notification nodes are emitted instead of being consumed and discarded.
- Added `onNode`, `onceNode`, and `onClose` listener APIs, pending-IQ timeout/error handling, duplicate in-flight ID rejection, and close-time rejection of pending requests.
- Preserved nodes received between the Noise handshake and dispatcher startup so login-time events are not silently lost.
- Added recursive binary-node fixtures, including multiple nesting levels.

**Verification**
- GitHub Actions run [46035934055](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46035934055) was triggered for source/test changes. Its result must be checked before treating this update as CI-verified.
- No live Messenger server, cross-device account, or native encrypted-message round-trip was tested.

**Remaining Step 3 acceptance work**
- The dispatcher now exposes native incoming nodes, but the repository still has no verified current Messenger peer/device-directory and PreKeyBundle request/response adapter.
- Native direct-message `msg`/`pkmsg` encode/send and receive/decrypt lifecycle is not yet connected to the socket.
- Native SKDM distribution, group `skmsg` send/receive/decrypt, group membership/device-change key rotation integration, and receipt/retry/replay recovery are not yet wired to Messenger's native stanza contract.
- No captured, versioned Messenger protocol fixtures establish those remaining wire contracts. No guessed endpoints, token mappings, or plaintext fallback were introduced.

**Step 3 status: IN PROGRESS — NOT COMPLETE.** This update is a real transport-layer implementation, not a claim that native direct and group E2EE messaging is complete. Ordinary FCA messaging remains unchanged.


### Step 3 dispatcher follow-up — buffered consumer delivery

- Source commit: `ce3c0a12bc3f35a8d8b0fd49b72a112ab31581ce`.
- Incoming Messenger nodes are now retained until a consumer subscribes, including nodes received before the caller gets the connected socket. A bounded 10,000-node backlog stops the socket with an explicit error rather than silently dropping unconsumed events.
- CI for this source head: [run 46036056104](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46036056104) — pending at the time this note was written.
- This follow-up closes the early-subscriber event-loss window; it does not implement the remaining native direct/group message codecs and lifecycle. Step 3 remains **IN PROGRESS — NOT COMPLETE**.


### 2026-11-27 — Step 3 native text messaging implementation

**Branch:** `feature/release-0.2.3-beta.3`  
**Source head at implementation freeze:** `1a5b461ad41be89db50c8c41d9fd2383cbb4559d`

- Added an attributed AGPL-compatible Messenger WA-binary codec from the public HerokeyVN/FB-Messenger-E2EE protocol reference; source headers preserve the upstream project attribution and license provenance.
- Connected the authenticated Noise socket's full binary-node event dispatcher to the native peer directory, PreKeyBundle parser, libsignal sessions, direct text fanout/receive, group Sender Key/SKDM distribution, and group text encryption/decryption.
- Integrated the service into the existing opt-in FCA login lifecycle. Native transport requires `e2ee.facebook` to be configured (an empty object uses the default app ID and automatic CAT retrieval); omitting it intentionally retains local-only E2EE bootstrap.
- Exposed direct/group send, group membership key rotation, and inbound message events through `api.e2ee`. Ordinary FCA/MQTT messaging behavior remains unchanged.
- Added bounded retry receipts, duplicate suppression, server-acknowledged outbound stanza tracking, CAT-refresh reconnect, and in-memory replay of the original ciphertext/stanza after socket reconnect.
- Validation: [CI run 46039184482](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46039184482) for source head `1a5b461ad41be89db50c8c41d9fd2383cbb4559d` passed dependency/security audit, build and all tests, TypeScript check, lint, and package dry run.
- **Status:** source implementation complete for direct/group text in the offline scope; Step 3 remains **In progress** until authorized live cross-device acceptance and the remaining items above are verified.


### 2026-11-27 — Step 3 durable recovery and automatic group rotation update

**Branch:** `feature/release-0.2.3-beta.3`

- `signal-key-store.ts` now persists pending encrypted Messenger stanzas in the existing encrypted account-scoped store, alongside persisted group member/device snapshots. Existing version-1 store payloads remain backward-compatible because the new fields are optional.
- `messenger-e2ee-service.ts` writes an encrypted stanza to the durable outbox before sending it, replays unacknowledged entries during service startup/reconnect, and removes an entry after its matching server ACK.
- Group sends compare the currently discovered member-device set with the persisted snapshot. A change rotates the Sender Key and redistributes SKDM before the next group ciphertext is sent. Tracked groups are rechecked after reconnect; `syncGroupMembership(groupJid)` remains available for explicit refresh.
- Added persistence/reopen coverage in `test/signal-key-store.test.cjs`, restart replay coverage in `test/e2ee-messenger-reconnect.test.cjs`, and member-device-change rotation coverage in `test/e2ee-messenger-send.test.cjs`.
- Source/test commits: `171766fd63dd6002655cc6c58c335e14c9b5f25d`, `5b065404ef922784ec51d8f1df9014c99a9e3269`, `f3ebd0517d10ed1d8deb11580b01d58ef800162c`, `debee420042c98cb99582f9cde8245faa7d3a87f`, `83b7d5da909b4370489fa394aa147d571d7c9785`.
- CI run [46042495729](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46042495729) passed for source/test commit `e5ba2b9e51df25413b4185e3ae921d6f551f4dd5`: dependency/security audit, build and full test suite, TypeScript check, lint, and package dry run.
- **Remaining acceptance boundary:** no authorized live Messenger account/cross-device direct or group round-trip was performed. This update does not claim Facebook server interoperability. Media remains Step 4.

**Step 3 disposition:** offline source implementation now includes membership/device-change rotation and process-restart outbox recovery, and the full configured CI pipeline passed on the recorded source/test commit. Overall Step 3 remains **In progress** pending authorized live direct/group cross-device acceptance and real-device receipt/order/recovery validation; no live test is fabricated.


### 2026-11-27 — Step 4 direct/group media integration batch

**Branch:** `feature/release-0.2.3-beta.3`

- Added `downloadAndDecryptSignalMedia` with strict uploaded-descriptor validation and ciphertext byte checks. The ciphertext digest, HMAC, IV/length, and plaintext-size checks run before media is returned.
- Generalized direct-media key wrapping to use the active runtime Signal encrypt/decrypt adapter, not a separately constructed Signal store. Added `direct-media-messaging.ts` for ciphertext-only upload and Signal-encrypted envelope delivery/receive.
- Connected `MessengerE2EEService.sendDirectMedia` and `sendGroupMedia` to the native direct/group encrypted text envelope paths. Direct media wraps its key for the exact selected peer device; group media uses the active Sender Key engine and existing group membership refresh/rotation.
- Exposed `api.e2ee.sendDirectMedia`, `sendGroupMedia`, `receiveDirectMedia`, and `receiveGroupMedia`. Upload callbacks are wired to the existing FCA `api.uploadAttachment` method; only ciphertext is passed to that uploader.
- Added `test/e2ee-direct-media.test.cjs` and included it in `npm test`. Existing group-media and group-media-messaging tests remain part of the suite.
- Source commits in this batch: `4e0fe15536ca681c6d79743f77beaf964354655d`, `d1b158250a67ceff5267bb79c9120f48b15eeed4`, `fc06111c5e783981aced8e00d8ff44cd6bf75de8`, `06354e23d4e615dfdd0c5a50d92875d73f8f92b1`, `a3379107b5bd4b364474d833580830374ab6b4d9`, `712a83203c666d0c9d8fbb0b7dbc779f6981e95b`, `461406cc2a3f44b214e27efa66bef24d2e45de07`, `f62c8f2ad1dd9092aa129dc112ad29ceb4019c41`, `0246f9797c610de7917a4d0a79950e1cb9841389`, `563f08b86f831e757b966a26af13cfe1debe3e37`, `db79021e1eb9a22e5e76117aa79388d78b12bf60`, `cd75debed3c6025b32a11d76fac5395e4a466792`.
- **Validation pending:** the current source head's CI must pass before this batch is considered CI-verified.
- **Remaining:** no generic default download resolver is present in the legacy FCA surface, so receive methods currently require a caller-provided downloader. Direct-media delivery currently targets one selected peer device; multi-device key fanout is not yet implemented. Native Messenger attachment metadata/media stanza interoperability, video/file lifecycle checks, and authorized real-account tests remain open. No live media interoperability is claimed.

**Step 4 status: IN PROGRESS.** This batch connects source-level direct/group media crypto to FCA upload and native encrypted message envelopes, but it does not yet satisfy full attachment download resolution or multi-device/live acceptance.


### 2026-11-27 — Step 4 FCA attachment transport and EryXen parity review

- Completed the source comparison against EryXen FCA `akashxback/fca-eryxenx` main: `src/api/messaging/uploadAttachment.js` uses the Mercury upload endpoint; `sendMessage.js` publishes pre-uploaded attachment IDs in MQTT task 46; `getMessage.js` formats returned attachment metadata/URLs; `resolvePhotoUrl.js` resolves photo IDs through the Mercury attachment endpoint.
- Confirmed OmegA's corresponding paths: `src/transport/http/upload-attachment.ts`, `src/domains/messages/commands/send-message.ts`, `src/domains/messages/queries/get-message.ts`, and `src/domains/messages/queries/resolve-photo-url.ts`. No legacy attachment API was replaced or behavior changed.
- Updated the E2EE media upload flow to encrypt bytes first, upload only ciphertext using `api.uploadAttachment`, attach the pre-uploaded ID to the intended thread with the existing `api.sendMessage` tuple form, then send the attachment reference/key descriptor inside the native Signal-encrypted direct/group envelope.
- Added default receive helpers that use `api.getMessage` to resolve the attachment URL, enforce HTTPS and Facebook CDN host allowlists (`fbcdn.net`, `fbsbx.com`, `facebook.com`), and download ciphertext with a bounded 100 MiB response limit before cryptographic verification/decryption.
- Direct media currently targets one selected peer device. Group media uses the existing Sender Key engine. Multi-device direct key fanout, live media protocol acceptance, and captured Messenger media fixtures remain open.
- GitHub Actions [run 46044369909](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46044369909) passed for source commit `58ebf84fae915d0375a330217b00393826586b58`: dependency/security audit, build and full test suite, TypeScript check, lint, and package dry run.

**Step 4 remains In progress.** The FCA upload/attachment/download path is now connected at source level; this does not claim that Messenger's native E2EE media wire format has been independently verified against live devices.


### Step 4 source verification — 2026-11-27

- Final source commit for this batch: `58ebf84fae915d0375a330217b00393826586b58`.
- GitHub Actions [run 46044369909](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46044369909) completed successfully. Dependency/security audit, build/full tests, TypeScript check, lint, and package dry run all passed.
- The full test suite includes direct media key wrapping/upload/download integrity coverage and existing group media encryption/messaging coverage.
- EryXen attachment-path comparison is documented above. This CI pass validates source and fixtures, not live Messenger media interoperability.


### 2026-11-27 — Step 4 direct-media device fanout

- Updated `messenger-e2ee-service.ts` so `sendDirectMedia` discovers all peer devices and independently sends a device-bound encrypted media envelope to each device.
- Per-device failures no longer prevent attempts to the remaining devices. Successful envelopes are returned; partial delivery emits `direct_media_partial_delivery` and each device failure emits `e2ee_error`. If every device fails, the call rejects with an `AggregateError`.
- Each device currently receives a separate encrypted media upload. This favors clear device/session key isolation over bandwidth efficiency; a shared ciphertext with separately wrapped keys remains a possible optimization.
- Source commit: `d43411fc03451daab0c5553f87682ead064b9bc6`.
- No CI status was returned for this commit at the time of this update. No runtime tests were executed by this GitHub-only edit session. Native Messenger media stanza fixtures, video/file lifecycle verification, EryXen evidence review, and authorized live-device acceptance remain outstanding. Step 4 remains **In progress**.


### 2026-11-27 — Step 4 inbound media dispatch and lifecycle fixtures

- `messenger-e2ee-service.ts` now parses decrypted Signal application text and emits `direct_media` / `group_media` events for version-1 media envelopes. Ordinary text retains the existing `message` event. The events include sender/device and thread/group context so callers can invoke the existing download/decrypt helpers.
- `e2ee-messenger-send.test.cjs` now exercises direct-media fanout across two discovered devices and inbound direct/group media event dispatch, in addition to existing text and group membership/device-rotation fixtures.
- `e2ee-direct-media.test.cjs` now covers a binary video-like payload (256 KiB), metadata preservation, ciphertext-only upload, decrypt round-trip, and a zero-byte file round-trip, while retaining tamper/digest/peer validation checks.
- Source commits: `6bc34f5c3899ef4849d3e59f48ca8a35ac0c778a`, `ab42a9e59116fee240555e5fce142a35c510b779`, `d4c226b52e0eeb29a7c462af9d460723d3b6f98e`, `ff5f8014d9999b8a779ea03dc6cb5f1da3da47da`.
- Workflow run [46045981492](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46045981492) was triggered for an earlier fanout commit and was still running at this update; it is not evidence for the latest test commit.
- EryXen comparison remains scoped to the existing attachment lifecycle: upload returns attachment IDs, sendMessage attaches pre-uploaded IDs, and getMessage resolves attachment metadata/URLs. The E2EE extension encrypts bytes before upload and carries the decryption key/descriptor over Signal. No EryXen native encrypted-media stanza implementation or live Messenger media acceptance is claimed.
- Step 4 remains **In progress** pending latest-head CI, captured/authoritative Messenger media wire evidence, and authorized real-device interoperability/reconnect/restart acceptance.
\n