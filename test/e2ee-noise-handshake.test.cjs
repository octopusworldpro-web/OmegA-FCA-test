"use strict";
const assert = require("node:assert/strict");
const fca = require("../dist/index.js");

assert.equal(typeof fca.performMessengerNoiseXXHandshake, "function");
assert.equal(typeof fca.buildMessengerClientPayload, "function");
assert.equal(typeof fca.MessengerNoiseFrameCipher, "function");

const payload = fca.buildMessengerClientPayload({ fbid: "123456789", deviceId: 7, fbCat: "cat-fixture" });
assert.ok(Buffer.isBuffer(payload) && payload.length > 20);
assert.throws(() => fca.buildMessengerClientPayload({ fbid: "abc", deviceId: 7, fbCat: "cat" }), /numeric/);
assert.throws(() => fca.buildMessengerClientPayload({ fbid: "123", deviceId: -1, fbCat: "cat" }), /device ID/);

const keyA = Buffer.alloc(32, 0x11);
const keyB = Buffer.alloc(32, 0x22);
const a = new fca.MessengerNoiseFrameCipher(keyA, keyB);
const b = new fca.MessengerNoiseFrameCipher(keyB, keyA);
const frame = a.encryptFrame(Buffer.from("offline-noise-fixture"));
assert.equal(b.decryptLengthPrefixedFrame(frame).toString(), "offline-noise-fixture");
assert.throws(() => b.decryptLengthPrefixedFrame(Buffer.from([0, 0, 0])), /truncated/);

const transport = {
  sent: [],
  async send(data) { this.sent.push(Buffer.from(data)); },
  async read(length) { return Buffer.alloc(length); }
};
(async () => {
  await assert.rejects(fca.performMessengerNoiseXXHandshake({
    transport, staticPrivateKey: Buffer.alloc(32, 1), fbid: "123456789", deviceId: 7, fbCat: "cat",
    verifyCertificate: () => { throw new Error("fixture certificate rejected"); }
  }), /Messenger Noise server ephemeral key|protobuf|truncated/);
  assert.ok(transport.sent.length === 1);
  console.log("Messenger Noise framing/client-payload offline tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
