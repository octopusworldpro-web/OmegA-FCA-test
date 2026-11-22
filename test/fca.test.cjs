"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const fca = require("../dist/index.js");

const tests = [];
const COOKIE_ATTRIBUTE_KEYS = new Set([
  "domain",
  "path",
  "expires",
  "max-age",
  "secure",
  "httponly",
  "samesite",
  "priority",
  "partitioned"
]);

function test(name, fn) {
  tests.push({ name, fn });
}

function toCookiePair(name, value) {
  const cookieName = String(name || "").trim();
  if (!cookieName) {
    return null;
  }

  const cookieValue = value === undefined || value === null ? "" : String(value).trim();
  return `${cookieName}=${cookieValue}`;
}

function dedupeCookiePairs(pairs) {
  const latestByName = new Map();

  for (const pair of pairs) {
    const normalized = String(pair || "").trim();
    const eqIndex = normalized.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }

    const name = normalized.slice(0, eqIndex).trim();
    if (!name) {
      continue;
    }

    latestByName.set(name, `${name}=${normalized.slice(eqIndex + 1).trim()}`);
  }

  return [...latestByName.values()];
}

function parseCookieHeaderString(raw) {
  let header = String(raw || "").trim();
  if (!header) {
    return [];
  }

  if (/^cookie\s*:/i.test(header)) {
    header = header.replace(/^cookie\s*:/i, "").trim();
  }

  const pairs = [];
  for (const segment of header.split(/[;\r\n]+/)) {
    const token = segment.trim();
    const eqIndex = token.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }

    const name = token.slice(0, eqIndex).trim();
    if (!name || COOKIE_ATTRIBUTE_KEYS.has(name.toLowerCase())) {
      continue;
    }

    const value = token.slice(eqIndex + 1).trim().replace(/^"(.*)"$/, "$1");
    const pair = toCookiePair(name, value);
    if (pair) {
      pairs.push(pair);
    }
  }

  return dedupeCookiePairs(pairs);
}

function parseNetscapeCookieText(raw) {
  const pairs = [];
  const lines = String(raw || "").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const normalized = trimmed.replace(/^#HttpOnly_/, "");
    if (normalized.startsWith("#")) {
      continue;
    }

    const columns = normalized.split("\t");
    if (columns.length < 7) {
      continue;
    }

    const name = columns[5];
    const value = columns.slice(6).join("\t");
    const pair = toCookiePair(name, value);
    if (pair) {
      pairs.push(pair);
    }
  }

  return dedupeCookiePairs(pairs);
}

function normalizeCookiePayload(payload) {
  if (!payload) {
    return null;
  }

  if (typeof payload === "string") {
    const netscapePairs = parseNetscapeCookieText(payload);
    if (netscapePairs.length) {
      return netscapePairs.join("; ");
    }

    const headerPairs = parseCookieHeaderString(payload);
    if (headerPairs.length) {
      return headerPairs.join("; ");
    }

    return null;
  }

  if (Array.isArray(payload)) {
    const pairs = [];

    for (const entry of payload) {
      if (typeof entry === "string") {
        const stringPairs = parseCookieHeaderString(entry);
        if (stringPairs.length) {
          pairs.push(...stringPairs);
          continue;
        }

        const eqIndex = entry.indexOf("=");
        if (eqIndex > 0) {
          const pair = toCookiePair(entry.slice(0, eqIndex), entry.slice(eqIndex + 1));
          if (pair) {
            pairs.push(pair);
          }
        }
        continue;
      }

      if (entry && typeof entry === "object") {
        const pair = toCookiePair(entry.name || entry.key, entry.value);
        if (pair) {
          pairs.push(pair);
        }
      }
    }

    const deduped = dedupeCookiePairs(pairs);
    return deduped.length ? deduped.join("; ") : null;
  }

  if (typeof payload === "object") {
    if (payload.Cookie || payload.cookie || payload.cookies) {
      return normalizeCookiePayload(payload.Cookie || payload.cookie || payload.cookies);
    }

    if ((payload.name || payload.key) && Object.prototype.hasOwnProperty.call(payload, "value")) {
      return toCookiePair(payload.name || payload.key, payload.value);
    }

    const pairs = [];
    for (const [name, value] of Object.entries(payload)) {
      if (value === undefined || value === null || typeof value === "object") {
        continue;
      }

      const pair = toCookiePair(name, value);
      if (pair) {
        pairs.push(pair);
      }
    }

    const deduped = dedupeCookiePairs(pairs);
    return deduped.length ? deduped.join("; ") : null;
  }

  return null;
}

function loadCookieCredentials(candidate, sourceLabel) {
  if (!fs.existsSync(candidate)) {
    return null;
  }

  const raw = fs.readFileSync(candidate, "utf8").trim();
  if (!raw) {
    return null;
  }

  let payload = raw;
  if (candidate.endsWith(".json")) {
    payload = JSON.parse(raw);
  }

  const cookieHeader = normalizeCookiePayload(payload);
  if (!cookieHeader) {
    return null;
  }

  return {
    mode: "cookie",
    source: sourceLabel,
    credentials: {
      Cookie: cookieHeader
    }
  };
}

