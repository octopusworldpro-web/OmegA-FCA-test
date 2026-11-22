import logger from "../func/logger";
import format from "../utils/format";
import { createDefaultContext, type FcaContext, type FcaOptions } from "./state";
import { createRequestHelper } from "./request";
import { setOptions } from "./options";
import { loadConfig } from "./config";
import { runConfiguredUpdateCheck } from "./update-check";
import loginHelper from "./login-helper";

const { getType } = format;

export interface LoginCredentials {
  appState?: Loose[] | string;
  email?: string;
  password?: string;
  Cookie?: string | string[] | Record<string, string>;
}

const g: Loose = global as Loose;
const initialConfig = loadConfig().config;
g.fca = g.fca || {};
g.fca.config = initialConfig;

if (!g.fca._errorHandlersInstalled) {
  g.fca._errorHandlersInstalled = true;

  process.on("unhandledRejection", (reason: Loose) => {
    try {
      if (reason && typeof reason === "object") {
        const errorCode = reason.code || reason.cause?.code;
        const errorMessage = reason.message || String(reason);

        if (errorMessage.includes("No Sequelize instance passed")) {
          return;
        }

        if (
          errorCode === "UND_ERR_CONNECT_TIMEOUT" ||
          errorCode === "ETIMEDOUT" ||
          errorMessage.includes("Connect Timeout") ||
          errorMessage.includes("fetch failed")
        ) {
          logger(`Network timeout error caught (non-fatal): ${errorMessage}`, "warn");
          return;
        }

        if (
          errorCode === "ECONNREFUSED" ||
          errorCode === "ENOTFOUND" ||
          errorCode === "ECONNRESET" ||
          errorMessage.includes("ECONNREFUSED") ||
          errorMessage.includes("ENOTFOUND")
        ) {
          logger(`Network connection error caught (non-fatal): ${errorMessage}`, "warn");
          return;
        }
      }
      logger(
        `Unhandled promise rejection (non-fatal): ${reason && reason.message ? reason.message : String(reason)}`,
        "error"
      );
    } catch { }
  });

  process.on("uncaughtException", (error: Loose) => {
    try {
      const errorMessage = error.message || String(error);
      const errorCode = error.code;

      if (errorMessage.includes("No Sequelize instance passed")) {
        return;
      }

      if (
        errorCode === "UND_ERR_CONNECT_TIMEOUT" ||
        errorCode === "ETIMEDOUT" ||
        errorMessage.includes("Connect Timeout") ||
        errorMessage.includes("fetch failed")
      ) {
        logger(`Uncaught network timeout error (non-fatal): ${errorMessage}`, "warn");
        return;
      }

      logger(`Uncaught exception (attempting to continue): ${errorMessage}`, "error");
    } catch { }
  });
}

function cookiePairsFromInput(input: Loose): string[] {
  if (!input) return [];
  if (typeof input === "string") return loginHelper.normalizeCookieHeaderString(input);
  if (Array.isArray(input)) {
    const pairs: string[] = [];
    for (const entry of input) {
      if (typeof entry === "string") {
        pairs.push(...loginHelper.normalizeCookieHeaderString(entry));
      } else if (entry && typeof entry === "object") {
        const key = entry.key || entry.name;
        if (key && entry.value !== undefined && entry.value !== null) {
          pairs.push(`${String(key).trim()}=${String(entry.value)}`);
        }
      }
    }
    return pairs;
  }
  if (typeof input === "object") {
    const nested = input.Cookie || input.cookie || input.cookies;
    if (nested) return cookiePairsFromInput(nested);
    if (input.key || input.name) {
      return input.value === undefined || input.value === null
        ? []
        : [`${String(input.key || input.name).trim()}=${String(input.value)}`];
    }
    return Object.entries(input)
      .filter(([, value]) => value !== undefined && value !== null && typeof value !== "object")
      .map(([key, value]) => `${key}=${String(value)}`);
  }
  return [];
}

function dedupeCookiePairs(pairs: string[]): string[] {
  const byName = new Map<string, string>();
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    if (name) byName.set(name, `${name}=${pair.slice(eq + 1)}`);
  }
  return [...byName.values()];
}

export function normalizeLoginCredentials(credentials: LoginCredentials): LoginCredentials {
  let appState: Loose[] | undefined;
  let cookieInput: Loose = credentials.Cookie;

  if (typeof credentials.appState === "string") {
    let parsed: Loose = null;
    try { parsed = JSON.parse(credentials.appState); } catch { }
    if (Array.isArray(parsed)) appState = parsed;
    else cookieInput = [credentials.appState, ...(cookieInput ? [cookieInput] : [])];
  } else if (Array.isArray(credentials.appState)) {
    appState = credentials.appState;
  }

  const explicitCookiePairs = cookiePairsFromInput(cookieInput);
  const Cookie = dedupeCookiePairs(explicitCookiePairs).join("; ");
  return { appState, Cookie: Cookie || undefined };
}

function appStateToFbid(appState: Loose[] | string | undefined): string {
  const pairs = cookiePairsFromInput(appState);
  const uid = pairs.find((pair) => /^c_user=/i.test(pair)) ||
    pairs.find((pair) => /^i_user=/i.test(pair));
  return uid ? uid.slice(uid.indexOf("=") + 1) : "";
}

const DEFAULT_LOGIN_OPTIONS: Required<Pick<
  FcaOptions,
  | "selfListen"
  | "selfListenEvent"
  | "listenEvents"
  | "listenTyping"
  | "updatePresence"
  | "forceLogin"
  | "autoMarkRead"
  | "autoReconnect"
  | "online"
  | "emitReady"
  | "userAgent"
