"use strict";

const assert = require("node:assert/strict");
const { createSchedulerDomain } = require("../dist/index.js");

async function main() {
  let currentTime = 1_000;
  const timeouts = [];
  const clearedTimeouts = [];
  const intervals = [];
  const clearedIntervals = [];
  const sent = [];

  const scheduler = createSchedulerDomain({
    now: () => currentTime,
    sendMessage: (...args) => { sent.push(args); },
    setTimeoutFn: (fn, delay) => {
      const timer = { fn, delay, cleared: false };
      timeouts.push(timer);
      return timer;
    },
    clearTimeoutFn: (timer) => {
      timer.cleared = true;
      clearedTimeouts.push(timer);
    },
    setIntervalFn: (fn, delay) => {
      const timer = { fn, delay, unrefCalled: false, unref() { this.unrefCalled = true; } };
      intervals.push(timer);
      return timer;
    },
    clearIntervalFn: (timer) => clearedIntervals.push(timer)
  });

  assert.equal(intervals[0].delay, 5 * 60 * 1000);
  assert.equal(intervals[0].unrefCalled, true, "cleanup interval must not keep Node alive");

  const farFuture = currentTime + 3_000_000_000;
  const id = scheduler.scheduleMessage("hello", "thread-1", farFuture);
  assert.equal(timeouts[0].delay, 2_147_483_647, "long delays must be safely chunked");
  assert.equal(scheduler.getScheduledCount(), 1);

  scheduler.cleanup();
  assert.equal(scheduler.getScheduledCount(), 1, "cleanup must not discard a pending message");

  timeouts[0].fn();
  assert.equal(sent.length, 0, "message must not send before its timestamp");
  assert.equal(timeouts[1].delay, farFuture - currentTime - 2_147_483_647);

  currentTime = farFuture;
  timeouts[1].fn();
  await Promise.resolve();
  assert.equal(sent.length, 1, "message sends once it is due");
  assert.equal(sent[0][0], "hello");
  assert.equal(scheduler.getScheduledCount(), 0);

  const cancelId = scheduler.scheduleMessage("cancel", "thread-2", currentTime + 10_000);
  assert.equal(scheduler.cancelScheduledMessage(cancelId), true);
  assert.equal(scheduler.cancelScheduledMessage(cancelId), false);
  assert.equal(scheduler.getScheduledCount(), 0);

  scheduler.scheduleMessage("cleanup", "thread-3", currentTime + 10_000);
  assert.equal(scheduler.destroy(), 1);
  assert.equal(clearedIntervals.length, 1);
  assert.throws(
    () => scheduler.scheduleMessage("after destroy", "thread-4", currentTime + 20_000),
    /destroyed/
  );
  assert.ok(clearedTimeouts.length >= 2);

  console.log("Scheduler tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
