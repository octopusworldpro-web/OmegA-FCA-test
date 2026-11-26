# OmegA-FCA Messenger E2EE Auto-Integration Plan

> **Status:** Step 1 complete in the OmegA-Goatbot compatibility branch. This covers automatic local identity provisioning only; Messenger E2EE is not yet connected or production-verified.

## Goal

Make E2EE initialize and connect automatically as part of the normal OmegA-FCA account login/session lifecycle. The user should not have to manually add Signal encryption variables or paste an encryption key into Railway.

The implementation must preserve existing FCA login, normal message sending/receiving, reconnect behavior, and opt-in/feature compatibility. E2EE must never be reported as active unless the required stages actually succeeded.

## User-approved product decisions

- **No manual Railway E2EE environment variables.** Generate the local encryption material automatically.
- **Automatic startup.** The FCA login/session lifecycle should initialize the Signal runtime and attempt the supported Facebook E2EE registration/connection flow without a separate user command.
- **Key rotation is acceptable.** A newly generated local encryption key/device identity on a fresh setup or recovery is acceptable; the user does not require a manually managed long-lived secret.
- **Do not damage existing features.** A failed or unsupported E2EE connection must not prevent ordinary FCA login or non-E2EE messaging.
- **No fake success.** Local key generation, successful ICDC registration, and verified encrypted Messenger delivery are separate states and must be reported separately.
- **Keep changes focused.** Avoid unnecessary checkpoints, throttling, or unrelated architecture changes.

## Verified baseline on `feature/release-0.2.3-beta.3`

The following was checked against the branch when this document was prepared:

1. `package.json` is version `0.2.3-beta.3`, targets Node.js `>=20`, and does not list `@signalapp/libsignal-client` as a dependency.
2. `src/domains/e2ee/runtime.ts` exposes `createSignalE2EERuntime()`. It currently requires the caller to supply `accountId`, `storagePath`, `encryptionKey`, `localDeviceId`, and a compatible `signal` module. It initializes local identity and a signed prekey only.
3. `src/domains/e2ee/signal-key-store.ts` encrypts local state with AES-256-GCM and derives a 32-byte key using scrypt. Its current public API requires the caller to provide the encryption secret.
4. `src/domains/e2ee/libsignal-adapter.ts` contains adapters and local identity/prekey generation helpers around a supplied libsignal implementation.
5. `src/domains/e2ee/device-registration.ts` contains a Facebook ICDC registration helper. It requires authenticated account details, cookies, user-agent, libsignal, and a prepared key store. The caller must invoke it and persist/reuse its device record.
6. `docs/E2EE-STATUS.md` correctly says that local Signal primitives are not proof of a working Messenger E2EE transport. Login integration, peer bundle exchange, MQTT envelope handling, Messenger wire compatibility, and real encrypted delivery are not established by the existing local/mock tests.

Re-check these files before implementation because the branch may change after this document is committed.

## Step 2 implementation note

The runtime now provisions a configurable persistent one-time EC prekey batch (default 25) and, when the supplied Signal implementation exposes the required KEM API, an optional post-quantum prekey batch (default 1). Existing prekeys are reused across runtime restarts; only missing capacity is generated. The runtime returns the persisted public one-time prekeys and signed-prekey bundle on both first start and subsequent starts, while private material remains in the encrypted key store. Identity repair also no longer replaces an existing identity merely because registration metadata is missing.

A restart audit also fixed signed-prekey selection: when no explicit key ID is requested, the runtime now reuses the highest persisted signed prekey instead of generating a new one on every process start. This preserves the published bundle until an explicit rotation policy is implemented.

This is **not Step 2 complete**: the package still requires a caller-supplied compatible Signal implementation. No self-owned, Messenger-compatible Signal engine has been completed or verified yet, and the current mock tests do not establish protocol interoperability. Do not mark E2EE active on this basis.

## Five implementation steps

### Step 1 — Automatic local encryption setup

<em>Completed on OmegA-Goatbot branch `agent-fca-compat-fix`.</em>

**Purpose:** Remove the need for a user-provided Railway encryption secret and device ID.

Tasks:
- [x] Add an internal E2EE bootstrap/configuration path invoked from the GoatBot FCA login and account-recovery login option builders.
- [x] Generate a cryptographically secure 32-byte local encryption key and device ID with Node.js crypto.
- [x] Generate a positive local device identifier. Signal registration ID remains Step 2/3 work.
- Decide the storage policy explicitly:
  - [x] Persist per-account identity under `data/e2ee/<fbid>/identity.json` with `0700` directory and `0600` file permissions.
  - If identity continuity across process restarts is required, persist the generated wrapping secret securely alongside the account's local state (not in logs or committed files), or use an available secure host secret store.
  - If a fresh key is generated after every process restart, treat that as a **new E2EE device identity**: old sessions and keys cannot be decrypted/reused, and device registration/bundle publication must be repeated. Do not silently pretend it is the old device.
