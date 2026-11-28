# OmegA-FCA documentation

Current package observed in the E2EE Inbox test deployment: **0.2.4-beta.1** (Node.js 20).

## Current operational documents

- [E2EE DM Inbox — current investigation](E2EE-DM-INBOX-CURRENT-STATUS.md) — latest Railway evidence, CAT blocker, next verification sequence, and security actions.
- [E2EE current status](E2EE-STATUS.md) — concise current runtime disposition and acceptance boundary.
- [E2EE implementation roadmap](E2EE-ROADMAP.md) — historical implementation scope, source evidence, and offline validation record.

## General guides

- [Architecture](ARCHITECTURE.md) — startup path and source ownership.
- [API and compatibility](API.md) — supported entry points and FCA-style surface.
- [Authentication and sessions](AUTHENTICATION.md) — accepted session inputs and safety behavior.
- [Reference comparison](REFERENCE-COMPATIBILITY.md) — comparison against the EryXen FCA reference and bot integration.
- [Humanizer configuration](HUMANIZER-CONFIG.md) — delay/cooldown configuration.

## Important

This repository is an unofficial client for private Facebook interfaces. Passing local tests does not prove that Facebook accepts a login, MQTT session, message action, or E2EE operation. Never use credentials or sessions that you do not own or are not authorized to operate.

The current DM Inbox report is the source of truth for the live CAT failure. The roadmap is historical implementation evidence and must not override newer runtime findings. See [CHANGELOG](../CHANGELOG.md) for release history and [SECURITY](../SECURITY.md) for reporting issues.
