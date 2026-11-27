# OmegA-FCA E2EE — Current Implementation Status

**Canonical plan:** [E2EE-ROADMAP.md](E2EE-ROADMAP.md)  
**Version:** `0.2.3-beta.3`  
**Branch:** `feature/release-0.2.3-beta.3`

This file records source-level implementation evidence and its limits. The four-step roadmap is the sole authority for scope and completion criteria. The latest native media protocol implementation supersedes earlier historical entries describing FCA attachment relay; E2EE media no longer uses the ordinary FCA attachment upload/send path.

## Overall

**Step 1 is verified complete for local Signal runtime and FCA login lifecycle integration. Step 2 is verified complete for the user-approved offline source/fixture scope. Step 3's offline implementation now includes persistent outbox recovery and automatic group member/device-change key rotation, with the full configured CI pipeline passing; authorized live acceptance remains pending. Step 4 remains in progress. Live Facebook/Messenger interoperability is not established or claimed.**

| Step | Status | Implemented evidence | Main remaining work |
|---|---|---|---|
| 1. E2EE Engine & Login Integration | Verified complete (local boundary) | Pinned libsignal 0.70.0; authenticated UID validation; account-local bootstrap and encrypted store; automatic identity/device metadata; restart support; fail-open login integration | No remaining work within the stated local-engine/login boundary. Do not interpret this as server registration or native Messenger support |
| 2. Facebook Device Registration & Key Sync | Verified complete — offline scope | Automatic CAT retrieval; default ICDC registration/reuse; authenticated Noise XX WebSocket key-sync transport; strict certificate verifier; encrypted frames and IQ correlation; persisted acknowledgements; monotonic prekey IDs; replenishment/rotation; bounded retries and restart recovery; offline fixtures and CI pass | Live Facebook acceptance was explicitly waived and is not claimed; no captured valid live certificate chain; long-lived encrypted message events/MQTT belong to Step 3; no verified Kyber upload format |
| 3. E2EE Messaging & Group System | Offline implementation verified by CI; live acceptance pending | Native Noise WA-binary dispatcher; Messenger device/prekey discovery; direct/group encrypted text; ACK/retry/dedup; CAT-refresh reconnect; encrypted outbox persisted before send and replayed after restart until ACK; persisted group member/device snapshots and automatic Sender Key rotation on change during group send/reconnect; FCA API exposure | Authorized live cross-device acceptance; real receipts/order/replay validation |
| 4. Encrypted Media & Full Compatibility Test | Native media source implementation in progress; latest CI/live acceptance pending | 32-byte media keys with HKDF/AES-CBC/HMAC; `media_conn` + `/wa-msgr/mms` encrypted upload; native image/video/audio/document ConsumerApplication protobufs; direct fanout to peer/self devices; group Sender Key media; typed inbound media events; integrity-checked CDN download; binary/video/empty-file fixtures | Latest-head CI; authorized live media_conn/upload/download and cross-device direct/group acceptance; reconnect/restart and real receipt validation |

## Implemented components and boundaries

- `src/domains/e2ee/bootstrap.ts`: creates account-scoped local identity metadata and automatically generates/reuses a local encryption key and device ID. No E2EE environment variable or manual key setup is required for the default local bootstrap.
- `src/domains/e2ee/signal-key-store.ts`: encrypted persistence for Signal identity/session/prekey/group state, device metadata, pending Messenger ciphertext stanzas, and group member/device snapshots.
- `src/domains/e2ee/libsignal-adapter.ts`: adapter boundary for the selected libsignal implementation.
- `src/domains/e2ee/runtime.ts`: initializes local Signal identity, signed prekey, one-time EC prekeys, and Kyber prekeys when the installed libsignal module supports KEM generation. Runtime comments explicitly limit this to local identity/prekey initialization.
- `src/domains/e2ee/messenger-cat.ts`: obtains CAT from the authenticated FCA GraphQL session; the unofficial document ID is version-sensitive and CAT is refreshed before transient connection retries.
- `src/domains/e2ee/messenger-noise.ts` and `messenger-noise-socket.ts`: Noise XX handshake, pinned certificate-chain verification, X25519/HKDF/AES-GCM framing, Messenger WebSocket setup, full WA-binary decoding, long-lived node dispatch, IQ response correlation, and reconnect-safe frame reads.
- `src/domains/e2ee/messenger-binary/`: attributed WA-binary token tables, recursive decoder, encoder, and marshal/unmarshal helpers.
- `src/domains/e2ee/messenger-peer-directory.ts`: native Messenger device-directory and encrypt-IQ bundle retrieval, libsignal PreKeyBundle conversion, and reusable peer manager.
- `src/domains/e2ee/messenger-e2ee-service.ts`: direct text fanout/receive, group Sender Key/SKDM text flow, native direct/group media protobuf send/receive, all-peer/self-device fanout, `media_conn` upload/download, stanza acknowledgements, retry receipts, duplicate suppression, durable encrypted outbox replay across process restart, and automatic group member/device-change snapshot checks with Sender Key rotation on group sends/reconnect.
- `src/domains/e2ee/messenger-media.ts`: native Messenger 32-byte media-key/HKDF/AES-CBC/HMAC format, media_conn acquisition, encrypted-media CDN upload with 401 refresh retry, native image/video/audio/document ConsumerApplication builders, and integrity-checked decrypt.
- `src/domains/e2ee/encrypted-media.ts`, `direct-media-messaging.ts`, `encrypted-group-media.ts`, and `group-media-messaging.ts`: retained legacy application-envelope helpers and regression tests; the active FCA login path no longer uses these for native E2EE media transport.
- `src/domains/e2ee/login-integration.ts`: opt-in login lifecycle. It initializes local Signal state, automatically obtains CAT, performs ICDC registration/reuse, opens the default Noise key-sync socket, and publishes pending prekeys. An explicit `facebook.sendIQ` override remains available for tests/custom transports.
- `src/core/login-helper.impl.ts`: invokes E2EE after authenticated UID validation and ordinary FCA/MQTT setup, passing active cookies, user agent, and fb_dtsg to the CAT request adapter. Exposes native media send/download methods from the Messenger service; ordinary FCA attachment APIs are unchanged. E2EE failures remain fail-open for ordinary FCA login.
- `src/core/state.ts`: exposes opt-in E2EE configuration. Facebook `appId` and `fbCat` are optional overrides; standard login uses the audited default app ID and automatically fetches CAT.
- `src/domains/e2ee/device-registration.ts`: ICDC fetch/register, CAT wire encoding, response validation, and persisted device metadata. Tests use deterministic fetch fixtures, not live Facebook acceptance.
- `src/domains/e2ee/prekey-publisher.ts`: builds the WA-binary `encrypt` IQ and publishes through the authenticated Noise socket by default. It requires a matching IQ-result acknowledgement before persisting publication state.
- `src/domains/e2ee/direct-messages.ts` and `src/domains/e2ee/peer-manager.ts`: Signal direct-message primitives, native Messenger per-device bundle adapter, and session establishment. Direct/group text transport is wired through the E2EE Noise WebSocket, not the ordinary FCA MQTT JSON event channel.
- `src/domains/e2ee/group-key-manager.ts` and `src/domains/e2ee/sender-keys.ts`: group Sender Key/SKDM handling and delivery state.
- `src/domains/e2ee/group-messaging.ts`: application-level encrypted group-message envelope orchestration over an injected authenticated transport.
- `src/domains/e2ee/encrypted-media.ts`, `src/domains/e2ee/encrypted-group-media.ts`, and `src/domains/e2ee/group-media-messaging.ts`: local media crypto and application-level group-media orchestration; not native Facebook media transport.

