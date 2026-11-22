import fs from "node:fs";
import path from "node:path";

export interface SessionGuardOptions {
  interval?: number;
  debounce?: number;
  maxBytes?: number;
  maxCookies?: number;
}

export interface SessionGuardHandle {
  saveNow: () => void;
  stop: () => void;
}

const DEFAULT_INTERVAL = 3 * 60 * 1000;
const DEFAULT_DEBOUNCE = 30 * 1000;
const MAX_APPSTATE_BYTES = 64 * 1024;
const MAX_COOKIES = 500;

function validateSessionSnapshot(raw: unknown, expectedUserId: string, maxBytes: number, maxCookies: number): unknown[] {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > maxCookies) {
    throw new Error("Session snapshot has an invalid cookie count");
  }
  const normalized = raw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Session snapshot contains an invalid cookie");
    }
    const cookie = item as Record<string, unknown>;
    const key = String(cookie.key || cookie.name || "").trim();
    const value = cookie.value;
    const domain = String(cookie.domain || ".facebook.com").toLowerCase().replace(/^\./, "");
    if (!key || typeof value !== "string" || !domain.endsWith("facebook.com") ||
      (domain !== "facebook.com" && !domain.endsWith(".facebook.com"))) {
      throw new Error("Session snapshot contains an invalid Facebook cookie");
    }
    if (value.length > 16_384) throw new Error("Session cookie value is too large");
    const { name, ...rest } = cookie;
    return { ...rest, key };
  });
  const cookies = new Map(normalized.map((item) => {
    const cookie = item as Record<string, unknown>;
    return [String(cookie.key), String(cookie.value)] as const;
  }));
  if (cookies.get("c_user") !== expectedUserId || !cookies.get("xs")) {
    throw new Error("Session snapshot account identity does not match the active account");
  }
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > maxBytes) {
    throw new Error("Session snapshot exceeds the configured size limit");
  }
  return normalized;
}

function writeAtomic(filePath: string, data: string): void {
  const target = path.resolve(filePath);
  const directory = path.dirname(target);
  const temporary = path.join(directory, ".omega-session-" + process.pid + "-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".tmp");
  let fd: number | undefined;
  try {
    fs.mkdirSync(directory, { recursive: true });
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, data, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, target);
    try { fs.chmodSync(target, 0o600); } catch { }
  } catch (error) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { }
    try { fs.unlinkSync(temporary); } catch { }
    throw error;
  }
}

export function createSessionGuard(
  filePath: string,
  expectedUserId: string,
  getAppState: () => unknown,
  logger: (message: string, type?: string) => void = () => {},
  options: SessionGuardOptions = {}
): SessionGuardHandle {
  if (typeof filePath !== "string" || !filePath.trim()) throw new Error("Session guard requires an account file path");
  if (!/^\d{1,30}$/.test(String(expectedUserId || ""))) throw new Error("Session guard requires a valid account ID");

  const intervalMs = Math.max(1_000, Number(options.interval) || DEFAULT_INTERVAL);
  const debounceMs = Math.max(0, Number(options.debounce ?? DEFAULT_DEBOUNCE));
  const maxBytes = Math.max(1_024, Number(options.maxBytes) || MAX_APPSTATE_BYTES);
  const maxCookies = Math.max(2, Math.min(2_000, Number(options.maxCookies) || MAX_COOKIES));
  let stopped = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const saveNow = () => {
    if (stopped) return;
    try {
      const state = validateSessionSnapshot(getAppState(), String(expectedUserId), maxBytes, maxCookies);
      writeAtomic(filePath, JSON.stringify(state));
      logger("SESSION GUARD: account session snapshot saved", "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger("SESSION GUARD: snapshot not saved (" + message + ")", "warn");
    }
  };

  const intervalTimer = setInterval(saveNow, intervalMs);
  if (typeof intervalTimer.unref === "function") intervalTimer.unref();

  if (debounceMs === 0) saveNow();
  else {
    debounceTimer = setTimeout(saveNow, debounceMs);
    if (typeof debounceTimer.unref === "function") debounceTimer.unref();
  }

  return {
    saveNow,
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(intervalTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
    }
  };
}

export default createSessionGuard;
