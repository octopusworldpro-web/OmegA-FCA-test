# OmegA-FCA

Unofficial Facebook Messenger client with an FCA-style compatibility API for the OmegA bot ecosystem.

<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.3--beta.3-7C3AED?style=for-the-badge" alt="Version 0.2.3-beta.3">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20-339933?style=for-the-badge&logo=nodedotjs" alt="Node.js 20+">
  <img src="https://img.shields.io/badge/license-Apache--2.0-EA580C?style=for-the-badge" alt="Apache 2.0">
  <img src="https://img.shields.io/badge/status-beta-CA8A04?style=for-the-badge" alt="Beta">
</p>

> **Unofficial/private-interface notice:** Facebook's web and Messenger interfaces can change without notice. Local tests do not prove live login, MQTT, message delivery, or E2EE compatibility. Use only accounts and sessions you own or are authorized to operate.

## Install

```bash
npm install @nirzon-islam/omega-fca
```

Requires Node.js 20 or newer.

## Quick start

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

    api.listenMqtt((listenError, event) => {
      if (listenError) {
        console.error("Listener error:", listenError.message);
        return;
      }
      if (event?.type === "message") {
        console.log("Message event:", event.threadID);
      }
    });
  }
);
```

Keep AppState/cookies private. Never commit session files or print their contents.

## Current implementation areas

- Session parsing and validation
- FCA-style callback/Promise compatibility
- Account, message, thread, and user operations
- MQTT listener, reconnect handling, middleware, and outgoing-action limiter
- Humanizer middleware with command detection, cooldown, rate cap, and optional typing indicator
- Local Signal key storage and E2EE helper modules

**Important feature boundary:** the humanizer source defaults to disabled and must be explicitly configured. The current E2EE runtime initializes local Signal primitives; Messenger device registration, peer/bundle exchange, MQTT encrypted envelopes, and full Messenger wire compatibility are not established as integrated in this release. Do not treat this beta as a production-ready encrypted Messenger client.

## Development

```bash
npm ci
npm test
npm run lint
npm run typecheck
npm run build
```

Tests are local contract/unit tests. They do not verify Facebook's live service behavior. Check the GitHub Actions run for the exact commit before treating a change as CI-verified.

## Documentation

See [docs/README.md](docs/README.md) for the documentation index:
- [Architecture](docs/ARCHITECTURE.md)
- [API and compatibility](docs/API.md)
- [Authentication and sessions](docs/AUTHENTICATION.md)
- [E2EE implementation status](docs/E2EE-STATUS.md)
- [Reference compatibility audit](docs/REFERENCE-COMPATIBILITY.md)

## Links

- [GitHub repository](https://github.com/octopusworldpro-web/OmegA-FCA-test)
- [npm package](https://www.npmjs.com/package/@nirzon-islam/omega-fca)
