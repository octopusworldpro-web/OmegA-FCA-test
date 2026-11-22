export {
  login,
  loginAsync,
  loginLegacy,
  loginViaAPI,
  tokensViaAPI,
  normalizeCookieHeaderString,
  normalizeLoginCredentials,
  setJarFromPairs,
  type LoginApiCallback
} from "./core/auth";

export { login as default } from "./core/auth";
export { createDefaultContext, createFcaState, createApiFacade } from "./core/state";
export { createRequestHelper } from "./core/request";
export { listenMqtt } from "./core/mqtt";
export { createSessionGuard } from "./core/session-guard";
export { createAuthCore } from "./core/auth-helpers";
export { defaultConfig, loadConfig, resolveConfig, writeConfigTemplate } from "./core/config";
export { attachThreadInfoRealtimeSync } from "./core/thread-info-realtime-sync";
export { encryptSessionBackup, decryptSessionBackup, isEncryptedSessionBackup } from "./session/backup-crypto";
export { checkForPackageUpdate, runConfiguredUpdateCheck } from "./core/update-check";
export { createFcaClient } from "./app/create-client";
export {
  MessengerBot,
  createMessengerBot,
  type MessengerBotOptions,
  type MessengerMiddleware,
  type MessengerNext
} from "./app/messenger-bot";
export { MessengerContext, type MessengerBotLike } from "./app/messenger-context";
export { attachClientFacade } from "./compat/api-registry";
export { createMessagesDomain } from "./domains/messages";
export { createThreadsDomain } from "./domains/threads";
export { createRealtimeDomain } from "./domains/realtime";
export { createUsersDomain } from "./domains/users";
export { createAccountDomain } from "./domains/account";
export { createHttpDomain } from "./domains/http";
export { createSchedulerDomain } from "./domains/scheduler";
export { createRealtimeListener } from "./domains/realtime/listener";

export * from "./types";
export { getMqttReconnectDelay, parseMqttJsonPayload, type MqttReconnectDelayOptions } from "./domains/realtime/reconnect-policy";
export { saveCookies, getAppState } from "./utils/cookies";
export { requestWithRetry } from "./utils/request/retry";
export { buildMqttWebSocketUrl, getMqttWebSocketHost, type MqttWebSocketUrlOptions } from "./transport/realtime/mqtt-url";

export { validateMqttSubscriptionAck, normalizeMqttSyncState, buildInitialMqttSyncQueue } from "./transport/realtime/sync-protocol";

export { consumeMqttTaskResponse } from "./transport/realtime/task-registry";

export { publishLsRequestWithAck, type PublishLsRequestOptions } from "./transport/realtime/ls-requests";

export { createSendMessageCommand, type SendMessageCommandDeps } from "./domains/messages/commands/send-message";
export { createEditMessageCommand, type EditMessageCommandDeps } from "./domains/messages/commands/edit-message";
export { createUnsendMessageCommand, type UnsendMessageCommandDeps } from "./domains/messages/commands/unsend-message";

export { createUploadAttachmentCommand, type UploadAttachmentCommandDeps } from "./domains/messages/commands/upload-attachment";
export { createAttachmentUploadTransport, type UploadAttachmentTransportDeps, type UploadAttachmentTransportResult } from "./transport/http/upload-attachment";

export {
  createCreateNewGroupCommand,
  type CreateNewGroupCommandDeps
} from "./domains/threads/commands/create-new-group";
export {
  createAddUsersToGroupCommand,
  type AddUsersToGroupCommandDeps
} from "./domains/threads/commands/add-users-to-group";
export {
  createRemoveUserFromGroupCommand,
  type RemoveUserFromGroupCommandDeps
} from "./domains/threads/commands/remove-user-from-group";
export {
  createChangeAdminStatusCommand,
  type ChangeAdminStatusCommandDeps
} from "./domains/threads/commands/change-admin-status";
export {
  createSetTitleCommand,
  type SetTitleCommandDeps
} from "./domains/threads/commands/set-title";
export {
  createChangeThreadEmojiCommand,
  type ChangeThreadEmojiCommandDeps
} from "./domains/threads/commands/change-thread-emoji";
export {
  createChangeGroupImageCommand,
  type ChangeGroupImageCommandDeps
} from "./domains/threads/commands/change-group-image";

export { formatFriends } from "./domains/users/queries/get-friends-list";
export { formatMessagesGraphQLResponse } from "./domains/threads/queries/get-thread-history";
export { formatUserIdEntry } from "./domains/users/shared";

export {
  createGetThreadHistoryQuery,
  type GetThreadHistoryQueryDeps
} from "./domains/threads/queries/get-thread-history";

export {
  createGetThreadInfoQuery,
  type GetThreadInfoQueryDeps
} from "./domains/threads/queries/get-thread-info";

export { createShareContactCommand, type ShareContactCommandDeps } from "./domains/messages/commands/share-contact";

export { createSocialDomain, type SocialDomainDeps } from "./domains/social";

export { formatIncomingAttachment } from "./utils/format/attachment";
export { formatDeltaMessage, formatDeltaQuotedMessage } from "./utils/format/delta";
export { formatFetchedMessage } from "./domains/messages/queries/get-message";

export { createSignalKeyStore, type SignalKeyStore, type SignalStoreOptions, type SignalKeyPairRecord, type SignalSignedPreKeyRecord, type SignalSessionAddress } from "./domains/e2ee/signal-key-store";

export { createLibsignalStores, ensureSignalIdentity, createSignalSignedPreKey, createSignalPreKey, createSignalKyberPreKey } from "./domains/e2ee/libsignal-adapter";
export { establishSignalDirectSession, encryptSignalDirectMessage, decryptSignalDirectMessage, createSignalDirectMessages, type SignalPeerAddress, type SignalCiphertext, type SignalDirectMessageDeps } from "./domains/e2ee/direct-messages";
export { encryptSignalMedia, decryptSignalMedia, encryptAndUploadSignalMedia, type EncryptedMediaDescriptor } from "./domains/e2ee/encrypted-media";

export { createSignalE2EEActions, type E2EEReadReceipt, type E2EEActionsDeps } from "./domains/e2ee/actions";

export { createLibsignalSenderKeyStore } from "./domains/e2ee/libsignal-adapter";
export { createSignalSenderKeyGroups, type SenderKeyDistribution, type SenderKeyCiphertext } from "./domains/e2ee/sender-keys";
