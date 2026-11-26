"use strict";
const assert = require("node:assert/strict");
const { initializeE2EEForLogin } = require("../dist/index.js");

(async () => {
  const disabled = await initializeE2EEForLogin("123456789", { enabled: false });
  assert.equal(disabled.status, "disabled");

  let bootstrapCalled = false;
  let runtimeOptions;
  const runtime = { close: async () => {} };
  const ready = await initializeE2EEForLogin("123456789", { enabled: true }, {
    bootstrap: async (accountId) => {
      bootstrapCalled = true;
      assert.equal(accountId, "123456789");
      return { storagePath: "/tmp/account.signal", encryptionKey: Buffer.alloc(32, 7), localDeviceId: 123, signal: { marker: true } };
    },
    runtime: async (options) => { runtimeOptions = options; return runtime; }
  });
  assert.equal(bootstrapCalled, true);
  assert.equal(ready.status, "ready");
  assert.equal(ready.runtime, runtime);
  assert.equal(runtimeOptions.accountId, "123456789");
  assert.equal(runtimeOptions.signal.marker, true);
  assert.equal(runtimeOptions.localDeviceId, 123);

  const failed = await initializeE2EEForLogin("123456789", { enabled: true }, {
    bootstrap: async () => { throw new Error("simulated E2EE failure"); }
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.runtime, null);
  assert.match(failed.error, /simulated E2EE failure/);
  console.log("E2EE authenticated-login integration and fail-open tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
