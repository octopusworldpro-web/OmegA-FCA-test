# Facebook E2EE device registration

OmegA-FCA exposes `registerFacebookE2EEDevice()` for the Messenger ICDC registration exchange.

Before calling it:
1. Create the account-bound encrypted `SignalKeyStore`.
2. Initialize the libsignal identity and registration ID with `ensureSignalIdentity()`.
3. Generate and persist a signed prekey with `createSignalSignedPreKey()`.
4. Supply the authenticated Facebook cookie header, account UID, Messenger app ID/category, and the same persistent device UUID on future runs.

The operation performs `fb_icdc_fetch`, signs the updated ICDC identity list with the local libsignal identity key, then submits `fb_register_v2`. It returns the assigned Messenger device ID and ICDC sequence.

On successful registration, OmegA-FCA now persists the device UUID, assigned Messenger device ID, registration timestamp, and ICDC sequence inside the account-bound encrypted SignalKeyStore. Reuse this stored device record and do not call registration on every process start. Facebook may change this private protocol without notice; a successful HTTP response is not proof that MQTT/Noise transport or encrypted message delivery is active. Those are verified in later checklist steps.


## Signal key inventory and prekey batches

The encrypted SignalKeyStore exposes sorted IDs for persisted signed, one-time EC, and Kyber prekeys. This lets the caller reconcile local inventory with the server's published inventory without exposing private key material.

- `createSignalPreKeyBatch(signal, store, startId, count)` creates 1–1000 one-time EC prekeys.
- `createSignalKyberPreKeyBatch(signal, store, startId, count)` creates 1–1000 signed Kyber prekeys.
- Batch creation rejects invalid IDs and collisions; individual creation also refuses to overwrite an existing key.
- One-time EC prekeys are removed through the libsignal `PreKeyStore.removePreKey()` callback after consumption.
- Signed prekeys are retained until an explicit lifecycle decision; do not delete an old signed prekey while sessions may still reference it.

These helpers generate and persist keys locally and return public material for a transport layer to publish. They do not pretend to publish a key bundle to Facebook; the exact Messenger upload protocol and server acknowledgement remain a separate integration/verification requirement.
