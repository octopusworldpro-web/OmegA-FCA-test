# OmegA-FCA — Canonical E2EE Completion Plan

**Version:** `0.2.3-beta.3`  
**Branch:** `feature/release-0.2.3-beta.3`  
**Authority:** This is the single source of truth for E2EE scope and progress. The work is grouped into exactly four Steps. Older E2EE task lists and previous 5-step/8-item checklists are superseded and must not be used for progress reporting.

## Overall status

**Step 1 is verified complete at the local engine and FCA login-integration boundary. Steps 2–4 remain in progress; native Messenger interoperability is not yet production-verified.**

- Step 1: Verified complete
- Step 2: In progress
- Step 3: In progress
- Step 4: In progress

A Step is complete only after its code, tests, required integration, and acceptance evidence are present. Unit tests, mocks, helper modules, and a passing CI run do not by themselves prove Messenger interoperability.

## Step 1 — E2EE Engine & Login Integration

**Scope**
- Automatic compatible libsignal engine setup.
- Reuse the existing authenticated FCA AppState/session and cookies for E2EE; do not add an external credential relay.
- Account-scoped automatic identity and key-store bootstrap.
- Fail-open behavior: E2EE initialization failure must not break ordinary FCA login, MQTT, humanizer, or regular messaging.
- Preserve the existing FCA login API and protect credentials/key material.

**Implemented and verified in the current branch**
- Pinned `@signalapp/libsignal-client` `0.70.0` loads automatically; no manual Signal module injection is needed.
- Authenticated FCA UID is passed to the opt-in bootstrap only after existing session identity validation.
- Local Signal runtime initializes before the existing successful login callback; initialization errors are caught and exposed as `api.e2ee.status = \"failed\"` without throwing into ordinary FCA login.
- Identity, signed prekey, one-time EC prekeys, and Kyber prekey material are persisted in the encrypted account-scoped store and survive process restart with the real libsignal package.
- Account storage paths and device IDs are isolated. No password, 2FA, AppState, or cookies are passed into the E2EE bootstrap.
- Store encryption key is no longer written to `identity.json`; it must be supplied via `OMEGA_FCA_E2EE_MASTER_KEY` or `e2ee.encryptionKey`. Missing key fails E2EE open while normal FCA login remains available.
- Legacy metadata that contains a plaintext key is rejected with a migration warning rather than silently reused.
- Added real-library restart/account-isolation smoke test and fail-open/bootstrap tests.

**Boundary**
- This completes the local engine and FCA login integration in Step 1. Facebook ICDC registration and server key publication remain Step 2; Messenger MQTT encrypted wire compatibility remains Step 3. No live Facebook-account interoperability is claimed.

**Acceptance**
- Existing AppState/Cookie login works unchanged.
- No password, 2FA, AppState, or cookie is sent to an external E2EE credential service.
- The selected Signal engine loads automatically and a persistent account runtime is initialized.
- E2EE failure is fail-open for ordinary FCA behavior.
- Lifecycle and restart tests pass.

## Step 2 — Facebook Device Registration & Key Sync

**Scope**
- Facebook ICDC device registration.
- Persistent identity key and Facebook E2EE device ID/registration metadata.
- Signed PreKey, One-time PreKey, and protocol-supported Kyber/PQ PreKey publishing and synchronization.
- Safe prekey replenishment, rotation, retry, and atomic one-time-key consumption.

**Implemented in the current branch**
- Facebook ICDC registration helper.
- Encrypted key-store persistence and device metadata support.
- Public identity-bundle metadata exposure.
- Persistent EC/PQ prekey bundle groundwork and atomic Kyber-prekey consumption safeguards.

**Still required**
- Invoke ICDC registration from the authenticated FCA login lifecycle.
- Verify actual Facebook registration and public key-bundle publishing using the authenticated session.
- Verify the real protocol-matched PQ/Kyber provider and key formats; mock KEM tests are not production KEM evidence.
- Verify server responses, key rotation, replenishment, and restart recovery against the selected protocol.

**Acceptance**
- ICDC registration and key publishing succeed against Facebook using the existing authenticated session.
- Device identity and key state survive restart and remain account-isolated.
- Published key formats and one-time key consumption are verified against the target protocol.

## Step 3 — E2EE Messaging & Group System

**Scope**
- Messenger MQTT encrypted send/receive and decrypt integration.
- Direct-message encryption and peer/device bundle exchange.
- Group Sender Keys/SKDM, encrypted group messaging, membership/device changes, and key rotation.
- Preserve ordinary non-E2EE message/event handling.

**Implemented in the current branch**
- Group Sender Key/SKDM delivery persistence and restart-aware retry logic.
- Application-level encrypted group-message orchestration over an injected authenticated transport.
- Tests for group key delivery persistence/retry and encrypted group-message envelope validation/decryption.

**Still required**
- Implement and verify Messenger peer/device discovery and bundle exchange.
- Integrate direct-message encryption/decryption with the real Messenger MQTT envelope and event lifecycle.
- Establish Messenger wire-format compatibility for direct and group encrypted messages.
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

**Implemented in the current branch**
- Encrypted group-media pipeline and application-level transport orchestration.
- Tests covering ciphertext upload, envelope handling, receive/decrypt, and group/sender validation.

**Still required**
- Integrate and verify the actual Messenger media upload/download transport for supported image, video, and file attachments.
- Verify direct and group media interoperability with compatible Facebook E2EE devices.
- Complete the EryXen protocol/reference comparison and record any differences.
- Run authorized real-account tests for fresh login, reconnect, restart, multiple devices, and recovery.
- Verify receipts and attachment lifecycle where supported by the target protocol.

**Acceptance**
- Encrypted media is sent and received across authorized compatible devices.
- EryXen comparison is documented without copying unverified assumptions.
- Real-account interoperability evidence is recorded separately from mock/unit tests.
- Full build, tests, typecheck, lint, and package validation pass.

## Verification record

Latest checked branch head: `bbbab33b11f253605a90f4e089c2a065de3048cb`

Latest checked CI run: [45857562207](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/45857562207) — **success** for build/tests (including real libsignal runtime persistence/restart), TypeScript, lint, security audit, and package dry run.

CI success verifies the repository checks only. It does not prove native Messenger E2EE transport or real-account interoperability.

## Reporting rules

- Report progress only against these four Steps.
- Use **Implemented**, **In progress**, **Blocked**, and **Verified complete** precisely.
- Do not mark a Step complete based only on helper code, mocked tests, or CI.
- Do not reintroduce superseded Labyrinth backup/restore, key-transparency, alias-parity, or other older audit-list items into this four-Step E2EE plan unless the user explicitly changes the scope.
