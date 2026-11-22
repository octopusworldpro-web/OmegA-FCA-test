import type { ListenMqttError, MqttEvent } from "../../types/events";
import { getMqttReconnectDelay } from "./reconnect-policy";

const CYCLE_MS_DEFAULT = 60 * 60 * 1000;
const RECONNECT_DELAY_MS_DEFAULT = 2000;
const UNSUB_ALL_TIMEOUT_MS = 5000;

type ListenerCallback = (error: ListenMqttError | null, event?: MqttEvent | null) => void;

export interface RealtimeMessageEmitter {
  stopListening: (callback?: () => void) => void;
  stopListeningAsync: () => Promise<void>;
  [key: string]: Loose;
}

interface RealtimeListenerDeps {
  EventEmitter: Loose;
  logger: (text: string, type?: string) => void;
  emitAuth: (ctx: Loose, api: Loose, globalCallback: ListenerCallback, reason: string, detail?: string) => void;
  createMiddlewareSystem: () => {
    use: (middleware: Loose, fn?: Loose) => Loose;
    remove: (identifier: Loose) => boolean;
    clear: () => void;
    list: () => string[];
    setEnabled: (name: string, enabled: boolean) => boolean;
    wrapCallback: (callback: ListenerCallback) => ListenerCallback;
    count: number;
  };
  topics: readonly string[];
  listenMqttCore: (defaultFuncs: Loose, api: Loose, ctx: Loose, globalCallback: ListenerCallback) => void;
  getSeqIDFactory: (
    defaultFuncs: Loose,
    api: Loose,
    ctx: Loose,
    globalCallback: ListenerCallback,
    form: Record<string, Loose>,
    retryCount?: number
  ) => Promise<void>;
}

const MQTT_DEFAULTS = {
  cycleMs: CYCLE_MS_DEFAULT,
  reconnectDelayMs: RECONNECT_DELAY_MS_DEFAULT,
  autoReconnect: true,
  reconnectAfterStop: false
};

function mqttConf(ctx: Loose, overrides?: Record<string, Loose>) {
  ctx._mqttOpt = Object.assign({}, MQTT_DEFAULTS, ctx._mqttOpt || {}, overrides || {});
  if (typeof ctx._mqttOpt.autoReconnect === "boolean") {
    ctx.globalOptions.autoReconnect = ctx._mqttOpt.autoReconnect;
  }
  return ctx._mqttOpt;
}

