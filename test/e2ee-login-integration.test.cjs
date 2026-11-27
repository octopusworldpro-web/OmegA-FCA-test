"use strict";
const assert = require("node:assert/strict");
const { initializeE2EEForLogin } = require("../dist/index.js");

(async () => {
  const disabled = await initializeE2EEForLogin("123456789", { enabled: false });
  assert.equal(disabled.status, "disabled");

  let bootstrapCalled = false;
  let runtimeOptions;
  let runtimeClosed = false;
  const runtime = {
    store: {
      marker: true,
      listUnpublishedPreKeyIds: () => [1],
      isSignedPreKeyPublished: () => false,
      markPreKeysPublished: async () => {},
      markSignedPreKeyPublished: async () => {}
    }, registrationId: 456,
    identityKey: Buffer.concat([Buffer.from([5]), Buffer.alloc(32, 1)]).toString("base64"),
    signedPreKey: { keyId: 9, publicKey: Buffer.concat([Buffer.from([5]), Buffer.alloc(32, 2)]).toString("base64"), signature: Buffer.alloc(64, 3).toString("base64") },
    preKeys: [{ keyId: 1, publicKey: Buffer.concat([Buffer.from([5]), Buffer.alloc(32, 4)]).toString("base64") }],
    close: async () => { runtimeClosed = true; }
  };
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

  let registrationOptions;
  let catFetchCount = 0;
  const registered = await initializeE2EEForLogin("123456789", {
    enabled: true,
    facebook: { appId: "test-app", sendIQ: async (_stanza, id) => ({ tag: "iq", attrs: { id, type: "result" } }) }
  }, {
    bootstrap: async () => ({ storagePath: "/tmp/account.signal", encryptionKey: Buffer.alloc(32, 7), localDeviceId: 123, signal: { marker: true } }),
    runtime: async () => runtime,
    registerDevice: async (options) => { registrationOptions = options; return { deviceId: "device-1", waDeviceId: 42, registrationId: 456, signedPreKeyId: 9, icdcSequence: 8 }; },
    fetchCAT: async (options) => { catFetchCount++; assert.equal(options.fbid, "123456789"); assert.equal(options.fbDtsg, "dtsg"); return "cat-from-fixture"; }
  }, { cookies: "c_user=123456789; xs=session", userAgent: "test-agent", fbDtsg: "dtsg" });
  assert.equal(registered.status, "ready");
  assert.equal(registered.deviceRegistration.waDeviceId, 42);
  assert.equal(registered.preKeyPublication.uploaded, 1);
  assert.equal(catFetchCount, 1);
  assert.equal(registrationOptions.fbCat, "cat-from-fixture");
  assert.equal(registrationOptions.fbid, "123456789");
  assert.equal(registrationOptions.cookies, "c_user=123456789; xs=session");
  assert.equal(registrationOptions.userAgent, "test-agent");
  assert.equal(registrationOptions.signedPreKeyId, 9);
  assert.equal(registrationOptions.store.marker, true);

  const missingSession = await initializeE2EEForLogin("123456789", {
    enabled: true, facebook: { appId: "test-app", fbCat: "www" }
  }, { bootstrap: async () => ({ storagePath: "/tmp/account.signal", encryptionKey: Buffer.alloc(32, 7), localDeviceId: 123, signal: {} }), runtime: async () => runtime });
  assert.equal(missingSession.status, "failed");
  assert.match(missingSession.error, /authenticated cookie header/);
  assert.equal(runtimeClosed, true);

  const failed = await initializeE2EEForLogin("123456789", { enabled: true }, {
    bootstrap: async () => { throw new Error("simulated E2EE failure"); }
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.runtime, null);
  assert.match(failed.error, /simulated E2EE failure/);
  console.log("E2EE authenticated-login integration and fail-open tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
