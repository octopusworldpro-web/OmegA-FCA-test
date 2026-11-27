import type { SchedulerDomain, SchedulerOptions, ScheduledMessageInfo } from "../../types/scheduler";

interface ScheduledMessageInternal extends ScheduledMessageInfo {
  timeout: ReturnType<typeof setTimeout>;
  cancelled: boolean;
}

export interface SchedulerDomainDeps {
  sendMessage: (...args: Loose[]) => Promise<Loose> | Loose;
  logger?: (message: string, level?: string) => void;
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

const MAX_TIMER_DELAY = 2_147_483_647;
const CLEANUP_INTERVAL = 5 * 60 * 1000;

function toTimestamp(when: Date | number | string): number {
  if (when instanceof Date) return when.getTime();
  if (typeof when === "number") return when;
  if (typeof when === "string") return new Date(when).getTime();
  return Number.NaN;
}

export function createSchedulerDomain(deps: SchedulerDomainDeps): SchedulerDomain {
  const {
    sendMessage,
    logger = () => {},
    now = () => Date.now(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval
  } = deps;

  const scheduledMessages = new Map<string, ScheduledMessageInternal>();
  let nextId = 1;
  let destroyed = false;

  function removeScheduled(id: string) {
    const scheduled = scheduledMessages.get(id);
    if (!scheduled) return false;
    scheduled.cancelled = true;
    clearTimeoutFn(scheduled.timeout);
    scheduledMessages.delete(id);
    return true;
  }

  function sendWhenDue(scheduled: ScheduledMessageInternal) {
    if (destroyed || scheduled.cancelled) return;
    const remaining = scheduled.timestamp - now();
    if (remaining > 0) {
      scheduled.timeout = setTimeoutFn(() => sendWhenDue(scheduled), Math.min(remaining, MAX_TIMER_DELAY));
      return;
    }

    logger(`Sending scheduled message ${scheduled.id}`, "info");
    Promise.resolve(
      sendMessage(
        scheduled.message,
        scheduled.threadID,
        scheduled.options.callback || (() => {}),
        scheduled.options.replyMessageID,
        scheduled.options.isGroup
      )
    ).then(() => {
      logger(`Scheduled message ${scheduled.id} sent successfully`, "info");
      scheduledMessages.delete(scheduled.id);
    }).catch((error: Loose) => {
      logger(`Error sending scheduled message ${scheduled.id}: ${error?.message || String(error)}`, "error");
      scheduledMessages.delete(scheduled.id);
    });
  }

  function scheduleMessage(
    message: Loose,
    threadID: Loose,
    when: Date | number | string,
    options: SchedulerOptions = {}
  ) {
    if (destroyed) throw new Error("Scheduler has been destroyed");
    const timestamp = toTimestamp(when);
    if (!Number.isFinite(timestamp)) {
      throw new Error("Invalid 'when' parameter. Must be Date, number (timestamp), or ISO string");
    }

    const currentTime = now();
    if (timestamp <= currentTime) throw new Error("Scheduled time must be in the future");

    const id = `scheduled_${nextId++}_${currentTime}`;
    const delay = timestamp - currentTime;
    const scheduled = {
      id,
      message,
      threadID,
      timestamp,
      createdAt: currentTime,
      options: {
        replyMessageID: options.replyMessageID,
        isGroup: options.isGroup,
        callback: options.callback
      },
      cancelled: false,
      timeout: undefined as unknown as ReturnType<typeof setTimeout>
    } as ScheduledMessageInternal;

    scheduled.timeout = setTimeoutFn(() => sendWhenDue(scheduled), Math.min(delay, MAX_TIMER_DELAY));
    scheduledMessages.set(id, scheduled);
    logger(`Message scheduled: ${id} (in ${Math.round(delay / 1000)}s)`, "info");
    return id;
  }

  function cancelScheduledMessage(id: string) {
    const cancelled = removeScheduled(id);
    if (cancelled) logger(`Scheduled message ${id} cancelled`, "info");
    return cancelled;
  }

  function toPublicInfo(scheduled: ScheduledMessageInternal, currentTime: number): ScheduledMessageInfo {
    return {
      id: scheduled.id,
      message: scheduled.message,
      threadID: scheduled.threadID,
      timestamp: scheduled.timestamp,
      createdAt: scheduled.createdAt,
      options: { ...scheduled.options },
      timeUntilSend: Math.max(0, scheduled.timestamp - currentTime)
    };
  }

  function getScheduledMessage(id: string): ScheduledMessageInfo | null {
    const scheduled = scheduledMessages.get(id);
    if (!scheduled || scheduled.cancelled) return null;
    return toPublicInfo(scheduled, now());
  }

  function listScheduledMessages() {
    const currentTime = now();
    return Array.from(scheduledMessages.values())
      .filter((scheduled) => !scheduled.cancelled)
      .map((scheduled) => toPublicInfo(scheduled, currentTime))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  function cancelAllScheduledMessages() {
    let count = 0;
    for (const id of Array.from(scheduledMessages.keys())) {
      if (removeScheduled(id)) count += 1;
    }
    logger(`Cancelled ${count} scheduled messages`, "info");
    return count;
  }

  function getScheduledCount() {
    return scheduledMessages.size;
  }

  function cleanup() {
    // Pending messages are retained until their timer sends them; deleting an
    // expired entry here could silently discard a message before its callback runs.
    for (const [id, scheduled] of scheduledMessages) {
      if (scheduled.cancelled) scheduledMessages.delete(id);
    }
  }

  const cleanupInterval = setIntervalFn(cleanup, CLEANUP_INTERVAL);
  if (cleanupInterval && typeof (cleanupInterval as Loose).unref === "function") {
    (cleanupInterval as Loose).unref();
  }

  function destroy() {
    if (destroyed) return 0;
    destroyed = true;
    clearIntervalFn(cleanupInterval);
    const count = cancelAllScheduledMessages();
    logger("Scheduler destroyed and all resources cleaned up", "info");
    return count;
  }

  return {
    scheduleMessage,
    cancelScheduledMessage,
    getScheduledMessage,
    listScheduledMessages,
    cancelAllScheduledMessages,
    getScheduledCount,
    cleanup,
    destroy,
    _cleanupInterval: cleanupInterval
  };
}