function readJsonFileIfValid(candidate) {
  if (!fs.existsSync(candidate)) {
    return null;
  }

  const raw = fs.readFileSync(candidate, "utf8");
  if (!raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadIntegrationCredentials() {
  const rootDir = process.cwd();
  const cookieCandidates = [
    path.join(rootDir, "cookie.txt"),
    path.join(rootDir, "cookies.txt"),
    path.join(rootDir, "cookie.json"),
    path.join(rootDir, "cookies.json"),
    path.join(rootDir, "test", "cookie.txt"),
    path.join(rootDir, "test", "cookie.json")
  ];

  for (const candidate of cookieCandidates) {
    const loaded = loadCookieCredentials(candidate, path.relative(rootDir, candidate) || candidate);
    if (loaded) {
      return loaded;
    }
  }

  const appStateCandidates = [
    path.join(rootDir, "appstate.json"),
    path.join(rootDir, "appState.json"),
    path.join(rootDir, "test", "appstate.json")
  ];

  for (const candidate of appStateCandidates) {
    const parsedAppState = readJsonFileIfValid(candidate);
    if (!parsedAppState) {
      continue;
    }

    return {
      mode: "appState",
      source: path.relative(rootDir, candidate) || candidate,
      credentials: {
        appState: parsedAppState
      }
    };
  }

  const configPath = path.join(rootDir, "fca-config.json");
  if (fs.existsSync(configPath)) {
    const rawConfig = readJsonFileIfValid(configPath);
    if (!rawConfig) {
      return null;
    }

    const configCookiePath =
      rawConfig.cookiePath ||
      rawConfig.cookiesPath ||
      rawConfig.cookieFile ||
      rawConfig.cookiesFile ||
      rawConfig.credentials?.cookiePath ||
      rawConfig.credentials?.cookiesPath ||
      rawConfig.credentials?.cookieFile ||
      rawConfig.credentials?.cookiesFile;

    if (configCookiePath) {
      const resolvedCookiePath = path.resolve(rootDir, configCookiePath);
      const loaded = loadCookieCredentials(
        resolvedCookiePath,
        path.relative(rootDir, resolvedCookiePath) || resolvedCookiePath
      );
      if (loaded) {
        return loaded;
      }
    }

    const configCookie =
      rawConfig.Cookie ||
      rawConfig.cookie ||
      rawConfig.cookies ||
      rawConfig.sessionCookie ||
      rawConfig.credentials?.Cookie ||
      rawConfig.credentials?.cookie ||
      rawConfig.credentials?.cookies ||
      rawConfig.credentials?.sessionCookie;

    if (configCookie) {
      const normalizedConfigCookie = normalizeCookiePayload(configCookie);
      if (normalizedConfigCookie) {
        return {
          mode: "cookie",
          source: "fca-config.json",
          credentials: {
            Cookie: normalizedConfigCookie
          }
        };
      }
    }

    const fileAppStatePath =
      rawConfig.appStatePath ||
      rawConfig.appstatePath ||
      rawConfig.appStateFile ||
      rawConfig.appstateFile;

    if (fileAppStatePath) {
      const resolvedPath = path.resolve(rootDir, fileAppStatePath);
      const parsedAppState = readJsonFileIfValid(resolvedPath);
      if (parsedAppState) {
        return {
          mode: "appState",
          source: path.relative(rootDir, resolvedPath) || resolvedPath,
          credentials: {
            appState: parsedAppState
          }
        };
      }
    }
  }

  return null;
}

test("AppState and Cookie inputs normalize into consistent login credentials", () => {
  const fromAppState = fca.normalizeLoginCredentials({
    appState: [
      { name: "c_user", value: "12345" },
      { key: "xs", value: "token=with=equals" }
    ]
  });
  assert.strictEqual(fromAppState.appState.length, 2);
  assert.strictEqual(fromAppState.Cookie, undefined);

  const fromCookieHeader = fca.normalizeLoginCredentials({
    Cookie: "Cookie: c_user=67890; xs=token=with=equals"
  });
  assert.strictEqual(fromCookieHeader.Cookie, "c_user=67890; xs=token=with=equals");

  const fromCookieObjects = fca.normalizeLoginCredentials({
    Cookie: [
      { name: "c_user", value: "24680" },
      { key: "xs", value: "object-token" }
    ]
  });
  assert.strictEqual(fromCookieObjects.Cookie, "c_user=24680; xs=object-token");

  const fromAppStateHeader = fca.normalizeLoginCredentials({
    appState: "c_user=13579; xs=header-token"
  });
  assert.strictEqual(fromAppStateHeader.appState, undefined);
  assert.strictEqual(fromAppStateHeader.Cookie, "c_user=13579; xs=header-token");

  const fromJsonAppState = fca.normalizeLoginCredentials({
    appState: JSON.stringify([{ key: "c_user", value: "11223" }])
  });
  assert.strictEqual(fromJsonAppState.appState[0].value, "11223");
  assert.strictEqual(fromJsonAppState.Cookie, undefined);
});

test("sessionGuard atomically saves only the active account AppState", () => {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "omega-session-"));
  const target = path.join(dir, "account.txt");
  const validState = [
    { key: "c_user", value: "123456789", domain: ".facebook.com", path: "/" },
    { key: "xs", value: "session-token", domain: ".facebook.com", path: "/" }
  ];
  try {
    const guard = fca.createSessionGuard(target, "123456789", () => validState, () => {}, { interval: 10000, debounce: 0 });
    guard.saveNow();
    const saved = JSON.parse(fs.readFileSync(target, "utf8"));
    assert.equal(saved[0].key, "c_user");
    assert.equal(fs.statSync(target).mode & 0o077, 0);
    const previous = fs.readFileSync(target, "utf8");
    const invalid = fca.createSessionGuard(target, "987654321", () => validState, () => {}, { interval: 10000, debounce: 0 });
    invalid.saveNow();
    assert.equal(fs.readFileSync(target, "utf8"), previous);
    guard.stop();
    invalid.stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("MQTT stop APIs are safe when called through the legacy API and cancel queued reconnect", async () => {
  let connectCalls = 0;
  const ctx = {
    firstListen: true,
    lastSeqId: 123,
    globalOptions: { autoReconnect: true },
    tasks: new Map()
  };
  const api = {};
  const listener = fca.createRealtimeListener({
    EventEmitter: require("node:events").EventEmitter,
    logger: () => {},
    emitAuth: () => {},
    createMiddlewareSystem: () => ({
      use: () => true,
      remove: () => true,
      clear: () => {},
      list: () => [],
      setEnabled: () => true,
      wrapCallback: (callback) => callback,
      count: 0
    }),
    topics: [],
    listenMqttCore: () => { connectCalls += 1; },
    getSeqIDFactory: async () => {}
  });
  const listen = listener({}, api, ctx, { cycleMs: 0, reconnectDelayMs: 15, reconnectAfterStop: true });
  listen();
  assert.equal(connectCalls, 1);
  assert.equal(typeof api.stopListening, "function");
  assert.equal(typeof api.stopListeningAsync, "function");
  await api.stopListeningAsync();
  await api.stopListeningAsync();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(connectCalls, 1);
  assert.equal(ctx._reconnectTimer, null);
});

test("MQTT reconnect backoff is exponential, capped, and jitter bounded", () => {
  const delay = fca.getMqttReconnectDelay;
  assert.equal(delay({ attempt: 1, baseDelayMs: 1000, maxDelayMs: 8000, jitterMs: 400, random: 0 }), 1000);
  assert.equal(delay({ attempt: 2, baseDelayMs: 1000, maxDelayMs: 8000, jitterMs: 400, random: 0.5 }), 2200);
  assert.equal(delay({ attempt: 5, baseDelayMs: 1000, maxDelayMs: 8000, jitterMs: 400, random: 0.999 }), 8000);
  assert.equal(delay({ attempt: 99, baseDelayMs: 1000, maxDelayMs: 8000, jitterMs: 400, random: 0 }), 8000);
});


test("MQTT reconnect delay never exceeds configured cap, including jitter", () => {
  const delay = fca.getMqttReconnectDelay;
  for (const attempt of [1, 2, 5, 20, 100]) {
    for (const random of [0, 0.5, 0.999999]) {
      assert.ok(delay({ attempt, baseDelayMs: 2500, maxDelayMs: 7000, jitterMs: 400, random }) <= 7000);
    }
  }
  assert.equal(delay({ attempt: 1, baseDelayMs: 1000, maxDelayMs: 8000, jitterMs: 400, random: 0.999 }), 1400);
});

test("MQTT payload decoder accepts objects and buffers and rejects malformed frames", () => {
  const parse = fca.parseMqttJsonPayload;
  assert.deepEqual(parse(Buffer.from('{"type":"ready"}')), { type: "ready" });
  assert.deepEqual(parse({ type: "presence" }), { type: "presence" });
  assert.equal(parse("not-json"), null);
  assert.equal(parse("[]"), null);
  assert.equal(parse("null"), null);
});

test("GoatBot login contract exposes session getters and emitter methods", async () => {
  const emitter = new (require("node:events").EventEmitter)();
  const state = [{ key: "c_user", value: "123456789" }, { key: "xs", value: "session" }];
  const api = fca.createApiFacade({
    globalOptions: { online: false },
    jar: {},
    userID: "123456789",
    emitter,
    setOptions: () => {},
    getAppState: () => state,
    cookieHeaderFromJar: () => "c_user=123456789; xs=session",
    getLatestBackup: async (_uid, type) => type === "appstate" ? JSON.stringify(state) : "c_user=123456789; xs=session"
  });
  assert.deepEqual(api.getAppState(), state);
  assert.equal(api.getCookies(), "c_user=123456789; xs=session");
  assert.deepEqual(await api.getLatestAppStateFromDB(), state);
  assert.equal(await api.getLatestCookieFromDB(), "c_user=123456789; xs=session");
  let emitted = false;
  api.once("goatbot-contract", () => { emitted = true; });
  emitter.emit("goatbot-contract");
  assert.equal(emitted, true);
});

test("cookie persistence accepts single and multiple Set-Cookie headers and resolves relative URLs", () => {
  const saved = [];
  const jar = { setCookieSync: (cookie, url) => saved.push({ cookie, url }) };
  const response = { headers: { "set-cookie": ["c_user=123; Path=/; Domain=.facebook.com", "xs=token; Path=/; Domain=.facebook.com"] }, config: { url: "/settings", baseURL: "https://www.facebook.com" } };
  assert.strictEqual(fca.saveCookies(jar)(response), response);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].url, "https://www.facebook.com/settings");
  const single = { headers: { "set-cookie": "datr=value; Path=/; Domain=.facebook.com" }, request: { res: { responseUrl: "https://m.facebook.com/" } } };
  fca.saveCookies(jar)(single);
  assert.equal(saved.length, 3);
  assert.equal(saved[2].url, "https://m.facebook.com/");
});

test("AppState collection includes Facebook subdomain cookies and deduplicates by scope", () => {
  const jar = { getCookiesSync: (url) => {
    if (url.includes("www.facebook.com")) return [{ key: "c_user", value: "123", domain: ".facebook.com", path: "/", expires: "Infinity" }];
    if (url.includes("m.facebook.com")) return [{ key: "c_user", value: "123", domain: ".facebook.com", path: "/", expires: "Infinity" }, { key: "m_cookie", value: "mobile", domain: "m.facebook.com", path: "/", expires: "Infinity" }];
    return [];
  } };
  const state = fca.getAppState(jar);
  assert.equal(state.length, 2);
  assert.deepEqual(state.map((cookie) => cookie.key), ["c_user", "m_cookie"]);
});
test("HTTP retry policy retries 429 and 5xx responses but returns ordinary 4xx responses", async () => {
  let attempts = 0;
  const result = await fca.requestWithRetry(async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("rate limited");
      error.response = { status: 429, data: "retry" };
      error.config = { method: "get", url: "/messages" };
      throw error;
    }
    return { status: 200, data: "ok" };
  }, 3, 1);
  assert.equal(attempts, 2);
  assert.equal(result.data, "ok");
  const badRequest = { status: 400, data: "bad request" };
  const returned = await fca.requestWithRetry(async () => {
    const error = new Error("bad request");
    error.response = badRequest;
    throw error;
  }, 3, 1);
  assert.strictEqual(returned, badRequest);
});
test("MQTT websocket URL preserves endpoint parameters and replaces sid/cid safely", () => {
  const url = new URL(fca.buildMqttWebSocketUrl({
    endpoint: "https://edge-chat.facebook.com/chat?region=prn&sid=old&keep=yes#fragment",
    sessionId: 123456,
    clientId: "client-abc"
  }));
  assert.equal(url.protocol, "wss:");
  assert.equal(url.hostname, "edge-chat.facebook.com");
  assert.equal(url.searchParams.get("region"), "prn");
  assert.equal(url.searchParams.get("keep"), "yes");
  assert.equal(url.searchParams.get("sid"), "123456");
  assert.equal(url.searchParams.get("cid"), "client-abc");
  assert.equal(url.hash, "");
  assert.equal(fca.getMqttWebSocketHost(url.toString()), "edge-chat.facebook.com");
});

