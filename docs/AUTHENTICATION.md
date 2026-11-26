# Authentication and session handling

## Supported session input

The public README and login parser describe session-based authentication using:

- `appState`: cookie-object array.
- `Cookie`: cookie header string, cookie array, or supported key/value object.

The parser and validation logic live in `src/utils/loginParser/`, `src/core/auth.ts`, and `src/core/session-validation.ts`. Consult those files for exact accepted shapes and validation errors before changing behavior.

## Login sequence

The login helper validates and normalizes the supplied session, obtains the required account/session context, creates the API facade, attaches legacy FCA methods, and prepares realtime listener compatibility. Login success means the initial authenticated setup completed; it does not guarantee that MQTT will remain connected or that every private API operation will succeed.

## Session safety

- Do not print, commit, or include AppState/cookie values in logs, issues, fixtures, or documentation.
- Keep account sessions isolated; do not reuse one account's Signal/session storage for another account.
- Treat Facebook checkpoint/challenge responses as a hard pause. The realtime listener wraps outgoing requests and pauses actions after a detected checkpoint.
- Do not bypass Facebook challenges or retry credentials indefinitely.
- Use session files with restrictive filesystem permissions and keep secrets out of source control.

## Session guard

The package contains session-guard support in `src/core/session-guard.ts`. The exact behavior and options must be taken from that implementation and its tests; do not assume a guard guarantees session renewal or prevents logout.

## Credential login

This branch's documented quick-start is session-based. Do not assume email/password plus 2FA login parity with another FCA package. Any future credential flow must be independently reviewed for credential handling, destination allowlisting, consent, and tests before it is documented or enabled.
