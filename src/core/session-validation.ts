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