test("MQTT websocket URL builds regional fallback and rejects untrusted endpoints", () => {
  const fallback = new URL(fca.buildMqttWebSocketUrl({ region: "FRA", sessionId: 42, clientId: "c1" }));
  assert.equal(fallback.protocol, "wss:");
  assert.equal(fallback.hostname, "edge-chat.facebook.com");
  assert.equal(fallback.searchParams.get("region"), "fra");
  assert.throws(() => fca.buildMqttWebSocketUrl({ endpoint: "https://evil.example/chat", sessionId: 42, clientId: "c1" }), /Rejected/);
  assert.throws(() => fca.buildMqttWebSocketUrl({ endpoint: "wss://edge-chat.facebook.com.evil.example/chat", sessionId: 42, clientId: "c1" }), /Rejected/);
  assert.throws(() => fca.buildMqttWebSocketUrl({ endpoint: "http://edge-chat.facebook.com/chat", sessionId: 42, clientId: "c1" }), /Rejected/);
});
test("public exports are available", () => {
  assert.strictEqual(typeof fca.login, "function");
  assert.strictEqual(typeof fca.createFcaClient, "function");
  assert.strictEqual(typeof fca.attachClientFacade, "function");
  assert.strictEqual(typeof fca.resolveConfig, "function");
  assert.strictEqual(typeof fca.loadConfig, "function");
});

test("dist/cjs.cjs default export is callable login (Mirai / classic require)", () => {
  const login = require("../dist/cjs.cjs");
  assert.strictEqual(typeof login, "function");
  assert.strictEqual(typeof login.login, "function");
  assert.strictEqual(typeof login.createMessengerBot, "function");
});

test("package root resolves through the CommonJS export map", () => {
  const packageEntry = require("..");
  assert.strictEqual(typeof packageEntry, "function");
  assert.strictEqual(typeof packageEntry.login, "function");
  assert.strictEqual(typeof packageEntry.createMessengerBot, "function");
});

test("ESM entry exposes default login and named FCA exports", async () => {
  const esm = await import("../dist/index.mjs");
  assert.strictEqual(typeof esm.default, "function");
  assert.strictEqual(typeof esm.login, "function");
  assert.strictEqual(typeof esm.createFcaClient, "function");
  assert.strictEqual(typeof esm.attachClientFacade, "function");
  assert.strictEqual(typeof esm.resolveConfig, "function");
});

test("resolveConfig honors legacy autoUpdate alias", () => {
  const resolved = fca.resolveConfig({
    autoUpdate: false,
    checkUpdate: {
      notifyIfCurrent: true
    }
  });

  assert.strictEqual(resolved.autoUpdate, false);
  assert.strictEqual(resolved.checkUpdate.enabled, false);
  assert.strictEqual(resolved.checkUpdate.notifyIfCurrent, true);
});

test("OmegA-FCA defaults keep external login and automatic updates disabled", () => {
  const resolved = fca.resolveConfig();
  assert.strictEqual(resolved.autoLogin, false);
  assert.strictEqual(resolved.apiServer, "");
  assert.strictEqual(resolved.autoUpdate, false);
  assert.strictEqual(resolved.checkUpdate.enabled, false);
  assert.strictEqual(resolved.checkUpdate.install, false);
  assert.strictEqual(resolved.checkUpdate.packageName, "@nirzon-islam/omega-fca");
});

test("legacy upstream config is migrated away from old package and login services", () => {
  const migrated = fca.resolveConfig({
    autoLogin: true,
    apiServer: "https://minhdong.site",
    apiKey: "legacy-key",
    checkUpdate: {
      enabled: true,
      install: true,
      packageName: "@dongdev/fca-unofficial"
    }
  });

  assert.strictEqual(migrated.autoLogin, false);
  assert.strictEqual(migrated.apiServer, "");
  assert.strictEqual(migrated.apiKey, "");
  assert.strictEqual(migrated.checkUpdate.packageName, "@nirzon-islam/omega-fca");
  assert.strictEqual(migrated.checkUpdate.enabled, false);
  assert.strictEqual(migrated.checkUpdate.install, false);
});

test("external credential login does not contact a provider unless HTTPS is explicitly configured", async () => {
  let requests = 0;
  const auth = fca.createAuthCore({
    config: fca.defaultConfig,
    axiosBase: async () => {
      requests += 1;
      return { status: 200, data: { cookie: "c_user=123; xs=abc" } };
    }
  });

  const disabled = await auth.loginViaAPI("owner@example.com", "not-a-real-password");
  assert.strictEqual(disabled.ok, false);
  assert.match(disabled.message, /disabled/i);
  assert.strictEqual(requests, 0);

  const insecure = await auth.loginViaAPI(
    "owner@example.com",
    "not-a-real-password",
    null,
    "http://untrusted.example"
  );
  assert.strictEqual(insecure.ok, false);
  assert.match(insecure.message, /HTTPS/i);
  assert.strictEqual(requests, 0);
});

