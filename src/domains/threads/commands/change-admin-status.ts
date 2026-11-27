import type { FcaContext } from "../../../core/state";
import { assertMqttCapability } from "../../../session/capability-resolver";
import type { MqttRequestClient } from "../../../transport/contracts/request";
import { publishLsRequestWithAck } from "../../../transport/realtime/ls-requests";

export interface ChangeAdminStatusCommandDeps {
  ctx: FcaContext;
  generateOfflineThreadingID: () => string;
  logError?: (scope: string, error: Loose) => void;
}

export function createChangeAdminStatusCommand(deps: ChangeAdminStatusCommandDeps) {
  const { ctx, generateOfflineThreadingID, logError } = deps;

  return function changeAdminStatus(
    threadID: string,
    adminID: string | string[],
    adminStatus: boolean
  ) {
    if (typeof threadID !== "string") {
      throw { error: "changeAdminStatus: threadID must be a string" };
    }
    if (typeof adminID !== "string" && !Array.isArray(adminID)) {
      throw { error: "changeAdminStatus: adminID must be a string or an array" };
    }
    if (typeof adminStatus !== "boolean") {
      throw { error: "changeAdminStatus: adminStatus must be true or false" };
    }

    try {
      assertMqttCapability(ctx);
    } catch (error) {
      logError?.("changeAdminStatus", error);
      return Promise.reject(error);
    }

    if (typeof ctx.wsReqNumber !== "number" || !Number.isSafeInteger(ctx.wsReqNumber)) ctx.wsReqNumber = 0;
    if (typeof ctx.wsTaskNumber !== "number" || !Number.isSafeInteger(ctx.wsTaskNumber)) ctx.wsTaskNumber = 0;
    const requestId = ++ctx.wsReqNumber;
    const adminIDs = [...new Set((Array.isArray(adminID) ? adminID : [adminID]).map(String))];
    if (!adminIDs.length || adminIDs.some((id) => !id.trim())) {
      return Promise.reject(new Error("adminID must contain at least one valid ID"));
    }
    let taskCounter = ctx.wsTaskNumber;
    const tasks = adminIDs.map((id) => ({
      failure_count: null,
      label: "25",
      payload: JSON.stringify({
        thread_key: threadID,
        contact_id: id,
        is_admin: adminStatus ? 1 : 0
      }),
      queue_name: "admin_status",
      task_id: ++taskCounter
    }));
    ctx.wsTaskNumber = taskCounter;

    return publishLsRequestWithAck({
      client: ctx.mqttClient as MqttRequestClient,
      requestId,
      content: {
        app_id: "2220391788200892",
        payload: JSON.stringify({
          epoch_id: generateOfflineThreadingID(),
          tasks,
          version_id: "8798795233522156"
        }),
        request_id: requestId,
        type: 3
      },
      extract: (message) => message.payload
    }).catch((error: Loose) => {
      logError?.("changeAdminStatus", error);
      throw error;
    });
  };
}
