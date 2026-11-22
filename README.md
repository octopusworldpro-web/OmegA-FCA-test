# OmegA-FCA

**OmegA-FCA** is an unofficial Node.js Facebook Messenger client and FCA-style compatibility layer maintained by **NirZon** for the OmegA Bot ecosystem.

- Package: `@nirzon-islam/omega-fca`
- Version: `0.2.0`
- Runtime: Node.js 20+
- License: Apache-2.0

> **Important:** This is an unofficial client that uses private Facebook web and Messenger interfaces. Those interfaces can change without notice. Synthetic tests do not prove that Facebook will accept a login, MQTT connection, or message operation. Use only accounts and sessions you own or are authorized to operate.

## Source and attribution

The initial implementation is based on the uploaded `@dongdev/fca-unofficial` v4.0.2 source archive. The original Apache-2.0 license and upstream copyright notices are retained. OmegA-FCA's package metadata, configuration, documentation, security defaults, compatibility work, and future changes are maintained separately by NirZon.

## Installation

```bash
npm install @nirzon-islam/omega-fca
```

The GitHub test repository is [octopusworldpro-web/OmegA-FCA-test](https://github.com/octopusworldpro-web/OmegA-FCA-test). The npm package is not considered production-ready until the build, automated tests, and authorized live-account acceptance tests pass.

## Quick start — classic FCA callback

```js
const login = require("@nirzon-islam/omega-fca");

login(
  { appState: require("./appstate.json") },
  { listenEvents: true, autoReconnect: true },
  (error, api) => {
    if (error) {
      console.error("Login failed:", error.message);
      return;
    }

    console.log("Authenticated UID:", api.getCurrentUserID());

    api.listenMqtt((listenError, event) => {
      if (listenError) {
        console.error("Listener error:", listenError.message);
        return;
      }

      if (event?.type === "message" && event.body) {
        console.log("Incoming message event received");
      }
    });
  }
);
```

The Promise API is also available:

```js
const { loginAsync } = require("@nirzon-islam/omega-fca");

const ctx = await loginAsync({ appState: require("./appstate.json") });
const api = ctx.api;
```

## Authentication and credentials

Supported input formats include:

- `appState`: array of Facebook cookie objects.
- `Cookie`: cookie header string, array, or key/value object.

The source also contains an optional email/password token-provider integration. **OmegA-FCA disables this path by default.** It will not send email/password/2FA values to a remote service unless an operator explicitly configures an HTTPS `apiServer` or passes an HTTPS API URL to the relevant API method. The remote provider is not part of Facebook itself and must be independently trusted.

Example configuration is in [fca-config.example.json](fca-config.example.json). Automatic package installation/update checks and external credential login are disabled by default. Facebook checkpoints and security challenges must be resolved by the account owner; this library does not promise or provide checkpoint bypass.

Never commit `appstate.json`, `account.txt`, cookie exports, passwords, 2FA seeds, API keys, or populated `fca-config.json` files.

## Included API areas

The source archive includes the following FCA-style API areas:

- Login helpers, cookie normalization, session validation and account/session utilities.
- Authenticated HTTP requests and GraphQL/form-data helpers.
- MQTT/WebSocket realtime listener, subscription and reconnect handling.
- Message send, edit, delete/unsend, reaction, typing, mark-read/seen/delivered and attachment helpers.
- Thread information/history/list, group management, polls, themes and thread settings.
- User lookup, user information and friends-list helpers.
- Account, scheduler, optional SQLite/Sequelize cache and a namespaced client facade.
- Classic callback-style FCA API and the higher-level `MessengerBot` wrapper.

The presence of an API method in source does not establish that its private Facebook endpoint is currently accepted. Each operation still needs compatible fixtures or authorized live testing.

## API compatibility audit

See [EryXen API Compatibility Audit](docs/ERYXEN-API-COMPATIBILITY.md) for the reference API comparison, security exclusions, and remaining compatibility gaps.

## GoatBot compatibility

The intended bot target is [nirzon-islam/OmegA-Goatbot](https://github.com/nirzon-islam/OmegA-Goatbot).

The classic callback login shape and common FCA methods are present in this source. The current GoatBot repository also uses project-specific extensions such as `sessionGuard` and an `e2ee` API. Those extensions are **not implemented in the uploaded OmegA-FCA source archive**. The bot currently also has its own humanizer wrapper. Do not replace the bot's existing FCA dependency until the compatibility matrix and bot-side regression tests confirm every required method and lifecycle behavior.

See [GoatBot compatibility notes](docs/GOATBOT-COMPATIBILITY.md) for the integration gaps and acceptance checklist.

## Encryption status

The uploaded source archive does not contain a Messenger E2EE implementation, Signal Protocol session store, Group Sender Keys, or SKDM implementation. OmegA-FCA does not claim to support encrypted one-to-one or group messaging in this release. These features must be implemented and tested separately before being advertised.

## Source and dependency audit

See [Source & Dependency Audit](docs/SOURCE-DEPENDENCY-AUDIT.md) for the current static audit, addressed findings, and remaining release gates.

## Development

```bash
npm install
npm run build
npm run typecheck
npm test
npm run lint
npm pack --dry-run
```

The test suite contains synthetic checks and an optional live-login test that is skipped unless the operator provides a private, authorized session. Never add real credentials to the repository or CI logs.

## Project status

OmegA-FCA 0.2.0 is an integration and validation release, not a claim of complete production parity with every FCA fork. The next gate is a clean dependency install, successful build/typecheck/test run, then GoatBot compatibility tests and owner-authorized Facebook live testing.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
