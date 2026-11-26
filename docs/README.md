# OmegA-FCA documentation

Current source baseline: **0.2.3-beta.3** (Node.js >= 20).

## Guides

- [Architecture](ARCHITECTURE.md) — startup path and source ownership.
- [API and compatibility](API.md) — supported entry points and FCA-style surface.
- [Authentication and sessions](AUTHENTICATION.md) — accepted session inputs and safety behavior.
- [E2EE status](E2EE-STATUS.md) — implemented local components versus missing Messenger integration.
- [Reference comparison](REFERENCE-COMPATIBILITY.md) — comparison against the public `@eryxenx/fca` 1.3.5 package documentation and Bot-by-Nirzon integration.

## Important

This repository is an unofficial client for private Facebook interfaces. Passing local tests does not prove that Facebook accepts a login, MQTT session, message action, or E2EE operation. Never use credentials or sessions that you do not own or are not authorized to operate.

The documentation describes the checked source branch, not a promise of live-service compatibility. See [CHANGELOG](../CHANGELOG.md) for release history and [SECURITY](../SECURITY.md) for reporting issues.
