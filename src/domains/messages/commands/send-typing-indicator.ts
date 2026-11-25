import { createLegacyPromise } from "../../../compat/legacy-promise";
import type { NodeStyleCallback } from "../../../compat/callbackify";
import type { FcaContext } from "../../../core/state";
import { assertMqttCapability } from "../../../session/capability-resolver";
import { publishRealtimeMessage } from "../../../transport/realtime/publish";
import type { SendTypingOptions } from "../../../types/messaging";

export interface SendTypingIndicatorCommandDeps {
  ctx: FcaContext;
  logError?: (scope: string, error: Loose) => void;
}

function buildTypingPayload(
  threadID: string | number,
  isTyping: boolean,
  requestId: number,
  attribution: number
) {
  const isGroupThread = Array.isArray(threadID) ? 0 : 1;

  return {
    app_id: "772021112871879",
    payload: JSON.stringify({
      label: "3",
      payload: JSON.stringify({
        thread_key: Number.parseInt(String(threadID), 10),
        is_group_thread: isGroupThread,
        is_typing: isTyping ? 1 : 0,
        attribution,
        sync_group: 1,
        thread_type: isGroupThread ? 2 : 1
      }),
      version: "8965252033599983"
    }),
    request_id: requestId,
    type: 4
  };
}

export function createSendTypingIndicatorCommand(deps: SendTypingIndicatorCommandDeps) {
  const { ctx, logError } = deps;

  return function sendTypingIndicator(
    threadID: string | number | Array<string | number>,
    isTyping: boolean,
    options?: SendTypingOptions | NodeStyleCallback<boolean>,
    callback?: NodeStyleCallback<boolean>
  ) {
    const effectiveOptions = typeof options === "function" ? {} : options || {};
    const effectiveCallback = typeof options === "function" ? options : callback;
    const { callback: cb, promise } = createLegacyPromise<boolean>(effectiveCallback, false);

    try {
      assertMqttCapability(ctx);

      const threadIDs = Array.isArray(threadID) ? threadID : [threadID];
      if (!threadIDs.length || threadIDs.some((value) => value === null || typeof value === "undefined" || value === "")) {
        throw new Error("threadID is required");
      }

      if (typeof ctx.wsReqNumber !== "number") {
        ctx.wsReqNumber = 0;
      }

      const requestedDuration = Number(effectiveOptions.duration);
      const duration = Number.isFinite(requestedDuration) && requestedDuration > 0
        ? Math.min(requestedDuration, 60000)
        : 10000;
      const autoStop = effectiveOptions.autoStop !== false;
      const attribution = effectiveOptions.type || 0;
      const stopTimers: Map<string, NodeJS.Timeout> =
        ctx._typingStopTimers instanceof Map ? ctx._typingStopTimers : new Map<string, NodeJS.Timeout>();
      ctx._typingStopTimers = stopTimers;

      Promise.all(
        threadIDs.map((currentThreadID) => {
          const key = String(currentThreadID);
          const previousTimer = stopTimers.get(key);
          if (previousTimer) {
            clearTimeout(previousTimer);
            stopTimers.delete(key);
          }
          return publishRealtimeMessage({
            client: ctx.mqttClient as Loose,
            topic: "/ls_req",
            payload: buildTypingPayload(currentThreadID, isTyping, ++ctx.wsReqNumber!, attribution)
          });
        })
      )
        .then(() => {
          if (isTyping && autoStop) {
            threadIDs.forEach((currentThreadID) => {
              const key = String(currentThreadID);
              const timer = setTimeout(() => {
                stopTimers.delete(key);
                if (!ctx.mqttClient || ctx._stopRequested || ctx._ending) return;
                publishRealtimeMessage({
                  client: ctx.mqttClient as Loose,
                  topic: "/ls_req",
                  payload: buildTypingPayload(currentThreadID, false, ++ctx.wsReqNumber!, attribution)
                }).catch((error: Loose) => {
                  logError?.("sendTypingIndicator.stop", error);
                });
              }, duration);
              if (typeof timer.unref === "function") timer.unref();
              stopTimers.set(key, timer);
            });
          }

          cb(null, true);
        })
        .catch((error: Loose) => {
          logError?.("sendTypingIndicator", error);
          cb(error);
        });
    } catch (error) {
      logError?.("sendTypingIndicator", error);
      cb(error);
    }

    return promise;
  };
}
