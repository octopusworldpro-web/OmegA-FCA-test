/**
 * MQTT/WebSocket listener for Facebook Messenger real-time events.
 * Connects to edge-chat.facebook.com, subscribes to topics, parses deltas and typing/presence.
 */
import formatMod from "../../utils/format";
import { getMqttReconnectDelay, parseMqttJsonPayload } from "../../domains/realtime/reconnect-policy";
import { buildMqttWebSocketUrl, getMqttWebSocketHost } from "./mqtt-url";
import { buildInitialMqttSyncQueue, normalizeMqttSyncState, validateMqttSubscriptionAck } from "./sync-protocol";
import { consumeMqttTaskResponse } from "./task-registry";

const { formatID } = formatMod;

const DEFAULT_RECONNECT_DELAY_MS = 2000;
/** Chờ /t_ms lâu hơn một chút — mạng chậm hay server trễ dễ gây reconnect oan */
const T_MS_WAIT_TIMEOUT_MS = 8000;
/** Giảm dồn reconnect cùng lúc khi nhiều client / mạng chập chờn */
const RECONNECT_JITTER_MS = 400;

function createListenMqtt(deps: Loose) {
  const { WebSocket, mqtt, HttpsProxyAgent, buildStream, buildProxy,
    topics, parseDelta, getTaskResponseData, logger, emitAuth
  } = deps;

  return function listenMqtt(defaultFuncs: Loose, api: Loose, ctx: Loose, globalCallback: Loose) {

    function scheduleReconnect(delayMs?: number) {
      if (ctx._ending || ctx._stopRequested) {
        logger("mqtt reconnect skipped - ending/stopped", "warn");
        return;
      }
      if (ctx._reconnectTimer) {
        logger("mqtt reconnect already scheduled", "warn");
        return;
      }
      const configuredBase = (ctx._mqttOpt && ctx._mqttOpt.reconnectDelayMs) || DEFAULT_RECONNECT_DELAY_MS;
      const base = typeof delayMs === "number" && delayMs > 0 ? delayMs : configuredBase;
      const attempt = (ctx._mqttReconnectAttempts || 0) + 1;
      const ms = getMqttReconnectDelay({
        attempt,
        baseDelayMs: base,
        maxDelayMs: (ctx._mqttOpt && ctx._mqttOpt.maxReconnectDelayMs) || 30000,
        jitterMs: RECONNECT_JITTER_MS,
        random: Math.random()
      });
      ctx._mqttReconnectAttempts = attempt;
      logger(`mqtt will reconnect in ~${ms}ms (attempt ${attempt})`, "warn");
      ctx._reconnectTimer = setTimeout(() => {
        ctx._reconnectTimer = null;
        if (!ctx._ending && !ctx._stopRequested) {
          listenMqtt(defaultFuncs, api, ctx, globalCallback);
        }
      }, ms);
    }

    function isActiveClient(client: Loose): boolean {
      return ctx.mqttClient === client && !ctx._ending && !ctx._stopRequested;
    }

    /** Hủy timer reconnect đang chờ — sắp mở kết nối mới */
    if (ctx._reconnectTimer) {
      clearTimeout(ctx._reconnectTimer);
      ctx._reconnectTimer = null;
    }

    if (ctx._rTimeout) {
      try {
        clearTimeout(ctx._rTimeout);
      } catch {
        /* ignore */
      }
      ctx._rTimeout = null;
    }
    try {
      delete ctx.tmsWait;
    } catch {
      /* ignore */
    }

    const prev = ctx.mqttClient;
    if (prev) {
      try {
        prev.removeAllListeners();
      } catch {
        /* ignore */
      }
      try {
        if (prev.connected) {
          prev.end(true);
        }
      } catch {
        /* ignore */
      }
      if (ctx.mqttClient === prev) {
        ctx.mqttClient = undefined;
      }
    }

    const chatOn = ctx.globalOptions.online;
    const sessionID = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) + 1;
    const username = {
      u: ctx.userID, s: sessionID, chat_on: chatOn, fg: false, d: ctx.clientId,
      ct: "websocket", aid: 219994525426954, aids: null, mqtt_sid: "",
      cp: 3, ecp: 10, st: [], pm: [], dc: "", no_auto_fg: true, gas: null, pack: [], p: null, php_override: ""
    };

    const cookies = api.getCookies();
    const host = buildMqttWebSocketUrl({
      endpoint: ctx.mqttEndpoint || null,
      region: ctx.region || null,
      sessionId: sessionID,
      clientId: ctx.clientId
    });

    const options: Loose = {
      clientId: "mqttwsclient",
      protocolId: "MQIsdp",
      protocolVersion: 3,
      username: JSON.stringify(username),
      clean: true,
      wsOptions: {
        headers: {
          Cookie: cookies,
          Origin: "https://www.facebook.com",
          "User-Agent": ctx.globalOptions.userAgent || "Mozilla/5.0",
          Referer: "https://www.facebook.com/",
          Host: getMqttWebSocketHost(host),
          Connection: "Upgrade",
          Pragma: "no-cache",
          "Cache-Control": "no-cache",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "vi,en;q=0.9",
          "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits"
        },
        origin: "https://www.facebook.com",
        protocolVersion: 13,
        binaryType: "arraybuffer"
      },
      keepalive: 30,
      reschedulePings: true,
      reconnectPeriod: 0,
      connectTimeout: 12000
    };
    if (ctx.globalOptions.proxy !== undefined) {
      const agent = new HttpsProxyAgent(ctx.globalOptions.proxy);
      options.wsOptions.agent = agent;
    }

    ctx.mqttClient = new mqtt.Client(
      () => buildStream(options, new WebSocket(host, options.wsOptions), buildProxy()),
      options
    );
    const mqttClient = ctx.mqttClient;

    mqttClient.on("error", function (err: Loose) {
      if (!isActiveClient(mqttClient)) {
        return;
      }
      const msg = String(err && err.message ? err.message : err || "");
      if ((ctx._ending || ctx._cycling) && /No subscription existed|client disconnecting/i.test(msg)) {
        logger(`mqtt expected during shutdown: ${msg}`, "info");
        return;
      }

      if (/Not logged in|Not logged in.|blocked the login|401|403/i.test(msg)) {
        try {
          if (mqttClient && mqttClient.connected) {
            mqttClient.end(true);
          }
        } catch (_) { }
        return emitAuth(ctx, api, globalCallback,
          /blocked/i.test(msg) ? "login_blocked" : "not_logged_in",
          msg
        );
      }
      logger(`mqtt error: ${msg}`, "error");
      try {
        if (mqttClient && mqttClient.connected) {
          mqttClient.end(true);
        }
      } catch (_) { }
      if (ctx._ending || ctx._cycling) return;

      if (ctx.globalOptions.autoReconnect && !ctx._ending && isActiveClient(mqttClient)) {
        const d = (ctx._mqttOpt && ctx._mqttOpt.reconnectDelayMs) || DEFAULT_RECONNECT_DELAY_MS;
        logger(`mqtt autoReconnect listenMqtt() in ~${d}ms`, "warn");
        scheduleReconnect(d);
      } else {
        globalCallback({ type: "stop_listen", error: msg || "Connection refused" }, null);
      }
    });

    mqttClient.on("connect", function () {
      if (!isActiveClient(mqttClient)) {
        return;
      }
      if (process.env.OnStatus === undefined) {
        logger("fca-unofficial", "info");
        process.env.OnStatus = "true";
      }
      ctx._cycling = false;

      const d = (ctx._mqttOpt && ctx._mqttOpt.reconnectDelayMs) || DEFAULT_RECONNECT_DELAY_MS;
      const topicList = topics.slice() as string[];

      /**
       * Subscribe là async; publish sync queue trước SUBACK → Facebook trả
       * "Connection refused: No subscription existed" và đóng socket.
       */
      mqttClient.subscribe(topicList, (subErr: Error | null, granted?: Array<{ topic: string; qos: number }>) => {
        if (!isActiveClient(mqttClient)) {
          return;
        }
        const subAck = validateMqttSubscriptionAck(topicList, subErr, granted);
        if (!subAck.ok) {
          const sm = subAck.reason || "MQTT subscription was not acknowledged";
          logger(`mqtt subscribe error: ${sm}`, "error");
          try {
            if (mqttClient && mqttClient.connected) {
              mqttClient.end(true);
            }
          } catch (_) { }
          if (!ctx._ending && !ctx._cycling && ctx.globalOptions.autoReconnect && isActiveClient(mqttClient)) {
            scheduleReconnect(d);
          }
          return;
        }

        if (!isActiveClient(mqttClient) || !mqttClient.connected) {
          return;
        }

        const initialSync = buildInitialMqttSyncQueue(ctx);
        const outbound = [
          { topic: initialSync.topic, payload: initialSync.payload },
          { topic: "/foreground_state", payload: { foreground: chatOn } },
          { topic: "/set_client_settings", payload: { make_user_available_when_in_foreground: true } }
        ];
        const startTmsTimeout = () => {
        let rTimeout: NodeJS.Timeout | null = setTimeout(function () {
          rTimeout = null;
          if (ctx._ending) {
            logger("mqtt t_ms timeout skipped - ending", "warn");
            return;
          }
          if (!isActiveClient(mqttClient)) {
            return;
          }
          logger(`mqtt t_ms timeout, cycling in ~${d}ms`, "warn");
          try {
            if (mqttClient && mqttClient.connected) {
              mqttClient.end(true);
            }
          } catch (_) { }
          if (ctx.globalOptions.autoReconnect && !ctx._ending) {
            scheduleReconnect(d);
          }
        }, T_MS_WAIT_TIMEOUT_MS);

        ctx._rTimeout = rTimeout;

        ctx.tmsWait = function () {
          if (rTimeout) {
            clearTimeout(rTimeout);
            rTimeout = null;
          }
          if (ctx._rTimeout) {
            delete ctx._rTimeout;
          }
          ctx._mqttReconnectAttempts = 0;
          if (ctx.globalOptions.emitReady) globalCallback({ type: "ready", error: null });
          delete ctx.tmsWait;
        };
        };
        const publishNext = (index: number) => {
          if (!isActiveClient(mqttClient) || !mqttClient.connected) return;
          if (index >= outbound.length) {
            startTmsTimeout();
            return;
          }
          const item = outbound[index];
          mqttClient.publish(item.topic, JSON.stringify(item.payload), { qos: 1, retain: false }, (publishErr?: Error | null) => {
            if (!isActiveClient(mqttClient)) return;
            if (publishErr) {
              const message = publishErr.message || String(publishErr);
              logger("mqtt publish " + item.topic + " failed: " + message, "error");
              try { if (mqttClient.connected) mqttClient.end(true); } catch (_) { }
              if (ctx.globalOptions.autoReconnect && !ctx._ending && !ctx._stopRequested) scheduleReconnect(d);
              else globalCallback({ type: "stop_listen", error: message }, null);
              return;
            }
            publishNext(index + 1);
          });
        };
        publishNext(0);
      });
    });

    mqttClient.on("message", function (topic: string, message: Loose) {
      if (ctx._ending || ctx.mqttClient !== mqttClient) return;
      try {
        const jsonMessage = parseMqttJsonPayload(message);
        if (!jsonMessage) {
          logger(`mqtt message ignored: invalid JSON object on topic ${topic}`, "warn");
          return;
        }

        if (jsonMessage.type === "jewel_requests_add") {
          globalCallback(null, { type: "friend_request_received", actorFbId: jsonMessage.from.toString(), timestamp: Date.now().toString() });
        } else if (jsonMessage.type === "jewel_requests_remove_old") {
          globalCallback(null, { type: "friend_request_cancel", actorFbId: jsonMessage.from.toString(), timestamp: Date.now().toString() });
        } else if (topic === "/t_ms") {
          if (ctx.tmsWait && typeof ctx.tmsWait == "function") ctx.tmsWait();
          const syncState = normalizeMqttSyncState(jsonMessage, { lastSeqId: ctx.lastSeqId, syncToken: ctx.syncToken });
          ctx.lastSeqId = syncState.lastSeqId;
          ctx.syncToken = syncState.syncToken;
          if (Array.isArray(jsonMessage.deltas)) {
            for (const dlt of jsonMessage.deltas) {
              if (dlt && typeof dlt === "object") parseDelta(defaultFuncs, api, ctx, globalCallback, { delta: dlt });
            }
          }
        } else if (topic === "/thread_typing" || topic === "/orca_typing_notifications") {
          const typ = {
            type: "typ",
            isTyping: !!jsonMessage.state,
            from: jsonMessage.sender_fbid.toString(),
            threadID: formatID((jsonMessage.thread || jsonMessage.sender_fbid).toString())
          };
          globalCallback(null, typ);
        } else if (topic === "/orca_presence") {
          if (!ctx.globalOptions.updatePresence) {
            for (const data of (jsonMessage.list || [])) {
              const presence = { type: "presence", userID: String(data.u), timestamp: data.l * 1000, statuses: data.p };
              globalCallback(null, presence);
            }
          }
        } else if (topic === "/ls_resp") {
          const rawPayload = jsonMessage.payload;
          const parsedPayload = typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;
          if (!parsedPayload || typeof parsedPayload !== "object" || Array.isArray(parsedPayload)) return;
          const reqID = jsonMessage.request_id;
          const tasks = ctx.tasks;
          if (tasks && tasks instanceof Map) {
            consumeMqttTaskResponse(tasks, reqID, parsedPayload, getTaskResponseData);
          }
        }
      } catch (ex: Loose) {
        const errMsg = ex && ex.message ? ex.message : String(ex || "Unknown error");
        logger(`mqtt message handler error: ${errMsg}`, "error");
        // Don't crash on message parsing errors, just log and continue
      }
    });

    mqttClient.on("close", function () {
      if (ctx.mqttClient !== mqttClient) {
        return;
      }
      if (ctx._ending || ctx._cycling) {
        logger("mqtt close expected", "info");
        return;
      }
      logger("mqtt connection closed", "warn");
      if (ctx.globalOptions.autoReconnect && !ctx._ending && !ctx._cycling && !ctx._stopRequested) {
        scheduleReconnect();
      } else if (!ctx._ending && !ctx._cycling && !ctx._stopRequested) {
        globalCallback({ type: "stop_listen", error: "Connection closed and autoReconnect is disabled" }, null);
      }
    });

    mqttClient.on("disconnect", () => {
      if (ctx.mqttClient !== mqttClient) {
        return;
      }
      if (ctx._ending || ctx._cycling) {
        logger("mqtt disconnect expected", "info");
        return;
      }
      logger("mqtt disconnected", "warn");
      if (ctx.globalOptions.autoReconnect && !ctx._ending && !ctx._cycling && !ctx._stopRequested) {
        scheduleReconnect();
      } else if (!ctx._ending && !ctx._cycling && !ctx._stopRequested) {
        globalCallback({ type: "stop_listen", error: "Disconnected and autoReconnect is disabled" }, null);
      }
    });
  };
}

export = createListenMqtt;



