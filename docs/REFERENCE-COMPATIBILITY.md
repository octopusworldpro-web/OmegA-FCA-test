# Reference compatibility audit

**OmegA-FCA baseline:** `0.2.3-beta.3`  
**External reference reviewed:** public npm documentation for `@eryxenx/fca@1.3.5`, plus the checked `Bot-by-Nirzon` source files.

References:
- npm package: https://www.npmjs.com/package/@eryxenx/fca
- Bot reference: https://github.com/nirzon-islam/Bot-by-Nirzon
- OmegA-FCA: https://github.com/octopusworldpro-web/OmegA-FCA-test/tree/feature/release-0.2.3-beta.3

## Reference behavior documented by npm

The public 1.3.5 package page documents classic FCA callback login, `sessionGuard`, `listenMqtt`, automatic E2EE connection after login, `listenE2EE`, encrypted-thread routing through existing send/reaction/unsend calls, `sendBroadcast`, `createMessengerBot`, and `createFcaClient`.

These are claims made by the external package's published documentation. They must not be copied as OmegA-FCA capabilities unless the corresponding OmegA source and tests prove them.

## Bot reference findings

The checked Bot-by-Nirzon `humanizerOptions.js` maps bot config to an FCA `humanize` login option and applies updated options through `api.getHumanizer().setOptions()`. It notes that the humanizer instance exists only after the MQTT listener starts, so settings may need to be applied again after listener restart.

The checked `loadData.js` invokes `api._connectE2EEAndMerge()` only when that method exists and `config.e2ee.enable` is not false. This is a bot-side integration guard, not evidence that OmegA-FCA provides the same private method or E2EE transport.

The reference login source imports `@eryxenx/fca`; it is not a specification for OmegA-FCA's internal architecture.

## OmegA-FCA differences verified in source

| Area | OmegA-FCA 0.2.3-beta.3 source |
|---|---|
| Humanizer | Middleware controller exists; source default is disabled. Command detection supports metadata, configured prefixes/names, and configured no-prefix admin IDs. |
| Typing | Humanizer requests typing while waiting; typing delivery depends on the supplied sender and realtime transport. |
| E2EE runtime | Initializes local Signal primitives using an explicitly supplied Signal module. |
| Device registration | ICDC helper exists separately; helper presence does not prove login lifecycle integration. |
| Messenger E2EE transport | Runtime comments explicitly separate MQTT envelope and Messenger wire integration; full integration is not established. |
| Tests | Local tests validate helpers/contracts; mocked tests do not prove live Facebook acceptance or encrypted delivery. |

## Compatibility decision

Do not describe OmegA-FCA as a drop-in implementation of every feature listed by the external 1.3.5 README. Preserve the stable FCA-style methods already present, and document feature-by-feature compatibility only after checking source, declarations, tests, and authorized integration behavior.

## Audit scope note

This comparison is limited to the public npm README/documentation and the named Bot-by-Nirzon files checked during this documentation pass. It is not a claim that every file in the external npm tarball or every file in the bot repository has been exhaustively reverse-engineered.
