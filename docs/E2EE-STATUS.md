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
