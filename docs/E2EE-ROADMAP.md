# OmegA-FCA E2EE implementation roadmap

**Baseline:** `0.2.3-beta.3`  
**Target branch:** `feature/release-0.2.3-beta.3`  
**Current state:** integration in progress — not production-ready or verified.

This roadmap groups the remaining Messenger E2EE work into four implementation steps. A step is complete only when its code, tests, and integration evidence are present; documentation or mocked tests alone do not count as completion.

## Step 1 — E2EE engine and existing-login integration

**Goal:** Start E2EE from the authenticated FCA session without changing the existing login contract.

- Add and pin a compatible Signal/libsignal engine dependency; load it automatically rather than requiring callers to inject `signalModule`.
- Reuse the already authenticated FCA AppState/session and cookies for the E2EE connection.
- Initialize the account-scoped E2EE runtime and persistent local identity automatically when E2EE is enabled.
- Keep password and 2FA handling inside the existing FCA login flow. Do not forward credentials to an external login API or relay.
- Make E2EE initialization fail-open: an E2EE failure must not break ordinary FCA login, MQTT, humanizer, or regular message operations.
- Keep key material and session data protected at rest; redact cookies, AppState, keys, and plaintext from logs.

**Acceptance checks**
- No new external credential-login path is introduced.
- Existing login signatures and ordinary FCA behavior remain unchanged.
- Restart reuses the same account identity and persisted keys.
- Missing or incompatible E2EE dependencies produce a clear E2EE-disabled state while normal FCA remains usable.

## Step 2 — Facebook device registration and key synchronization

**Goal:** Register the local Signal identity as a Messenger E2EE device and maintain its public key bundle.

- Connect the existing ICDC registration helper to the authenticated login lifecycle.
- Persist and reuse the Facebook E2EE device ID and registration metadata per account.
- Publish/synchronize the identity key, signed prekey, one-time prekeys, and protocol-supported post-quantum prekeys.
- Verify signed-prekey and device identity data before trusting or publishing it.
- Handle prekey replenishment, rotation, registration retries, and restart recovery without replacing an existing identity unexpectedly.
- Ensure one-time prekeys are consumed atomically and cannot be reused after successful consumption.

**Acceptance checks**
- Registration uses the existing authenticated session only.
- Device and key state survives restart and is isolated by account.
- Invalid server responses and rejected registrations fail safely.
- Key publication and consumption are tested against the selected protocol implementation, not only mocks.

## Step 3 — E2EE direct messaging and groups

**Goal:** Connect Signal sessions to Messenger's actual realtime message protocol.

- Implement peer/device discovery and authenticated bundle exchange.
- Establish and persist direct-message sessions with the selected Signal engine.
- Encode/decode Messenger E2EE MQTT envelopes and route incoming encrypted events through the existing realtime event lifecycle.
- Encrypt outgoing direct messages and decrypt incoming messages while preserving the public FCA API behavior.
- Integrate group Sender Keys and Sender Key Distribution Messages (SKDM).
- Support encrypted group message send/receive, membership/device changes, and key rotation.
- Keep ordinary non-E2EE message paths and event handling backward-compatible.

**Acceptance checks**
- Wire serialization and protocol fields match the supported Messenger implementation.
- Direct and group messages pass cross-device interoperability tests.
- Reconnect, duplicate delivery, out-of-order delivery, replay, and session recovery are covered.
- Unsupported or malformed encrypted events fail safely without corrupting normal MQTT processing.

## Step 4 — Encrypted media and end-to-end compatibility verification

**Goal:** Complete encrypted media flows and prove the integrated system works with authorized test accounts.

- Encrypt media before upload and decrypt downloaded media only after successful authentication.
- Integrate encrypted media metadata, upload/download transport, and temporary media handling.
- Cover image, video, and file attachments; add group encrypted media where the Messenger protocol supports it.
- Verify receipts, reactions, edit/unsend behavior, and attachment lifecycle on encrypted threads where supported.
- Compare behavior with the reviewed EryXen reference while independently validating the actual OmegA implementation.
- Run build, typecheck, lint, unit/integration tests, and authorized real-account tests.
- Verify fresh login, restart, reconnect, multiple devices, and recovery behavior.
- Document runtime/platform requirements, known limitations, and safe rollback behavior.

**Acceptance checks**
- Encrypted media is interoperable across authorized test devices.
- Real-account tests demonstrate successful encrypted send and receive; mocks are not accepted as proof.
- Ordinary FCA login, MQTT, humanizer, and regular messages remain unaffected when E2EE is disabled or unavailable.
- No secrets or plaintext appear in logs or test artifacts.

## Current implementation boundary

The branch already contains local encrypted key storage, libsignal adapter interfaces, local identity/prekey helpers, an ICDC registration helper, direct-message and group primitives, and experimental OmegA-authored cryptographic components. These are building blocks, not a complete Messenger E2EE implementation.

At the time of this roadmap update:
- the Signal module is still caller-supplied to the runtime;
- ICDC registration is not yet invoked by the login lifecycle;
- key-bundle publication and peer exchange are not integrated;
- Messenger E2EE MQTT envelope and wire-protocol integration is not established;
- group messaging and encrypted media are not proven end-to-end;
- local/mock tests do not prove live Messenger interoperability.

## Compatibility and safety constraints

- Do not change or replace the existing FCA password/2FA login flow.
- Do not add an external password/2FA relay or send credentials to a third-party login service.
- Reuse the authenticated AppState/session for the separate E2EE connection.
- E2EE remains opt-in and fail-open with respect to ordinary FCA functionality.
- Preserve account isolation, persistent identity, encrypted storage, atomic one-time-key consumption, and secret redaction.
- Do not claim production support until the acceptance checks above pass.
