const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  attachE2EEInboxBridge,
  normalizeMessengerE2EEInboxMessage
} = require("../dist/cjs.cjs");

const source = {
  id: "e2ee-message-1",
  threadId: "123456789.0@msgr",
  senderId: "123456789",
  text: "hello from inbox",
  timestampMs: 1795860000000
};
const normalized = normalizeMessengerE2EEInboxMessage(source);
assert.equal(normalized.type, "message");
assert.equal(normalized.messageID, source.id);
assert.equal(normalized.threadID, "123456789");
assert.equal(normalized.senderID, "123456789");
assert.equal(normalized.body, source.text);
assert.equal(normalized.timestamp, source.timestampMs);
assert.equal(normalized.isGroup, false);
assert.equal(normalized.isE2EE, true);
assert.equal(normalizeMessengerE2EEInboxMessage({ ...source, threadId: "not-a-user" }), null);
assert.equal(normalizeMessengerE2EEInboxMessage({ ...source, text: "" }), null);

const messenger = new EventEmitter();
const delivered = [];
const diagnostics = [];
const detach = attachE2EEInboxBridge(messenger, event => delivered.push(event), (message, level) => diagnostics.push({ message, level }));
messenger.emit("inbox_diagnostic", { stage: "NOISE_MESSAGE_RECEIVED" });
assert.equal(diagnostics.some(item => item.message.includes("NOISE_MESSAGE_RECEIVED")), true);
messenger.emit("message", source);
assert.equal(diagnostics.some(item => item.message.includes("FCA_INBOX_CALLBACK_INVOKED")), true);
assert.equal(delivered.length, 1);
assert.equal(delivered[0].messageID, source.id);
const diagnosticCountBeforeDetach = diagnostics.length;
detach();
messenger.emit("message", { ...source, id: "after-detach" });
messenger.emit("inbox_diagnostic", { stage: "AFTER_DETACH" });
assert.equal(delivered.length, 1);
assert.equal(diagnostics.length, diagnosticCountBeforeDetach);

const failingMessenger = new EventEmitter();
const callbackErrors = [];
const detachFailing = attachE2EEInboxBridge(
  failingMessenger,
  () => { throw new Error("fixture callback failure"); },
  (message, level) => callbackErrors.push({ message, level })
);
assert.throws(() => failingMessenger.emit("message", source), /fixture callback failure/);
assert.equal(callbackErrors.some(item => item.level === "error" && item.message.includes("callback dispatch failed")), true);
detachFailing();
console.log("E2EE Inbox bridge tests passed");