export function createRealtimeListener(deps: RealtimeListenerDeps) {
  const { EventEmitter, logger, emitAuth, createMiddlewareSystem, topics, listenMqttCore, getSeqIDFactory } = deps;

  return function attachRealtimeListener(defaultFuncs: Loose, api: Loose, ctx: Loose, opts?: Record<string, Loose>) {
    const identity: ListenerCallback = function () { };
    let globalCallback: ListenerCallback = identity;

    if (!ctx._middleware) {
      ctx._middleware = createMiddlewareSystem();
    }
    const middleware = ctx._middleware;

    function installPostGuard() {
      if (ctx._postGuarded) {
        return defaultFuncs.post;
      }

      const rawPost = defaultFuncs.post && defaultFuncs.post.bind(defaultFuncs);
      if (!rawPost) {
        return defaultFuncs.post;
      }

      function postSafe(...args: Loose[]) {
        return rawPost(...args).catch((error: Loose) => {
          const message = (error && error.error) || (error && error.message) || String(error || "");
          if (/Not logged in|blocked the login/i.test(message)) {
            emitAuth(
              ctx,
              api,
              globalCallback,
              /blocked/i.test(message) ? "login_blocked" : "not_logged_in",
              message
            );
          }
          throw error;
        });
      }

      defaultFuncs.post = postSafe;
      ctx._postGuarded = true;
      return postSafe;
    }

    let conf = mqttConf(ctx, opts);

    function getSeqIDWrapper(): Promise<void> {
      if (ctx._getSeqPromise) return ctx._getSeqPromise;
      if (ctx._ending && !ctx._cycling) return Promise.resolve();
      if (ctx._getSeqRetryTimer) return Promise.resolve();
      const form = {
        av: ctx.globalOptions.pageID,
        queries: JSON.stringify({ o0: { doc_id: "3336396659757871", query_params: {
          limit: 1, before: null, tags: ["INBOX"], includeDeliveryReceipts: false, includeSeqID: true
        } } })
      };
      logger("mqtt getSeqID call", "info");
      const operation = Promise.resolve()
        .then(() => getSeqIDFactory(defaultFuncs, api, ctx, globalCallback, form))
        .then(() => {
          logger("mqtt getSeqID done", "info");
          ctx._cycling = false;
          ctx._getSeqRetryAttempts = 0;
        })
        .catch((error: Loose) => {
          ctx._cycling = false;
          const message = error && error.message ? error.message : String(error || "Unknown error");
          logger("mqtt getSeqID error: " + message, "error");
          if (ctx._ending || ctx._stopRequested) return;
          if (ctx.globalOptions.autoReconnect && !ctx._getSeqRetryTimer) {
            const attempt = (ctx._getSeqRetryAttempts || 0) + 1;
            const delay = getMqttReconnectDelay({ attempt, baseDelayMs: conf.reconnectDelayMs, maxDelayMs: conf.maxReconnectDelayMs || 30000, jitterMs: 400, random: Math.random() });
            ctx._getSeqRetryAttempts = attempt;
            logger("mqtt getSeqID will retry in ~" + delay + "ms (attempt " + attempt + ")", "warn");
            ctx._getSeqRetryTimer = setTimeout(() => {
              ctx._getSeqRetryTimer = null;
              if (!ctx._ending && !ctx._stopRequested) void getSeqIDWrapper();
            }, delay);
            if (typeof ctx._getSeqRetryTimer.unref === "function") ctx._getSeqRetryTimer.unref();
          }
        })
        .finally(() => { if (ctx._getSeqPromise === operation) ctx._getSeqPromise = null; });
      ctx._getSeqPromise = operation;
      return operation;
    }

    function isConnected() {
      return !!(ctx.mqttClient && ctx.mqttClient.connected);
    }

    function unsubAll(callback?: () => void) {
      if (!isConnected()) {
        if (callback) {
          setTimeout(callback, 0);
        }
        return;
      }

      let pending = topics.length;
      if (!pending) {
        if (callback) {
          setTimeout(callback, 0);
        }
        return;
      }

      let fired = false;
      const timeout = setTimeout(() => {
        if (!fired) {
          fired = true;
          logger("unsubAll timeout, proceeding anyway", "warn");
          callback?.();
        }
      }, UNSUB_ALL_TIMEOUT_MS);

      topics.forEach((topic) => {
        try {
          ctx.mqttClient.unsubscribe(topic, () => {
            if (--pending === 0 && !fired) {
              clearTimeout(timeout);
              fired = true;
              callback?.();
            }
          });
        } catch (error: Loose) {
          logger(`unsubAll error for topic ${topic}: ${error && error.message ? error.message : String(error)}`, "warn");
          if (--pending === 0 && !fired) {
            clearTimeout(timeout);
            fired = true;
            callback?.();
          }
        }
      });
    }

    function endQuietly(next?: () => void) {
      const finish = () => {
        try {
          if (ctx.mqttClient) {
            ctx.mqttClient.removeAllListeners();
          }
        } catch { }

        ctx.mqttClient = undefined;
        ctx.lastSeqId = null;
        ctx.syncToken = undefined;
        ctx.t_mqttCalled = false;
        ctx._ending = false;
        ctx._cycling = false;

        if (ctx._reconnectTimer) {
          clearTimeout(ctx._reconnectTimer);
          ctx._reconnectTimer = null;
        }
        if (ctx._getSeqRetryTimer) {
          clearTimeout(ctx._getSeqRetryTimer);
          ctx._getSeqRetryTimer = null;
        }
        ctx._getSeqRetryAttempts = 0;
        if (ctx._rTimeout) {
          clearTimeout(ctx._rTimeout);
          ctx._rTimeout = null;
        }
        if (ctx.tasks && ctx.tasks instanceof Map) {
          const pendingTasks = Array.from(ctx.tasks.values());
          ctx.tasks.clear();
          for (const task of pendingTasks) {
            if (!task || task.completed || typeof task.callback !== "function") continue;
            task.completed = true;
            try { task.callback(new Error("MQTT listener stopped before response"), null); } catch (error: Loose) {
              logger("pending MQTT task cleanup error: " + String(error), "warn");
            }
          }
        }
        if (ctx._userInfoIntervals && Array.isArray(ctx._userInfoIntervals)) {
          ctx._userInfoIntervals.forEach((interval: NodeJS.Timeout) => {
            try {
              clearInterval(interval);
            } catch { }
          });
          ctx._userInfoIntervals = [];
        }
        if (ctx._autoSaveInterval && Array.isArray(ctx._autoSaveInterval)) {
          ctx._autoSaveInterval.forEach((interval: NodeJS.Timeout) => {
            try {
              clearInterval(interval);
            } catch { }
          });
          ctx._autoSaveInterval = [];
        }
        if (ctx._scheduler && typeof ctx._scheduler.destroy === "function") {
          try {
            ctx._scheduler.destroy();
          } catch { }
          ctx._scheduler = undefined;
        }
        next?.();
      };

      try {
        if (ctx.mqttClient) {
          if (isConnected()) {
            try {
              ctx.mqttClient.publish("/browser_close", "{}", { qos: 0 });
            } catch { }
          }
          let ended = false;
          const finishOnce = () => {
            if (ended) return;
            ended = true;
            clearTimeout(endTimeout);
            finish();
          };
          const endTimeout = setTimeout(() => {
            logger("mqtt client end timeout, forcing listener cleanup", "warn");
            finishOnce();
          }, UNSUB_ALL_TIMEOUT_MS);
          if (typeof endTimeout.unref === "function") endTimeout.unref();
          ctx.mqttClient.end(true, finishOnce);
        } else {
          finish();
        }
      } catch {
        finish();
      }
    }

    function delayedReconnect() {
      const delay = conf.reconnectDelayMs;
      if (ctx._reconnectTimer) clearTimeout(ctx._reconnectTimer);
      logger(`mqtt reconnect in ${delay}ms`, "info");
      ctx._reconnectTimer = setTimeout(() => {
        ctx._reconnectTimer = null;
        if (!ctx._stopRequested && !ctx._ending) void getSeqIDWrapper();
      }, delay);
    }

    function forceCycle() {
      if (ctx._cycling || ctx._ending || ctx._stopRequested) {
        logger("mqtt force cycle skipped - lifecycle transition active", "warn");
        return;
      }
      ctx._cycling = true;
      ctx._ending = true;
      logger("mqtt force cycle begin", "warn");
      unsubAll(() => endQuietly(() => {
        ctx._cycling = false;
        if (!ctx._stopRequested) delayedReconnect();
      }));
    }

    return function listenRealtime(callback?: ListenerCallback): RealtimeMessageEmitter {
      ctx._stopRequested = false;
      ctx._getSeqRetryAttempts = 0;

      const stopListening = (callback2?: () => void): void => {
        const cb = typeof callback2 === "function" ? callback2 : function () { };
        if (ctx._stopPromise) {
          ctx._stopPromise.then(() => cb(), () => cb());
          return;
        }
        logger("mqtt stop requested", "info");
        globalCallback = identity;
        ctx._stopRequested = true;
        if (ctx._autoCycleTimer) {
          clearInterval(ctx._autoCycleTimer);
          ctx._autoCycleTimer = null;
        }
        if (ctx._reconnectTimer) {
          clearTimeout(ctx._reconnectTimer);
          ctx._reconnectTimer = null;
        }
        if (ctx._getSeqRetryTimer) {
          clearTimeout(ctx._getSeqRetryTimer);
          ctx._getSeqRetryTimer = null;
        }
        ctx._getSeqRetryAttempts = 0;
        ctx._ending = true;
        const stopped = new Promise<void>((resolve) => {
          unsubAll(() => endQuietly(() => {
            logger("mqtt stopped", "info");
            conf = mqttConf(ctx, conf);
            if (conf.reconnectAfterStop) {
              ctx._stopRequested = false;
              delayedReconnect();
            }
            resolve();
          }));
        });
        ctx._stopPromise = stopped;
        stopped.then(() => {
          if (ctx._stopPromise === stopped) ctx._stopPromise = null;
          cb();
        }, () => {
          if (ctx._stopPromise === stopped) ctx._stopPromise = null;
          cb();
        });
      };

      const stopListeningAsync = (): Promise<void> =>
        new Promise((resolve) => stopListening(resolve));

      class MessageEmitter extends EventEmitter {
        stopListening(callback2?: () => void) {
          stopListening(callback2);
        }

        stopListeningAsync(): Promise<void> {
          return stopListeningAsync();
        }
      }

      const msgEmitter = new MessageEmitter();
      const originalCallback: ListenerCallback =
        callback ||
        function (error, message) {
          if (error) {
            logger("mqtt emit error", "error");
            msgEmitter.emit("error", error);
            return;
          }
          msgEmitter.emit("message", message);
        };

      globalCallback = middleware.count > 0 ? middleware.wrapCallback(originalCallback) : originalCallback;

      conf = mqttConf(ctx, conf);
      installPostGuard();

      if (!ctx.firstListen) {
        ctx.lastSeqId = null;
      }
      ctx.syncToken = undefined;
      ctx.t_mqttCalled = false;

      if (ctx._autoCycleTimer) {
        clearInterval(ctx._autoCycleTimer);
        ctx._autoCycleTimer = null;
      }

      if (conf.cycleMs && conf.cycleMs > 0) {
        ctx._autoCycleTimer = setInterval(forceCycle, conf.cycleMs);
        logger(`mqtt auto-cycle enabled ${conf.cycleMs}ms`, "info");
      } else {
        logger("mqtt auto-cycle disabled", "info");
      }

      if (!ctx.firstListen || !ctx.lastSeqId) {
        getSeqIDWrapper();
      } else {
        logger("mqtt starting listenMqtt", "info");
        listenMqttCore(defaultFuncs, api, ctx, globalCallback);
      }

      api.stopListening = msgEmitter.stopListening;
      api.stopListeningAsync = msgEmitter.stopListeningAsync;

      let currentOriginalCallback = originalCallback;
      let currentGlobalCallback = globalCallback;

      function rewrapCallbackIfNeeded() {
        if (!ctx.mqttClient || ctx._ending) {
          return;
        }

        const hasMiddleware = middleware.count > 0;
        const isWrapped = currentGlobalCallback !== currentOriginalCallback;

        if (hasMiddleware && !isWrapped) {
          currentGlobalCallback = middleware.wrapCallback(currentOriginalCallback);
          globalCallback = currentGlobalCallback;
          logger("Middleware added - callback re-wrapped", "info");
        } else if (!hasMiddleware && isWrapped) {
          currentGlobalCallback = currentOriginalCallback;
          globalCallback = currentGlobalCallback;
          logger("All middleware removed - callback unwrapped", "info");
        }
      }

      api.useMiddleware = function (middlewareFn: Loose, fn?: Loose) {
        const result = middleware.use(middlewareFn, fn);
        rewrapCallbackIfNeeded();
        return result;
      };
      api.removeMiddleware = function (identifier: Loose) {
        const result = middleware.remove(identifier);
        rewrapCallbackIfNeeded();
        return result;
      };
      api.clearMiddleware = function () {
        middleware.clear();
        rewrapCallbackIfNeeded();
      };
      api.listMiddleware = function () {
        return middleware.list();
      };
      api.setMiddlewareEnabled = function (name: string, enabled: boolean) {
        const result = middleware.setEnabled(name, enabled);
        rewrapCallbackIfNeeded();
        return result;
      };

      const existingMiddlewareCount = Object.getOwnPropertyDescriptor(api, "middlewareCount");
      if (!existingMiddlewareCount) {
        Object.defineProperty(api, "middlewareCount", {
          configurable: true,
          enumerable: false,
          get: function () {
            return (ctx._middleware && ctx._middleware.count) || 0;
          }
        });
      } else if (existingMiddlewareCount.configurable) {
        Object.defineProperty(api, "middlewareCount", {
          configurable: true,
          enumerable: existingMiddlewareCount.enumerable,
          get: function () {
            return (ctx._middleware && ctx._middleware.count) || 0;
          }
        });
      }

      return msgEmitter;
    };
  };
}
