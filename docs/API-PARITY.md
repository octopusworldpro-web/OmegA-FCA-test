# Public API compatibility audit

This document records the compatibility surface verified by source inspection and automated tests.

## Authentication contract

- CommonJS default export is a callable login function.
- `login(credentials, callback)` and `login(credentials, options, callback)` pass the flat API object as the callback's second argument.
- Promise login returns the authenticated context; `loginAsync()` is the explicit Promise entry point.
- `loginLegacy()` retains its context-callback form.
- Cookie header and AppState inputs are normalized before authentication and validated at the login boundary.

## Flat API and client facade

The flat API remains the compatibility surface used by existing integrations. The namespaced facade mirrors the same operations without replacing the flat methods.

| Area | Verified methods |
|---|---|
| Authentication/session | `getCurrentUserID`, `getAppState`, `getCookies`, `setOptions` |
| Realtime | `listenMqtt`, `stopListening`, `stopListeningAsync` |
| Messaging | `sendMessage`, `editMessage`, `deleteMessage`, `unsendMessage`, `setMessageReaction`, `sendTypingIndicator`, `markAsRead`, `markAsReadAll`, `markAsSeen`, `markAsDelivered` |
| Media | `sendImage`, `sendVideo`, `sendAudio`, `sendFile`, `sendLocation`, `uploadAttachment`, `forwardAttachment` |
| Threads | `getThreadInfo`, `getThreadList`, `getThreadHistory`, `getThreadPictures`, `createNewGroup`, `addUserToGroup`, `removeUserFromGroup`, `changeAdminStatus`, `changeGroupImage`, `changeThreadColor`, `changeThreadEmoji`, `changeNickname`, `setTitle`, `muteThread`, `changeArchivedStatus`, `deleteThread`, `createPoll`, `createThemeAI`, `getThemePictures`, `handleMessageRequest`, `searchForThread` |
| Users | `getUserID`, `getUserInfo`, `getUserInfoV2`, `getFriendsList` |
| Account/social | `getHumanizer`, `changeAvatar`, `changeBio`, `logout`, `setPostReaction`, `reactToPost`, `reactToComment`, `postComment`, `sharePost`, `unfriend`, `changeBlockedStatus` |
| HTTP | `httpGet`, `httpPost`, `postFormData` |

The client facade exposes both `messages.react` and `messages.setReaction` as aliases of the same reaction operation.

## Callback and Promise behavior

- Login callback overloads are tested separately from Promise login.
- Outgoing message operations preserve the callback argument passed by callers; the limiter schedules invocation and the original callback still receives the operation result/error.
- Promise-returning operations remain awaitable through the limiter.
- Realtime listener callbacks and emitter handles are not wrapped by the outgoing-action limiter.
- Read-only queries and incoming events are not rate-limited.

## Outgoing-action limiter contract

The limiter applies a small per-thread cooldown and a smaller global spacing interval to outgoing mutations. Calls are FIFO, callback arguments are passed through unchanged, and failures do not poison subsequent queue entries. Defaults are intentionally modest to avoid changing ordinary bot behavior.

## Explicit compatibility boundaries

A method is considered supported only when implemented and covered by source-level or automated checks. No placeholder method names are added for operations that have no implementation. Synthetic tests establish local API contracts only; they do not prove live service acceptance.