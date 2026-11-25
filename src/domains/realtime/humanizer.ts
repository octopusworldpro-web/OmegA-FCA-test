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
  enabled: false,
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
  return clamp(value, 3000, 60000);
}

export function createHumanizerController(
  middleware: RealtimeMiddlewareSystem,
  sendTypingIndicator?: (threadID: string, isTyping: boolean, options?: Loose) => Loose,
  onTypingError?: (error: Loose) => void
): HumanizerController {
  let options: Required<HumanizerOptions> = { ...DEFAULTS };
  const lastRun = new Map<string, number>();
  const minuteBuckets = new Map<string, number[]>();
  const queues = new Map<string, Promise<void>>();
  const pending = new Map<ReturnType<typeof setTimeout>, () => void>();
  const activeCallbacks = new Set<() => void>();
  let middlewareInstalled = false;
  let generation = 0;

  function getKey(event: Loose) {
    const thread = event && (event.threadID ?? event.threadId);
    return options.perThread && thread != null ? String(thread) : "__global__";
  }

  function releasePending() {
    for (const timer of pending.keys()) clearTimeout(timer);
    pending.clear();
    for (const resume of [...activeCallbacks]) resume();
  }

  function install() {
    if (middlewareInstalled) return;
    middleware.use("omega-humanizer", (event, next) => {
      let continued = false;
      const resume = () => {
        if (continued) return;
        continued = true;
        activeCallbacks.delete(resume);
        next();
      };
      if (!options.enabled || !event || !["message", "message_reply"].includes(String(event.type))) {
        resume();
        return;
      }
      activeCallbacks.add(resume);

      const key = getKey(event);
      const now = Date.now();
      const recent = (minuteBuckets.get(key) || []).filter((stamp) => now - stamp < 60000);
      if (options.maxPerMinute > 0 && recent.length >= options.maxPerMinute) {
        minuteBuckets.set(key, recent);
        resume();
        return;
      }
      recent.push(now);
      minuteBuckets.set(key, recent);

      const delayRange = options.reactDelayMs;
      const delay = Array.isArray(delayRange)
        ? Math.round(delayRange[0] + Math.random() * (delayRange[1] - delayRange[0]))
        : delayRange;
      const scheduledGeneration = generation;
      const previous = queues.get(key) || Promise.resolve();
      const operation = previous.catch(() => undefined).then(async () => {
        if (scheduledGeneration !== generation || !options.enabled) {
          resume();
          return;
        }
        const cooldownRemaining = Math.max(0, options.cooldownMs - (Date.now() - (lastRun.get(key) || 0)));
        const wait = Math.max(delay, cooldownRemaining);
        const threadID = event.threadID ?? event.threadId;
        if (wait > 0 && threadID != null && typeof sendTypingIndicator === "function") {
          try {
            void Promise.resolve(sendTypingIndicator(String(threadID), true, { duration: wait, autoStop: true })).catch((error: Loose) => {
              onTypingError?.(error);
            });
          } catch (error) {
            onTypingError?.(error);
          }
        }
        if (wait <= 0) {
          lastRun.set(key, Date.now());
          resume();
          return;
        }
        await new Promise<void>((resolve) => {
          let completed = false;
          const finish = () => {
            if (completed) return;
            completed = true;
            pending.delete(timer);
            lastRun.set(key, Date.now());
            next();
            resolve();
          };
          const timer = setTimeout(finish, wait);
          pending.set(timer, finish);
        });
      });
      queues.set(key, operation);
      void operation.finally(() => {
        if (queues.get(key) === operation) queues.delete(key);
      }).catch(() => undefined);
    });
    middlewareInstalled = true;
  }

  return {
    get enabled() { return options.enabled; },
    set enabled(value: boolean) {
      options.enabled = Boolean(value);
      if (!options.enabled) releasePending();
    },
    setOptions(next: HumanizerOptions = {}) {
      const merged = { ...options, ...next };
      options = {
        enabled: merged.enabled !== false,
        reactDelayMs: normalizeDelay(merged.reactDelayMs),
        cooldownMs: clamp(merged.cooldownMs, DEFAULTS.cooldownMs, 600000),
        maxPerMinute: clamp(merged.maxPerMinute, DEFAULTS.maxPerMinute, 1000),
        perThread: merged.perThread !== false
      };
      if (options.enabled) install();
      else releasePending();
      return { ...options };
    },
    getOptions() { return { ...options }; },
    reset() {
      generation++;
      lastRun.clear();
      minuteBuckets.clear();
      releasePending();
      queues.clear();
    }
  };
}

export default createHumanizerController;
