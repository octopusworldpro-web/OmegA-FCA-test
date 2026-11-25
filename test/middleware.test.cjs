"use strict";

const assert = require("node:assert/strict");
const { createRealtimeMiddlewareSystem } = require("../dist/index.js");

async function runProcess(system, event) {
  return new Promise((resolve) => system.process(event, (error, result) => resolve({ error, result })));
}

async function main() {
  const system = createRealtimeMiddlewareSystem();
  let count = 0;

  system.use("sync-next", (_event, next) => { count += 1; next(); });
  system.use("async-next", async (_event, next) => {
    count += 1;
    next();
    await Promise.resolve();
  });
  system.use("tail", (_event, next) => { count += 1; next(); });

  const passed = await runProcess(system, { type: "message" });
  assert.equal(passed.error, null);
  assert.deepEqual(passed.result, { type: "message" });
  assert.equal(count, 3, "each middleware must advance exactly once");

  system.clear();
  let asyncCount = 0;
  system.use("promise-auto-next", async () => { await Promise.resolve(); asyncCount += 1; });
  system.use("promise-tail", (_event, next) => { asyncCount += 1; next(); });
  const asyncPassed = await runProcess(system, { type: "message" });
  assert.deepEqual(asyncPassed.result, { type: "message" });
  assert.equal(asyncCount, 2);

  // A callback wrapped before middleware is installed must still observe
  // middleware added later (the Humanizer is enabled after listenMqtt starts).
  system.clear();
  let lateEvent;
  const liveCallback = system.wrapCallback((_error, event) => { lateEvent = event; });
  system.use("late-humanizer", (event, next) => { event.lateFlag = true; next(); });
  liveCallback(null, { type: "message" });
  assert.equal(lateEvent?.lateFlag, true, "late-installed middleware must run through an existing callback wrapper");

  system.clear();
  system.use("drop", () => false);
  const dropped = await runProcess(system, { type: "message" });
  assert.equal(dropped.result, null);

  system.clear();
  system.use("error", (_event, next) => next(new Error("middleware failure")));
  const failed = await runProcess(system, { type: "message" });
  assert.match(failed.error.message, /middleware failure/);

  system.clear();
  system.use("throw", () => { throw new Error("sync throw"); });
  const thrown = await runProcess(system, { type: "message" });
  assert.match(thrown.error.message, /sync throw/);

  console.log("Realtime middleware tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
