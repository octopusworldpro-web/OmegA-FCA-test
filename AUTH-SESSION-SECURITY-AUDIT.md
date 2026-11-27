# Authentication and Session Security Audit

Audit date: 2026-11-22

## Scope

Static review of `src/core/auth.ts`, `src/core/auth-helpers.ts`, `src/core/login-helper.impl.ts`, `src/core/config.ts`, and `src/session/`. This is not a live Facebook authentication test.

## Confirmed input paths

- AppState cookie objects.
- Cookie header/string/object inputs.
- Email/password/2FA values can reach an external credential-provider flow only when an HTTPS provider URL is explicitly configured or passed.
- Config defaults disable `autoLogin`, update checks, automatic install, and the external provider URL.

## Findings and changes

### A-01 — Account-ambiguous database session recovery

**Finding:** When the current session did not yield a valid UID, recovery called `hydrateJarFromDB(null)`. The null UID path selected the newest cookie/appstate backup regardless of account. This could silently restore a different account's session.

**Change:** Removed the global/latest-account fallback from the automatic login recovery path. An unidentified session must not be replaced by whichever account most recently wrote a backup.

**Status:** Fixed in commit `cbbe4d81cb74b66a132f0c9edf43a79be175a028`.

### A-02 — Session cookies installed for plaintext HTTP origins

**Finding:** Cookie import helpers installed Facebook session cookies against both HTTP and HTTPS origins. One helper did not force the Secure attribute.

**Change:** `setJarFromPairs` now uses HTTPS Facebook origins only and marks imported session cookies Secure. AppState cookie hydration now uses HTTPS origins only and marks imported cookies Secure.

**Status:** Fixed in commits `2919a79bb7196fbdc00b764ec11d01993210164a` and `8e5f5fbbd7eeab21ada8a17207af97bad3618e4d`.

### A-03 — External credential provider trust boundary

**Finding:** The optional provider receives the submitted email, password, and optional 2FA seed. HTTPS protects transport but does not make the provider trustworthy. Its response can contain Facebook cookies/access tokens.

**Existing safeguards:** Provider URL is not configured by default; URL must be HTTPS and cannot include embedded URL credentials; automatic login defaults off; legacy known provider hosts are cleared during config normalization.

**Remaining action:** Add explicit tests that reject HTTP, malformed URLs, and embedded URL credentials; document that enabling this feature transfers credentials to the operator-selected third party. Prefer AppState/Cookie login.

### A-04 — Arbitrary cookie domains in imported sessions

**Finding:** AppState entries could specify a cookie domain outside Facebook. The cookie jar helper also accepted a caller-supplied domain without enforcing the Facebook domain boundary.

**Change:** AppState cookie import now skips non-Facebook domains. The shared cookie-jar helper rejects non-Facebook target domains.

**Status:** Fixed in commits `f5208edffa466a2cc2ab21193f54053dbe2ee288` and `54a7c15417998d4553c2f03a406ee6876333bec1`.

### A-05 — Credential provider HTTP redirects

**Finding:** An HTTP client following redirects could potentially forward a credential POST to a different host if the configured provider returned a redirect.

**Change:** External credential-provider requests now set `maxRedirects: 0`; redirects are returned as responses and are not followed.

**Status:** Fixed in commit `e87f5a3758effc88ade58bb7173109eb933966f4`.

### A-06 — Security regression tests

**Change:** Added synthetic tests for HTTPS-only cookie installation, Secure attributes, Facebook-domain validation, malformed/credential-bearing provider URLs, and disabled redirect following.

**Status:** Added in commit `7645df57061fa8f6e2e37f6faa0bfccf18c62546`; CI verification pending.

## Remaining security work

1. Database session backups are stored as serialized appstate/cookie values. Encryption at rest, access control, retention, and backup deletion need a dedicated design before production use.
2. Validate imported cookie names, values, domains, expiry, and duplicate handling; avoid accepting arbitrary domains for Facebook authentication cookies.
3. Add deterministic unit tests for cookie parsing, secure cookie flags, UID binding, expired sessions, checkpoint errors, and provider URL validation.
4. Ensure logs never print cookie values, passwords, access tokens, or 2FA seeds.
5. Do not silently retry a checkpoint or bypass account security challenges.
6. Live session validation still requires an owner-authorized account; CI synthetic tests cannot prove Facebook acceptance.

## Safe operating guidance

- Prefer AppState or Cookie from an account you own/control.
- Keep `account.txt`, appstate JSON, cookie headers, passwords, 2FA seeds, database backups, and provider API keys out of Git.
- Keep the repository private if it contains operational code/configuration, but privacy does not replace secret exclusion.
- Do not enable external credential login unless the provider's operator, implementation, retention policy, and security have been independently reviewed.


## A-07 — Session backup encryption and account scoping

- New SQL AppState/cookie backups are encrypted with AES-256-GCM before being written to the database.
- The encryption key must be supplied as `OMEGA_FCA_SESSION_BACKUP_KEY` (32-byte base64 or 64-character hex). No key is embedded in source or generated from an account password.
- Authenticated additional data binds ciphertext to the numeric Facebook UID and backup type. Copying a row to another UID or changing its type makes decryption fail.
- Missing/invalid keys cause backup writes to be skipped; encrypted backups cannot be restored without the same key.
- Legacy plaintext backups are rejected by default. An explicit temporary opt-in, `OMEGA_FCA_ALLOW_LEGACY_PLAINTEXT_BACKUPS=true`, permits reading them; migrate by signing in again with the encryption key configured, then remove the opt-in.
- Global “latest backup” restore is disabled. A backup is only eligible for lookup when a valid numeric UID is already known. The login path that has no known UID does not restore an arbitrary account's backup.
- This protects new backups at the application layer; it does not encrypt the entire SQLite database, WAL files, filesystem snapshots, or backups made outside OmegA-FCA. Protect the database volume and key separately.
- Automated tests cover ciphertext opacity, successful decryption, wrong UID/type, wrong key, and legacy plaintext rejection. These tests do not replace a live database migration or deployment test.
