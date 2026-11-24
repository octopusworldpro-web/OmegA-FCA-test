export interface OutgoingActionLimiterOptions {
  /** Minimum spacing between actions sent to the same thread. */
  perThreadCooldownMs?: number;
  /** Minimum spacing between all outgoing actions from this client. */
  globalCooldownMs?: number;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

type Action = () => unknown;

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Small FIFO limiter for outgoing mutations. It is intentionally opt-in at the
 * domain boundary: incoming events and read-only queries are never throttled.
 */
export function createOutgoingActionLimiter(options: OutgoingActionLimiterOptions = {}) {
  const perThreadCooldownMs = Math.max(0, options.perThreadCooldownMs ?? 400);
  const globalCooldownMs = Math.max(0, options.globalCooldownMs ?? 150);
  const now = options.now ?? Date.now;
  const wait = options.wait ?? defaultWait;
  const threadTails = new Map<string, Promise<unknown>>();
  let globalTail: Promise<unknown> = Promise.resolve();
  let lastGlobalRun = 0;
  const lastThreadRun = new Map<string, number>();

  function schedule<T>(threadID: unknown, action: Action): Promise<T> {
    const key = threadID == null || threadID === "" ? "__global__" : String(threadID);
    const previousThread = threadTails.get(key) ?? Promise.resolve();
    const run = Promise.all([previousThread.catch(() => undefined), globalTail.catch(() => undefined)])
      .then(async () => {
        const current = now();
        const threadDelay = Math.max(0, perThreadCooldownMs - (current - (lastThreadRun.get(key) ?? 0)));
        const globalDelay = Math.max(0, globalCooldownMs - (current - lastGlobalRun));
        const delay = Math.max(threadDelay, globalDelay);
        if (delay > 0) await wait(delay);
        const startedAt = now();
        lastThreadRun.set(key, startedAt);
        lastGlobalRun = startedAt;
        return await action() as T;
      });

    threadTails.set(key, run);
    globalTail = run.then(() => undefined, () => undefined);
    void run.finally(() => {
      if (threadTails.get(key) === run) threadTails.delete(key);
    }).catch(() => undefined);
    return run as Promise<T>;
  }

  function wrap<T extends (...args: any[]) => any>(fn: T, getThreadID: (...args: Parameters<T>) => unknown = (args) => args[1]): T {
    return ((...args: Parameters<T>) => schedule(getThreadID(...args), () => fn(...args))) as T;
  }

  return { schedule, wrap };
}
