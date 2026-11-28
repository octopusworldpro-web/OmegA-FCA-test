import type { RealtimeMiddlewareSystem } from "../realtime/middleware";

export interface HumanizerOptions {
  enabled?: boolean;
  reactDelayMs?: number | [number, number];
  cooldownMs?: number;
  maxPerMinute?: number;
  perThread?: boolean;
  /** Prefixes that identify commands, e.g. ["!", "/"]. Empty means metadata-only detection. */
  commandPrefixes?: string[];
  /** Registered command names and aliases, compared case-insensitively. */
  commandNames?: string[];
  /** Permit bare commands only for configured admin sender IDs. */
  noPrefixEnabled?: boolean;
  noPrefixAdminIds?: string[];
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
  perThread: true,
  commandPrefixes: [],
  commandNames: [],
  noPrefixEnabled: false,
  noPrefixAdminIds: []
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

function normalizeStringList(value: unknown, lowercase = false): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => (lowercase ? item.trim().toLowerCase() : item.trim()))
    .filter(Boolean))];
}

/** Prefer parser metadata; otherwise match registered names and safe no-prefix rules. */
function isCommandEvent(event: Loose, config: Required<HumanizerOptions>): boolean {
  if (event.isCommand === true || event.command === true || event.commandName != null) return true;
  const body = typeof event.body === "string" ? event.body.trimStart() : "";
  if (!body) return false;

  const matchesName = (text: string) => {
    const token = text.trim().split(/\s+/, 1)[0]?.toLowerCase() || "";
    return !!token && (config.commandNames.length === 0 || config.commandNames.includes(token));
  };

  for (const prefix of config.commandPrefixes) {
    if (body.startsWith(prefix) && matchesName(body.slice(prefix.length))) return true;
  }

  if (config.noPrefixEnabled && config.commandNames.length > 0) {
    const senderID = event.userID ?? event.senderID ?? event.author;
    if (senderID != null && config.noPrefixAdminIds.includes(String(senderID))) {
      const token = body.split(/\s+/, 1)[0]?.toLowerCase() || "";
      return config.commandNames.includes(token);
    }
  }
  return false;
}

export function createHumanizerController(
  middleware: RealtimeMiddlewareSystem,
  sendTypingIndicator?: (threadID: string, isTyping: boolean, options?: Loose) => Loose
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
      if (
        !options.enabled ||
        !event ||
        !["message", "message_reply"].includes(String(event.type)) ||
        !isCommandEvent(event, options)
      ) {
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
        // Both values are supplied by the caller (GoatBot config): delay is the
        // reaction wait, while cooldown is the minimum per-thread spacing.
        // Defaults apply only when the caller omits an option.
        const wait = Math.max(delay, cooldownRemaining);
        const threadID = event.threadID ?? event.threadId;
        if (wait > 0 && threadID != null && typeof sendTypingIndicator === "function") {
          try {
            void Promise.resolve(sendTypingIndicator(String(threadID), true, { duration: wait, autoStop: true })).catch(() => {});
          } catch { /* Typing is optional; never block message delivery on it. */ }
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
            resume();
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
        perThread: merged.perThread !== false,
        commandPrefixes: normalizeStringList(merged.commandPrefixes),
        commandNames: normalizeStringList(merged.commandNames, true),
        noPrefixEnabled: merged.noPrefixEnabled === true,
        noPrefixAdminIds: normalizeStringList(merged.noPrefixAdminIds)
      };
      if (options.enabled) install();
      else releasePending();
      return { ...options, commandPrefixes: [...options.commandPrefixes], commandNames: [...options.commandNames], noPrefixAdminIds: [...options.noPrefixAdminIds] };
    },
    getOptions() { return { ...options, commandPrefixes: [...options.commandPrefixes], commandNames: [...options.commandNames], noPrefixAdminIds: [...options.noPrefixAdminIds] }; },
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