- [x] Scope each identity directory to the validated numeric Facebook account ID.
- [x] Reuse the existing identity on subsequent login/recovery calls; atomic creation prevents concurrent first-login overwrites.
- [x] Use exclusive temporary files, atomic hard-link creation, restrictive permissions, and temporary-file cleanup.

**Acceptance checks:**
- No E2EE-specific Railway variable is required for first-time setup.
- Missing local state causes secure automatic initialization.
- Existing valid state is reused when the selected persistence policy allows it.
- [x] Corrupt state, wrong account, or unreadable storage produces a clear E2EE-specific warning while ordinary login continues.
- Secrets and private keys never appear in logs.

### Step 2 — Signal engine and prekey initialization

**Purpose:** Make the cryptographic runtime available automatically, rather than requiring callers to inject an undocumented module manually.

Tasks:
- Select and pin a compatible, maintained libsignal client version that supports the exact APIs used by `libsignal-adapter.ts`; verify Node.js 20 and target platform support.
- Add the dependency and update lockfile/build configuration only after compatibility is confirmed.
- Create an internal adapter/factory that loads the installed Signal implementation and passes it to `createSignalE2EERuntime()`.
- Initialize identity, registration ID, signed prekey, one-time EC prekey batch, and Kyber/PQ prekeys only where supported by the selected library and the target Messenger protocol.
- Persist generated private material before attempting publication; do not publish a public key whose matching private key was not safely stored.
- Add safe prekey replenishment thresholds and collision protection. Do not regenerate a new identity on every reconnect.
- Handle unsupported native binaries/platforms as an E2EE-unavailable state, not a fatal FCA login error.

**Acceptance checks:**
- Runtime initializes with no caller-supplied `signal` module in normal usage.
- Required keys are created once and can be loaded on the next session according to the storage policy.
- Prekey IDs do not collide; private material remains local.
- Unit tests use the real selected library where possible; mocks remain useful for failure-path tests but are not treated as protocol verification.

### Step 3 — Automatic Facebook E2EE device registration

**Purpose:** Connect the initialized local identity to the authenticated Facebook account.

Tasks:
- Integrate `registerFacebookE2EEDevice()` into the real successful-login lifecycle after cookies, FBID, app metadata, user-agent, and Signal runtime are available.
- Derive/pass the required account fields from the existing authenticated session; do not ask the user to manually configure duplicate values.
- Reuse the stored device identifier and registration record when valid. Re-register only for first setup, explicit recovery, invalidated device state, or a deliberate identity rotation.
- Verify the ICDC fetch/register response and persist the returned device metadata atomically.
- Treat authentication expiry, unsupported account state, rate limiting, network errors, and server response changes as recoverable E2EE registration failures.
- Never log cookies, raw request bodies, identity private keys, or secret key material.
- Do not repeatedly register on every reconnect; use a bounded retry/backoff policy consistent with the existing connection lifecycle.

**Acceptance checks:**
- Successful login automatically attempts registration when prerequisites are present.
- A confirmed Facebook registration result is distinguishable from local-only initialization.
- A failed registration leaves ordinary FCA login and normal messaging operational.
- Reconnect reuses the same registered device when state is valid.

### Step 4 — Messenger realtime transport and encrypted message flow

**Purpose:** Connect Signal cryptography to the actual Messenger transport. This is the largest protocol-integration stage and cannot be replaced by local encryption helpers.

Tasks:
- Trace the existing MQTT/realtime connection, incoming message parser, outgoing message sender, receipt handling, and reconnect lifecycle before changing code.
- Identify the exact supported Messenger E2EE envelope format and the account/device metadata required by the transport. Confirm from reliable protocol evidence or controlled authorized test-account observations; do not invent field names or protobuf layouts.
- Implement peer/device discovery and bundle fetch/validation, including identity signature verification and trust-change handling.
- Implement the required session establishment and message encryption/decryption path using the selected Signal implementation.
- Route encrypted envelopes through the existing realtime transport while leaving ordinary message paths unchanged.
- Handle multi-device recipients, missing bundles, stale prekeys, duplicate delivery, out-of-order messages, replay protection, and session reset/recovery.
- Keep encrypted payloads separate from plaintext message handling. Never downgrade an E2EE message to plaintext silently.
- Integrate encrypted group messaging only after the direct-message envelope path is verified. Sender-key primitives already present are not proof that Messenger group wire compatibility exists.
- Keep read/delivery receipts and typing/seen actions aligned with the actual Messenger protocol; Signal application-level receipt helpers are not substitutes for Messenger's private wire format.

