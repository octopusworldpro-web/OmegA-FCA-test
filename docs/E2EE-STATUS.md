# OmegA-FCA E2EE — Current Implementation Status

**Canonical plan:** [E2EE-ROADMAP.md](E2EE-ROADMAP.md)  
**Version:** `0.2.3-beta.3`  
**Branch:** `feature/release-0.2.3-beta.3`

This file records source-level implementation evidence and its limits. The four-step roadmap is the sole authority for scope and completion criteria.

## Overall

**Step 1 is verified complete for local Signal runtime and FCA login lifecycle integration. Steps 2–4 remain in progress. Live Facebook/Messenger interoperability is not established.**

| Step | Status | Implemented evidence | Main remaining work |
|---|---|---|---|
| 1. E2EE Engine & Login Integration | Verified complete (local boundary) | Pinned libsignal 0.70.0; authenticated UID validation; account-local bootstrap and encrypted store; automatic identity/device metadata; restart support; fail-open login integration | No remaining work within the stated local-engine/login boundary. Do not interpret this as server registration or native Messenger support |
| 2. Facebook Device Registration & Key Sync | In progress — transport/acceptance blocked | Conditional ICDC registration; encrypted persistent EC-prekey publication acknowledgements; duplicate-upload suppression; signed-prekey-only upload; matching IQ-result validation; focused source tests | No default authenticated Messenger Noise XX transport with certificate-chain validation; no live ICDC/IQ acceptance; CAT auto-retrieval/login wiring and verified server-aware replenishment/rotation remain open; no verified Kyber upload format |
| 3. E2EE Messaging & Group System | In progress | Signal direct-message primitives; injected peer/bundle interfaces; Sender Key/SKDM persistence/retry; application-level group envelope orchestration | Native peer discovery/bundle exchange and direct/group Messenger MQTT wire integration; real compatible-device tests |
| 4. Encrypted Media & Full Compatibility Test | In progress | Direct/group media crypto helpers and application-level group-media orchestration | Native Messenger media upload/download, real media interoperability, EryXen comparison, authorized real-account acceptance |

## Implemented components and boundaries

- `src/domains/e2ee/bootstrap.ts`: creates account-scoped local identity metadata and automatically generates/reuses a local encryption key and device ID. No E2EE environment variable or manual key setup is required for the default local bootstrap.
- `src/domains/e2ee/signal-key-store.ts`: encrypted persistence for Signal identity/session/prekey/group state and device metadata.
- `src/domains/e2ee/libsignal-adapter.ts`: adapter boundary for the selected libsignal implementation.
- `src/domains/e2ee/runtime.ts`: initializes local Signal identity, signed prekey, one-time EC prekeys, and Kyber prekeys when the installed libsignal module supports KEM generation. Runtime comments explicitly limit this to local identity/prekey initialization.
- `src/domains/e2ee/login-integration.ts`: opt-in login lifecycle. It initializes the local runtime; if `facebook.appId` and `facebook.fbCat` are configured, it calls the ICDC helper using the authenticated session cookie header and user agent. If `facebook.sendIQ` is also supplied, it invokes the prekey publisher. Errors close the partial runtime and return a failed E2EE result.
- `src/core/login-helper.impl.ts`: invokes `initializeE2EEForLogin` after authenticated UID validation and ordinary FCA/MQTT setup. It passes the active cookie header and configured user agent. It passes an empty factory-dependency object; it does not create a Messenger Noise IQ adapter. E2EE failures are logged and normal FCA login still succeeds.
- `src/core/state.ts`: exposes the opt-in `e2ee` option and optional `facebook.sendIQ` callback. The callback contract explicitly requires an already-authenticated Messenger Noise IQ transport; ordinary MQTT JSON is incompatible.
- `src/domains/e2ee/device-registration.ts`: ICDC request construction, response validation, and persisted device metadata. Its tests use a mocked fetcher; they do not demonstrate Facebook server acceptance.
- `src/domains/e2ee/prekey-publisher.ts`: builds the WA-binary `encrypt` IQ for identity, signed prekey, and one-time Curve25519 prekeys. It requires an injected `sendIQ` function and checks the matching IQ result acknowledgement. Tests use a simulated adapter response, not a live Noise socket.
- `src/domains/e2ee/direct-messages.ts` and `src/domains/e2ee/peer-manager.ts`: Signal direct-message primitives and transport-neutral peer/bundle interfaces. No native Facebook peer discovery or MQTT envelope integration is established.
- `src/domains/e2ee/group-key-manager.ts` and `src/domains/e2ee/sender-keys.ts`: group Sender Key/SKDM handling and delivery state.
- `src/domains/e2ee/group-messaging.ts`: application-level encrypted group-message envelope orchestration over an injected authenticated transport.
- `src/domains/e2ee/encrypted-media.ts`, `src/domains/e2ee/encrypted-group-media.ts`, and `src/domains/e2ee/group-media-messaging.ts`: local media crypto and application-level group-media orchestration; not native Facebook media transport.

Local cryptographic foundations include X3DH/PQXDH orchestration, XEdDSA verification, and an experimental Double Ratchet. Their presence is not, by itself, proof of official Signal conformance or Messenger interoperability.

## Kyber / post-quantum boundary

The current source generates and stores local Kyber material only when the libsignal KEM API is available. The documented Messenger device-registration format describes a Curve25519 identity key, signed Curve25519 Signed Pre Key, and Curve25519 One-Time Pre Keys; it does not specify a Kyber upload field or stanza. OmegA must not upload a guessed Kyber payload or label Kyber publication complete. Keep the local PQ material isolated unless a current authoritative Messenger protocol or an authorized server response establishes the supported format.

Reference: [Meta Messenger E2EE Overview — Device Registration](https://engineering.fb.com/wp-content/uploads/2023/12/Messenger-End-to-EndEncryptionOverview_12-6-2023.pdf#page=7).

## ICDC and prekey configuration

Enable the local runtime and optionally configure ICDC registration through login options:

```js
{
  e2ee: {
    enabled: true,
    facebook: {
      appId: "<verified Messenger app ID>",
      fbCat: "<verified Facebook category>"
    }
  }
}
```

When the Facebook parameters are present, the authenticated FCA login supplies its active cookie header and user agent internally. Do not copy session cookies into configuration. If the Facebook parameters are omitted, OmegA initializes only the local Signal runtime and does not attempt ICDC registration.

Prekey publication is a separate conditional operation. Supply `facebook.sendIQ` only if the caller has a real, already-authenticated Messenger Noise IQ transport. The ordinary FCA MQTT JSON client is not a valid implementation of that callback. A successful mocked IQ test proves only the publisher's local contract, not server publication.

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

The previously recorded CI run [45860381188](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/45860381188) covered baseline commit `55d02c7044938e68db9de87aee319831f68c8950` and reported success. This historical result is not validation of the current branch head, and it does not establish live Facebook/Messenger interoperability.

See [E2EE-ROADMAP.md](E2EE-ROADMAP.md) for the only approved four-Step checklist and progress rules.


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
