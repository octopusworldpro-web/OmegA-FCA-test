# E2EE implementation status

## What exists in this branch

The source tree contains local Signal-related components:

- `signal-key-store.ts`: encrypted local persistence for identity keys, registration ID, prekeys, sessions, trusted identities, sender keys, and device metadata.
- `libsignal-adapter.ts`: adapter functions around a caller-supplied compatible Signal module.
- `runtime.ts`: initializes local identity/signed-prekey state and exposes direct-message actions and sender-key group primitives.
- `device-registration.ts`: separate Facebook ICDC device-registration helper.
- Additional direct-message, action, sender-key, peer-manager, and encrypted-media modules.

The key store uses AES-256-GCM and derives a 32-byte key with scrypt. The caller must provide an encryption secret containing at least 32 bytes. The package does not silently generate and persist that secret for the caller.

## What is not established as integrated

The runtime source explicitly states that local initialization is separate from:

- Facebook device registration being invoked in the login flow
- peer/bundle exchange
- Messenger E2EE MQTT envelope handling
- Messenger's encrypted-message wire compatibility
- end-to-end encrypted group message/media delivery

The presence of a device-registration helper or local encryption primitive is not proof of full Messenger E2EE. The local tests use controlled/mock dependencies and do not prove real encrypted delivery.

## Operational status

Treat Messenger E2EE as **not production-integrated / not verified** in this release. Do not enable it in a bot configuration on the assumption that the package automatically connects an E2EE transport.

## Requirements before claiming full support

1. Wire device registration and persistent device identity into the actual login lifecycle.
2. Implement and verify peer bundle/key exchange.
3. Integrate encrypted envelopes with the real Messenger realtime transport.
4. Verify direct-message and group-message protocol compatibility.
5. Verify encrypted media upload/download and receipt behavior.
6. Add authorized end-to-end tests against real test accounts, with secrets redacted.
7. Document platform/runtime requirements and recovery behavior.


## Receipt action support

The opt-in Signal action layer supports encrypted application-level read and delivery receipts through `sendReadReceipt` / `sendDeliveryReceipt`, with matching `decryptReadReceipt` / `decryptDeliveryReceipt` validators. These are Signal-encrypted payload helpers only; they are **not** Messenger's private receipt wire format and do not replace `api.markAsRead` or `api.markAsDelivered`. Automatic Messenger receipts remain controlled by `autoMarkRead` and `autoMarkDelivery` and are dispatched best-effort for incoming message events.


## OmegA-owned ratchet research implementation (in progress)

The branch now also contains `double-ratchet.ts`, an OmegA-authored experimental ratchet state engine built on the repository's native X25519, HKDF-SHA256, and AES-256-GCM primitives. It currently includes send/receive chain advancement, DH-ratchet transition logic, bounded skipped-message-key storage, state export/restore, and authenticated message headers.

Recent hardening:
- Decryption applies state changes transactionally; an authentication or validation failure restores the prior ratchet state.
- Persisted skipped-message entries are validated for identifier format, 32-byte key material, and the maximum entry count before restoration.
- Tests cover failed-authentication rollback, out-of-order delivery, replay rejection, state restoration, and malformed persisted state.

**This is not a verified Signal Double Ratchet implementation.** Its KDF labels, message/header encoding, AEAD choice, initialization/session-establishment rules, DH-ratchet interoperability, and test-vector conformance have not been validated against the Signal specification or Messenger. The current tests are local synthetic tests, not peer interoperability tests. Do not use this engine for production Messenger E2EE or report the E2EE state as active.

The remaining Step 2 work includes protocol-spec conformance and independent test vectors, an OmegA-owned session establishment/signature layer (including the required XEdDSA/PQXDH components where applicable), runtime factory integration without caller-supplied Signal modules, and persistence/lifecycle integration. Steps 3–5 remain blocked on establishing and validating Messenger's actual device-registration and encrypted transport formats.


## OmegA X3DH key-agreement core (in progress)

The branch now exposes `initiateOmegAX3DH()` and `respondOmegAX3DH()` in `src/domains/e2ee/x3dh.ts`. The module implements the classical X25519 three/four-DH key agreement core, the X3DH 32-byte HKDF derivation with the X25519 domain-separation prefix, identity-bound associated data using the typed Curve25519 public-key encoding, and both optional-one-time-prekey and no-one-time-prekey paths. It wipes its temporary DH buffers and local copies of ephemeral/private key bytes after derivation.

The initiator requires a `verifySignedPreKey` callback and aborts if it returns false. This is an explicit security boundary: **the callback must be a real XEdDSA verifier for the selected protocol**. The included tests use a synthetic verifier callback only to verify DH symmetry and failure plumbing; they do not test XEdDSA or establish Signal interoperability. The responder's caller must atomically consume/delete a one-time prekey after successful initial-message authentication.

This is a classical X3DH core, **not PQXDH** and not a complete Signal session. XEdDSA implementation, PQ KEM (ML-KEM/Kyber) interoperability, protocol-specific key/signature encodings, integration with the session store and ratchet, runtime auto-factory, and official protocol test vectors remain outstanding. Do not publish or enable this as Messenger E2EE.
