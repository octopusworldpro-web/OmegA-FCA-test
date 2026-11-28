"use strict";

const assert = require("assert");
const { createHumanizerController } = require("../dist/index.js");

async function run() {
  let handler;
  const middleware = {
    use(name, fn) {
      assert.strictEqual(name, "omega-humanizer");
      handler = fn;
    }
  };
  const typingCalls = [];
  const humanizer = createHumanizerController(middleware, (...args) => {
    typingCalls.push(args);
    return Promise.resolve(true);
  });

  humanizer.setOptions({
    enabled: true,
    reactDelayMs: 5,
    cooldownMs: 0,
    maxPerMinute: 10,
    perThread: true,
    commandPrefixes: ["!"]
  });

  // Ordinary chat must pass immediately and must not trigger typing.
  let called = false;
  handler({ type: "message", body: "hello there", threadID: "123" }, () => { called = true; });
  assert.strictEqual(called, true, "plain chat should bypass humanizer immediately");
  assert.strictEqual(typingCalls.length, 0, "plain chat must not send a typing indicator");

  // Prefix commands are delayed and receive the typing indicator.
  called = false;
  handler({ type: "message", body: "!help", threadID: "123" }, () => { called = true; });
  assert.strictEqual(called, false, "configured prefix command should be delayed");
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.strictEqual(called, true, "command middleware should continue after delay");
  assert.strictEqual(typingCalls.length, 1, "command should send a typing indicator");

  // Reply events support the same command detection path.
  called = false;
  handler({ type: "message_reply", body: "!menu", threadID: "123" }, () => { called = true; });
  assert.strictEqual(called, false, "message_reply command should be delayed");
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.strictEqual(called, true);

  // Explicit parser metadata can identify commands without a textual prefix.
  called = false;
  handler({ type: "message", body: "help", isCommand: true, threadID: "123" }, () => { called = true; });
  assert.strictEqual(called, false, "explicit command metadata should be honored");
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.strictEqual(called, true);

  // A bare prefix is not a command.
  called = false;
  handler({ type: "message", body: "!", threadID: "123" }, () => { called = true; });
  assert.strictEqual(called, true, "bare prefix should bypass humanizer");

  // When a command registry is supplied, only registered names/aliases are delayed.
  humanizer.setOptions({
    enabled: true,
    reactDelayMs: 5,
    cooldownMs: 0,
    commandPrefixes: ["!"],
    commandNames: ["help", "menu", "h"]
  });
  called = false;
  handler({ type: "message", body: "!unknown", threadID: "123" }, () => { called = true; });
  assert.strictEqual(called, true, "unknown prefixed text should bypass when registry matching is enabled");
  called = false;
  handler({ type: "message", body: "!h arg", threadID: "123" }, () => { called = true; });
  assert.strictEqual(called, false, "registered aliases should be recognized");
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.strictEqual(called, true);

  // Bare commands are delayed only when no-prefix is enabled and sender is a configured admin.
  humanizer.setOptions({
    enabled: true,
    reactDelayMs: 5,
    cooldownMs: 0,
    commandPrefixes: ["!"],
    commandNames: ["help", "menu", "h"],
    noPrefixEnabled: true,
    noPrefixAdminIds: ["admin-1"]
  });
  called = false;
  handler({ type: "message", body: "help", senderID: "ordinary-user", threadID: "123" }, () => { called = true; });
  assert.strictEqual(called, true, "non-admin bare text must bypass humanizer");
  called = false;
  handler({ type: "message", body: "help", senderID: "admin-1", threadID: "123" }, () => { called = true; });
  assert.strictEqual(called, false, "registered no-prefix admin command should be delayed");
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.strictEqual(called, true);

  humanizer.setOptions({ enabled: false });
  called = false;
  handler({ type: "message", body: "!help", threadID: "123" }, () => { called = true; });
  assert.strictEqual(called, true, "disabled humanizer should pass commands immediately");

  called = false;
  handler({ type: "presence", threadID: "123" }, () => { called = true; });
  assert.strictEqual(called, true, "non-message events should never be delayed");

  humanizer.setOptions({ enabled: true, reactDelayMs: [0, 0], cooldownMs: 0 });
  assert.deepStrictEqual(humanizer.getOptions().reactDelayMs, [0, 0]);
  humanizer.reset();

  // Same-thread command events are serialized in FIFO order.
  humanizer.setOptions({ enabled: true, reactDelayMs: 25, cooldownMs: 25, maxPerMinute: 10, commandPrefixes: ["!"], commandNames: [], noPrefixEnabled: false, noPrefixAdminIds: [] });
  const order = [];
  const started = Date.now();
  handler({ type: "message", body: "!one", threadID: "queue-thread" }, () => order.push("first"));
  handler({ type: "message", body: "!two", threadID: "queue-thread" }, () => order.push("second"));
  await new Promise((resolve) => setTimeout(resolve, 65));
  assert.deepStrictEqual(order, ["first", "second"], "same-thread commands should continue in FIFO order");
  assert(Date.now() - started >= 40, "same-thread cooldown should space queued commands");

  // delayMs (mapped by GoatBot to reactDelayMs) and cooldownMs are independent
  // config controls: delay sets the reaction wait; cooldown enforces the minimum
  // spacing between accepted commands on the same thread.
  humanizer.setOptions({ enabled: true, reactDelayMs: 0, cooldownMs: 35, maxPerMinute: 10, commandPrefixes: ["!"], commandNames: [] });
  assert.strictEqual(humanizer.getOptions().reactDelayMs, 0);
  assert.strictEqual(humanizer.getOptions().cooldownMs, 35);
  const cooldownOrder = [];
  handler({ type: "message", body: "!cooldown-first", threadID: "config-cooldown" }, () => cooldownOrder.push("first"));
  handler({ type: "message", body: "!cooldown-second", threadID: "config-cooldown" }, () => cooldownOrder.push("second"));
  assert.deepStrictEqual(cooldownOrder, ["first"], "cooldownMs from config should hold the next same-thread command");
  await new Promise((resolve) => setTimeout(resolve, 55));
  assert.deepStrictEqual(cooldownOrder, ["first", "second"], "configured cooldown should release the queued command");

  // Updating the options at runtime must replace the previous config values.
  humanizer.setOptions({ enabled: true, reactDelayMs: 30, cooldownMs: 0, commandPrefixes: ["!"] });
  assert.strictEqual(humanizer.getOptions().reactDelayMs, 30);
  assert.strictEqual(humanizer.getOptions().cooldownMs, 0);
  let configDelayReleased = false;
  const configDelayStarted = Date.now();
  handler({ type: "message", body: "!configured-delay", threadID: "config-delay" }, () => { configDelayReleased = true; });
  assert.strictEqual(configDelayReleased, false, "configured delayMs should delay command processing");
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.strictEqual(configDelayReleased, true);
  assert(Date.now() - configDelayStarted >= 25, "configured delayMs should determine the reaction wait when cooldownMs is zero");

  // Reset must release pending middleware callbacks rather than leaving the
  // realtime middleware pipeline waiting for an obsolete timer.
  let releasedByReset = false;
  handler({ type: "message", body: "!pending", threadID: "reset-thread" }, () => { releasedByReset = true; });
  assert.strictEqual(releasedByReset, false);
  humanizer.reset();
  assert.strictEqual(releasedByReset, true, "reset should release pending middleware callbacks");

  // A zero per-minute cap means unlimited, not disabled.
  humanizer.setOptions({ enabled: true, reactDelayMs: 0, cooldownMs: 0, maxPerMinute: 0, commandPrefixes: ["!"], commandNames: [], noPrefixEnabled: false, noPrefixAdminIds: [] });
  let unlimitedCount = 0;
  for (let i = 0; i < 25; i++) handler({ type: "message", body: "!run", threadID: "unlimited" }, () => { unlimitedCount++; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.strictEqual(unlimitedCount, 25, "maxPerMinute=0 should disable the cap");
  humanizer.reset();
  console.log("Humanizer tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
