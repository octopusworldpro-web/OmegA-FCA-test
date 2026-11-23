"use strict";

const assert = require("node:assert/strict");
const { requestWithRetry } = require("../dist/index.js");

async function main() {
  let attempts = 0;
  const emitted = [];
  const context = {
    _emitter: {
      emit(event, payload) {
        emitted.push({ event, payload });
      }
    }
  };

  const result = await requestWithRetry(async () => {
    attempts += 1;
    return { status: 200, data: { ok: true } };
  }, 3, 1000, context);

  assert.deepEqual(result, { status: 200, data: { ok: true } });
  assert.equal(attempts, 1, "a successful normal request must execute exactly once");
  assert.deepEqual(emitted, [], "normal requests must not emit rate-limit or network warnings");

  let noContextAttempts = 0;
  const noContextResult = await requestWithRetry(async () => {
    noContextAttempts += 1;
    return "unchanged";
  });

  assert.equal(noContextResult, "unchanged");
  assert.equal(noContextAttempts, 1, "default retry settings must not affect successful requests");

  console.log("Smart safety normal-condition tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
