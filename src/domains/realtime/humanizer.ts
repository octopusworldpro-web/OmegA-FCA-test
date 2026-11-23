import type { RealtimeMiddlewareSystem } from "../realtime/middleware";

export interface HumanizerOptions {
  enabled?: boolean;
  reactDelayMs?: number | [number, number];
  cooldownMs?: number;
  maxPerMinute?: number;
  perThread?: boolean;
}

export interface HumanizerController {
  enabled: boolean;
  setOptions(options?: HumanizerOptions): HumanizerOptions;
  getOptions(): HumanizerOptions;
  reset(): void;
}

const DEFAULTS: Required<HumanizerOptions> = {
  enabled: true,
  reactDelayMs: 3000,
  cooldownMs: 5500,
  maxPerMinute: 20,
  perThread: true
};

function clamp(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(0, Math.round(parsed))) : fallback;
}

function normalizeDelay(value: HumanizerOptions["reactDelayMs"]): number | [number, number] {
  if (Array.isArray(value)) {
    const first = clamp(value[0], 0, 60000);
    const second = clamp(value[1], first, 60000);
    return [Math.min(first, second), Math.max(first, second)];
  }
  return clamp(value, DEFAULTS.reactDelayMs, 60000);
}

export function createHumanizerController(
  middleware: RealtimeMiddlewareSystem,
  sendTypingIndicator?: (threadID: string, isTyping: boolean, options?: Loose) => Loose
): HumanizerController {
  let options: Required<HumanizerOptions> = { ...DEFAULTS };
  const lastRun = new Map<string, number>();
  const minuteBuckets = new Map<string, number[]>();
  let middlewareInstalled = false;

  function getKey(event: Loose) {
    const thread = event && (event.threadID ?? event.threadId);
    return options.perThread && thread != null ? String(thread) : "__global__";
  }

  function install() {
    if (middlewareInstalled) return;
    middleware.use("omega-humanizer", (event, next) => {
      if (!options.enabled || !event || !["message", "message_reply"].includes(String(event.type))) {
        next();
        return;
      }
      const key = getKey(event);
      const now = Date.now();
      const recent = (minuteBuckets.get(key) || []).filter((stamp) => now - stamp < 60000);
      if (options.maxPerMinute > 0 && recent.length >= options.maxPerMinute) {
        minuteBuckets.set(key, recent);
        next();
        return;
      }
      recent.push(now);
      minuteBuckets.set(key, recent);

      const cooldownRemaining = Math.max(0, options.cooldownMs - (now - (lastRun.get(key) || 0)));
      const delayRange = options.reactDelayMs;
      const delay = Array.isArray(delayRange)
        ? Math.round(delayRange[0] + Math.random() * (delayRange[1] - delayRange[0]))
        : delayRange;
      const wait = Math.max(delay, cooldownRemaining);
      lastRun.set(key, now);

      const threadID = event.threadID ?? event.threadId;
      if (wait > 0 && threadID != null && typeof sendTypingIndicator === "function") {
        try { void Promise.resolve(sendTypingIndicator(String(threadID), true, { duration: wait, autoStop: true })).catch(() => {}); } catch {}
      }
      if (wait <= 0) {
        next();
        return;
      }
      setTimeout(() => next(), wait);
    });
    middlewareInstalled = true;
  }

  return {
    get enabled() { return options.enabled; },
    set enabled(value: boolean) { options.enabled = Boolean(value); },
    setOptions(next: HumanizerOptions = {}) {
      const merged = { ...options, ...next };
      options = {
        enabled: merged.enabled !== false,
        reactDelayMs: normalizeDelay(merged.reactDelayMs),
        cooldownMs: clamp(merged.cooldownMs, DEFAULTS.cooldownMs, 600000),
        maxPerMinute: clamp(merged.maxPerMinute, DEFAULTS.maxPerMinute, 1000),
        perThread: merged.perThread !== false
      };
      return { ...options };
    },
    getOptions() { return { ...options }; },
    reset() {
      lastRun.clear();
      minuteBuckets.clear();
    }
  };
}

export default createHumanizerController;
