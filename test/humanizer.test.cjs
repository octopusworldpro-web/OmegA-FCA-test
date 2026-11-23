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
  console.log("Humanizer tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
