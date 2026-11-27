"use strict";
const assert = require("node:assert/strict");
const fca = require("../dist/index.js");

(async () => {
  const calls = [];
  let persistedDevice;
  const privateKey = {
    sign: (bytes) => Buffer.from("signed:").toString("utf8") && Buffer.from(bytes).subarray(0, 16)
  };
  const options = {
    fbid: "123456789",
    fbCat: "www",
    appId: "219994525426954",
    cookies: "c_user=123456789; xs=test",
    userAgent: "test-agent",
    deviceId: "11111111-2222-4333-8444-555555555555",
    signedPreKeyId: 1,
    signal: { PrivateKey: { deserialize: () => privateKey } },
    store: {
      getRegistrationId: () => 4567,
      getDeviceRecord: () => persistedDevice,
      setDeviceRecord: async (record) => { persistedDevice = record; calls.push({ persisted: record }); },
      getIdentityKeyPair: () => ({
        publicKey: Buffer.concat([Buffer.from([5]), Buffer.alloc(32, 1)]).toString("base64"),
        privateKey: Buffer.alloc(32, 2).toString("base64")
      }),
      loadSignedPreKey: (id) => id === 1 ? {
        keyId: 1,
        publicKey: Buffer.concat([Buffer.from([5]), Buffer.alloc(32, 3)]).toString("base64"),
        privateKey: Buffer.alloc(32, 4).toString("base64"),
        signature: Buffer.alloc(64, 5).toString("base64"),
        createdAt: 1700000000
      } : undefined
    },
    now: () => 1700000000000,
    fetch: async (url, init) => {
      calls.push({ url, body: init.body });
      if (url.endsWith("fb_icdc_fetch")) {
        return { ok: true, json: async () => ({ status: 200, device_identities: [Buffer.alloc(32, 9).toString("base64url")], icdc_seq: 7 }) };
      }
      return { ok: true, json: async () => ({ status: 200, wa_device_id: 42 }) };
    }
  };
  const result = await fca.registerFacebookE2EEDevice(options);
  assert.equal(result.waDeviceId, 42);
  assert.equal(result.icdcSequence, 8);
  assert.equal(result.deviceId, options.deviceId);
  assert.equal(calls.filter((call) => call.url).length, 2);
  assert.equal(calls.find((call) => call.persisted)?.persisted.waDeviceId, 42);
  assert.match(calls[0].url, /fb_icdc_fetch$/);
  assert.match(calls[1].url, /fb_register_v2$/);
  assert.match(calls[1].body, /e_ident=/);
  const repeat = await fca.registerFacebookE2EEDevice({
    ...options,
    fetch: async () => { throw new Error("registered device must not register again"); }
  });
  assert.deepEqual(repeat, result);
  assert.equal(calls.filter((call) => call.url).length, 2);
  await assert.rejects(
    fca.registerFacebookE2EEDevice({ ...options, force: true, fetch: async () => ({ ok: true, json: async () => ({ status: 403 }) }) }),
    /invalid ICDC device list/
  );
  console.log("Facebook E2EE device registration tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
