interface CookieJarLike {
  setCookieSync?: (cookie: string, url: string) => void;
  getCookiesSync?: (url: string) => Loose[];
}

interface AppStateCookie {
  key: string;
  value: string;
  domain: string;
  path: string;
  hostOnly: boolean;
  creation: Date;
  lastAccessed: Date;
  secure: boolean;
  httpOnly: boolean;
  expires: Date | "Infinity";
}

function saveCookies(jar: CookieJarLike) {
  return (res: Loose) => {
    const rawSetCookie = res?.headers?.["set-cookie"] ?? res?.headers?.["Set-Cookie"];
    if (!rawSetCookie || !jar || typeof jar.setCookieSync !== "function") return res;
    let responseUrl = res?.request?.res?.responseUrl || res?.request?.responseURL;
    try {
      if (!responseUrl) {
        const requestUrl = res?.config?.url;
        const baseUrl = res?.config?.baseURL;
        responseUrl = requestUrl ? new URL(requestUrl, baseUrl || "https://www.facebook.com/").toString() : "https://www.facebook.com/";
      }
      const parsed = new URL(String(responseUrl));
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return res;
      const cookies = Array.isArray(rawSetCookie) ? rawSetCookie : [rawSetCookie];
      for (const cookie of cookies) {
        if (typeof cookie !== "string" || !cookie.trim()) continue;
        try { jar.setCookieSync(cookie, parsed.toString()); } catch { /* ignore malformed cookie */ }
      }
    } catch { /* cookie persistence must not mask the HTTP response */ }
    return res;
  };
}

function getAppState(jar: CookieJarLike): AppStateCookie[] {
  if (!jar || typeof jar.getCookiesSync !== "function") return [];

  const urls = ["https://www.facebook.com/", "https://m.facebook.com/", "https://mbasic.facebook.com/", "https://web.facebook.com/", "https://touch.facebook.com/"];
  const all = urls.flatMap((u) => {
    try {
      return jar.getCookiesSync?.(u) || [];
    } catch {
      return [];
    }
  });

  const seen = new Set<string>();
  const out: AppStateCookie[] = [];

  for (const c of all) {
    const key = c.key || c.name;
    if (typeof key !== "string" || !key || typeof c.value !== "string") continue;

    const id = key + "|" + (c.domain || "") + "|" + (c.path || "/");
    if (seen.has(id)) continue;
    seen.add(id);

    out.push({
      key,
      value: c.value,
      domain: c.domain || ".facebook.com",
      path: c.path || "/",
      hostOnly: Boolean(c.hostOnly),
      creation: c.creation || new Date(),
      lastAccessed: c.lastAccessed || new Date(),
      secure: Boolean(c.secure),
      httpOnly: Boolean(c.httpOnly),
      expires: c.expires && c.expires !== "Infinity" ? c.expires : "Infinity"
    });
  }

  return out;
}

export { saveCookies, getAppState };
export type { CookieJarLike, AppStateCookie };


