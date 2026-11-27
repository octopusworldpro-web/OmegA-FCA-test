"use strict";
const assert = require("node:assert/strict");
const fca = require("../dist/index.js");

const binary = (tag, content) => ({ tag, attrs: {}, content });
const responseDevices = {
  tag: "iq", attrs: {}, content: [{
    tag: "users", attrs: {}, content: [{
      tag: "user", attrs: { jid: "123456789.0@msgr" }, content: [{
        tag: "devices", attrs: {}, content: [
          { tag: "device", attrs: { id: "17" } },
          { tag: "device", attrs: { id: "18" } }
        ]
      }]
    }]
  }]
};
const key = Buffer.alloc(32, 7);
const responseBundle = {
  tag: "iq", attrs: {}, content: [
    { tag: "user", attrs: { jid: "123456789.17@msgr" }, content: [
      binary("registration", Buffer.from([0, 0, 0, 9])),
      binary("identity", key),
      { tag: "skey", attrs: {}, content: [
        binary("id", Buffer.from([0, 0, 3])),
        binary("value", key),
        binary("signature", Buffer.alloc(64, 4))
      ] }
    ] },
    { tag: "key", attrs: {}, content: [{
      tag: "key", attrs: {}, content: [
        binary("id", Buffer.from([0, 0, 5])),
        binary("value", key)
      ]
    }] }
  ]
};
let calls = 0;
const socket = {
  async sendIQ(stanza, id) {
    calls++;
    assert.ok(Buffer.isBuffer(stanza));
    assert.ok(id);
    return calls === 1 ? responseDevices : responseBundle;
  }
};
(async () => {
  const directory = new fca.MessengerPeerDirectory(socket);
  assert.deepEqual(await directory.listDevices("123456789"), [
    { name: "123456789", deviceId: 17 },
    { name: "123456789", deviceId: 18 }
  ]);
  const bundle = await directory.fetchPreKeyBundle({ name: "123456789", deviceId: 17 });
  assert.equal(bundle.registrationId, 9);
  assert.equal(bundle.deviceId, 17);
  assert.equal(bundle.signedPreKey.keyId, 3);
  assert.equal(bundle.preKey.keyId, 5);
  assert.equal(bundle.identityKey.length, 33);

  let args;
  const signal = {
    PublicKey: { deserialize(value) { assert.equal(value.length, 33); return { value }; } },
    PreKeyBundle: { new(...values) { args = values; return { values }; } }
  };
  const native = fca.buildMessengerSignalPreKeyBundle(signal, bundle);
  assert.ok(native);
  assert.equal(args[0], 9);
  assert.equal(args[1], 17);
  assert.equal(args[2], 5);
  assert.equal(args[4], 3);
  assert.equal(args[8], null);
  console.log("Messenger peer directory and Signal PreKeyBundle fixtures passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