>> = {
  selfListen: false,
  selfListenEvent: false,
  listenEvents: false,
  listenTyping: false,
  updatePresence: false,
  forceLogin: false,
  autoMarkRead: false,
  autoReconnect: true,
  online: true,
  emitReady: false,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
};

/** Classic FCA-style callback receives the flat `api` object (same as `ctx.api`). */
export type LoginApiCallback = (err: Error | null | undefined, api?: Loose) => void;

export async function loginAsync(
  credentials: LoginCredentials,
  customOptions: FcaOptions = {}
): Promise<FcaContext> {
  const { config } = loadConfig();
  g.fca = g.fca || {};
  g.fca.config = config;
  const ctx = createDefaultContext();
  const globalOptions: FcaOptions = { ...DEFAULT_LOGIN_OPTIONS };

  setOptions(globalOptions, customOptions || {});
  ctx.options = { ...ctx.options, ...globalOptions };
  ctx.globalOptions = globalOptions;
  const normalizedCredentials = normalizeLoginCredentials(credentials);
  ctx.cookieString = dedupeCookiePairs([
    ...cookiePairsFromInput(normalizedCredentials.appState),
    ...cookiePairsFromInput(normalizedCredentials.Cookie)
  ]).join("; ");
  ctx.fbid = appStateToFbid(ctx.cookieString);
  (ctx as Loose)._request = createRequestHelper(ctx);

  const runLogin = () =>
    new Promise<Loose>((resolve, reject) => {
      loginHelper(
        normalizedCredentials.appState,
        normalizedCredentials.Cookie,
        credentials.email,
        credentials.password,
        globalOptions,
        (error: Loose, api: Loose) => {
          if (error) return reject(error);
          return resolve(api);
        }
      );
    });

  let api: Loose;
  if (config.checkUpdate.enabled) {
    await runConfiguredUpdateCheck(config, logger);
  }
  api = await runLogin();

  (ctx as Loose).api = api;
  try {
    if (typeof api.getCurrentUserID === "function") {
      ctx.fbid = String(api.getCurrentUserID() || ctx.fbid || "");
      ctx.userID = ctx.fbid;
    }
    if (typeof api.getCookies === "function") {
      ctx.cookieString = String(api.getCookies() || ctx.cookieString || "");
    }
  } catch { }

  return ctx;
}

/**
 * Login: Promise API, or legacy `login(credentials, (err, api) => …)` like classic FCA.
 * For `const login = require('@nirzon-islam/omega-fca')`, use the published `dist/cjs.cjs` entry.
 */
export function login(
  credentials: LoginCredentials,
  callback: LoginApiCallback
): void;
export function login(
  credentials: LoginCredentials,
  options: FcaOptions,
  callback: LoginApiCallback
): void;
export function login(
  credentials: LoginCredentials,
  customOptions?: FcaOptions
): Promise<FcaContext>;
export function login(
  credentials: LoginCredentials,
  optionsOrCallback?: FcaOptions | LoginApiCallback,
  callback?: LoginApiCallback
): Promise<FcaContext> | void {
  if (typeof optionsOrCallback === "function") {
    const cb = optionsOrCallback;
    void loginAsync(credentials, {}).then(
      (ctx) => cb(null, (ctx as Loose).api),
      (err: Loose) => cb(err instanceof Error ? err : new Error(String(err?.message ?? err)))
    );
    return;
  }

  if (typeof callback === "function") {
    const opts = (optionsOrCallback || {}) as FcaOptions;
    void loginAsync(credentials, opts).then(
      (ctx) => callback!(null, (ctx as Loose).api),
      (err: Loose) => callback!(err instanceof Error ? err : new Error(String(err?.message ?? err)))
    );
    return;
  }

  return loginAsync(credentials, (optionsOrCallback || {}) as FcaOptions);
}

export function loginLegacy(
  credentials: LoginCredentials,
  options?: FcaOptions | ((err: Error | null, ctx?: FcaContext) => void),
  callback?: (err: Error | null, ctx?: FcaContext) => void
) {
  if (getType(options) === "Function" || getType(options) === "AsyncFunction") {
    callback = options as (err: Error | null, ctx?: FcaContext) => void;
    options = {};
  }

  const p = loginAsync(credentials, (options || {}) as FcaOptions);
  if (typeof callback === "function") {
    void p.then(
      (res) => callback?.(null, res),
      (err) => callback?.(err instanceof Error ? err : new Error(String(err?.message ?? err)))
    );
    return;
  }
  return p;
}

export interface TokensApiResponse {
  status?: boolean;
  ok?: boolean;
  uid?: string;
  access_token?: string;
  cookies?: Loose[] | string;
  cookie?: Loose[] | string;
  message?: string;
}

export const tokensViaAPI = (
  email: string,
  password: string,
  twoFactor?: string | null,
  apiBaseUrl?: string | null
): Promise<TokensApiResponse> => loginHelper.tokensViaAPI(email, password, twoFactor, apiBaseUrl);

export const loginViaAPI = (
  email: string,
  password: string,
  twoFactor?: string | null,
  apiBaseUrl?: string | null,
  apiKey?: string | null
): Promise<TokensApiResponse> => loginHelper.loginViaAPI(email, password, twoFactor, apiBaseUrl, apiKey);

export const normalizeCookieHeaderString = (cookieHeader: string) =>
  loginHelper.normalizeCookieHeaderString(cookieHeader);

export const setJarFromPairs = (
  jar: {
    setCookieSync?: (cookie: string, url: string) => void;
    setCookie?: (cookie: string, url: string, cb?: (err?: Error | null) => void) => void;
  },
  pairs: string[],
  domain: string
) => loginHelper.setJarFromPairs(jar, pairs, domain);

export default login;



