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
