# OmegA-FCA Security Policy

OmegA-FCA is an unofficial Facebook Messenger client. It handles highly sensitive session material and interacts with private Facebook web/Messenger interfaces. Treat every cookie, AppState, password, 2FA seed, API key, and session backup as a secret.

## Security defaults

- AppState and Cookie login are the intended local session inputs.
- Automatic update installation is disabled by default.
- External email/password token-provider login is disabled unless an operator explicitly configures an HTTPS `apiServer` or supplies an HTTPS endpoint to the API method.
- The optional token-provider endpoint is a third party, not Facebook. Review and control that service before sending credentials to it.
- Never log cookie values, passwords, 2FA seeds, API keys, or raw authenticated request headers.
- Do not commit `account.txt`, `appstate.json`, `cookie.txt`, `fca-config.json`, database files containing sessions, or environment files.
- Facebook checkpoints and security challenges must be resolved by the account owner. OmegA-FCA does not promise checkpoint bypass.

## Report a vulnerability

Please report security issues privately to the repository maintainer rather than publishing exploit details in an issue. Include the affected version, a concise impact description, and safe reproduction steps. Redact all session data and credentials.

## Upstream attribution

OmegA-FCA 0.2.0 includes source derived from `Dongdev source` v4.0.2. The original Apache-2.0 license and copyright notices are retained; see [NOTICE](NOTICE).
