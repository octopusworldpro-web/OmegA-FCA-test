import { delay } from "./client";

interface RetryContext {
  _emitter?: {
    emit: (event: string, payload?: Loose) => void;
  };
}

interface RetryError extends Error {
  response?: Loose;
  statusCode?: number;
  config?: {
    url?: string;
    method?: string;
  };
  code?: string;
  error?: string;
  originalError?: Loose;
}

const MAX_RATE_LIMIT_COOLDOWN = 5 * 60 * 1000;

function getHeader(headers: Loose, name: string): string {
  if (!headers || typeof headers !== "object") return "";
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  if (!key) return "";
  const value = headers[key];
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

/**
 * Prefer Facebook/API-provided retry timing. Fall back to a short,
 * bounded exponential cooldown when the response has no usable hint.
 */
function getRateLimitCooldown(headers: Loose, attempt: number, baseDelay: number): number {
  const retryAfter = getHeader(headers, "retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const retryAt = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(retryAt) && retryAt > 0) {
      return Math.min(Math.max(1000, retryAt), MAX_RATE_LIMIT_COOLDOWN);
    }
  }

  const reset = getHeader(headers, "x-ratelimit-reset") || getHeader(headers, "x-rate-limit-reset");
  if (reset) {
    const resetValue = Number(reset);
    const resetAt = Number.isFinite(resetValue)
      ? (resetValue > 1e12 ? resetValue : resetValue * 1000) - Date.now()
      : 0;
    if (resetAt > 0) {
      return Math.min(Math.max(1000, resetAt), MAX_RATE_LIMIT_COOLDOWN);
    }
  }

  // Facebook Business Use Case headers report recovery time in minutes.
  const businessUsage = getHeader(headers, "x-business-use-case-usage");
  if (businessUsage) {
    try {
      const usage = JSON.parse(businessUsage) as Loose;
      const entries = Object.values(usage || {}).flat() as Loose[];
      const recoveryMinutes = entries.reduce((max, item) => {
        const value = Number(item && item.estimated_time_to_regain_access);
        return Number.isFinite(value) ? Math.max(max, value) : max;
      }, 0);
      if (recoveryMinutes > 0) {
        return Math.min(Math.max(1000, recoveryMinutes * 60 * 1000), MAX_RATE_LIMIT_COOLDOWN);
      }
    } catch {
      // Ignore malformed usage headers and use the bounded fallback.
    }
  }

  const fallback = baseDelay * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(Math.max(1000, fallback + Math.floor(Math.random() * 200)), 30000);
}

const TEMPORARY_NETWORK_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "ETIMEDOUT",
  "ECONNABORTED",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "ERR_NETWORK"
]);

function isTemporaryNetworkError(error: RetryError): boolean {
  const code = String(error && error.code ? error.code : "").toUpperCase();
  if (TEMPORARY_NETWORK_CODES.has(code)) return true;

  const message = String(error && error.message ? error.message : "");
  return /timeout|timed out|connection reset|socket hang up|network error|fetch failed|temporary failure in name resolution/i.test(message);
}

function getNetworkRetryDelay(attempt: number, baseDelay: number): number {
  const exponential = Math.max(0, baseDelay) * Math.pow(2, Math.max(0, attempt - 1));
  // Equal jitter avoids synchronized retry bursts while keeping a predictable upper bound.
  const bounded = Math.min(exponential, 30000);
  const jitter = Math.floor(Math.random() * Math.max(1, bounded * 0.5));
  return Math.min(Math.max(250, Math.floor(bounded * 0.5) + jitter), 30000);
}

async function requestWithRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelay = 1000,
  ctx?: RetryContext
): Promise<T> {
  let lastError: Loose;

  const emit = (event: string, payload: Loose) => {
    try {
      if (ctx && ctx._emitter && typeof ctx._emitter.emit === "function") {
        ctx._emitter.emit(event, payload);
      }
    } catch {
      // ignore emitter errors
    }
  };

  for (let i = 0; i < retries; i++) {
    try {
      // Normal successful requests pass through immediately: no cooldown, retry, or safety event.
      const result = await fn();
      const response = result as Loose;
      const responseStatus = Number(response && response.status);

      // Axios is configured to resolve HTTP 4xx/5xx responses, so handle 429 here.
      if (responseStatus === 429) {
        const cooldownMs = getRateLimitCooldown(response.headers, i + 1, baseDelay);
        emit("rateLimit", {
          status: responseStatus,
          url: response.config && response.config.url ? response.config.url : "",
          method: String((response.config && response.config.method) || "").toUpperCase(),
          cooldownMs,
          retryAttempt: i + 1
        });
        if (i === retries - 1) return result;
        await delay(cooldownMs);
        continue;
      }

      return result;
    } catch (rawError) {
      const e = rawError as RetryError;
      lastError = e;

      if (e?.code === "ERR_INVALID_CHAR" || (e?.message && e.message.includes("Invalid character in header"))) {
        const err = new Error(
          "Invalid header content detected. Request aborted to prevent crash."
        ) as RetryError;
        err.error = "Invalid header content";
        err.originalError = e;
        err.code = "ERR_INVALID_CHAR";
        return Promise.reject(err);
      }

      const status =
        ((e as { response?: { status?: number } })?.response?.status as number | undefined) ||
        e?.statusCode ||
        0;
      const url = e?.config?.url || "";
      const method = String(e?.config?.method || "").toUpperCase();

      if (status === 429) {
        const response = e.response as Loose;
        const cooldownMs = getRateLimitCooldown(response && response.headers, i + 1, baseDelay);
        emit("rateLimit", { status, url, method, cooldownMs, retryAttempt: i + 1 });
        if (i === retries - 1) {
          return (e.response as T) || Promise.reject(e);
        }
        await delay(cooldownMs);
        continue;
      }

      if (status >= 400 && status < 500) {
        return (e.response as T) || Promise.reject(e);
      }

      const netCode = e?.code || "";
      const msg = e && e.message ? e.message : String(e || "");
      const temporaryNetworkError = !status && isTemporaryNetworkError(e);

      if (temporaryNetworkError) {
        const retryDelay = getNetworkRetryDelay(i + 1, baseDelay);
        emit("networkError", {
          code: netCode,
          message: msg,
          url,
          method,
          retryAttempt: i + 1,
          willRetry: i < retries - 1,
          retryDelayMs: i < retries - 1 ? retryDelay : 0
        });

        if (i === retries - 1) {
          return (e.response as T) || Promise.reject(e);
        }

        await delay(retryDelay);
        continue;
      }

      if (i === retries - 1) {
        return (e.response as T) || Promise.reject(e);
      }

      // Keep the existing fallback retry behavior for non-network server errors.
      const backoffDelay = Math.min(baseDelay * Math.pow(2, i) + Math.floor(Math.random() * 200), 30000);
      await delay(backoffDelay);
    }
  }

  const finalError = (lastError as Error) || new Error("Request failed after retries");
  return Promise.reject(finalError);
}

export { requestWithRetry };
