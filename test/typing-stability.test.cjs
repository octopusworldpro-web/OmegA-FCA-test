"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  createSendTypingIndicatorCommand,
  createRealtimeListener
} = require("../dist/index.js");

async function main() {
  const published = [];
  const ctx = {
    mqttClient: {
      connected: true,
      publish(topic, payload, options, callback) {
        published.push({ topic, payload: JSON.parse(payload) });
        callback(null);
      },
      removeAllListeners() {},
      end(_force, callback) { callback?.(); }
    },
    globalOptions: { autoReconnect: true },
    wsReqNumber: 0,
    _stopRequested: false,
    _ending: false
  };
  const typing = createSendTypingIndicatorCommand({ ctx });
  await typing("12345", true, { duration: 60000 });
  assert.equal(published.length, 1);
  assert.equal(ctx._typingStopTimers.size, 1);

  // A later explicit stop cancels the scheduled auto-stop for the same thread.
  await typing("12345", false);
  assert.equal(published.length, 2);
  assert.equal(ctx._typingStopTimers.size, 0);

  await typing("12345", true, { duration: 60000 });
  assert.equal(ctx._typingStopTimers.size, 1);

  const attach = createRealtimeListener({
    EventEmitter,
    logger: () => undefined,
    emitAuth: () => undefined,
    createMiddlewareSystem: () => ({
      use: () => undefined, remove: () => false, clear: () => undefined,
      list: () => [], setEnabled: () => false, wrapCallback: (fn) => fn, count: 0
    }),
    topics: [],
    listenMqttCore: () => undefined,
    getSeqIDFactory: async () => undefined
  });
  const listen = attach({}, {}, ctx);
  const emitter = listen(undefined, { cycleMs: 0 });
  await emitter.stopListeningAsync();
  assert.equal(ctx._typingStopTimers.size, 0);

  console.log("Typing timer lifecycle tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
