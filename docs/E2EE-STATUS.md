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


## OmegA-owned Double Ratchet engine (implementation in progress; conformance pending)

The branch now contains an OmegA-authored classical DH Double Ratchet engine in `src/domains/e2ee/double-ratchet.ts`, built on the local X25519, HKDF-SHA256, and AES-256-GCM primitives. It includes:

- Standard Alice/Bob initialization from a shared 32-byte session secret and Bob's initial ratchet key pair/public key.
- Root-chain KDF using the `WhisperRatchet` domain label and HMAC-SHA256 chain KDF (0x01 message-key and 0x02 next-chain-key constants).
- Sending/receiving chain advancement and two-step DH-ratchet transitions.
- PN/N counters, bounded skipped-message keys, out-of-order delivery and replay rejection.
- Canonical binary header authentication with length-prefixed external associated data.
- Transactional decryption: malformed headers, wrong associated data, and authentication failures do not consume keys or mutate state.
- State export/restore with key/counter/skipped-key validation.

Tests now exercise standard Alice/Bob initialization, first message and reply, repeated ratchet exchanges, skipped messages, replay rejection, tampered headers, wrong associated data, rollback, and state restoration.

**Status: engine implementation is present, but Signal conformance is not yet certified.** The local tests are synthetic and are not official Signal test vectors or independent peer interoperability tests. AES-256-GCM is used as the configured AEAD; Messenger's actual algorithm/encoding profile has not been established. Header encryption (the optional HE variant), protocol-specific wire serialization, and post-quantum SCKA/ML-KEM integration are not implemented here. Do not claim Messenger E2EE is active or production-ready based on this engine alone.

## OmegA X3DH key-agreement core (in progress)

The branch now exposes `initiateOmegAX3DH()` and `respondOmegAX3DH()` in `src/domains/e2ee/x3dh.ts`. The module implements the classical X25519 three/four-DH key agreement core, the X3DH 32-byte HKDF derivation with the X25519 domain-separation prefix, identity-bound associated data using the typed Curve25519 public-key encoding, and both optional-one-time-prekey and no-one-time-prekey paths. It wipes its temporary DH buffers and local copies of ephemeral/private key bytes after derivation.

The initiator requires a `verifySignedPreKey` callback and aborts if it returns false. This is an explicit security boundary: **the callback must be a real XEdDSA verifier for the selected protocol**. The included tests use a synthetic verifier callback only to verify DH symmetry and failure plumbing; they do not test XEdDSA or establish Signal interoperability. The responder's caller must atomically consume/delete a one-time prekey after successful initial-message authentication.

This is a classical X3DH core, **not PQXDH** and not a complete Signal session. XEdDSA implementation, PQ KEM (ML-KEM/Kyber) interoperability, protocol-specific key/signature encodings, integration with the session store and ratchet, runtime auto-factory, and official protocol test vectors remain outstanding. Do not publish or enable this as Messenger E2EE.

## OmegA-owned XEdDSA verification core (in progress)

The branch now contains `src/domains/e2ee/xeddsa.ts`, an OmegA-authored Curve25519 XEdDSA verifier implementing the revision-1 public-key conversion, Edwards point decoding, SHA-512 challenge calculation, scalar bit-length checks, and the specified verification equation. X3DH now uses this verifier by default when validating a signed-prekey bundle; an explicit protocol-specific verifier override remains available.

The verifier handles public inputs only and is not a signing implementation. Current automated tests cover malformed lengths, invalid signatures, and rejection by the default X3DH path. These are negative tests, not official XEdDSA vectors or independent interoperability evidence. Positive official vectors and cross-implementation tests are still required before treating signed-prekey verification as production-validated.

## OmegA hybrid PQXDH orchestration core (in progress; KEM backend required)

Added `src/domains/e2ee/pqxdh.ts` with initiator/responder orchestration for the Signal PQXDH revision-3 hybrid construction: X25519 DH1-DH3 (optional DH4 with EC OPK), signed curve-prekey and signed KEM-prekey validation using XEdDSA, KEM encapsulation/decapsulation, the Curve25519 0xFF domain prefix, SHA-512 HKDF with the protocol/curve/hash/KEM parameter string, and identity-bound associated data. A KEM provider is mandatory and must supply the exact parameter-specific key encoding and encapsulation/decapsulation functions. The module fails closed when no provider is supplied.

Automated tests use a deliberately synthetic test KEM to verify initiator/responder transcript symmetry and failure handling. **These tests do not implement or validate ML-KEM/Kyber.** No production KEM backend is currently wired. The Signal PQXDH specification requires a real post-quantum KEM; a callback interface or mock is not a substitute. Do not advertise PQXDH as operational until a vetted, parameter-matched KEM backend, official vectors, and independent interoperability tests are available.
