# OmegA-FCA — Canonical E2EE Completion Plan

**Version:** `0.2.3-beta.3`  
**Branch:** `feature/release-0.2.3-beta.3`  
**Authority:** This is the single source of truth for E2EE scope and progress. Work is grouped into exactly four Steps. Older E2EE task lists and previous multi-step checklists are superseded and must not be used for progress reporting.

## Overall status

**Step 1 is verified complete at the local engine and FCA login-integration boundary. Steps 2–4 remain in progress; native Messenger interoperability is not production-verified.**

- Step 1: Verified complete
- Step 2: In progress
- Step 3: In progress
- Step 4: In progress

A Step is complete only after its code, tests, required integration, and acceptance evidence are present. Unit tests, mocks, helper modules, and a passing CI run do not by themselves prove Messenger interoperability.

## Step 1 — E2EE Engine & Login Integration

**Scope**
- Automatic compatible libsignal engine setup.
- Reuse the existing authenticated FCA session; do not add an external credential relay.
- Account-scoped automatic identity and key-store bootstrap, with no new environment-variable or manual key setup.
- Fail-open behavior: E2EE initialization failure must not break ordinary FCA login, MQTT, humanizer, or regular messaging.
- Preserve the existing FCA login API and configuration.

**Implemented and verified in the current branch**
- Pinned `@signalapp/libsignal-client` `0.70.0` loads automatically.
- Authenticated FCA UID is passed to the opt-in bootstrap only after existing session identity validation.
- Local Signal runtime initializes within the login lifecycle; initialization errors do not break ordinary FCA login.
- Identity, signed prekey, one-time EC prekeys, and Kyber prekey material are persisted in the account-scoped store and survive process restart with the real libsignal package.
- Account storage paths, generated local encryption keys, and device IDs are automatically persisted per account with restrictive local file/directory permissions. No new E2EE environment variable or separate key setup is required.
- No password, 2FA, AppState, or cookies are passed into the E2EE bootstrap.

**Local storage security note**
- The automatically generated store key is persisted in the account's local `identity.json` file so restarts work without manual configuration. File/directory permissions are restricted where supported, but this is not equivalent to protecting the key from someone who can read the same account's local files.

**Boundary**
- This completes the local engine and FCA login integration in Step 1. Facebook ICDC registration and server key publication remain Step 2; Messenger MQTT encrypted wire compatibility remains Step 3. No live Facebook-account interoperability is claimed.

**Acceptance**
- Existing AppState/Cookie login works unchanged.
- No password, 2FA, AppState, or cookie is sent to an external E2EE credential service.
- The selected Signal engine loads automatically and a persistent account runtime is initialized without extra key configuration.
- E2EE failure is fail-open for ordinary FCA behavior.
- Lifecycle and restart tests pass.

## Step 2 — Facebook Device Registration & Key Sync

**Scope**
- Facebook ICDC device registration.
- Persistent identity key and Facebook E2EE device ID/registration metadata.
- Signed PreKey, One-time PreKey, and protocol-supported Kyber/PQ PreKey publishing and synchronization.
- Safe prekey replenishment, rotation, retry, and atomic one-time-key consumption.

**Implemented groundwork**
- Facebook ICDC registration helper in `src/domains/e2ee/device-registration.ts`.
- Encrypted key-store persistence and device metadata support.
- Public identity-bundle metadata exposure.
- Persistent EC/PQ prekey bundle groundwork and atomic Kyber-prekey consumption safeguards.

**Still required**
- The ICDC helper is not yet invoked by the authenticated login lifecycle.
- Verify the actual Facebook registration request fields, server response, and public key-bundle publishing using the existing authenticated session. Do not guess `fb_cat`, `app_id`, or response formats.
- Verify the real protocol-matched PQ/Kyber provider and key formats; mock KEM tests are not production KEM evidence.
- Verify key rotation, replenishment, and restart recovery against the selected protocol.

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

**Implemented groundwork**
- Signal direct-message primitives using libsignal, with peer/device discovery and bundle parsing supplied through injected interfaces.
- Group Sender Key/SKDM delivery persistence and restart-aware retry logic.
- Application-level encrypted group-message orchestration over an injected authenticated transport.
- Tests for persistence/retry, envelope validation, and decryption.

**Still required**
- Implement and verify Messenger peer/device discovery and native bundle exchange.
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

**Implemented groundwork**
- Direct and group media cryptographic helpers.
- Group-media application-level transport orchestration.
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

Code baseline covered by the recorded CI run: `55d02c7044938e68db9de87aee319831f68c8950`

Latest checked CI run: [45860381188](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/45860381188) — **success**.

CI success verifies repository checks only. It does not prove native Messenger E2EE transport or real-account interoperability.

## Reporting rules

- Report progress only against these four Steps.
- Use **Implemented**, **In progress**, **Blocked**, and **Verified complete** precisely.
- Do not mark a Step complete based only on helper code, mocked tests, or CI.
- Do not reintroduce superseded Labyrinth backup/restore, key-transparency, alias-parity, or other older audit-list items into this four-Step E2EE plan unless the user explicitly changes the scope.
