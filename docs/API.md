# API and compatibility

**Package:** `@nirzon-islam/omega-fca`  
**Version:** `0.2.3-beta.3`  
**Runtime:** Node.js >= 20

## Package entry points

The package metadata declares:

- CommonJS: `dist/cjs.cjs`
- ESM: `dist/index.mjs`
- Type declarations: `dist/index.d.ts`

The root `index.ts` is the source entry point. The declaration file and runtime exports should be checked together when changing public APIs.

## Main API areas in source

- Login and session validation
- FCA-style callback compatibility and Promise helpers
- Account operations
- Message send/edit/delete/unsend, reactions, typing and receipt operations
- Thread/group operations and queries
- User queries
- MQTT listener, middleware, reconnect policy and outgoing-action limiter
- MessengerBot and namespaced client wrappers

The existence of an implementation or exported method does not guarantee that Facebook's private endpoint currently accepts it.

## Compatibility rules

- Preserve callback signatures where the legacy FCA surface requires them.
- Keep Promise helpers additive; do not silently change callback behavior.
- Keep public TypeScript declarations aligned with runtime exports.
- Treat errors from checkpoint/session guards as explicit stop conditions; do not retry them as ordinary transient network errors.
- Keep transport behavior and bot-specific command policy outside the generic FCA API unless the public API explicitly documents the option.

## Validation

Use the root package scripts:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

These checks validate the local codebase only. They do not replace authorized live integration tests.
