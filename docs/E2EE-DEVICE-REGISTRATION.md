# Facebook E2EE device registration

OmegA-FCA exposes `registerFacebookE2EEDevice()` for the Messenger ICDC registration exchange.

Before calling it:
1. Create the account-bound encrypted `SignalKeyStore`.
2. Initialize the libsignal identity and registration ID with `ensureSignalIdentity()`.
3. Generate and persist a signed prekey with `createSignalSignedPreKey()`.
4. Supply the authenticated Facebook cookie header, account UID, Messenger app ID/category, and the same persistent device UUID on future runs.

The operation performs `fb_icdc_fetch`, signs the updated ICDC identity list with the local libsignal identity key, then submits `fb_register_v2`. It returns the assigned Messenger device ID and ICDC sequence.

On successful registration, OmegA-FCA now persists the device UUID, assigned Messenger device ID, registration timestamp, and ICDC sequence inside the account-bound encrypted SignalKeyStore. Reuse this stored device record and do not call registration on every process start. Facebook may change this private protocol without notice; a successful HTTP response is not proof that MQTT/Noise transport or encrypted message delivery is active. Those are verified in later checklist steps.
