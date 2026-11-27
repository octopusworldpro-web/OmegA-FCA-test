export interface MqttReconnectDelayOptions {
  attempt: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  jitterMs?: number;
  random?: number;
}

/** Exponential reconnect backoff with bounded jitter. Attempt numbers start at one. */
export function getMqttReconnectDelay(options: MqttReconnectDelayOptions): number {
  const attempt = Math.max(1, Math.floor(Number(options.attempt) || 1));
  const base = Math.max(1, Math.floor(Number(options.baseDelayMs) || 1));
  const max = Math.max(base, Math.floor(Number(options.maxDelayMs) || 30000));
  const jitter = Math.max(0, Math.floor(Number(options.jitterMs) || 0));
  const random = Math.min(0.999999, Math.max(0, Number(options.random) || 0));
  const exponential = Math.min(max, base * Math.pow(2, Math.min(attempt - 1, 30)));
  return Math.min(max, exponential + Math.floor(random * (jitter + 1)));
}

/** Decode an MQTT JSON payload without allowing malformed frames to escape the handler. */
export function parseMqttJsonPayload(payload: unknown): Record<string, Loose> | null {
  try {
    const text = Buffer.isBuffer(payload) ? payload.toString("utf8") : payload;
    const value = typeof text === "string" ? JSON.parse(text) : text;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, Loose>
      : null;
  } catch {
    return null;
  }
}