**Acceptance checks:**
- A real authorized test account can exchange an encrypted direct message with a compatible E2EE peer.
- The receiver decrypts the message and the sender/receiver agree on session state.
- Invalid signatures, missing keys, malformed envelopes, replayed messages, and unsupported message types fail safely.
- Existing non-E2EE send/receive and reconnect tests continue to pass.
- No plaintext fallback occurs for a message identified as E2EE.

**Important limitation:** Messenger's private/undocumented transport behavior may change. If the exact envelope/bundle protocol cannot be established and verified, this step must remain explicitly blocked/unsupported; do not label E2EE as connected merely because ICDC registration succeeded.

### Step 5 — End-to-end integration, resilience, tests, and documentation

**Purpose:** Make the feature safe to ship and straightforward to operate.

Tasks:
- Add lifecycle tests covering first login, repeat login, reconnect, account switch, logout, storage reset, device rotation, expired cookies, registration rejection, network outage, and missing/unsupported Signal runtime.
- Add direct-message tests with two independent real test identities and authorized test accounts. Add group and encrypted-media tests only after their respective protocol paths exist.
- Verify encrypted media key handling, upload/download flow, attachment metadata, integrity checks, and cleanup before claiming media support.
- Verify group sender-key distribution, member/device changes, sender-key rotation, and group membership updates before claiming group support.
- Run the full project build, typecheck, and test suite; add regression coverage for ordinary FCA behavior.
- Update `docs/E2EE-STATUS.md`, README/API docs, and examples to describe actual supported behavior, prerequisites, storage behavior, key rotation, and known limitations.
- Add structured status values such as `disabled`, `initializing`, `local-ready`, `device-registered`, `transport-ready`, `active`, and `failed`. Only use `active` after verified encrypted transport operation.
- Ensure errors are useful but redact credentials and cryptographic secrets.

**Acceptance checks:**
- Clean install/build/test passes on supported Node.js 20 environments.
- Normal FCA login and ordinary messaging remain functional if E2EE is unavailable.
- Automated tests prove each state transition and failure path.
- Real-account end-to-end results are recorded separately from mocked/unit-test results.
- Documentation never overstates the level of Messenger E2EE support.

## Cross-cutting implementation rules

- Do not add manual Railway E2EE environment variables as a prerequisite.
- Do not store private keys, encryption secrets, cookies, or AppState in source control, logs, test snapshots, or error messages.
- Keep E2EE account-scoped and isolate multiple logged-in accounts.
- Avoid breaking changes to existing public FCA APIs unless absolutely required; prefer internal automatic wiring and backward-compatible optional configuration.
- E2EE failures must not take down the normal FCA session.
- Do not silently downgrade encrypted messages to plaintext.
- Do not claim protocol compatibility based solely on mocks, local crypto tests, successful HTTP status, or device registration.
- Make changes in small reviewable commits and run targeted tests after each stage.
- Re-check current branch contents before editing; this document is the plan, not proof that any implementation step is complete.

## Work tracking

| Step | Scope | Status |
|---|---|---|
| 1 | Automatic local encryption setup | Done — 11 targeted Node.js tests passed locally; GoatBot branch `agent-fca-compat-fix` |
| 2 | Signal engine and prekey initialization | In progress — persistent EC prekey batch initialization added; automatic engine loading and real-engine verification remain |
| 3 | Automatic Facebook E2EE device registration | Not started |
| 4 | Messenger realtime transport and encrypted message flow | Not started |
| 5 | End-to-end integration, resilience, tests, and documentation | Not started |

**Step 1 validation:** 11 targeted Node.js tests passed locally for identity creation/reuse, account isolation, corrupt-state handling, permissions, provider selection, zero-E2EE-environment setup, and fail-open login options. The test files are committed in OmegA-Goatbot; the full GoatBot application and real Messenger E2EE transport have not been end-to-end tested here.

**Current release assessment:** Messenger E2EE is not production-integrated or verified. Step 1 provides local identity material only; Signal engine initialization, Facebook device registration, and encrypted Messenger transport remain future steps.
