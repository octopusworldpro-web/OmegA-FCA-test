# FCA API and GoatBot Method Parity

Audit target: `nirzon-islam/OmegA-Goatbot` `main` (current source tree) and the public `@eryxenx/fca` 1.3.5 API reference.

## GoatBot runtime call sites

The following FCA methods are called directly by the current GoatBot login, listener, handler, and session code:

| Method | OmegA-FCA surface | Status |
| --- | --- | --- |
| `listenMqtt` | Legacy API + `client.realtime.listen` | Present |
| `getHumanizer` | Legacy API + namespaced account/realtime facade | Added to legacy API |
| `markAsDelivered` | Legacy API + `client.messages.markDelivered` | Present |
| `markAsRead` | Legacy API + `client.messages.markRead` | Present |
| `unsendMessage` | Legacy API + `client.messages.unsend` | Present |
| `getCurrentUserID` | Legacy API + `client.account.getCurrentUserID` | Present |
| `getThreadList` | Legacy API + `client.threads.getList` | Present |
| `setOptions` | Legacy API + `client.account.setOptions` | Present |

The GoatBot `_connectE2EEAndMerge` hook is an E2EE integration point and belongs to the later E2EE checklist steps, not classic FCA method parity.

## Additional documented convenience methods

Added legacy and namespaced wrappers for:

- `sendImage`, `sendVideo`, `sendAudio`, and `sendFile` — accept a local path, Buffer, or readable stream and delegate to the existing upload/send pipeline.
- `sendLocation` — validates latitude/longitude and delegates to the existing location payload path.

The fallback `createFcaClient(api)` facade now exposes these helpers as well. Automated tests cover wrapper input validation, send delegation, and the GoatBot-used facade methods.

## Scope notes

This step verifies the API surface used by the current OmegA-Goatbot main branch and adds the commonly documented media/location shortcuts. It does **not** claim a clone of every optional method advertised by upstream FCA (for example, message pinning, follow/unfollow, friend-request initiation, Imgbb upload, or every profile lookup alias). Those require independent protocol implementations and tests; they must not be represented as supported by placeholder aliases.

No upstream FCA dependency was added to OmegA-FCA. Login remains on OmegA-FCA's own Facebook session path.
