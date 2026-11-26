export interface BroadcastOptions {
  /** Minimum delay between starting sends, in milliseconds. Defaults to 2000. */
  delay?: number;
  /** Maximum number of concurrent sends. Defaults to 1. */
  parallel?: number;
  onEach?: (error: Error | null, info: Loose, threadID: string) => void;
}

export interface BroadcastResult {
  sent: Array<{ threadID: string; info: Loose }>;
  failed: Array<{ threadID: string; error: Error }>;
  total: number;
}

/** Send one message to multiple threads without changing the legacy sendMessage signature. */
export function createSendBroadcast(sendMessage: (...args: Loose[]) => Promise<Loose> | Loose) {
  return async function sendBroadcast(
    message: Loose,
    threadIDs: string[],
    options: BroadcastOptions = {}
  ): Promise<BroadcastResult> {
    if (!Array.isArray(threadIDs) || threadIDs.some((id) => typeof id !== "string" || !id.trim())) {
      throw new TypeError("threadIDs must be an array of non-empty thread ID strings");
    }
    const ids = [...new Set(threadIDs.map((id) => id.trim()))];
    const delay = options.delay === undefined ? 2000 : Number(options.delay);
    const parallel = options.parallel === undefined ? 1 : Number(options.parallel);
    if (!Number.isFinite(delay) || delay < 0) throw new RangeError("delay must be a non-negative number");
    if (!Number.isInteger(parallel) || parallel < 1 || parallel > 20) {
      throw new RangeError("parallel must be an integer between 1 and 20");
    }

    const result: BroadcastResult = { sent: [], failed: [], total: ids.length };
    let next = 0;
    let lastStarted = 0;
    const worker = async () => {
      while (true) {
        const index = next++;
        if (index >= ids.length) return;
        const threadID = ids[index];
        const wait = Math.max(0, delay - (Date.now() - lastStarted));
        if (lastStarted && wait) await new Promise((resolve) => setTimeout(resolve, wait));
        lastStarted = Date.now();
        try {
          const info = await sendMessage(message, threadID);
          result.sent.push({ threadID, info });
          try { options.onEach?.(null, info, threadID); } catch { }
        } catch (value) {
          const error = value instanceof Error ? value : new Error(String(value));
          result.failed.push({ threadID, error });
          try { options.onEach?.(error, null, threadID); } catch { }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(parallel, ids.length) }, worker));
    return result;
  };
}