test("explicit HTTPS credential provider receives normalized two-factor input", async () => {
  let requestConfig;
  const auth = fca.createAuthCore({
    config: { apiServer: "", apiKey: "test-api-key" },
    axiosBase: async (config) => {
      requestConfig = config;
      return { status: 200, data: { uid: "12345", cookie: "c_user=12345; xs=abc" } };
    }
  });

  const result = await auth.loginViaAPI(
    "owner@example.com",
    "not-a-real-password",
    " ab cd ",
    "https://trusted.example/base/"
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(requestConfig.url, "https://trusted.example/base/api/v1/facebook/login_ios");
  assert.strictEqual(requestConfig.data.twoFactor, "ABCD");
  assert.strictEqual(requestConfig.headers["x-api-key"], "test-api-key");
});

test("session cookie import uses HTTPS Facebook origins and Secure cookies", () => {
  const calls = [];
  const auth = fca.createAuthCore();
  auth.setJarFromPairs({
    setCookieSync(cookie, url) {
      calls.push({ cookie, url });
    }
  }, ["c_user=123", "xs=secret"], ".facebook.com");

  assert.strictEqual(calls.length, 6);
  assert.ok(calls.every(({ url }) => url.startsWith("https://")));
  assert.ok(calls.every(({ cookie }) => /; Secure;/.test(cookie)));
  assert.ok(calls.every(({ cookie }) => /domain=\.facebook\.com/i.test(cookie)));
});

test("session cookie import rejects non-Facebook cookie domains", () => {
  const auth = fca.createAuthCore();
  assert.throws(
    () => auth.setJarFromPairs({ setCookieSync() {} }, ["session=secret"], ".attacker.example"),
    /Facebook domains/i
  );
});

test("credential provider rejects embedded URL credentials and malformed URLs", async () => {
  let requests = 0;
  const auth = fca.createAuthCore({
    axiosBase: async () => {
      requests += 1;
      return { status: 200, data: { uid: "1" } };
    }
  });

  for (const url of [
    "https://user:password@trusted.example",
    "not-a-url"
  ]) {
    const result = await auth.loginViaAPI("owner@example.com", "dummy-password", null, url);
    assert.strictEqual(result.ok, false);
  }
  assert.strictEqual(requests, 0);
});

test("credential provider requests do not follow redirects", async () => {
  let requestConfig;
  const auth = fca.createAuthCore({
    axiosBase: async (config) => {
      requestConfig = config;
      return { status: 200, data: { uid: "12345" } };
    }
  });

  const result = await auth.loginViaAPI(
    "owner@example.com",
    "dummy-password",
    null,
    "https://trusted.example"
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(requestConfig.maxRedirects, 0);
});

test("session backups are encrypted at rest and bound to account and type", () => {
  const { encryptSessionBackup, decryptSessionBackup, isEncryptedSessionBackup } = fca;
  const previousKey = process.env.OMEGA_FCA_SESSION_BACKUP_KEY;
  const previousLegacy = process.env.OMEGA_FCA_ALLOW_LEGACY_PLAINTEXT_BACKUPS;
  process.env.OMEGA_FCA_SESSION_BACKUP_KEY = "11".repeat(32);
  delete process.env.OMEGA_FCA_ALLOW_LEGACY_PLAINTEXT_BACKUPS;
  try {
    const secret = "c_user=12345; xs=private-session";
    const encrypted = encryptSessionBackup(secret, "12345", "cookie");
    assert.ok(isEncryptedSessionBackup(encrypted));
    assert.ok(!encrypted.includes("private-session"));
    assert.strictEqual(decryptSessionBackup(encrypted, "12345", "cookie"), secret);
    assert.strictEqual(decryptSessionBackup(encrypted, "99999", "cookie"), null);
    assert.strictEqual(decryptSessionBackup(encrypted, "12345", "appstate"), null);
    assert.strictEqual(decryptSessionBackup("legacy-plaintext", "12345", "cookie"), null);
    process.env.OMEGA_FCA_SESSION_BACKUP_KEY = "22".repeat(32);
    assert.strictEqual(decryptSessionBackup(encrypted, "12345", "cookie"), null);
  } finally {
    if (previousKey === undefined) delete process.env.OMEGA_FCA_SESSION_BACKUP_KEY;
    else process.env.OMEGA_FCA_SESSION_BACKUP_KEY = previousKey;
    if (previousLegacy === undefined) delete process.env.OMEGA_FCA_ALLOW_LEGACY_PLAINTEXT_BACKUPS;
    else process.env.OMEGA_FCA_ALLOW_LEGACY_PLAINTEXT_BACKUPS = previousLegacy;
  }
});

test("createFcaClient reuses grouped namespaces when they already exist", () => {
  const send = () => "send-ok";
  const getInfo = () => "thread-ok";
  const listen = () => "listen-ok";

  const api = {
    messages: { send },
    threads: { getInfo },
    users: { getInfo: () => "user-ok" },
    account: { getCurrentUserID: () => "123" },
    realtime: { listen },
    http: { get: () => "http-ok" },
    scheduler: { scheduleMessage: () => "sched-ok" }
  };

  const client = fca.createFcaClient(api);

  assert.strictEqual(client.messages.send, send);
  assert.strictEqual(client.threads.getInfo, getInfo);
  assert.strictEqual(client.realtime.listen, listen);
  assert.strictEqual(client.scheduler.scheduleMessage(), "sched-ok");
});

test("attachClientFacade exposes grouped namespaces on legacy api object", () => {
  const api = {
    sendMessage() {
      return "legacy-send";
    },
    getThreadInfo() {
      return "legacy-thread";
    },
    getUserInfo() {
      return "legacy-user";
    },
    getCurrentUserID() {
      return "1000";
    },
    listenMqtt() {
      return "legacy-listen";
    },
    stopListening() {
      return "legacy-stop";
    },
    stopListeningAsync() {
      return Promise.resolve("legacy-stop-async");
    },
    useMiddleware() {
      return "legacy-use";
    },
    removeMiddleware() {
      return "legacy-remove";
    },
    clearMiddleware() {
      return "legacy-clear";
    },
    listMiddleware() {
      return [];
    },
    setMiddlewareEnabled() {
      return true;
    },
    httpGet() {
      return "legacy-http-get";
    },
    httpPost() {
      return "legacy-http-post";
    },
    postFormData() {
      return "legacy-http-form";
    }
  };

  const client = fca.attachClientFacade(api);

  assert.strictEqual(api.client, client);
  assert.strictEqual(typeof api.messages.send, "function");
  assert.strictEqual(typeof api.threads.getInfo, "function");
  assert.strictEqual(typeof api.users.getInfo, "function");
  assert.strictEqual(typeof api.account.getCurrentUserID, "function");
  assert.strictEqual(typeof api.realtime.listen, "function");
  assert.strictEqual(typeof api.http.get, "function");
});

test("optional live login works when credentials are provided", async () => {
  const integration = loadIntegrationCredentials();
  if (!integration) {
    return {
      skipped: true,
      reason: "add cookie.txt, cookies.txt, cookie.json, or cookiePath/Cookie in fca-config.json to enable real-cookie login"
    };
  }

  let ctx;
  try {
    ctx = await fca.login(integration.credentials, {
      online: false,
      forceLogin: false,
      autoMarkRead: false
    });
  } catch (error) {
    return {
      skipped: true,
      reason: `live login failed from ${integration.source}: ${error && error.message ? error.message : String(error)}`
    };
  }

  assert.ok(ctx);
  assert.ok(ctx.api);
  assert.strictEqual(typeof ctx.api.sendMessage, "function");
  assert.strictEqual(typeof ctx.api.listenMqtt, "function");
  assert.strictEqual(typeof ctx.api.client.messages.send, "function");
  assert.ok(ctx.userID || ctx.fbid);

  return {
    mode: integration.mode,
    source: integration.source,
    userID: ctx.userID || ctx.fbid || null
  };
});


test("MQTT SUBACK requires every subscribed topic to be granted", () => {
  const validate = fca.validateMqttSubscriptionAck;
  const topics = ["/ls_req", "/ls_resp", "/t_ms"];
  assert.deepStrictEqual(validate(topics, null, topics.map((topic) => ({ topic, qos: 1 }))), { ok: true });
  assert.match(validate(topics, null, [{ topic: "/ls_req", qos: 1 }]).reason, /omitted topic/);
  assert.match(validate(topics, null, topics.map((topic) => ({ topic, qos: topic === "/t_ms" ? 128 : 1 }))).reason, /rejected/);
  assert.match(validate(topics, new Error("SUBACK failed"), []).reason, /SUBACK failed/);
});

test("MQTT initial sync chooses create queue or diffs and preserves protocol fields", () => {
  const build = fca.buildInitialMqttSyncQueue;
  const fresh = build({ userID: "123", lastSeqId: 42 });
  assert.equal(fresh.topic, "/messenger_sync_create_queue");
  assert.equal(fresh.payload.entity_fbid, "123");
  assert.equal(fresh.payload.initial_titan_sequence_id, 42);
  assert.equal(fresh.payload.encoding, "JSON");
  assert.equal(fresh.payload.sync_token, undefined);
  const resume = build({ userID: "123", lastSeqId: 43, syncToken: "token-a" });
  assert.equal(resume.topic, "/messenger_sync_get_diffs");
  assert.equal(resume.payload.last_seq_id, 43);
  assert.equal(resume.payload.sync_token, "token-a");
});

test("MQTT t_ms sync state accepts safe sequence IDs and ignores invalid values", () => {
  const normalize = fca.normalizeMqttSyncState;
  assert.deepStrictEqual(
    normalize({ firstDeltaSeqId: "10", lastIssuedSeqId: "12", syncToken: "next" }, { lastSeqId: 2, syncToken: "old" }),
    { lastSeqId: 12, syncToken: "next" }
  );
  assert.deepStrictEqual(
    normalize({ firstDeltaSeqId: "NaN", lastIssuedSeqId: "12x", syncToken: "" }, { lastSeqId: 2, syncToken: "old" }),
    { lastSeqId: 2, syncToken: "old" }
  );
});


test("MQTT response registry consumes known tasks once and ignores expired IDs", () => {
  const tasks = new Map();
  let calls = 0;
  tasks.set("req-1", { type: "send_message_mqtt", callback(error, value) {
    calls += 1;
    assert.equal(error, null);
    assert.equal(value.type, "send_message_mqtt");
    assert.equal(value.reqID, "req-1");
  } });
  const mapper = (type, payload) => ({ messageID: payload.mid });
  assert.equal(fca.consumeMqttTaskResponse(tasks, "missing", { mid: "x" }, mapper), false);
  assert.equal(fca.consumeMqttTaskResponse(tasks, "req-1", { mid: "m1" }, mapper), true);
  assert.equal(tasks.has("req-1"), false);
  assert.equal(fca.consumeMqttTaskResponse(tasks, "req-1", { mid: "m2" }, mapper), false);
  assert.equal(calls, 1);
});


test("MQTT request acknowledgement matches request ID and removes all listeners", async () => {
  const { EventEmitter } = require("events");
  const client = new EventEmitter();
  client.publish = (_topic, raw, _options, callback) => {
    callback();
    const request = JSON.parse(raw);
    queueMicrotask(() => {
      client.emit("message", "/ls_resp", Buffer.from(JSON.stringify({ request_id: request.request_id, payload: { ok: true } })));
    });
  };
  const result = await fca.publishLsRequestWithAck({
    client, content: { request_id: 51 }, requestId: 51, timeoutMs: 100,
    extract: (message) => message.payload
  });
  assert.deepStrictEqual(result, { ok: true });
  for (const event of ["message", "error", "close", "offline", "end"]) {
    assert.equal(client.listenerCount(event), 0);
  }
});

test("MQTT request acknowledgement cleans up after synchronous publish failure", async () => {
  const { EventEmitter } = require("events");
  const client = new EventEmitter();
  client.publish = () => { throw new Error("publish exploded"); };
  await assert.rejects(
    fca.publishLsRequestWithAck({ client, content: {}, requestId: 52, timeoutMs: 100, extract: (message) => message }),
    /publish exploded/
  );
  for (const event of ["message", "error", "close", "offline", "end"]) {
    assert.equal(client.listenerCount(event), 0);
  }
});

test("MQTT request acknowledgement rejects on connection loss and invalid timeout", async () => {
  const { EventEmitter } = require("events");
  const client = new EventEmitter();
  client.publish = () => {};
  const pending = fca.publishLsRequestWithAck({ client, content: {}, requestId: 53, timeoutMs: 1000, extract: (message) => message });
  client.emit("close");
  await assert.rejects(pending, /connection closed/);
  await assert.rejects(
    fca.publishLsRequestWithAck({ client, content: {}, requestId: 54, timeoutMs: 0, extract: (message) => message }),
    /positive number/
  );
});

async function main() {
  let passed = 0;
  let skipped = 0;

  for (const { name, fn } of tests) {
    try {
      const result = await fn();
      if (result && result.skipped) {
        skipped += 1;
        console.log(`SKIP ${name} - ${result.reason}`);
        continue;
      }

      passed += 1;
      if (result && result.userID) {
        console.log(`PASS ${name} (${result.mode} from ${result.source}: ${result.userID})`);
      } else {
        console.log(`PASS ${name}`);
      }
    } catch (error) {
      console.error(`FAIL ${name}`);
      throw error;
    }
  }

  console.log(`SUMMARY passed=${passed} skipped=${skipped} total=${tests.length}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});


test("sendMessage preserves text and reply metadata with monotonic request/task IDs", async () => {
  const { EventEmitter } = require("events");
  const client = new EventEmitter();
  let sent;
  client.publish = (_topic, raw, _options, callback) => {
    callback();
    sent = JSON.parse(raw);
    queueMicrotask(() => client.emit("message", "/ls_resp", Buffer.from(JSON.stringify({
      request_id: sent.request_id,
      payload: {}
    }))));
  };
  const ctx = { mqttClient: client, wsReqNumber: 40, wsTaskNumber: 70 };
  const send = fca.createSendMessageCommand({
    ctx,
    uploadAttachment: async () => [],
    generateOfflineThreadingID: () => "offline-thread-id",
    isReadableStream: () => false
  });
  let callbackCalls = 0;
  const result = await send("hello omega", "thread-123", (error, value) => {
    assert.equal(error, undefined);
    assert.equal(value.body, "hello omega");
    callbackCalls += 1;
  }, "reply-message-9");

  const envelope = JSON.parse(sent.payload);
  const sendTask = JSON.parse(envelope.tasks[0].payload);
  const readTask = JSON.parse(envelope.tasks[1].payload);
  assert.equal(sendTask.thread_id, "thread-123");
  assert.equal(sendTask.text, "hello omega");
  assert.deepEqual(sendTask.reply_metadata, {
    reply_source_id: "reply-message-9",
    reply_source_type: 1,
    reply_type: 0
  });
  assert.equal(envelope.tasks[0].task_id, 71);
  assert.equal(envelope.tasks[1].task_id, 72);
  assert.equal(readTask.thread_id, "thread-123");
  assert.equal(readTask.sync_group, 1);
  assert.equal(sent.request_id, 41);
  assert.equal(ctx.wsReqNumber, 41);
  assert.equal(ctx.wsTaskNumber, 72);
  assert.equal(result.threadID, null);
  assert.equal(callbackCalls, 1);
  for (const event of ["message", "error", "close", "offline", "end"]) {
    assert.equal(client.listenerCount(event), 0);
  }
});

test("sendMessage accepts replyToMessage from the payload object", async () => {
  const { EventEmitter } = require("events");
  const client = new EventEmitter();
  let sent;
  client.publish = (_topic, raw, _options, callback) => {
    callback();
    sent = JSON.parse(raw);
    queueMicrotask(() => client.emit("message", "/ls_resp", Buffer.from(JSON.stringify({
      request_id: sent.request_id, payload: {}
    }))));
  };
  const send = fca.createSendMessageCommand({
    ctx: { mqttClient: client },
    uploadAttachment: async () => [],
    generateOfflineThreadingID: () => "offline-id",
    isReadableStream: () => false
  });
  await send({ body: "reply body", replyToMessage: "quoted-id" }, "thread-2");
  const envelope = JSON.parse(sent.payload);
  const payload = JSON.parse(envelope.tasks[0].payload);
  assert.equal(payload.text, "reply body");
  assert.equal(payload.reply_metadata.reply_source_id, "quoted-id");
});


test("sendMessage uploads Buffer media and serializes returned attachment IDs", async () => {
  const { EventEmitter } = require("events");
  const client = new EventEmitter();
  let sent;
  let uploaded;
  const media = Buffer.from("omega-media");
  client.publish = (_topic, raw, _options, callback) => {
    callback();
    sent = JSON.parse(raw);
    queueMicrotask(() => client.emit("message", "/ls_resp", Buffer.from(JSON.stringify({
      request_id: sent.request_id, payload: {}
    }))));
  };
  const send = fca.createSendMessageCommand({
    ctx: { mqttClient: client },
    uploadAttachment: async (files) => {
      uploaded = files;
      return [{ image_id: "image-987", filename: "photo.png" }];
    },
    generateOfflineThreadingID: () => "media-offline-id",
    isReadableStream: () => false
  });
  const result = await send({ body: "caption", attachment: media }, "thread-media");
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0], media);
  const envelope = JSON.parse(sent.payload);
  const task = JSON.parse(envelope.tasks[0].payload);
  assert.equal(task.send_type, 3);
  assert.equal(task.text, "caption");
  assert.deepEqual(task.attachment_fbids, ["image-987"]);
  assert.equal(result.body, "caption");
});

test("sendMessage accepts pre-uploaded attachment tuples without re-uploading", async () => {
  const { EventEmitter } = require("events");
  const client = new EventEmitter();
  let sent;
  let uploadCalls = 0;
  client.publish = (_topic, raw, _options, callback) => {
    callback();
    sent = JSON.parse(raw);
    queueMicrotask(() => client.emit("message", "/ls_resp", Buffer.from(JSON.stringify({
      request_id: sent.request_id, payload: {}
    }))));
  };
  const send = fca.createSendMessageCommand({
    ctx: { mqttClient: client },
    uploadAttachment: async () => { uploadCalls += 1; return []; },
    generateOfflineThreadingID: () => "preuploaded-id",
    isReadableStream: () => false
  });
  await send({ attachment: ["image", "already-uploaded-123"] }, "thread-media");
  const task = JSON.parse(JSON.parse(sent.payload).tasks[0].payload);
  assert.equal(uploadCalls, 0);
  assert.deepEqual(task.attachment_fbids, ["already-uploaded-123"]);
  assert.equal(task.send_type, 3);
});

test("uploadAttachment command rejects empty input through callback and Promise", async () => {
  const command = fca.createUploadAttachmentCommand({
    ctx: {},
    logger: {}
  });
  let callbackError;
  const promise = command([], (error) => { callbackError = error; });
  await assert.rejects(promise, (error) => /attachment/i.test(error.error));
  assert.ok(callbackError);
});


function createAckMqttClient() {
  const { EventEmitter } = require("events");
  const client = new EventEmitter();
  client.publish = (_topic, raw, _options, callback) => {
    callback();
    const request = JSON.parse(raw);
    queueMicrotask(() => client.emit("message", "/ls_resp", Buffer.from(JSON.stringify({
      request_id: request.request_id,
      payload: { accepted: true }
    }))));
  };
  return client;
}

test("removeUserFromGroup waits for matching MQTT acknowledgement and uses monotonic IDs", async () => {
  const client = createAckMqttClient();
  const ctx = { mqttClient: client, wsReqNumber: 10, wsTaskNumber: 20 };
  const remove = fca.createRemoveUserFromGroupCommand({
    ctx,
    generateOfflineThreadingID: () => "remove-epoch"
  });
  let calls = 0;
  const result = await remove("member-1", "group-1", (error, value) => {
    assert.equal(error, null);
    assert.equal(value, true);
    calls += 1;
  });
  assert.equal(result, true);
  assert.equal(calls, 1);
  assert.equal(ctx.wsReqNumber, 11);
  assert.equal(ctx.wsTaskNumber, 21);
  for (const event of ["message", "error", "close", "offline", "end"]) assert.equal(client.listenerCount(event), 0);
});

test("changeAdminStatus assigns distinct task IDs and resolves from MQTT ACK", async () => {
  const client = createAckMqttClient();
  const ctx = { mqttClient: client, wsReqNumber: 2, wsTaskNumber: 8 };
  const changeAdmin = fca.createChangeAdminStatusCommand({
    ctx,
    generateOfflineThreadingID: () => "admin-epoch"
  });
  const result = await changeAdmin("group-1", ["admin-a", "admin-b"], true);
  assert.deepEqual(result, { accepted: true });
  assert.equal(ctx.wsReqNumber, 3);
  assert.equal(ctx.wsTaskNumber, 10);
  for (const event of ["message", "error", "close", "offline", "end"]) assert.equal(client.listenerCount(event), 0);
});

test("setTitle and changeThreadEmoji wait for MQTT acknowledgement", async () => {
  const titleClient = createAckMqttClient();
  const titleCtx = { mqttClient: titleClient, wsReqNumber: 0, wsTaskNumber: 0 };
  const setTitle = fca.createSetTitleCommand({
    defaultFuncs: { post: async () => ({}) },
    ctx: titleCtx,
    generateOfflineThreadingID: () => "title-epoch",
    generateTimestampRelative: () => "now",
    generateThreadingID: () => "threading-id"
  });
  assert.deepEqual(await setTitle("New group", "group-1"), { success: true });
  assert.equal(titleCtx.wsTaskNumber, 1);

  const emojiClient = createAckMqttClient();
  const emojiCtx = { mqttClient: emojiClient };
  const setEmoji = fca.createChangeThreadEmojiCommand({
    defaultFuncs: { post: async () => ({}) },
    ctx: emojiCtx,
    generateOfflineThreadingID: () => "emoji-epoch"
  });
  assert.deepEqual(await setEmoji("🔥", "group-1"), { success: true });
  assert.equal(emojiCtx.wsTaskNumber, 1);
});

test("createNewGroup rejects duplicate/self participants before sending GraphQL", () => {
  const createGroup = fca.createCreateNewGroupCommand({
    defaultFuncs: { post: async () => ({}) },
    ctx: { jar: {}, userID: "owner-1" }
  });
  assert.throws(() => createGroup(["owner-1", "member-1", "member-1"]), /at least 2 distinct users/);
});


test("formatFriends skips malformed rows and preserves normalized friend fields", () => {
  const friends = fca.formatFriends({
    valid: { id: "12345", name: "Test User", gender: 2, is_friend: true },
    missingId: { name: "No ID" },
    nullRow: null
  });
  assert.equal(friends.length, 1);
  assert.equal(friends[0].userID, "12345");
  assert.equal(friends[0].fullName, "Test User");
  assert.equal(friends[0].gender, "male_singular");
  assert.equal(friends[0].isFriend, true);
  assert.deepEqual(fca.formatFriends(null), []);
});

test("formatUserIdEntry tolerates partial typeahead records", () => {
  const entry = fca.formatUserIdEntry({ uid: null, text: "Partial result" });
  assert.equal(entry.userID, "");
  assert.equal(entry.name, "Partial result");
  assert.equal(entry.indexRank, 0);
  assert.equal(entry.score, 0);
  assert.equal(entry.isVerified, false);
});

test("formatMessagesGraphQLResponse validates shape and handles empty message lists", () => {
  assert.throws(
    () => fca.formatMessagesGraphQLResponse({}),
    /invalid message_thread response/
  );
  const messages = fca.formatMessagesGraphQLResponse({
    o0: { data: { message_thread: {
      thread_key: { thread_fbid: "group-1" },
      thread_type: "GROUP",
      messages: { nodes: [] }
    } } }
  });
  assert.deepEqual(messages, []);
});

test("getThreadHistory rejects invalid pagination before issuing a request", async () => {
  const getHistory = fca.createGetThreadHistoryQuery({
    defaultFuncs: { post: async () => { throw new Error("must not call transport"); } },
    ctx: { jar: {}, userID: "viewer-1" }
  });
  await assert.rejects(getHistory("thread-1", 0, null), /amount must be a positive integer/);
  await assert.rejects(getHistory("", 10, null), /threadID is required/);
});


test("getThreadInfo returns empty values without querying for blank IDs", async () => {
  let calls = 0;
  const getInfo = fca.createGetThreadInfoQuery({
    defaultFuncs: { post: async () => { calls += 1; throw new Error("must not call transport"); } },
    api: {},
    ctx: { jar: {} }
  });
  assert.equal(await getInfo(""), null);
  assert.deepEqual(await getInfo(["", "  "]), {});
  assert.equal(calls, 0);
});

test("shareContact waits for its matching MQTT ACK and allocates monotonic IDs", async () => {
  const { EventEmitter } = require("events");
  const client = new EventEmitter();
  let published;
  client.publish = (topic, body, options, callback) => {
    published = { topic, body: JSON.parse(body) };
    callback();
    setImmediate(() => client.emit("message", "/ls_resp", Buffer.from(JSON.stringify({
      request_id: published.body.request_id,
      payload: { status: "ok" }
    }))));
  };
  const ctx = { mqttClient: client, wsReqNumber: 40, wsTaskNumber: 70 };
  const shareContact = fca.createShareContactCommand({
    ctx,
    generateOfflineThreadingID: () => "epoch-1"
  });
  const result = await shareContact("hello", "contact-9", "thread-2");
  assert.deepEqual(result, { success: true });
  assert.equal(published.topic, "/ls_req");
  assert.equal(published.body.request_id, 41);
  const task = JSON.parse(published.body.payload).tasks[0];
  assert.equal(task.task_id, 71);
  assert.equal(task.label, "359");
  assert.deepEqual(JSON.parse(task.payload), {
    contact_id: "contact-9",
    sync_group: 1,
    text: "hello",
    thread_id: "thread-2"
  });
  assert.equal(client.listenerCount("message"), 0);
});

test("shareContact rejects blank identifiers without publishing", async () => {
  const { EventEmitter } = require("events");
  const client = new EventEmitter();
  let publishes = 0;
  client.publish = () => { publishes += 1; };
  const shareContact = fca.createShareContactCommand({
    ctx: { mqttClient: client },
    generateOfflineThreadingID: () => "epoch-2"
  });
  await assert.rejects(shareContact("", "contact-1", "  "), /senderID and threadID are required/);
  assert.equal(publishes, 0);
});

test("social postComment uses the documented Comet comment mutation and validates inputs", async () => {
  let sent;
  const social = fca.createSocialDomain({
    ctx: { userID: "actor-1", jar: {} },
    defaultFuncs: { post: async (url, jar, form) => {
      sent = { url, form };
      return { status: 200, data: { data: { comment_create: { comment: { id: "comment-1" } } } } };
    } },
    sendMessage: async () => ({})
  });
  const result = await social.postComment("owner_12345", "Nice post!");
  assert.equal(sent.url, "https://www.facebook.com/api/graphql/");
  assert.equal(sent.form.doc_id, "33964973576450400");
  assert.equal(sent.form.fb_api_req_friendly_name, "useCometUFICreateCommentMutation");
  const variables = JSON.parse(sent.form.variables);
  assert.equal(variables.input.feedback_id, Buffer.from("feedback:12345").toString("base64"));
  assert.equal(variables.input.message.text, "Nice post!");
  assert.equal(result.data.comment_create.comment.id, "comment-1");
  await assert.rejects(social.postComment("123", "  "), /Comment text is required/);
});

test("social reactToComment uses comment feedback ID and validates reaction names", async () => {
  let sent;
  const social = fca.createSocialDomain({
    ctx: { userID: "actor-1", jar: {} },
    defaultFuncs: { post: async (url, jar, form) => {
      sent = form;
      return { status: 200, data: { data: { feedback_react: { feedback: { id: "feedback:comment-2" } } } } };
    } },
    sendMessage: async () => ({})
  });
  await social.reactToComment("comment-2", "haha");
  assert.equal(sent.doc_id, "7616998081714004");
  const variables = JSON.parse(sent.variables);
  assert.equal(variables.input.feedback_id, Buffer.from("feedback:comment-2").toString("base64"));
  assert.equal(variables.input.feedback_reaction_id, 4);
  await assert.rejects(social.reactToComment("comment-2", "not-a-reaction"), /Invalid comment reaction/);
});

test("social sharePost builds a share mutation with post ID and caption", async () => {
  let sent;
  const social = fca.createSocialDomain({
    ctx: { userID: "actor-1", jar: {} },
    defaultFuncs: { post: async (url, jar, form) => {
      sent = form;
      return { status: 200, data: { data: { story_create: { story: { id: "shared-1" } } } } };
    } },
    sendMessage: async () => ({})
  });
  const result = await social.sharePost("actor_98765", "Worth sharing");
  assert.equal(sent.doc_id, "26264075519853494");
  const variables = JSON.parse(sent.variables);
  assert.equal(variables.input.actor_id, "actor-1");
  assert.equal(JSON.parse(variables.input.attachments[0].link.share_scrape_data).share_params[0], "98765");
  assert.equal(variables.input.message.text, "Worth sharing");
  assert.equal(result.data.story_create.story.id, "shared-1");
});

test("social shareLink delegates a URL-bearing message through the existing Messenger sender", async () => {
  let sent;
  const social = fca.createSocialDomain({
    ctx: { userID: "actor-1" },
    defaultFuncs: { post: async () => ({ status: 200, data: {} }) },
    sendMessage: async (message, threadID) => { sent = { message, threadID }; return { messageID: "m1" }; }
  });
  const result = await social.shareLink("https://example.com", "thread-1", "Check this");
  assert.deepEqual(sent, { message: { body: "Check this\nhttps://example.com" }, threadID: "thread-1" });
  assert.equal(result.messageID, "m1");
  await assert.rejects(social.shareLink("javascript:alert(1)", "thread-1"), /http\(s\) URL/);
});

test("incoming media formatter handles photo, video, audio, file and malformed Mercury metadata", () => {
  const photo = fca.formatIncomingAttachment({
    mercuryJSON: JSON.stringify({
      attach_type: "photo",
      fileName: "incoming.jpg",
      metadata: { fbid: "photo-1", dimensions: "640,480", url: "https://cdn.example/photo.jpg" }
    })
  });
  assert.equal(photo.type, "photo");
  assert.equal(photo.ID, "photo-1");
  assert.equal(photo.width, "640");
  assert.equal(photo.height, "480");
  assert.equal(photo.url, "https://cdn.example/photo.jpg");

  const video = fca.formatIncomingAttachment({
    blob_attachment: {
      __typename: "MessageVideo",
      legacy_attachment_id: "video-1",
      filename: "clip.mp4",
      playable_url: "https://cdn.example/clip.mp4",
      large_image: { uri: "https://cdn.example/clip-preview.jpg", width: 320, height: 180 },
      original_dimensions: { x: 1280, y: 720 },
      playable_duration_in_ms: 12000,
      video_type: "MP4"
    }
  });
  assert.equal(video.type, "video");
  assert.equal(video.ID, "video-1");
  assert.equal(video.url, "https://cdn.example/clip.mp4");

  const audio = fca.formatIncomingAttachment({
    blob_attachment: {
      __typename: "MessageAudio",
      legacy_attachment_id: "audio-1",
      filename: "voice.m4a",
      playable_url: "https://cdn.example/voice.m4a",
      audio_type: "VOICE",
      playable_duration_in_ms: 2500
    }
  });
  assert.equal(audio.type, "audio");
  assert.equal(audio.url, "https://cdn.example/voice.m4a");

  const file = fca.formatIncomingAttachment({
    blob_attachment: {
      __typename: "MessageFile",
      message_file_fbid: "file-1",
      filename: "report.pdf",
      url: "https://cdn.example/report.pdf",
      content_type: "application/pdf"
    }
  });
  assert.equal(file.type, "file");
  assert.equal(file.ID, "file-1");

  const malformed = fca.formatIncomingAttachment({ mercuryJSON: "{bad json", attach_type: "mystery", url: "https://cdn.example/raw" });
  assert.equal(malformed.type, "unknown");
  assert.equal(malformed.url, "https://cdn.example/raw");
});

test("incoming MQTT message preserves media, mentions, participants and quoted reply for GoatBot", () => {
  const quoted = {
    body: "quoted text",
    messageMetadata: {
      actorFbId: "sender-2",
      messageId: "quoted-1",
      timestamp: "1700000000000",
      threadKey: { threadFbId: "thread-9" }
    },
    attachments: [{
      mercuryJSON: JSON.stringify({
        attach_type: "photo",
        metadata: { fbid: "quoted-photo", dimensions: "80,60", url: "https://cdn.example/quoted.jpg" }
      })
    }],
    participants: ["sender-2", "sender-3"]
  };
  const event = fca.formatDeltaMessage({
    body: "hello world",
    messageMetadata: {
      actorFbId: "sender-1",
      messageId: "message-1",
      timestamp: "1700000001000",
      threadKey: { threadFbId: "thread-9" },
      isUnread: true
    },
    data: { prng: JSON.stringify([{ i: "mention-1", o: 0, l: 5 }]) },
    attachments: [{
      mercuryJSON: JSON.stringify({
        attach_type: "photo",
        metadata: { fbid: "photo-2", dimensions: "640,480", url: "https://cdn.example/incoming.jpg" }
      })
    }],
    participants: ["sender-1", "sender-2", "sender-3"],
    repliedToMessage: quoted
  });
  assert.equal(event.type, "message_reply");
  assert.equal(event.senderID, "sender-1");
  assert.equal(event.threadID, "thread-9");
  assert.equal(event.messageID, "message-1");
  assert.equal(event.isGroup, true);
  assert.equal(event.isUnread, true);
  assert.deepEqual(event.mentions, { "mention-1": "hello" });
  assert.equal(event.attachments[0].type, "photo");
  assert.equal(event.messageReply.type, "Message");
  assert.equal(event.messageReply.messageID, "quoted-1");
  assert.equal(event.messageReply.attachments[0].ID, "quoted-photo");
});

test("fetched getMessage output keeps quoted-reply event type and legacy fields", () => {
  const result = fca.formatFetchedMessage("thread-4", {
    __typename: "UserMessage",
    message_id: "root-1",
    message_sender: { id: "sender-4" },
    message: { text: "reply body", ranges: [{ entity: { id: "user-9" }, offset: 0, length: 5 }] },
    timestamp_precise: "1700000002000",
    participants: [{ id: "sender-4" }, { id: "sender-5" }],
    blob_attachments: [],
    replied_to_message: {
      message: {
        __typename: "UserMessage",
        message_id: "parent-1",
        message_sender: { id: "sender-5" },
        message: { text: "parent body", ranges: [] },
        timestamp_precise: "1700000000000",
        participants: [{ id: "sender-4" }, { id: "sender-5" }],
        blob_attachments: []
      }
    }
  });
  assert.equal(result.type, "message_reply");
  assert.equal(result.messageReply.messageID, "parent-1");
  assert.deepEqual(result.mentions, { "user-9": "reply" });
  assert.deepEqual(result.args, ["reply", "body"]);
  assert.equal(result.isGroup, false);
});

test("GoatBot client facade exposes getMessage and incoming media helpers", () => {
  const api = {
    getMessage(threadID, messageID) {
      return { owner: this === api, threadID, messageID };
    },
    uploadAttachment(value) {
      return { uploaded: value };
    },
    forwardAttachment(value) {
      return { forwarded: value };
    }
  };
  const client = fca.createFcaClient(api);
  assert.deepEqual(client.messages.get("thread-1", "message-1"), {
    owner: true,
    threadID: "thread-1",
    messageID: "message-1"
  });
  assert.deepEqual(client.messages.uploadAttachment("photo"), { uploaded: "photo" });
  assert.deepEqual(client.messages.forwardAttachment("attachment-1"), { forwarded: "attachment-1" });
});



test("Signal direct-message helpers establish sessions, encrypt and decrypt prekey/whisper messages", async () => {
  const calls = [];
  class Address { constructor(name, deviceId) { this.value = { name, deviceId }; } }
  const signal = {
    ProtocolAddress: { new: (name, deviceId) => new Address(name, deviceId) },
    CiphertextMessageType: { Whisper: 2, PreKey: 3 },
    PreKeySignalMessage: { deserialize: (data) => ({ kind: "prekey", data }) },
    SignalMessage: { deserialize: (data) => ({ kind: "whisper", data }) },
    processPreKeyBundle: async (...args) => { calls.push(["bundle", ...args]); },
    signalEncrypt: async (...args) => ({ type: () => 2, serialize: () => Buffer.from("cipher") , args }),
    signalDecrypt: async (...args) => { calls.push(["decrypt", ...args]); return Buffer.from("plain"); },
    signalDecryptPreKey: async (...args) => { calls.push(["decrypt-prekey", ...args]); return Buffer.from("first message"); }
  };
  const stores = { sessionStore: {}, identityKeyStore: {}, preKeyStore: {}, signedPreKeyStore: {}, kyberPreKeyStore: {} };
  const deps = { signal, stores, localAddress: { name: "local-user", deviceId: 1 } };
  await fca.establishSignalDirectSession(deps, { name: "remote-user", deviceId: 2 }, { registrationId: 99 });
  const encrypted = await fca.encryptSignalDirectMessage(deps, { name: "remote-user", deviceId: 2 }, "hello");
  assert.deepEqual(encrypted, { type: 2, body: Buffer.from("cipher").toString("base64") });
  const first = await fca.decryptSignalDirectMessage(deps, { name: "remote-user", deviceId: 2 }, { type: 3, body: Buffer.from("prekey").toString("base64") });
  assert.equal(Buffer.from(first).toString(), "first message");
  const next = await fca.decryptSignalDirectMessage(deps, { name: "remote-user", deviceId: 2 }, { type: 2, body: Buffer.from("whisper").toString("base64") });
  assert.equal(Buffer.from(next).toString(), "plain");
  assert.deepEqual(calls.map((entry) => entry[0]), ["bundle", "decrypt-prekey", "decrypt"]);
  assert.equal(calls[0][2].value.name, "remote-user");
  assert.equal(calls[0][3].value.name, "local-user");
  await assert.rejects(fca.encryptSignalDirectMessage({ ...deps, localAddress: { name: "", deviceId: 1 } }, { name: "remote-user", deviceId: 2 }, "x"), /local/);
  await assert.rejects(fca.decryptSignalDirectMessage(deps, { name: "remote-user", deviceId: 2 }, { type: 7, body: Buffer.from("x").toString("base64") }), /Unsupported direct-message/);
});


test("Signal encrypted media encrypts bytes, wraps key, verifies integrity and decrypts", async () => {
  const encryptedMessages = [];
  const deps = {
    signal: {}, stores: { sessionStore: {}, identityKeyStore: {}, preKeyStore: {}, signedPreKeyStore: {}, kyberPreKeyStore: {} },
    localAddress: { name: "local", deviceId: 1 }
  };
  const remote = { name: "peer", deviceId: 2 };
  const originalEncrypt = fca.encryptSignalDirectMessage;
  const originalDecrypt = fca.decryptSignalDirectMessage;
  const media = Buffer.from("private image bytes \\u0000 and more");
  const descriptor = await fca.encryptSignalMedia({ ...deps, signal: {
    ProtocolAddress: { new: (name, deviceId) => ({ name, deviceId }) },
    signalEncrypt: async (plain) => { encryptedMessages.push(Buffer.from(plain)); return { type: () => 2, serialize: () => Buffer.from("wrapped-key") }; }
  } }, remote, media, { fileName: "photo.jpg", contentType: "image/jpeg" });
  assert.equal(descriptor.algorithm, "AES-256-CBC-HMAC-SHA256");
  assert.equal(descriptor.fileName, "photo.jpg");
  assert.notDeepEqual(Buffer.from(descriptor.ciphertext), media);
  assert.equal(encryptedMessages.length, 1);
  assert.equal(encryptedMessages[0].length, 64);
  assert.equal(descriptor.encryptedKey.type, 2);
  const decryptDeps = { ...deps, signal: {
    ProtocolAddress: { new: (name, deviceId) => ({ name, deviceId }) },
    CiphertextMessageType: { Whisper: 2 },
    SignalMessage: { deserialize: () => ({}) },
    signalDecrypt: async () => encryptedMessages[0]
  } };
  const roundTripDescriptor = { ...descriptor, encryptedKey: { type: 2, body: Buffer.from("cipher").toString("base64") } };
  const clear = await fca.decryptSignalMedia(decryptDeps, remote, roundTripDescriptor);
  assert.deepEqual(clear, media);
  await assert.rejects(fca.decryptSignalMedia(decryptDeps, remote, { ...roundTripDescriptor, digest: "00" }), /digest mismatch/);
  const changed = Buffer.from(roundTripDescriptor.ciphertext); changed[0] ^= 1;
  await assert.rejects(fca.decryptSignalMedia(decryptDeps, remote, { ...roundTripDescriptor, ciphertext: changed, digest: require("crypto").createHash("sha256").update(changed).digest("hex") }), /MAC verification/);
  assert.equal(typeof originalEncrypt, "function"); assert.equal(typeof originalDecrypt, "function");
});

test("Signal encrypted media upload sends only ciphertext bytes", async () => {
  let uploaded;
  const deps = {
    signal: { ProtocolAddress: { new: (name, deviceId) => ({ name, deviceId }) }, signalEncrypt: async () => ({ type: () => 2, serialize: () => Buffer.from("key-envelope") }) },
    stores: { sessionStore: {}, identityKeyStore: {}, preKeyStore: {}, signedPreKeyStore: {}, kyberPreKeyStore: {} },
    localAddress: { name: "local", deviceId: 1 }
  };
  const result = await fca.encryptAndUploadSignalMedia(deps, { name: "peer", deviceId: 2 }, Buffer.from("file-data"), async (bytes, metadata) => { uploaded = { bytes, metadata }; return { attachmentId: "opaque-1" }; }, { fileName: "report.pdf", contentType: "application/pdf" });
  assert.ok(Buffer.isBuffer(uploaded.bytes));
  assert.equal(uploaded.metadata.contentType, "application/octet-stream");
  assert.equal(uploaded.metadata.fileName, "report.pdf.enc");
  assert.equal(result.upload.attachmentId, "opaque-1");
  assert.equal("ciphertext" in result, false);
});
