"use strict";

const assert = require("node:assert/strict");
const { dispatchAutomaticReceipts, createRealtimeListener } = require("../dist/index.js");
const { EventEmitter } = require("node:events");

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function main() {
  const calls = [];
  const warnings = [];
  const api = {
    markAsDelivered: (...args) => { calls.push(["delivery", ...args]); },
    markAsRead: (...args) => { calls.push(["read", ...args]); }
  };
  const logger = (message, level) => warnings.push({ message, level });

  dispatchAutomaticReceipts(api, {
    autoMarkDelivery: true,
    autoMarkRead: true
  }, { threadID: "thread-1", messageID: "message-1" }, logger);
  await flush();
  assert.deepEqual(calls, [
    ["delivery", "thread-1", "message-1"],
    ["read", "thread-1", true]
  ]);

  calls.length = 0;
  dispatchAutomaticReceipts(api, {
    autoMarkDelivery: false,
    autoMarkRead: true
  }, { threadID: "thread-2", messageID: "message-2" }, logger);
  await flush();
  assert.deepEqual(calls, [["read", "thread-2", true]]);

  calls.length = 0;
  dispatchAutomaticReceipts(api, {}, { threadID: "thread-3", messageID: "message-3" }, logger);
  await flush();
  assert.deepEqual(calls, []);

  calls.length = 0;
  dispatchAutomaticReceipts(api, {
    autoMarkDelivery: true,
    autoMarkRead: true
  }, { threadID: "", messageID: "message-4" }, logger);
  await flush();
  assert.deepEqual(calls, []);

  const failingApi = {
    markAsDelivered: async () => { throw new Error("delivery unavailable"); },
    markAsRead: async () => { throw new Error("read unavailable"); }
  };
  dispatchAutomaticReceipts(failingApi, {
    autoMarkDelivery: true,
    autoMarkRead: true
  }, { threadID: "thread-5", messageID: "message-5" }, logger);
  await flush();
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((entry) => entry.level === "warn"));

  // Verify receipts are wired into the actual MQTT incoming-message callback.
  const listenerCalls = [];
  let mqttCallback;
  const listenerApi = {
    markAsDelivered: (...args) => { listenerCalls.push(["delivery", ...args]); },
    markAsRead: (...args) => { listenerCalls.push(["read", ...args]); }
  };
  const ctx = {
    globalOptions: { autoMarkDelivery: true, autoMarkRead: true },
    firstListen: true,
    lastSeqId: "1",
    mqttClient: null
  };
  const attachListener = createRealtimeListener({
    EventEmitter,
    logger: () => undefined,
    emitAuth: () => undefined,
    createMiddlewareSystem: () => ({
      use: () => undefined, remove: () => false, clear: () => undefined,
      list: () => [], setEnabled: () => false, wrapCallback: (fn) => fn, count: 0
    }),
    topics: [],
    listenMqttCore: (_funcs, _api, _ctx, callback) => { mqttCallback = callback; },
    getSeqIDFactory: async () => undefined
  });
  const listen = attachListener({}, listenerApi, ctx);
  listen(undefined, { cycleMs: 0 });
  assert.equal(typeof mqttCallback, "function");
  mqttCallback(null, {
    type: "message", threadID: "thread-live", messageID: "message-live"
  });
  await flush();
  assert.deepEqual(listenerCalls, [
    ["delivery", "thread-live", "message-live"],
    ["read", "thread-live", true]
  ]);

  listenerCalls.length = 0;
  mqttCallback(null, { type: "message_reaction", threadID: "thread-live", messageID: "reaction-1" });
  await flush();
  assert.deepEqual(listenerCalls, []);
  await listenerApi.stopListeningAsync();

  console.log("Automatic Messenger receipt tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
