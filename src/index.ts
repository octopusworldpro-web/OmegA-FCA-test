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
export { extractExpectedSessionUserId, assertSessionIdentity, validateSessionCookieInput } from "./core/session-validation";
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
export { createSendTypingIndicatorCommand, type SendTypingIndicatorCommandDeps } from "./domains/messages/commands/send-typing-indicator";
export { createRealtimeMiddlewareSystem, type RealtimeMiddlewareSystem } from "./domains/realtime/middleware";
export { createHumanizerController, type HumanizerController, type HumanizerOptions } from "./domains/realtime/humanizer";

export * from "./types";
export { getMqttReconnectDelay, parseMqttJsonPayload, type MqttReconnectDelayOptions } from "./domains/realtime/reconnect-policy";
export { saveCookies, getAppState } from "./utils/cookies";
export { requestWithRetry } from "./utils/request/retry";
export { detectFacebookCheckpoint } from "./utils/request/checkpoint";
export { buildMqttWebSocketUrl, getMqttWebSocketHost, type MqttWebSocketUrlOptions } from "./transport/realtime/mqtt-url";

export { validateMqttSubscriptionAck, normalizeMqttSyncState, normalizeMqttSequenceId, buildInitialMqttSyncQueue } from "./transport/realtime/sync-protocol";

export { consumeMqttTaskResponse } from "./transport/realtime/task-registry";
export { disposePreviousMqttClient } from "./transport/realtime/client-lifecycle";
export { isValidSessionUserId } from "./core/session-validation";

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

export { createSignalKeyStore, type SignalKeyStore, type SignalStoreOptions, type SignalKeyPairRecord, type SignalSignedPreKeyRecord, type SignalSessionAddress, type SignalDeviceRecord } from "./domains/e2ee/signal-key-store";

export { createLibsignalStores, ensureSignalIdentity, createSignalSignedPreKey, createSignalPreKey, createSignalKyberPreKey, createSignalPreKeyBatch, createSignalKyberPreKeyBatch } from "./domains/e2ee/libsignal-adapter";
export { establishSignalDirectSession, encryptSignalDirectMessage, decryptSignalDirectMessage, createSignalDirectMessages, type SignalPeerAddress, type SignalCiphertext, type SignalDirectMessageDeps } from "./domains/e2ee/direct-messages";
export { encryptSignalMedia, decryptSignalMedia, encryptAndUploadSignalMedia, type EncryptedMediaDescriptor } from "./domains/e2ee/encrypted-media";

export { createSignalE2EEActions, type E2EEAction, type E2EEReadReceipt, type E2EEDeliveryReceipt, type E2EETypingAction, type E2EEPresenceAction, type E2EEActionsDeps } from "./domains/e2ee/actions";

export { createLibsignalSenderKeyStore } from "./domains/e2ee/libsignal-adapter";
export { createSignalSenderKeyGroups, type SenderKeyDistribution, type SenderKeyCiphertext } from "./domains/e2ee/sender-keys";
export { createSignalEncryptedGroupMedia, type EncryptedGroupMediaDescriptor, type EncryptedGroupMediaExpectedContext } from "./domains/e2ee/encrypted-group-media";

export { createMediaShortcuts, type MediaShortcutDeps } from "./domains/messages/media-shortcuts";

export { registerFacebookE2EEDevice, type FacebookE2EERegistrationOptions, type FacebookE2EERegistrationResult } from "./domains/e2ee/device-registration";

export { dispatchAutomaticReceipts, type AutomaticReceiptMessage, type AutomaticReceiptOptions } from "./domains/realtime/auto-receipts";

export { createSignalE2EERuntime, type SignalRuntimeOptions, type SignalE2EERuntime } from "./domains/e2ee/runtime";

export { createSignalPeerManager, type SignalPeerManagerDeps, type SignalRemoteDevice } from "./domains/e2ee/peer-manager";

export { createSignalGroupKeyManager, type SignalGroupKeyManagerDeps, type SignalGroupDevice } from "./domains/e2ee/group-key-manager";

export { createOutgoingActionLimiter, type OutgoingActionLimiterOptions } from "./domains/realtime/outgoing-action-limiter";

export { createSendBroadcast, type BroadcastOptions, type BroadcastResult } from "./domains/messages/send-broadcast";

export { generateOmegAX25519KeyPair, deriveOmegAX25519, deriveOmegAHKDF, encryptOmegAAes256Gcm, decryptOmegAAes256Gcm, type OmegAKeyPair, type OmegAAeadCiphertext } from "./domains/e2ee/native-crypto";

export { createOmegADoubleRatchet, restoreOmegADoubleRatchet, type OmegADoubleRatchetState, type OmegADoubleRatchetHeader, type OmegADoubleRatchetMessage } from "./domains/e2ee/double-ratchet";

export { initiateOmegAX3DH, respondOmegAX3DH, type OmegAX3DHPreKeyBundle, type OmegAX3DHInitialMessage, type OmegAX3DHInitiatorOptions, type OmegAX3DHInitiatorResult, type OmegAX3DHResponderOptions } from "./domains/e2ee/x3dh";

export { initializeOmegADoubleRatchetAlice, initializeOmegADoubleRatchetBob } from "./domains/e2ee/double-ratchet";
export { verifyOmegAXEdDSA } from "./domains/e2ee/xeddsa";

export { initiateOmegAPQXDH, respondOmegAPQXDH, type OmegAPQKEM, type OmegAPQXDHBundle, type OmegAPQXDHInitialMessage, type OmegAPQXDHInitiatorOptions, type OmegAPQXDHResponderOptions, type OmegAPQXDHResult } from "./domains/e2ee/pqxdh";

export { createE2EEBootstrap, type E2EEBootstrapOptions, type E2EEBootstrap } from "./domains/e2ee/bootstrap";

export { createSignalEncryptedGroupMessaging, type SignalGroupMessagingDeps, type EncryptedGroupMessageEnvelope } from "./domains/e2ee/group-messaging";

export { createSignalEncryptedGroupMediaMessaging, type SignalGroupMediaMessagingDeps, type EncryptedGroupMediaMessageEnvelope } from "./domains/e2ee/group-media-messaging";

export { initializeE2EEForLogin, type E2EELoginOptions, type E2EELoginResult } from "./domains/e2ee/login-integration";

export { buildFacebookPreKeyUpload, publishFacebookPreKeys, type FacebookE2EESendIQ } from "./domains/e2ee/prekey-publisher";

export { verifyMessengerNoiseCertificateChain, MESSENGER_NOISE_ROOT_PUBLIC_KEY } from "./domains/e2ee/noise-certificate";

export { fetchFacebookCryptoAuthToken, FACEBOOK_CAT_GRAPHQL_DOC_ID, type FacebookCATRequestOptions } from "./domains/e2ee/messenger-cat";

export { performMessengerNoiseXXHandshake, buildMessengerClientPayload, MessengerNoiseFrameCipher, type MessengerNoiseRawTransport, type MessengerNoiseHandshakeOptions, type MessengerNoiseHandshakeResult } from "./domains/e2ee/messenger-noise";

export { connectMessengerNoiseSocket, MessengerNoiseSocket, type MessengerNoiseSocketOptions } from "./domains/e2ee/messenger-noise-socket";
