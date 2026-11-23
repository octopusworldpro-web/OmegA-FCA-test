# Step 9 — EryXenX / OmegA-FCA / GoatBot Protocol & Security Audit

Audit date: 2026-11-23
Target branch: `main`
Repositories inspected:
- OmegA-FCA: `octopusworldpro-web/OmegA-FCA-test`
- GoatBot: `nirzon-islam/OmegA-Goatbot`
- EryXenX npm package: `@eryxenx/fca` (npm metadata currently reports 1.3.5)

## Executive result

**Audit completed; integration and supply-chain blockers remain.** This report records verified repository/package metadata and boundaries. It does not claim live Facebook E2EE interoperability.

## 1. Protocol / API comparison

| Area | EryXenX npm package | OmegA-FCA main | GoatBot main |
| --- | --- | --- | --- |
| Regular Messenger API | Advertises 90+ methods and legacy FCA compatibility | Implements modular FCA domains and legacy API facade | Imports `@eryxenx/fca` in `bot/login/login.js` |
| MQTT | Advertises NEXCA MQTT, reconnect and E2EE listener | Has its own MQTT transport, sync/reconnect and listener stack | Starts regular `api.listenMqtt` listener |
| Direct E2EE | Advertises Signal E2EE and automatic connect after login | Exposes explicit libsignal key stores, PreKey session setup and encrypt/decrypt primitives | No OmegA-FCA package import or OmegA-specific E2EE adapter found in inspected login entry |
| Group E2EE | npm README documents group text/media limitations depending on native engine toggle | Exposes Sender Keys, SKDM orchestration and encrypted group media helpers | No verified OmegA group-E2EE transport integration |
| Encrypted actions | npm README documents E2EE typing/reaction/mark-read behavior with native engine caveats | Exposes encrypted application-level receipt/typing/presence action payloads | No verified OmegA encrypted action event routing |
| Session handling | Advertises sessionGuard, backup and E2EE device persistence | Has session validation, guard and encrypted session-backup helpers | Has separate account-bound appstate validation and atomic recovery |

**Important compatibility finding:** GoatBot's runtime import is still `require("@eryxenx/fca")`. OmegA-FCA's package name is `@nirzon-islam/omega-fca`. The new OmegA E2EE helpers are not automatically used by GoatBot merely because they exist in the OmegA-FCA repository. A deliberate adapter/migration and parity tests are still required.

## 2. Dependency / provenance findings

- GoatBot `package.json` declares `@eryxenx/fca: ^1.3.4`.
- GoatBot's committed `package-lock.json` is stale: its root metadata still identifies the older `goat-bot-v2@2.0.0`, its root dependency range is `^1.0.5`, and the resolved package entry is `@eryxenx/fca@1.0.5`. This means a clean `npm ci` may not represent the current manifest and the checked-in dependency graph is not aligned with `package.json`.
- npm currently advertises `@eryxenx/fca@1.3.5`; the package page points to `EryXenX/fca-eryxenx`. The canonical repository endpoint could not be read during this audit (GitHub API returned 404); a separate similarly named fork is not accepted as proof of the exact npm tarball source.
- A public GitHub Advisory Database entry GHSA-qhrc-mfjw-xwq3 was published on 2026-11-20 for `@eryxenx/fca`. The advisory search results identify versions 1.3.0, 1.3.1 and 1.3.2. The reported issue is credential/session material being sent to a third-party login relay. Do not infer that every version is affected or that 1.3.5 is safe solely from the version number; verify the exact npm tarball and source diff before trusting it.
- A separate security-scanner report also flags older historical releases. Scanner verdicts are leads, not a substitute for checking the official GHSA, exact tarball integrity, and source code.

### Required supply-chain remediation before production use

1. Inspect the exact resolved `@eryxenx/fca` version and its tarball integrity in a clean environment.
2. Compare the npm tarball against a trusted, reviewed source commit and inspect every login/token-provider/network destination.
3. Regenerate GoatBot's package lock from its current `package.json`; commit the matching lockfile and use `npm ci`.
4. Pin an exact reviewed version (not an open semver range) until provenance is established.
5. If any flagged version ran in a machine/CI environment, treat its reachable Facebook credentials, AppState, 2FA seed, npm tokens and deployment secrets as potentially exposed. Rotate them from a clean device and inspect outbound network logs. Do not paste secrets into issue logs.

## 3. OmegA-FCA security review boundaries

- Session identity validation and encrypted session-backup utilities exist in OmegA-FCA.
- Signal direct-message and Sender Key APIs are explicit primitives; they require a real compatible libsignal implementation, correct device/prekey provisioning and authenticated transport wiring.
- Group-key manager distribution callbacks are transport-injected. A successful unit test of the callback orchestration does not prove Facebook's private SKDM envelope or group membership protocol.
- Encrypted group media helpers authenticate ciphertext with digest/MAC and bind optional expected group/sender context. The transport callbacks do not implement Messenger's private CDN protocol.
- Encrypted receipts/typing/presence are application-level Signal payloads. They are not proof of Messenger-native read/typing/presence interoperability.
- No account secrets were read, printed or changed during this audit.

## 4. Findings / status

| ID | Finding | Severity | Status |
| --- | --- | --- | --- |
| FCA-09-01 | GoatBot still imports EryXenX FCA, not OmegA-FCA | High integration blocker | Open; requires explicit migration/adapter |
| FCA-09-02 | GoatBot package.json and package-lock dependency metadata disagree | High supply-chain/reproducibility blocker | Open; regenerate lock after package choice |
| FCA-09-03 | Public advisory reports malicious credential-relay code in exact EryXenX FCA versions 1.3.0–1.3.2 | Critical for those versions | Avoid those exact releases; verify actual installed tarball |
| FCA-09-04 | Canonical npm-linked EryXenX source repository was not readable through the linked GitHub account/API in this audit | Medium provenance gap | Open; obtain verifiable upstream source/tag |
| FCA-09-05 | OmegA Signal helpers are not yet proven against Facebook's live E2EE transport | High protocol-validation gap | Open; live authorized interoperability test required |

## Step 9 acceptance

- [x] Inspected OmegA-FCA public API and Signal implementation surface.
- [x] Inspected GoatBot login import, account-bound session validation and package dependency metadata.
- [x] Compared npm package feature claims and protocol boundaries.
- [x] Recorded advisory/provenance and stale-lockfile findings.
- [ ] GoatBot package lock regenerated and exact FCA dependency pinned.
- [ ] GoatBot migrated to OmegA-FCA with legacy API parity tests.
- [ ] Native Facebook E2EE DM/group/media/action interoperability verified.

**Step 9 is an audit report completion, not a production integration sign-off. The three unchecked acceptance items must remain open and must not be marked complete.**
