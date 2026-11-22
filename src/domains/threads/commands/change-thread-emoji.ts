import { createLegacyPromise } from "../../../compat/legacy-promise";
import type { NodeStyleCallback } from "../../../compat/callbackify";
import type { FcaContext } from "../../../core/state";
import { resolveThreadMutationTransport } from "../../../session/capability-resolver";
import { changeThreadEmojiViaHttp } from "../../../transport/http/threads";
import type { MqttRequestClient } from "../../../transport/contracts/request";
import { publishLsRequestWithAck } from "../../../transport/realtime/ls-requests";
import type { ChangeThreadEmojiResult } from "../../../types/messaging";

const THREAD_EMOJI_ERROR =
  "Trying to change emoji of a chat that doesn't exist. Have at least one message in the thread before trying to change the emoji.";

export interface ChangeThreadEmojiCommandDeps {
  defaultFuncs: {
    post: (url: string, jar: Loose, form?: Record<string, Loose>) => Promise<Loose>;
  };
  ctx: FcaContext;
  generateOfflineThreadingID: () => string;
  logError?: (scope: string, error: Loose) => void;
}

export function createChangeThreadEmojiCommand(deps: ChangeThreadEmojiCommandDeps) {
  const { defaultFuncs, ctx, generateOfflineThreadingID, logError } = deps;

  return function changeThreadEmoji(
    emoji: string,
    threadID: string | number,
    callback?: NodeStyleCallback<ChangeThreadEmojiResult>
  ) {
    const { callback: cb, promise } = createLegacyPromise<ChangeThreadEmojiResult>(callback);

    if (!emoji || threadID === null || typeof threadID === "undefined" || threadID === "") {
      cb(new Error("emoji and threadID are required"));
      return promise;
    }

    const transport = resolveThreadMutationTransport(ctx);

    if (transport === "mqtt") {
      if (typeof ctx.wsReqNumber !== "number" || !Number.isSafeInteger(ctx.wsReqNumber)) ctx.wsReqNumber = 0;
      if (typeof ctx.wsTaskNumber !== "number" || !Number.isSafeInteger(ctx.wsTaskNumber)) ctx.wsTaskNumber = 0;
      const requestId = ++ctx.wsReqNumber;
      const taskId = ++ctx.wsTaskNumber;

      publishLsRequestWithAck<ChangeThreadEmojiResult>({
        client: ctx.mqttClient as MqttRequestClient,
        requestId,
        content: {
          app_id: "2220391788200892",
          payload: JSON.stringify({
            epoch_id: generateOfflineThreadingID(),
            tasks: [
              {
                failure_count: null,
                label: "100003",
                payload: JSON.stringify({
                  thread_key: threadID,
                  custom_emoji: emoji,
                  avatar_sticker_instruction_key_id: null,
                  sync_group: 1
                }),
                queue_name: "thread_quick_reaction",
                task_id: taskId
              }
            ],
            version_id: "8798795233522156"
          }),
          request_id: requestId,
          type: 3
        },
        extract: () => ({ success: true })
      })
        .then((result) => {
          cb(null, result);
        })
        .catch((error: Loose) => {
          logError?.("changeThreadEmoji", error);
          cb(error);
        });

      return promise;
    }

    changeThreadEmojiViaHttp({
      defaultFuncs: defaultFuncs as Loose,
      ctx,
      emoji,
      threadID
    })
      .then((response: Loose) => {
        if (response?.error === 1357031) {
          throw { error: THREAD_EMOJI_ERROR };
        }
        if (response?.error) {
          throw response;
        }

        cb(null, { success: true });
      })
      .catch((error: Loose) => {
        logError?.("changeThreadEmoji", error);
        cb(error);
      });

    return promise;
  };
}
