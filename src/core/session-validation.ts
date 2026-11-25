function readCookieUID(input: unknown): string | null {
  if (!input) return null;
  if (typeof input === "string") {
    const raw = input.replace(/^cookie\s*:/i, "");
    for (const part of raw.split(/[;\r\n]+/)) {
      const eq = part.indexOf("=");
      if (eq > 0 && part.slice(0, eq).trim().toLowerCase() === "c_user") {
        return part.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
      }
    }
    return null;
  }
  if (Array.isArray(input)) {
    for (const entry of input) {
      if (typeof entry === "string") {
        const found = readCookieUID(entry);
        if (found) return found;
      } else if (entry && typeof entry === "object") {
        const item = entry as Record<string, unknown>;
        if (String(item.key || item.name || "").toLowerCase() === "c_user" && item.value != null) {
          return String(item.value).trim();
        }
      }
    }
    return null;
  }
  if (typeof input === "object") {
    const item = input as Record<string, unknown>;
    const nested = item.Cookie ?? item.cookie ?? item.cookies;
    if (nested !== undefined) return readCookieUID(nested);
    if (String(item.key || item.name || "").toLowerCase() === "c_user" && item.value != null) {
      return String(item.value).trim();
    }
    for (const [key, value] of Object.entries(item)) {
      if (key.toLowerCase() === "c_user" && value != null) return String(value).trim();
    }
  }
  return null;
}

export function extractExpectedSessionUserId(appState: unknown, cookieInput?: unknown): string | null {
  const expected = readCookieUID(appState) || readCookieUID(cookieInput);
  if (!expected) return null;
  if (!/^\d{1,30}$/.test(expected) || /^0+$/.test(expected)) {
    throw new Error("Invalid session identity: c_user must be a positive numeric Facebook account ID");
  }
  return expected;
}

export function assertSessionIdentity(expectedUserId: string | null, authenticatedUserId: unknown): void {
  if (!expectedUserId) return;
  const actual = String(authenticatedUserId ?? "").trim();
  if (!/^\d{1,30}$/.test(actual) || /^0+$/.test(actual)) {
    throw new Error("Session identity validation failed: Facebook did not confirm a valid account UID for the supplied c_user");
  }
  if (actual !== expectedUserId) {
    throw new Error(`Session identity mismatch: supplied c_user belongs to account ${expectedUserId}, but Facebook authenticated account ${actual}. Login rejected.`);
  }
}

/** Return true only for a positive numeric Facebook account UID. */
export function isValidSessionUserId(value: unknown): boolean {
  const userId = String(value ?? "").trim();
  return /^\d{1,30}$/.test(userId) && !/^0+$/.test(userId);
}

function cookieEntries(input: unknown): Array<{ name: string; value: string; expires?: unknown; expirationDate?: unknown }> {
  if (!input) return [];
  if (typeof input === "string") {
    const raw = input.replace(/^cookie\s*:/i, "");
    return raw.split(/[;\r\n]+/).flatMap((part) => {
      const eq = part.indexOf("=");
      return eq > 0 ? [{ name: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1") }] : [];
    });
  }
  if (Array.isArray(input)) return input.flatMap((entry) => {
    if (typeof entry === "string") return cookieEntries(entry);
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const name = String(item.key || item.name || "");
    if (!name || item.value == null) return [];
    return [{ name, value: String(item.value), expires: item.expires, expirationDate: item.expirationDate }];
  });
  if (typeof input === "object") {
    const item = input as Record<string, unknown>;
    const nested = item.Cookie ?? item.cookie ?? item.cookies;
    if (nested !== undefined) return cookieEntries(nested);
    if (item.key || item.name) return cookieEntries([item]);
    return Object.entries(item).map(([name, value]) => ({ name, value: String(value ?? "") }));
  }
  return [];
}

/** Validate the minimum identity/session cookies before attempting network login. */
export function validateSessionCookieInput(input: unknown): void {
  const entries = cookieEntries(input);
  if (!entries.length) throw new Error("Invalid login input: no usable cookies were provided");
  const byName = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));
  const uid = byName.get("c_user");
  if (!uid || !/^\d{1,30}$/.test(uid.value) || /^0+$/.test(uid.value)) {
    throw new Error("Invalid login input: missing or invalid c_user cookie");
  }
  const session = byName.get("xs");
  if (!session || !session.value.trim()) {
    throw new Error("Invalid login input: missing or empty xs session cookie");
  }
  for (const entry of [uid, session]) {
    const rawExpiry = entry.expirationDate ?? entry.expires;
    if (rawExpiry === undefined || rawExpiry === null || rawExpiry === "Infinity") continue;
    const numeric = typeof rawExpiry === "number" ? rawExpiry : Number.NaN;
    const expiry = Number.isFinite(numeric)
      ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
      : new Date(String(rawExpiry));
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() <= Date.now()) {
      throw new Error(`Invalid login input: ${entry.name.toLowerCase()} cookie has expired`);
    }
  }
}
