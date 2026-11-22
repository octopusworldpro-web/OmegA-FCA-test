import { createLegacyPromise } from "../../../compat/legacy-promise";
import type { NodeStyleCallback } from "../../../compat/callbackify";
import type { FcaContext } from "../../../core/state";
import { assertMqttCapability } from "../../../session/capability-resolver";
import type { MqttRequestClient } from "../../../transport/contracts/request";
import { publishLsRequestWithAck } from "../../../transport/realtime/ls-requests";
import type { ShareContactResult } from "../message.types";

export interface ShareContactCommandDeps {
  ctx: FcaContext;
  generateOfflineThreadingID: () => string;
  logError?: (scope: string, error: Loose) => void;
}

export function createShareContactCommand(deps: ShareContactCommandDeps) {
  const { ctx, generateOfflineThreadingID, logError } = deps;

  return function shareContact(
    text: string | null | undefined,
    senderID: string | number,
    threadID: string | number,
    callback?: NodeStyleCallback<ShareContactResult>
  ) {
    const { callback: cb, promise } = createLegacyPromise<ShareContactResult>(callback);

    try {
      assertMqttCapability(ctx);
      if (senderID === undefined || senderID === null || String(senderID).trim() === "" ||
          threadID === undefined || threadID === null || String(threadID).trim() === "") {
        throw new Error("senderID and threadID are required");
      }

      if (typeof ctx.wsReqNumber !== "number" || !Number.isSafeInteger(ctx.wsReqNumber)) ctx.wsReqNumber = 0;
      if (typeof ctx.wsTaskNumber !== "number" || !Number.isSafeInteger(ctx.wsTaskNumber)) ctx.wsTaskNumber = 0;
      const requestId = ++ctx.wsReqNumber;
      const taskId = ++ctx.wsTaskNumber;

      publishLsRequestWithAck<ShareContactResult>({
        client: ctx.mqttClient as MqttRequestClient,
        requestId,
        content: {
          app_id: "2220391788200892",
          payload: JSON.stringify({
            tasks: [{
              label: "359",
              payload: JSON.stringify({
                contact_id: String(senderID),
                sync_group: 1,
                text: text || "",
                thread_id: String(threadID)
              }),
              queue_name: "messenger_contact_sharing",
              task_id: taskId,
              failure_count: null
            }],
            epoch_id: generateOfflineThreadingID(),
            version_id: "7214102258676893"
          }),
          request_id: requestId,
          type: 3
        },
        extract: () => ({ success: true })
      }).then(result => cb(null, result)).catch((error: Loose) => {
        logError?.("shareContact", error);
        cb(error);
      });
    } catch (error) {
      logError?.("shareContact", error);
      cb(error);
    }

    return promise;
  };
}