Local cryptographic foundations include X3DH/PQXDH orchestration, XEdDSA verification, and an experimental Double Ratchet. Their presence is not, by itself, proof of official Signal conformance or Messenger interoperability.

## Kyber / post-quantum boundary

The current source generates and stores local Kyber material only when the libsignal KEM API is available. The documented Messenger device-registration format describes a Curve25519 identity key, signed Curve25519 Signed Pre Key, and Curve25519 One-Time Pre Keys; it does not specify a Kyber upload field or stanza. OmegA must not upload a guessed Kyber payload or label Kyber publication complete. Keep the local PQ material isolated unless a current authoritative Messenger protocol or an authorized server response establishes the supported format.

Reference: [Meta Messenger E2EE Overview — Device Registration](https://engineering.fb.com/wp-content/uploads/2023/12/Messenger-End-to-EndEncryptionOverview_12-6-2023.pdf#page=7).

## ICDC and prekey configuration

Enable the local runtime and optionally override Messenger ICDC parameters through login options:

```js
{
  e2ee: {
    enabled: true,
    facebook: {} // appId and fbCat are fetched/defaulted automatically
  }
}
```

When `e2ee.facebook` is enabled, the authenticated FCA login supplies its active cookie header, user agent, and fb_dtsg internally. CAT is acquired automatically and the default Messenger E2EE app ID is used unless explicitly overridden. Do not copy session cookies or CAT into configuration. If `e2ee.facebook` is omitted, OmegA initializes only the local Signal runtime and does not attempt ICDC registration.

The standard path opens the Messenger Noise key-sync socket and publishes pending prekeys after ICDC registration. An explicit `facebook.sendIQ` callback remains an advanced test/custom transport override; ordinary FCA MQTT JSON is not a valid substitute.

## Local storage security note

The generated store key is persisted in the account's local `identity.json` so it is reused automatically after restart. File/directory permissions are restricted where supported; this does not protect the key from someone who can read the same account's local files.

## Important boundaries

- ICDC helper invocation is not equivalent to successful Facebook device registration.
- A generated WA-binary prekey stanza is not proof of server acceptance.
- Application-level group messaging/media adapters are not native Messenger MQTT/media integration.
- Synthetic/mock tests do not establish Facebook server acceptance or cross-device interoperability.
- A passing CI run does not mean Messenger E2EE is active.
- Do not report E2EE as production-ready until all four roadmap acceptance sections are satisfied.

## Validation record

CI run [46031336965](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46031336965) passed for source commit `a8ac8ba135c42dfa10b63c9162ae5a8f363e6a02`: dependency/security audit, build and tests, TypeScript check, lint, and package dry run. This validates the offline source/fixture contract only; it does not establish live Facebook/Messenger interoperability.

See [E2EE-ROADMAP.md](E2EE-ROADMAP.md) for the only approved four-Step checklist and progress rules.


## 2026-11-27 — ICDC identity decoding hardening

- Updated `device-registration.ts` to accept both canonical padded Base64 and unpadded Base64URL ICDC identity encodings, while enforcing canonical decoding and an exact 32-byte public-key length.
- Updated `e2ee-device-registration.test.cjs` to exercise an unpadded Base64URL identity from the fetch response.
- This is a source/test hardening change only. It does not establish live ICDC acceptance or satisfy Step 2's authenticated Messenger Noise transport, CAT acquisition, server-aware prekey rotation/recovery, or live acceptance criteria. Step 2 remains **In progress**.

## 2026-11-27 — Current branch CI verification

- Commit: `a02542b93b097d99c7ac99f15cf862c7f0162e1d`.
- GitHub Actions run [46002835606](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46002835606) completed successfully on this exact commit.
- Verified job steps: dependency/security audit, build and test, TypeScript check, lint, and package dry run all passed.
- This verifies repository checks only. It does not verify live Facebook ICDC acceptance, Messenger Noise handshake/socket authentication, CAT acquisition, server-side prekey lifecycle, or cross-device interoperability. Step 2 remains **In progress**.

## Progress log

### 2026-11-27 — Initial documentation baseline review

**Scope:** Start tracking E2EE implementation work on `feature/release-0.2.3-beta.3`. The canonical four-Step scope in [E2EE-ROADMAP.md](E2EE-ROADMAP.md) is preserved; this log does not introduce or replace the approved roadmap.

**Source review findings**
- Step 1 remains verified complete within its documented local Signal runtime and FCA login lifecycle boundary: automatic local bootstrap, encrypted account-scoped storage, libsignal runtime setup, and fail-open login integration are present.
- Step 2 has implementation groundwork only: conditional ICDC registration and a WA-binary prekey publisher exist, but the login helper does not provide a native authenticated Messenger Noise `sendIQ` transport. Live Facebook registration/publication is not evidenced.
- Step 3 has local Signal direct/group primitives and transport-neutral orchestration, but native Messenger peer/bundle discovery and MQTT encrypted-envelope integration are not evidenced.
- Step 4 has local direct/group media cryptography and application-level orchestration, but native Messenger media transport and real-device acceptance are not evidenced.

**Validation**
- Repository test scripts include E2EE unit/integration tests, including login integration and real-libsignal runtime tests.
- Tests were **not run as part of this documentation review**. No new test-pass claim is made.
- No live Facebook/Messenger acceptance test was run. No server interoperability claim is made.
- No source-code changes were made in this baseline documentation update.

**Next work:** Continue with the canonical roadmap's next incomplete requirement. After each implementation task, update this status log with exact files changed, test commands/results, evidence, and remaining blockers before claiming progress.


### 2026-11-27 — Follow-up source audit

**Audit result:** The four-step status table above remains accurate. Step 1 is verified complete only for the local Signal engine and FCA login lifecycle boundary. Steps 2–4 contain implementation groundwork but do not meet their full acceptance criteria.

**Step 1 evidence rechecked**
- `bootstrap.ts` and `signal-key-store.ts`: automatic account-scoped bootstrap, generated/reused local device metadata, encrypted persistence, and restart support.
- `runtime.ts` and `libsignal-adapter.ts`: pinned libsignal integration and local identity/registration ID/Signed PreKey/One-time EC PreKey setup; Kyber generation is conditional on KEM support.
- `login-integration.ts`, `login-helper.impl.ts`, and `state.ts`: opt-in E2EE lifecycle after authenticated FCA login, authenticated session context passed internally, and fail-open handling so E2EE initialization failure does not abort ordinary login.

**Test files reviewed (not executed in this audit)**
- `test/e2ee-bootstrap.test.cjs`: automatic key persistence and account isolation.
- `test/e2ee-runtime-real.test.cjs`: installed libsignal runtime, prekey generation, persistence/restart reuse, and account isolation.
- `test/e2ee-login-integration.test.cjs`: disabled/ready/failed lifecycle paths, authenticated context forwarding, and cleanup on failure.
- `test/e2ee-runtime.test.cjs`: runtime lifecycle and restart persistence using a test Signal adapter.
- `test/signal-key-store.test.cjs`: encrypted state persistence, account binding, and key/session/prekey operations.

**Remaining gaps confirmed**
- Step 2: ICDC and PreKey helper implementations exist, but the standard FCA login path does not construct/provide the authenticated Messenger Noise `sendIQ` transport. No live Facebook registration or PreKey acceptance evidence was obtained.
- Step 3: direct/group Signal primitives and injected transport orchestration exist, but native Messenger peer/device discovery, bundle exchange, and MQTT encrypted send/receive integration remain unverified.
- Step 4: direct/group media cryptography and callback-based upload/download composition exist, but native Messenger media transport, real-device interoperability, and EryXen comparison remain outstanding.

**Validation limits**
- No test suite, build, typecheck, or lint command was run during this source audit.
- The queried combined CI status for commit `2a04b6cf87ac05ae41c22e1da6e6ff9ca8c8752e` was an empty status list (`[]`), not a passing check.
- No authorized live Facebook/Messenger account or cross-device acceptance test was performed.
- No source-code files were modified by this audit; this update records findings only.

**Conclusion:** Keep Step 1 verified complete at its stated local-engine/login boundary. Keep Steps 2, 3, and 4 in progress. Do not interpret the existing helper modules or test files as proof of live Messenger E2EE interoperability.


## 2026-11-27 — Step 2 recheck report

**Reviewed branch head:** `f94a6633934e1303bb06a43915acf531a2adae82`  
**Source changes in this recheck:** none; documentation report only.

### Findings

- ICDC registration is conditional on explicitly supplied `e2ee.facebook` options. The helper posts to `fb_icdc_fetch` and `fb_register_v2` and validates a particular response shape, but no live Facebook response was observed. Treat endpoint and payload compatibility as unverified.
- PreKey publication is conditional on a caller-provided authenticated `facebook.sendIQ` adapter. The regular login path passes no such adapter and does not create a Messenger Noise IQ connection.
- The runtime restores the full stored EC prekey list, and the publisher sends the full list whenever invoked. The key store does not persist which EC prekeys have been acknowledged by the server. Startup replenishment exists only as local count-based generation; no background replenishment or signed-prekey rotation policy is implemented.
- Kyber key material remains local-only. No server-side Kyber format is established by the checked implementation.

### Verification

- GitHub Actions [run 45963767306](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/45963767306) passed on the reviewed branch head. The job passed dependency/security audit, build and tests, TypeScript check, lint, and package dry run.
- CI success is not live Facebook ICDC acceptance and does not prove Messenger Noise transport or key publication interoperability.
- No authorized live-account test was run during this recheck.

### Next implementation targets

1. Integrate a real authenticated Messenger Noise IQ transport into the existing login session without routing through ordinary MQTT JSON.
2. Verify ICDC endpoint fields and response contract against an authorized live account before changing the registration payload.
3. Add persisted server-acknowledgement/publication state for EC prekeys, and make upload/retry idempotent.
4. Add a bounded replenishment and signed-prekey rotation/retirement policy, with restart/recovery tests.
5. Verify each behavior against the real server; keep E2EE failures fail-open for ordinary FCA login.

**Step 2 status: In progress — not complete.**


### 2026-11-27 — Step 2 completion attempt (user-authorized)

**Requested outcome:** complete the entire Step 2 target on the existing branch and report the result.

**Recheck performed**
- Re-read the current branch implementations of `device-registration.ts`, `prekey-publisher.ts`, `login-integration.ts`, `login-helper.impl.ts`, `signal-key-store.ts`, and the two focused test files.
- Confirmed the standard FCA login path calls E2EE with an empty factory dependency object. It supplies authenticated cookies and user agent to ICDC registration, but it does not create or inject a Messenger Noise IQ transport.
- Confirmed the prekey publisher only accepts a caller-provided `sendIQ` function. Its tests simulate an IQ result; they do not establish a real authenticated socket or server acknowledgement.
- Confirmed there is no persisted EC-prekey server-publication/acknowledgement ledger in the key store. Current runtime prekey replenishment is local initialization behavior, not verified server-aware replenishment/rotation.
- Attempted to retrieve the named EryXen FCA GitHub reference repository for protocol comparison, but the advertised repository URL was unavailable (GitHub returned 404). No reference source could be verified from this session.

**Safety decision / implementation result**
- No E2EE source files were changed. The missing Noise transport, ICDC server contract, and prekey stanza/acknowledgement behavior cannot be safely inferred from mocked tests or from the unavailable reference source. Implementing guessed protocol fields or treating the ordinary MQTT JSON channel as Noise would create false compatibility and could corrupt device registration/key state.
- No live Facebook account was available for authorized ICDC registration or real prekey-publication acceptance testing.
- No tests/build/typecheck/lint were run in this attempt; the previous CI result is not being reused as validation for a new implementation.

**Remaining Step 2 blockers**
1. A verified authenticated Messenger Noise transport and IQ response decoder integrated with the existing FCA session.
2. Authoritative/observed ICDC request and response contract, verified against an authorized account.
3. Persistent server-acknowledged EC-prekey state with idempotent upload/retry and correct one-time-key lifecycle.
4. Protocol-verified replenishment, signed-prekey rotation/retirement, and restart recovery.
5. Authorized live-server acceptance evidence for registration and signed/one-time prekey publication.

**Status: In progress — NOT complete.** This is an explicit implementation blocker report, not a completion claim. E2EE remains fail-open for ordinary FCA login; no fake success path was added.


## 2026-11-27 — Step 2 implementation update (source changes)

**Branch:** `feature/release-0.2.3-beta.3`  
**Reference implementations reviewed:** [bhhoang/fbapi-unofficial (MIT)](https://github.com/bhhoang/fbapi-unofficial), [WhiskeySockets/Baileys (MIT)](https://github.com/WhiskeySockets/Baileys), and [HerokeyVN/FB-Messenger-E2EE](https://github.com/HerokeyVN/FB-Messenger-E2EE). The MIT implementation was used to cross-check the ICDC request fields and the WA-binary `encrypt` IQ structure. The Noise reference confirms that the server certificate chain must be verified; a handshake that merely decrypts and ignores the certificate is not acceptable. The AGPL-3.0 FME implementation was inspected as a secondary reference, not copied.

### Source changes made

- `signal-key-store.ts`: added encrypted-at-rest, backward-compatible persistence for Facebook one-time-prekey publication acknowledgements and the currently acknowledged signed-prekey ID/timestamp.
- `prekey-publisher.ts`: now selects only locally stored EC prekeys without a persisted IQ-result acknowledgement. It does not blindly upload the full local prekey store on every restart. A matching `iq` response with the same request ID and `type=result` is required before acknowledgement state is persisted.
- Signed-prekey-only publication is supported when the current signed-prekey ID has not yet been acknowledged, without re-uploading previously acknowledged one-time prekeys.
- Failed, missing, mismatched, or error IQ responses do not mark keys as published.
- Added tests for acknowledgement persistence across restart, duplicate-upload suppression, and signed-prekey-only publication.

### Verification and remaining Step 2 work

- The source/test changes were pushed to this existing branch. GitHub Actions runs triggered by intermediate commits were cancelled by later pushes; the final documentation commit will trigger the definitive CI run. No passing result is claimed until that run completes.
- The normal FCA login still does not create an authenticated Messenger Noise socket or inject its `sendIQ` adapter. The existing ICDC helper still requires configured `facebook.appId` and `facebook.fbCat`; automatic CAT retrieval and default login wiring are not implemented yet.
- No server-side prekey-count query, automatic refill scheduler, or signed-prekey rotation/retirement policy has been integrated.
- No authorized live Facebook account was used. ICDC acceptance and server IQ acknowledgement remain unverified against Facebook.

**Step 2 status: In progress — NOT complete.** The acknowledgement/retry groundwork is now implemented and tested in source-level tests, but the missing authenticated Noise transport and automatic login integration still prevent the full Step 2 acceptance criteria from being met.


## 2026-11-27 — Follow-up reference and transport security review

The remaining Step 2 transport work was re-investigated against the public Messenger implementations:

- `bhhoang/fbapi-unofficial` (MIT) confirms the CAT GraphQL document ID, Messenger E2EE app ID, E2EE WebSocket endpoint, ICDC request fields, and the `encrypt` IQ shape. Its Noise implementation does not expose a certificate-chain verification step.
- `HerokeyVN/FB-Messenger-E2EE` (AGPL-3.0) contains a Messenger Noise XX transport implementation, but its `verifyCertChain()` function is explicitly a placeholder/TODO and does not validate the server certificate chain. The reviewed socket also logs sensitive ephemeral private-key material. This implementation is therefore not safe to transplant as a production transport without replacing and independently validating those sections.
- The public references do not provide evidence that the current OmegA-FCA login MQTT socket is itself an authenticated Messenger E2EE Noise channel. MQTT JSON traffic cannot be adapted into a Noise IQ transport.

**No unverified Noise socket, certificate bypass, or guessed server ACK has been added.** A transport that skips server certificate verification would expose the E2EE session to an active man-in-the-middle and would not meet the security requirement.

### Remaining acceptance blockers

1. Implement a Messenger Noise XX handshake with verified server certificate chain, correct client payload, framed AES-GCM transport, and IQ response correlation; add protocol-vector tests.
2. Wire CAT retrieval using the authenticated FCA request/session and automatically invoke ICDC registration with the confirmed app ID.
3. Attach the Noise transport to the authenticated Messenger E2EE endpoint; publish and verify EC one-time and signed prekeys through the real IQ channel.
4. Add server-side prekey-count query and bounded replenishment, plus a safe signed-prekey rotation/retirement policy that preserves old keys while active sessions may still reference them.
5. Run an authorized live-account registration and prekey acceptance test.

**Status remains: Step 2 In progress — NOT complete.** The source-level ACK persistence and duplicate-upload changes from the preceding implementation remain in place. This follow-up review found that the available reference Noise implementations are not sufficient evidence for a secure production transport; the missing acceptance items above are not marked complete.


## 2026-11-27 — Step 2 target completion audit

**Reviewed branch:** `feature/release-0.2.3-beta.3`  
**Reviewed head before this report:** `8882fcc32f27436bd7b8875b42232f5f647a48df`

### Verified implementation now present

- `src/domains/e2ee/signal-key-store.ts`: encrypted, backward-compatible persistence for acknowledged one-time EC prekeys and the currently acknowledged signed-prekey ID/timestamp.
- `src/domains/e2ee/prekey-publisher.ts`: selects only unacknowledged local EC prekeys; requires an IQ response with tag `iq`, matching request ID, and `type=result`; persists acknowledgements only after that validation; supports signed-prekey-only publication and skips already acknowledged keys.
- Focused test files include persistence across restart, duplicate-upload suppression, signed-prekey-only publication, and ICDC/prekey helper behavior.
- `device-registration.ts` persists the ICDC device record after a response passes its local shape checks. Those checks are not live Facebook acceptance evidence.
- Current branch CI run [45978434688](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/45978434688) completed successfully for the reviewed head. This verifies the configured CI pipeline only; it does not verify Facebook server behavior or live Messenger transport.

### Step 2 acceptance items still blocked

1. The ordinary FCA login path still passes no authenticated Messenger Noise `sendIQ` transport. `state.ts` exposes an optional caller-supplied adapter, but `login-helper.impl.ts` does not construct a Noise XX session or bind one to the E2EE endpoint.
2. The public Noise references reviewed for this task do not provide a safe drop-in implementation: the inspected code either lacks an independently verified certificate-chain validation path or contains a certificate-verification TODO and unsafe ephemeral-key logging. No certificate bypass or unauthenticated transport was added.
3. Automatic CAT retrieval and default ICDC wiring are not integrated. ICDC registration still depends on configured `appId` and `fbCat`; no authorized live-account request/response was available to validate its contract.
4. Server-side prekey-count query, bounded server-aware replenishment, and safe signed-prekey rotation/retirement are not implemented or verified.
5. No authorized live Facebook account test confirmed device registration or real IQ publication/acknowledgement.

### Corrections to earlier status notes

The earlier recheck statement that the key store had no publication acknowledgement ledger was superseded by the later source update documented above. The current source does persist acknowledgement state. Likewise, earlier statements that the publisher always re-uploaded the full stored EC prekey set are superseded by the current unacknowledged-only selection behavior. The remaining blocker is transport and live protocol acceptance, not the absence of local acknowledgement persistence.

**Final Step 2 disposition: IN PROGRESS — NOT VERIFIED COMPLETE.** The local acknowledgement/retry groundwork and CI validation are present, but the target's authenticated transport, automatic login integration, server-aware lifecycle, and live acceptance criteria are not met. Marking Step 2 complete would be inaccurate. Ordinary FCA login remains fail-open; no guessed protocol or false server-success path was introduced.


## 2026-11-27 — Step 2 source implementation follow-up

This entry records actual source changes after the prior audit; it does not change the Step 2 acceptance boundary.

- `src/domains/e2ee/prekey-publisher.ts`: serialized prekey publication per `SignalKeyStore` instance. Concurrent login/recovery calls for the same account now wait for the preceding publication to finish and re-read persisted acknowledgements before deciding what to upload.
- The publisher now persists acknowledgement only for EC prekey IDs actually present in the uploaded IQ. It no longer marks every ID returned by the store as published when an injected/stale runtime bundle omitted some of those keys.
- `test/e2ee-prekey-publisher.test.cjs`: added coverage for concurrent publication suppression and for keeping absent-from-bundle prekeys unacknowledged.
- Source commit: `a1eac676a485c8650d1eec0c467423961af4e73b`; regression test commit: `f9266d7a8dd52617a4ce1fd2acdd5165f535fd72`; final source correction commit: `ba90859b90ccd79ce661d26e18d7a6531742139e`.
- CI for final source commit [45980647560](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/45980647560) completed successfully: build/tests, TypeScript check, lint, and package dry run all passed.

**Step 2 remains IN PROGRESS — NOT VERIFIED COMPLETE.** These are real local publication correctness improvements, not a substitute for the missing authenticated Messenger Noise transport, default FCA login wiring, server-aware prekey lifecycle, or authorized live Facebook acceptance. Those protocol requirements remain open; no transport or server behavior was fabricated.


## 2026-11-27 — Noise identity and certificate groundwork update

**Branch:** `feature/release-0.2.3-beta.3`  
**Source head recorded for this update:** `aac205379522b8335ffc81f7db07c864da124fda`

### Changes recorded

- Added a separate persistent X25519 key pair for the Messenger Noise static identity in `src/domains/e2ee/signal-key-store.ts`. It is stored in the existing encrypted account-scoped store and remains backward-compatible with older store payloads.
- Updated `src/domains/e2ee/runtime.ts` to provision that Noise key pair once and reuse it after restart. It is not reused as the Signal identity key.
- Added store/runtime tests for 32-byte key validation, separation from the Signal identity, and persistence across restart.
- Added `src/domains/e2ee/noise-certificate.ts` with strict protobuf parsing and certificate checks: root signature, intermediate signature, leaf signature, issuer serial, validity window, and leaf public-key match to the server static key.
- Exported the certificate verifier and added negative-path tests to the package test command.

### CI evidence

GitHub Actions runs [45990589918](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/45990589918) and [45990583250](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/45990583250), both for source head `aac205379522b8335ffc81f7db07c864da124fda`, completed successfully. The jobs passed dependency/security audit, build and tests, TypeScript check, lint, and package dry run.

### Not yet implemented / verified

- The certificate verifier is not yet called by a Noise XX handshake and does not yet have a captured valid Messenger certificate-chain test vector or live endpoint verification.
- The persisted Noise static key is not yet connected to an authenticated Noise socket.
- Messenger Noise framing, encrypted transport, IQ send/response correlation, and normal FCA login wiring are still missing.
- No CAT/ICDC automatic login flow, live device registration, or real server prekey acknowledgement was established by these commits.
- Direct/group encrypted message integration with the existing MQTT send/receive pipeline and native encrypted media upload/download remain outstanding.

**Status:** Step 2 **In progress**; Step 3 **In progress**; Step 4 **In progress**. This update records source groundwork and passing CI only. It does not claim a complete Noise transport, live Messenger interoperability, or completion of any of Steps 2–4.


## 2026-11-27 — Step 2 acceptance policy update

- Per the user's explicit direction, a live Facebook account test is not required to complete Step 2.
- Step 2 must instead include the full source integration plus deterministic, versioned protocol fixtures and a simulated Messenger server covering CAT, ICDC, Noise XX, certificate validation, encrypted framing, IQ acknowledgements, prekey lifecycle, retry/reconnect, and restart recovery.
- A successful fixture suite and CI run prove the implemented offline protocol contract only. They do not prove that Facebook currently accepts the unofficial wire format. Live interoperability remains an optional, separately reported check.
- Step 2 is still **In progress**; this policy/documentation change alone does not complete it.

## 2026-11-27 — Step 2 verified complete (offline scope)

**Source commit:** `a8ac8ba135c42dfa10b63c9162ae5a8f363e6a02`  
**CI:** [run 46031336965](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46031336965) — all configured jobs passed.

- CAT is fetched automatically from the authenticated FCA GraphQL session and refreshed before bounded retries after transient Noise connection failures.
- ICDC device registration/reuse is integrated into the opt-in FCA login path, with the default Messenger E2EE app ID and correct CAT encoding for fetch/register requests.
- The normal path opens the Messenger Noise XX WebSocket transport, validates the server certificate chain with the strict pinned-root verifier, waits for login success, encrypts/decrypts frames, parses IQ responses, and publishes pending EC prekeys.
- The encrypted key store persists acknowledgement state and monotonic prekey ID allocation. Consumed IDs are not reused; the local pool is replenished, expired signed prekeys rotate while old records are retained, and retries/restart recovery are covered by fixtures.
- Deterministic tests cover CAT, ICDC, synthetic Noise XX handshake, frame cipher direction, IQ result parsing, prekey lifecycle, CAT refresh/retry, and restart behavior. Certificate negative/malformed inputs are covered; the successful handshake fixture uses an injected verifier seam because no captured valid live Messenger certificate chain is available.
- No live Facebook login, ICDC server acceptance, or real-server IQ acknowledgement was run. This was explicitly waived by the user and is not claimed.
- Step 2 is **Verified complete — offline scope**. Step 3 remains responsible for long-lived incoming encrypted-message events and MQTT envelope integration; Step 4 remains responsible for native encrypted media transport. Kyber publication is not implemented or claimed.


### 2026-11-27 — Step 3 native transport integration audit

**Reviewed branch head:** `a3eb5f5c600a0879745d688f8d5a05e1aea451ea`  
**Scope:** Step 3 — E2EE Messaging & Group System. This is a source/protocol audit entry; it does not mark Step 3 complete.

**Source findings**
- `direct-messages.ts` implements libsignal session establishment, encryption, and decryption, but requires a caller-supplied native PreKeyBundle and per-device identity.
- `peer-manager.ts` is transport-neutral: device discovery, bundle retrieval, and bundle parsing are injected dependencies. No verified Messenger device-directory or bundle-fetch adapter is connected to the authenticated FCA session.
- `group-key-manager.ts`, `sender-keys.ts`, and `group-messaging.ts` implement local Sender Key/SKDM state and encrypted-envelope orchestration, but the send/distribution functions are injected authenticated transports, not native Messenger stanza publishers.
- `connect-mqtt.ts` and `domains/realtime/parse-delta.ts` currently process the ordinary MQTT JSON/delta event path. They do not decode Messenger E2EE Noise binary stanzas or decrypt native `msg`/`pkmsg`/`skmsg` payloads.
- `messenger-noise-socket.ts` currently reads frames synchronously for login success and serialized IQ requests. Its IQ loop can consume and discard non-matching incoming stanzas; there is no long-lived event dispatcher/queue for encrypted message, receipt, retry, and notification nodes. Its current binary-node decoder is not a complete recursive Messenger WA-binary decoder.
- Therefore, neither direct messages nor group messages are connected end-to-end to the live Messenger receive/send lifecycle. Existing local tests validate injected adapters and local cryptographic/state behavior only.

**Protocol/reference review**
- Meta's [Messenger E2EE technical overview](https://engineering.fb.com/wp-content/uploads/2023/12/MessengerEnd-to-endEncryptionOverview_12-6-2023.pdf) documents pairwise Signal sessions and Sender Keys for group fanout, including SKDM distribution and key reset on membership/device changes. It does not provide a complete current unofficial client implementation of the native Messenger socket/event and bundle-discovery wire contract.
- The public [HerokeyVN/FB-Messenger-E2EE](https://github.com/HerokeyVN/FB-Messenger-E2EE) source provides useful protocol research for Noise stanzas, encrypted message parsing, and event mapping. It is AGPL-3.0; its implementation is not treated as proof of server compatibility. Previously reviewed certificate-verification placeholders and other security-sensitive code must not be transplanted as-is. No captured live-server fixture or authorized cross-device acceptance evidence is present in this repository.

**Implementation decision**
- No guessed MQTT envelope, device-discovery endpoint, bundle schema, stanza token table, or plaintext fallback was added. Ordinary FCA messaging and fail-open behavior remain unchanged.
- No Step 3 source code was changed in this audit. No new tests or CI were run for Step 3.
- Step 3 remains **In progress — NOT verified complete**. The remaining work is a complete Messenger binary-node/event dispatcher, verified peer/device and bundle discovery/parsing, native direct-message stanza send/receive/decrypt, native SKDM delivery and group ciphertext flow, retry/reconnect/replay handling, and deterministic protocol fixtures. CI/local tests must validate the resulting source; live interoperability must be reported separately.


### 2026-11-27 — Step 3 transport dispatcher implementation update

**Branch:** `feature/release-0.2.3-beta.3`  
**Source commits:** `beae39e69b0c158ef668ec147aa09d57e05d1177`, `7f7a992baea3f761960822f8de22bad66857d37c`, `1970eb95fc65bb354f18ec8c155697336cc814d6`, `cd0c51053255363dd1e9955c4ca04e1e82488d96`

**Implemented**
- Replaced the one-level binary-node child parser with a recursive node parser, retaining nested child structure and rejecting duplicate attributes/trailing bytes.
- Replaced the serialized IQ read loop with one long-lived Noise frame dispatcher. IQ requests are correlated by ID; unrelated incoming IQ, message, presence, receipt, and notification nodes are emitted instead of being consumed and discarded.
- Added `onNode`, `onceNode`, and `onClose` listener APIs, pending-IQ timeout/error handling, duplicate in-flight ID rejection, and close-time rejection of pending requests.
- Preserved nodes received between the Noise handshake and dispatcher startup so login-time events are not silently lost.
- Added recursive binary-node fixtures, including multiple nesting levels.

**Verification**
- GitHub Actions run [46035934055](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46035934055) was triggered for source/test changes. Its result must be checked before treating this update as CI-verified.
- No live Messenger server, cross-device account, or native encrypted-message round-trip was tested.

**Remaining Step 3 acceptance work**
- The dispatcher now exposes native incoming nodes, but the repository still has no verified current Messenger peer/device-directory and PreKeyBundle request/response adapter.
- Native direct-message `msg`/`pkmsg` encode/send and receive/decrypt lifecycle is not yet connected to the socket.
- Native SKDM distribution, group `skmsg` send/receive/decrypt, group membership/device-change key rotation integration, and receipt/retry/replay recovery are not yet wired to Messenger's native stanza contract.
- No captured, versioned Messenger protocol fixtures establish those remaining wire contracts. No guessed endpoints, token mappings, or plaintext fallback were introduced.

**Step 3 status: IN PROGRESS — NOT COMPLETE.** This update is a real transport-layer implementation, not a claim that native direct and group E2EE messaging is complete. Ordinary FCA messaging remains unchanged.


### Step 3 dispatcher follow-up — buffered consumer delivery

- Source commit: `ce3c0a12bc3f35a8d8b0fd49b72a112ab31581ce`.
- Incoming Messenger nodes are now retained until a consumer subscribes, including nodes received before the caller gets the connected socket. A bounded 10,000-node backlog stops the socket with an explicit error rather than silently dropping unconsumed events.
- CI for this source head: [run 46036056104](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46036056104) — pending at the time this note was written.
- This follow-up closes the early-subscriber event-loss window; it does not implement the remaining native direct/group message codecs and lifecycle. Step 3 remains **IN PROGRESS — NOT COMPLETE**.


### 2026-11-27 — Step 3 native Messenger messaging implementation record

- Source branch head: `1a5b461ad41be89db50c8c41d9fd2383cbb4559d`; documentation commits follow this head.
- Implemented and connected native Messenger WA-binary parsing/encoding, IQ/event dispatch, device discovery, PreKeyBundle retrieval/conversion, direct text fanout and receive/decrypt, group Sender Key/SKDM distribution and group text send/receive/decrypt.
- The authenticated login lifecycle now attaches the service when `e2ee.facebook` is configured. The FCA API exposes `sendDirectText`, `sendGroupText`, `syncGroupMembership`, and the `messenger` event emitter. Ordinary non-E2EE FCA messaging remains unchanged.
- Added acknowledgement-gated distribution delivery, bounded retry receipts, inbound deduplication, CAT refresh on reconnect, and replay of the same encrypted stanza while the process remains alive.
- Offline tests added: `e2ee-messenger-binary.test.cjs`, `e2ee-messenger-peer-directory.test.cjs`, `e2ee-messenger-reconnect.test.cjs`, and `e2ee-messenger-send.test.cjs` (direct/group send and inbound decrypt event).
- CI run [46039184482](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46039184482) for source head `1a5b461ad41be89db50c8c41d9fd2383cbb4559d` passed dependency/security audit, build and tests, TypeScript check, lint, and package dry run.
- **Limitations:** no authorized live Messenger account or cross-device round-trip was available; membership rotation is currently explicitly invoked through `syncGroupMembership`; outbox persistence across process restart and media remain unimplemented (media belongs to Step 4). Step 3 is therefore **not marked Verified complete**.


## 2026-11-27 — Step 3 durable recovery and automatic group rotation update

- Added backward-compatible optional fields to the encrypted Signal store for pending Messenger stanzas and group member/device snapshots.
- The service persists each encrypted stanza before network transmission, restores unacknowledged stanzas after process restart/reconnect, and removes durable entries after matching ACKs.
- Group sends and reconnect recovery re-discover group participants and their devices. A changed member/device snapshot triggers Sender Key rotation and SKDM redistribution; snapshots are saved for subsequent comparisons.
- Added focused persistence, process-restart replay, and device-change rotation tests.
- CI run [46042495729](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46042495729) passed for source/test commit `e5ba2b9e51df25413b4185e3ae921d6f551f4dd5`: dependency/security audit, build and full tests, TypeScript check, lint, and package dry run.
- No authorized live Messenger account or cross-device acceptance test was available/performed. No live interoperability claim is made; media remains Step 4.


### Step 3 CI verification — 2026-11-27

- Source/test commit: `e5ba2b9e51df25413b4185e3ae921d6f551f4dd5`.
- GitHub Actions [run 46042495729](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46042495729) completed successfully. Dependency/security audit, build and full test suite, TypeScript check, lint, and package dry run all passed.
- The passing suite includes encrypted-store persistence across restart, durable Messenger outbox replay/ACK removal, and automatic group Sender Key rotation when the discovered member-device set changes.
- This verifies the offline source/fixture implementation only. No authorized live Messenger cross-device test was run; Step 3 remains **In progress** until live direct/group interoperability and real-device receipt/order/recovery acceptance are evidenced.


## 2026-11-27 — Step 4 media integration batch

- Added direct media receive/decrypt composition and generalized attachment-key wrapping to the active runtime Signal session API.
- Added direct-media envelope orchestration. Native Messenger E2EE service now exposes direct and group media send/receive methods. Direct media is encrypted for the exact selected peer device; group media is wrapped with the group Sender Key and sent through the native encrypted group text path.
- FCA login exposes `api.e2ee.sendDirectMedia` and `sendGroupMedia`, uploading only ciphertext through the existing `api.uploadAttachment`. The receive APIs accept a download callback because no generic legacy attachment-ID download resolver was found in the current FCA API surface.
- Added `test/e2ee-direct-media.test.cjs` and wired it into the full npm test script. Existing group media tests remain included.
- Source commits: `4e0fe15536ca681c6d79743f77beaf964354655d`, `d1b158250a67ceff5267bb79c9120f48b15eeed4`, `fc06111c5e783981aced8e00d8ff44cd6bf75de8`, `06354e23d4e615dfdd0c5a50d92875d73f8f92b1`, `a3379107b5bd4b364474d833580830374ab6b4d9`, `712a83203c666d0c9d8fbb0b7dbc779f6981e95b`, `461406cc2a3f44b214e27efa66bef24d2e45de07`, `f62c8f2ad1dd9092aa129dc112ad29ceb4019c41`, `0246f9797c610de7917a4d0a79950e1cb9841389`, `563f08b86f831e757b966a26af13cfe1debe3e37`, `db79021e1eb9a22e5e76117aa79388d78b12bf60`, `cd75debed3c6025b32a11d76fac5395e4a466792`.
- CI verification for the latest source head is pending. No live Messenger media test is claimed.
- Remaining: default attachment download resolution, direct-media multi-device key fanout, verified native attachment metadata/media stanza interoperability, video/file lifecycle, EryXen protocol comparison, and authorized real-account acceptance.

**Step 4 remains In progress.**


## EryXen attachment compatibility comparison

Reviewed EryXen FCA `akashxback/fca-eryxenx` main and compared its `src/api/messaging/uploadAttachment.js`, `sendMessage.js`, `getMessage.js`, and `resolvePhotoUrl.js` with OmegA's `src/transport/http/upload-attachment.ts`, `src/domains/messages/commands/send-message.ts`, `src/domains/messages/queries/get-message.ts`, and `src/domains/messages/queries/resolve-photo-url.ts`. Both preserve the Mercury upload -> pre-uploaded attachment ID -> MQTT message attachment flow and attachment metadata/URL resolution. OmegA's E2EE media path reuses these APIs without changing normal non-E2EE attachments.

## Step 4 transport refinement — 2026-11-27

- The E2EE upload callback now uploads ciphertext, attaches the pre-uploaded ID to the destination thread through the existing FCA sendMessage API, and returns the resulting thread/message reference inside the Signal-encrypted media envelope.
- Default direct/group media download methods retrieve the thread message through api.getMessage, select its attachment URL, require HTTPS plus a Facebook CDN hostname allowlist, and cap downloads at 100 MiB before decrypt/integrity validation.
- Direct media currently wraps the key for one selected peer device; multi-device fanout remains open. Group media uses the existing Sender Key group engine.
- No captured native Messenger E2EE media protocol fixture or authorized live media test exists yet. The ciphertext attachment travels over the established FCA attachment channel; its key and descriptor travel inside the native Signal-encrypted direct/group message. This is not a claim that Messenger's own native E2EE attachment stanza contract has been live-verified.
- GitHub Actions [run 46044369909](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46044369909) passed for source commit `58ebf84fae915d0375a330217b00393826586b58`: dependency/security audit, build/full tests, TypeScript check, lint, and package dry run.


## Step 4 CI verification — 2026-11-27

- Source commit: `58ebf84fae915d0375a330217b00393826586b58`.
- [GitHub Actions run 46044369909](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46044369909) passed dependency/security audit, build and full test suite, TypeScript check, lint, and package dry run.
- This verifies the implemented offline media helpers and source integration. It does not establish live Messenger E2EE media interoperability.


## 2026-11-27 — Step 4 direct-media fanout update

- Source commit: `d43411fc03451daab0c5553f87682ead064b9bc6`.
- `MessengerE2EEService.sendDirectMedia` now iterates over all devices returned by the peer directory rather than selecting only the first device. Each device gets its own Signal-wrapped key/envelope and its own ciphertext upload.
- A failed device does not stop attempts to remaining devices. Partial delivery is surfaced through `direct_media_partial_delivery`; individual errors emit `e2ee_error`; all-device failure rejects with `AggregateError`.
- Roadmap update commit: `c8c0a787c818e60240678f0177e669196bad7363`.
- Verification boundary: no CI status was available for the source commit during this update and no runtime tests were executed in this session. Native media stanza protocol fixtures, full video/file lifecycle coverage, EryXen evidence comparison, and authorized live Messenger media acceptance are still outstanding. Step 4 remains **In progress**; no interoperability claim is made.


## 2026-11-27 — Step 4 inbound media and file lifecycle update

- Added typed inbound media event dispatch in `MessengerE2EEService`: decrypted version-1 direct/group media envelopes emit `direct_media` / `group_media` with sender and thread/group context; normal text remains on `message`.
- Expanded native Messenger service fixtures to test direct media fanout to two discovered peer devices and inbound direct/group media event delivery.
- Expanded direct-media tests with a 256 KiB binary video-like payload and zero-byte file round-trip, metadata preservation, ciphertext-only upload, and existing integrity/peer validation checks.
- Source/test commits: `6bc34f5c3899ef4849d3e59f48ca8a35ac0c778a`, `ab42a9e59116fee240555e5fce142a35c510b779`, `d4c226b52e0eeb29a7c462af9d460723d3b6f98e`, `ff5f8014d9999b8a779ea03dc6cb5f1da3da47da`.
- Roadmap update commit: `9b9451d4300d474de2905768da7e3e8fdf65f698`.
- Workflow run [46045981492](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46045981492) covered an earlier fanout commit and was still running when checked; it does not verify the later event-dispatch or expanded test commits. No latest-head green CI claim is made.
- EryXen compatibility comparison is limited to the established legacy attachment upload / pre-uploaded ID send / getMessage URL-resolution lifecycle. OmegA encrypts bytes before this upload and sends key/descriptor only inside Signal encryption. Native Meta media-stanza compatibility and authorized live-device acceptance remain unverified.
- Step 4 remains **In progress**. Outstanding acceptance: CI for the latest source/test head; authoritative/captured Messenger media-wire evidence; and authorized real-device tests covering direct/group media, receipts, reconnect, restart, and multi-device delivery.


## 2026-11-27 — EryXen attachment compatibility evidence

Reference repository reviewed: `akashxback/fca-eryxenx` on `main`.

- `src/api/messaging/uploadAttachment.js` (blob `22b58d210c8c5cd3a50366a20b741f0eb754811b`): existing Messenger attachment upload implementation and returned attachment references.
- `src/api/messaging/sendMessage.js` (blob `6725ecd2d6a8964031466ee9396cde97a4072ca5`): normal MQTT message send path accepts attachment references and sends the attachment-bearing message.
- `src/api/messaging/getMessage.js` (blob `d8dc59414adb44032f39150c952d8028f0f2b3f3`): message/attachment formatting from Messenger message data.
- `src/api/messaging/resolvePhotoUrl.js` (blob `afb58618e1b4920b33499917b1653214d34a4e37`): Mercury photo URL resolution.

Compatibility conclusion: EryXen's ordinary FCA attachment lifecycle remains unchanged for non-E2EE messages. OmegA's E2EE media path is now separate and uses Messenger `media_conn` + encrypted-media CDN upload + native media protobufs; it does not send E2EE ciphertext as a legacy FCA attachment. The reviewed EryXen files establish ordinary attachment compatibility only, not the native E2EE media contract.

## 2026-11-27 — CI run cancellation note

Workflow run [46045981492](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46045981492) for source commit `d4c226b52e0eeb29a7c462af9d460723d3b6f98e` ended with conclusion `cancelled`: dependency/security audit passed, but the build/test step was cancelled and TypeScript/lint/package checks were skipped. Later source/test commits `ff5f8014d9999b8a779ea03dc6cb5f1da3da47da` and `6bc34f5c3899ef4849d3e59f48ca8a35ac0c778a` therefore have no verified green CI result in this record. Do not treat the earlier green run for commit `58ebf84fae915d0375a330217b00393826586b58` as validation for these newer changes.


## 2026-11-27 — Native Messenger media protocol source implementation

- `messenger-media.ts` now implements 32-byte media keys, HKDF-SHA256 expansion, AES-256-CBC, 10-byte truncated HMAC-SHA256, and both plaintext/ciphertext SHA-256 checks.
- E2EE upload obtains `media_conn` over the authenticated Messenger Noise socket and posts encrypted bytes to the `/wa-msgr/mms/{type}/{fileEncSHA256}` endpoint. FCA `uploadAttachment` / `sendMessage` is no longer used for E2EE media; ordinary FCA attachment methods remain untouched.
- Native image/video/audio/document ConsumerApplication payloads include mediaKey, fileSHA256, fileEncSHA256, directPath, timestamp, MIME type, and optional media metadata; the complete application is Signal-encrypted for direct device fanout or group Sender Key delivery.
- Inbound native media payloads emit `direct_media` / `group_media` with decoded metadata. `downloadMessengerMedia` fetches the encrypted CDN blob and verifies digest, HMAC, plaintext length, and plaintext digest.
- Protocol reference: Meta Messenger E2EE whitepaper (2023-12-06), section 17; FME reference implementation `HerokeyVN/FB-Messenger-E2EE` (`src/e2ee/media/media-crypto.ts` and `src/e2ee/media/media-upload.ts`). FME is an unofficial implementation reference, not proof of live server acceptance.
- Native media crypto/upload/protobuf and service send/receive fixtures were added. Latest test commit: `3ad4c6a00923cd7c5628881791ddf92a678b102b`.
- No live media_conn/upload/download or real Messenger recipient acceptance test has been performed. Latest-head CI is still required; Step 4 remains **In progress**.


## 2026-11-27 — Native media protocol hardening and CI follow-up

- Added one-time `media_conn` refresh/retry after HTTP 401; upload requests now have a 30-second timeout and `media_conn` hosts are restricted to Facebook/FBCDN/FBSBX/WhatsApp domains.
- Media decryption validates 32-byte plaintext/ciphertext digests, bounded plaintext length, and uses constant-time HMAC comparison. Tests now include 256 KiB video payloads, empty files, all four media types, tampered ciphertext, independently tampered MAC, native upload URL shape, and 401 refresh retry.
- Service fixes after the first CI attempt: corrected HTTPS direct-path regex, numeric peer-ID regex, removed duplicate legacy `sendGroupMedia` implementation, and fixed base64url upload token encoding.
- Failed historical run [46046902565](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46046902565) was for earlier source/test merge commit `b4c73e55857768a4bccab9a66d37719ed8bb30a3`; its build failed on the then-present direct-path regex syntax and duplicate group-media method. Those exact issues were corrected in subsequent source commits. This run does not validate the current branch head.
- Latest native media source/test commits include `be70d80b849afa02d1a23a84cac381d4ac064e37`, `d40fd6fd01a1f75642aabefd74bb0d1482f30da3`, `fa84aa5d501623fb2c7eb890b377aba5e152af49`, `63a0c45c4207d0a6b231d5ef54d8b4f3fc1785ea`, `78bbce96aa5a9dda8b4661a33d3f4b508c632520`, and `a7ff4525fe6bb4e7a07ea29bfe585f004805f064`.
- No CI run/status is currently associated with the latest branch head in the available GitHub Actions results. Do not claim a green result for these later commits. Step 4 remains **In progress** until current-head build/test/typecheck/lint/package checks pass and authorized live Messenger media interoperability is accepted.


## 2026-11-27 — Latest branch-head checkpoint

- Current PR #8 head at this checkpoint: `26aa8f7397af0d89872fa6f9bb03c650e76a455e` on `feature/release-0.2.3-beta.3`.
- Latest source/test implementation is committed; documentation now describes the native Messenger media event shape (`event.media`) and native `downloadDirectMedia` / `downloadGroupMedia` helpers.
- `get_commit_combined_status` and `fetch_commit_workflow_runs` returned no status/workflow run for the latest branch head. The earlier green CI run `46044369909` validated the older source commit `58ebf84fae915d0375a330217b00393826586b58`; it is not a green result for the current native-media implementation. Intermediate run `46046902565` failed before the follow-up fixes were committed.
- Current Step 4 source implementation is substantially complete offline, but Step 4 is **not Verified complete**: latest-head CI and authorized live Messenger media acceptance are still missing. No Step 4 live-test waiver is recorded.
