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
    perThread: true
  });

  let called = false;
  handler({ type: "message", threadID: "123" }, () => { called = true; });
  assert.strictEqual(called, false, "enabled humanizer should delay message middleware");
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.strictEqual(called, true, "delayed middleware should continue");
  assert.strictEqual(typingCalls.length, 1, "humanizer should send a typing indicator");

  humanizer.setOptions({ enabled: false });
  called = false;
  handler({ type: "message", threadID: "123" }, () => { called = true; });
  assert.strictEqual(called, true, "disabled humanizer should pass messages immediately");

  called = false;
  handler({ type: "presence", threadID: "123" }, () => { called = true; });
  assert.strictEqual(called, true, "non-message events should never be delayed");

  humanizer.setOptions({ enabled: true, reactDelayMs: [0, 0], cooldownMs: 0 });
  assert.deepStrictEqual(humanizer.getOptions().reactDelayMs, [0, 0]);
  humanizer.reset();

  // Same-thread events are serialized instead of sharing overlapping delays.
  humanizer.setOptions({ enabled: true, reactDelayMs: 25, cooldownMs: 25, maxPerMinute: 10 });
  const order = [];
  const started = Date.now();
  handler({ type: "message", threadID: "queue-thread" }, () => order.push("first"));
  handler({ type: "message", threadID: "queue-thread" }, () => order.push("second"));
  await new Promise((resolve) => setTimeout(resolve, 65));
  assert.deepStrictEqual(order, ["first", "second"], "same-thread messages should continue in FIFO order");
  assert(Date.now() - started >= 40, "same-thread cooldown should space queued messages");

  // Reset must release pending middleware callbacks rather than leaving the
  // realtime middleware pipeline waiting for an obsolete timer.
  let releasedByReset = false;
  handler({ type: "message", threadID: "reset-thread" }, () => { releasedByReset = true; });
  assert.strictEqual(releasedByReset, false);
  humanizer.reset();
  assert.strictEqual(releasedByReset, true, "reset should release pending middleware callbacks");

  // A zero per-minute cap means unlimited, not disabled.
  humanizer.setOptions({ enabled: true, reactDelayMs: 0, cooldownMs: 0, maxPerMinute: 0 });
  let unlimitedCount = 0;
  for (let i = 0; i < 25; i++) handler({ type: "message", threadID: "unlimited" }, () => { unlimitedCount++; });
  assert.strictEqual(unlimitedCount, 25, "maxPerMinute=0 should disable the cap");
  humanizer.reset();
  console.log("Humanizer tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
