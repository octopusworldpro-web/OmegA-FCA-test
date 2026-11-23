"use strict";

const assert = require("node:assert/strict");
const { dispatchAutomaticReceipts } = require("../dist/index.js");

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

  console.log("Automatic Messenger receipt tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
