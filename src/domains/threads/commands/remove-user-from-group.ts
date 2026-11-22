import { createLegacyPromise } from "../../../compat/legacy-promise";
import type { NodeStyleCallback } from "../../../compat/callbackify";
import type { FcaContext } from "../../../core/state";
import { assertMqttCapability } from "../../../session/capability-resolver";
import type { MqttRequestClient } from "../../../transport/contracts/request";
import { publishLsRequestWithAck } from "../../../transport/realtime/ls-requests";

export interface RemoveUserFromGroupCommandDeps {
  ctx: FcaContext;
  generateOfflineThreadingID: () => string;
  logError?: (scope: string, error: Loose) => void;
}

export function createRemoveUserFromGroupCommand(deps: RemoveUserFromGroupCommandDeps) {
  const { ctx, generateOfflineThreadingID, logError } = deps;

  return function removeUserFromGroup(
    userID: string | number,
    threadID: string | number | NodeStyleCallback<boolean>,
    callback?: NodeStyleCallback<boolean>
  ) {
    if (!callback && typeof threadID === "function") {
      throw { error: "please pass a threadID as a second argument." };
    }

    const actualThreadID = threadID as string | number;
    const { callback: cb, promise } = createLegacyPromise<boolean>(callback, false);

    try {
      assertMqttCapability(ctx);

      if (typeof actualThreadID !== "string" && typeof actualThreadID !== "number") {
        throw { error: `threadID should be of type Number or String and not ${typeof actualThreadID}.` };
      }
      if (typeof userID !== "string" && typeof userID !== "number") {
        throw { error: `userID should be of type Number or String and not ${typeof userID}.` };
      }

      if (typeof ctx.wsReqNumber !== "number" || !Number.isSafeInteger(ctx.wsReqNumber)) ctx.wsReqNumber = 0;
      if (typeof ctx.wsTaskNumber !== "number" || !Number.isSafeInteger(ctx.wsTaskNumber)) ctx.wsTaskNumber = 0;
      const requestId = ++ctx.wsReqNumber;
      const taskId = ++ctx.wsTaskNumber;

      publishLsRequestWithAck<boolean>({
        client: ctx.mqttClient as MqttRequestClient,
        requestId,
        content: {
          app_id: "2220391788200892",
          payload: JSON.stringify({
            epoch_id: generateOfflineThreadingID(),
            tasks: [
              {
                failure_count: null,
                label: "140",
                payload: JSON.stringify({
                  thread_id: actualThreadID,
                  contact_id: userID,
                  sync_group: 1
                }),
                queue_name: "remove_participant_v2",
                task_id: taskId
              }
            ],
            version_id: "25002366262773827"
          }),
          request_id: requestId,
          type: 3
        },
        extract: () => true
      })
        .then((result) => cb(null, result))
        .catch((error: Loose) => {
          logError?.("removeUserFromGroup", error);
          cb(error);
        });
    } catch (error) {
      logError?.("removeUserFromGroup", error);
      cb(error);
    }

    return promise;
  };
}
