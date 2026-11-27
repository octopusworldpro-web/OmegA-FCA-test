# OmegA-FCA — Canonical E2EE Completion Plan

**Version:** `0.2.3-beta.3`  
**Branch:** `feature/release-0.2.3-beta.3`  
**Authority:** This is the single source of truth for E2EE scope, acceptance criteria, and progress. The plan contains exactly four Steps. Older E2EE task lists and previous multi-step checklists are superseded.

## Overall status

**Step 1 is verified complete for the local Signal engine and FCA login lifecycle boundary. Steps 2–4 remain in progress. No live Facebook/Messenger interoperability or production readiness is claimed.**

- Step 1: Verified complete — local engine and fail-open FCA login lifecycle
- Step 2: In progress — ICDC and prekey helpers are wired conditionally; live server acceptance and default Noise transport are not verified
- Step 3: In progress — local Signal direct/group primitives exist; native Messenger MQTT wire integration is not established
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

**Scope**
- Facebook ICDC device registration.
- Persistent identity key and Facebook E2EE device ID/registration metadata.
- Signed PreKey and One-time PreKey publishing and synchronization using the protocol-supported Messenger transport.
- Safe prekey replenishment, rotation, retry, and atomic one-time-key consumption.
- Keep Kyber/PQ material local unless an authoritative current Messenger protocol specifies a supported server format.

**Implemented groundwork**
- `device-registration.ts` implements ICDC fetch/register requests and validates the returned registration response before persisting device metadata.
- The authenticated FCA login lifecycle invokes this helper when `e2ee.facebook.appId` and `e2ee.facebook.fbCat` are configured. It supplies the authenticated cookie header and user agent; callers must not copy cookies into E2EE configuration.
- Registration is idempotent against an existing persisted device record unless forced.
- `prekey-publisher.ts` builds a WA-binary `encrypt` IQ containing the Signal identity, signed prekey, and one-time Curve25519 prekeys. It requires a caller-supplied authenticated Messenger Noise `sendIQ` adapter and only reports success after a matching `iq type=result` acknowledgement.
- The login integration invokes publication only when `e2ee.facebook.sendIQ` is supplied. The FCA login helper does not construct or inject a Noise IQ socket adapter. The ordinary FCA MQTT JSON transport is not a compatible substitute.
- Local Kyber/PQ key generation and encrypted persistence are implemented when libsignal KEM support is present. No verified Messenger Kyber upload field/stanza is implemented.

**Still required**
- Validate ICDC fetch/register request fields, response behavior, idempotency, and persisted device identity against an authorized live Facebook account. Current mocked tests prove request construction and local handling only.
- Supply and verify a real authenticated Messenger Noise IQ transport; then verify signed and one-time prekey publication against the live service.
- Verify replenishment, rotation, retries, and recovery against the actual server behavior.
- Do not claim Kyber publication. The current documented Messenger device-registration format describes Curve25519 identity, signed prekey, and one-time prekeys, not a Kyber upload field. Keep Kyber local-only unless a current authoritative protocol or observed authorized server contract proves otherwise.

**Acceptance**
- ICDC registration is accepted by Facebook using the existing authenticated session.
- Device identity and registration metadata survive restart and remain account-isolated.
- Signed/one-time prekeys are acknowledged by the real Messenger Noise IQ endpoint in the target format.
- Rotation/replenishment and restart recovery are verified against the target protocol.

## Step 3 — E2EE Messaging & Group System

**Scope**
- Messenger MQTT encrypted send/receive and decrypt integration.
- Direct-message encryption and peer/device bundle exchange.
- Group Sender Keys/SKDM, encrypted group messaging, membership/device changes, and key rotation.
- Preserve ordinary non-E2EE message/event handling.

**Implemented groundwork**
- Signal direct-message primitives using libsignal, with peer/device discovery and bundle parsing supplied through injected interfaces.
- Group Sender Key/SKDM state persistence and restart-aware delivery/retry logic.
- Application-level encrypted group-message orchestration over an injected authenticated transport.
- Local tests cover selected persistence, retry, envelope-validation, and decryption contracts.

**Still required**
- Implement and verify Messenger peer/device discovery and native bundle exchange.
- Connect direct-message encryption/decryption to the actual Messenger MQTT envelope and event lifecycle.
- Establish native Messenger wire-format compatibility for direct and group encrypted messages.
- Verify cross-device send/receive, reconnect, duplicate/out-of-order delivery, replay protection, and recovery with authorized test devices.

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
- Direct and group media cryptographic helpers.
- Group-media application-level transport orchestration.
- Local tests for selected ciphertext upload/envelope/receive/decrypt and group/sender validation paths.

**Still required**
- Integrate and verify actual Messenger media upload/download transport for supported image, video, and file attachments.
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
