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
