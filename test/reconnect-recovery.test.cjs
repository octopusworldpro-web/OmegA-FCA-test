"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createSessionGuard,
  getMqttReconnectDelay,
  parseMqttJsonPayload,
  disposePreviousMqttClient,
  isValidSessionUserId,
  normalizeMqttSequenceId
} = require("../dist/index.js");

async function main() {
  assert.equal(getMqttReconnectDelay({ attempt: 1, baseDelayMs: 100, maxDelayMs: 1000 }), 100);
  assert.equal(getMqttReconnectDelay({ attempt: 3, baseDelayMs: 100, maxDelayMs: 1000 }), 400);
  assert.equal(getMqttReconnectDelay({ attempt: 9, baseDelayMs: 100, maxDelayMs: 1000 }), 1000);
  assert.equal(getMqttReconnectDelay({ attempt: 1, baseDelayMs: 100, jitterMs: 400, random: 0.5 }), 300);
  assert.deepEqual(parseMqttJsonPayload(Buffer.from('{"type":"message"}')), { type: "message" });
  assert.equal(parseMqttJsonPayload("{broken"), null);
  assert.equal(parseMqttJsonPayload("[]"), null);

  assert.equal(isValidSessionUserId("123456"), true);
  assert.equal(isValidSessionUserId("0"), false);
  assert.equal(isValidSessionUserId("abc"), false);
  assert.equal(normalizeMqttSequenceId("12345"), 12345);
  assert.equal(normalizeMqttSequenceId(0), 0);
  assert.equal(normalizeMqttSequenceId(-1), null);
  assert.equal(normalizeMqttSequenceId("1.5"), null);
  assert.equal(normalizeMqttSequenceId(Number.MAX_SAFE_INTEGER + 1), null);

  let removed = 0;
  let ended = 0;
  const previous = {
    connected: false,
    removeAllListeners() { removed += 1; },
    end(force) { assert.equal(force, true); ended += 1; }
  };
  const context = { mqttClient: previous };
  assert.equal(disposePreviousMqttClient(context), true);
  assert.equal(removed, 1);
  assert.equal(ended, 1);
  assert.equal(context.mqttClient, undefined);
  assert.equal(disposePreviousMqttClient(context), false);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-session-"));
  const filePath = path.join(directory, "account.txt");
  const validState = [
    { key: "c_user", value: "123456789", domain: ".facebook.com" },
    { key: "xs", value: "session-token", domain: ".facebook.com" }
  ];
  let currentState = validState;
  const logs = [];
  const guard = createSessionGuard(filePath, "123456789", () => currentState, (message, type) => logs.push({ message, type }), {
    interval: 60000,
    debounce: 0
  });
  try {
    const saved = fs.readFileSync(filePath, "utf8");
    assert.deepEqual(JSON.parse(saved), validState);
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);

    currentState = [
      { key: "c_user", value: "999999999", domain: ".facebook.com" },
      { key: "xs", value: "other-account", domain: ".facebook.com" }
    ];
    guard.saveNow();
    assert.equal(fs.readFileSync(filePath, "utf8"), saved);
    assert.ok(logs.some((entry) => /does not match/.test(entry.message)));

    guard.stop();
    currentState = validState.map((cookie) => ({ ...cookie, value: cookie.key === "xs" ? "after-stop" : cookie.value }));
    guard.saveNow();
    assert.equal(fs.readFileSync(filePath, "utf8"), saved);
  } finally {
    guard.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }

  console.log("Reconnect and session recovery tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
