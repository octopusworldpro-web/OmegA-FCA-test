"use strict";
const assert = require("node:assert/strict");
const { createOutgoingActionLimiter } = require("../dist/index.js");

async function main() {
  let time = 1000;
  const waits = [];
  const limiter = createOutgoingActionLimiter({
    perThreadCooldownMs: 400,
    globalCooldownMs: 150,
    now: () => time,
    wait: async (ms) => { waits.push(ms); time += ms; }
  });
  const order = [];
  await Promise.all([
    limiter.schedule("thread-a", async () => { order.push("a1"); }),
    limiter.schedule("thread-a", async () => { order.push("a2"); }),
    limiter.schedule("thread-b", async () => { order.push("b1"); })
  ]);
  assert.equal(order.length, 3);
  assert.equal(new Set(order).size, 3);
  assert.ok(waits.every((delay) => delay >= 0));
  assert.ok(waits.length >= 1, "cooldown should delay burst actions");

  let called = false;
  const wrapped = limiter.wrap((message, threadID, callback) => {
    called = true;
    callback?.(null, "ok");
    return "ok";
  });
  let callbackResult;
  const result = await wrapped("hello", "thread-c", (error, value) => {
    assert.equal(error, null);
    callbackResult = value;
  });
  assert.equal(result, "ok");
  assert.equal(callbackResult, "ok");
  assert.equal(called, true);
  console.log("Outgoing action limiter tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
