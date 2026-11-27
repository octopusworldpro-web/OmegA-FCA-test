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

const { generateOmegAX25519KeyPair, deriveOmegAX25519, MessengerNoiseHandshakeState } = fca;
function readVarint(buf, state) {
  let n = 0, shift = 0;
  while (true) { const b = buf[state.i++]; n |= (b & 127) << shift; if (!(b & 128)) return n; shift += 7; }
}
function readField(buf, wanted) {
  const state = { i: 0 };
  while (state.i < buf.length) {
    const tag = readVarint(buf, state), field = tag >> 3, wire = tag & 7;
    if (wire !== 2) throw new Error("fixture expects length-delimited field");
    const len = readVarint(buf, state), value = buf.subarray(state.i, state.i + len); state.i += len;
    if (field === wanted) return Buffer.from(value);
  }
  throw new Error("fixture field missing");
}
function fieldBytes(field, value) {
  const vi = (n) => { const a=[]; do { let b=n&127; n >>>=7; if(n)b|=128; a.push(b); } while(n); return Buffer.from(a); };
  return Buffer.concat([vi((field<<3)|2),vi(value.length),value]);
}
const transport = {
  sent: [],
  async send(data) { this.sent.push(Buffer.from(data)); },
  async read(length) { return Buffer.alloc(length); }
};
(async () => {
  const clientStatic = generateOmegAX25519KeyPair();
  const serverStatic = generateOmegAX25519KeyPair();
  const serverEphemeral = generateOmegAX25519KeyPair();
  const incoming = [];
  const simulated = {
    sent: [],
    async send(data) { this.sent.push(Buffer.from(data)); },
    async read(length) {
      if (!incoming.length) throw new Error("simulated server has no queued bytes");
      const first = incoming[0];
      const out = first.subarray(0, length);
      if (out.length !== length) throw new Error("simulated server frame underflow");
      if (out.length === first.length) incoming.shift(); else incoming[0] = first.subarray(length);
      return Buffer.from(out);
    }
  };
  const serverState = new MessengerNoiseHandshakeState();
  const result = await fca.performMessengerNoiseXXHandshake({
    transport: {
      send: simulated.send.bind(simulated),
      read: async (length) => {
        if (incoming.length) return simulated.read(length);
        const clientHello = simulated.sent[0];
        const clientEphemeral = readField(readField(clientHello.subarray(7), 2), 1);
        serverState.mixHash(clientEphemeral);
        serverState.mixHash(serverEphemeral.publicKey);
        serverState.mixDH(serverEphemeral.privateKey, clientEphemeral);
        const encryptedStatic = serverState.encrypt(serverStatic.publicKey);
        serverState.mixDH(serverStatic.privateKey, clientEphemeral);
        const encryptedCert = serverState.encrypt(Buffer.from("synthetic-certificate-chain"));
        const serverHello = fieldBytes(3, Buffer.concat([
          fieldBytes(1, serverEphemeral.publicKey),
          fieldBytes(2, encryptedStatic),
          fieldBytes(3, encryptedCert)
        ]));
        const framed = Buffer.alloc(3 + serverHello.length);
        framed.writeUIntBE(serverHello.length, 0, 3);
        serverHello.copy(framed, 3);
        incoming.push(framed);
        return simulated.read(length);
      }
    },
    staticPrivateKey: clientStatic.privateKey,
    fbid: "123456789",
    deviceId: 7,
    fbCat: "cat-fixture",
    verifyCertificate: (chain, serverKey) => {
      assert.equal(chain.toString(), "synthetic-certificate-chain");
      assert.deepEqual(Buffer.from(serverKey), serverStatic.publicKey);
    }
  });
  const finishFrame = simulated.sent[1];
  const finish = readField(finishFrame.subarray(3), 4);
  const encryptedClientStatic = readField(finish, 1);
  const encryptedClientPayload = readField(finish, 2);
  const receivedClientStatic = serverState.decrypt(encryptedClientStatic);
  assert.deepEqual(receivedClientStatic, deriveOmegAX25519(clientStatic.privateKey, Buffer.from([9, ...Array(31).fill(0)])));
  serverState.mixDH(serverEphemeral.privateKey, receivedClientStatic);
  const receivedClientPayload = serverState.decrypt(encryptedClientPayload);
  assert.ok(receivedClientPayload.includes(Buffer.from("cat-fixture")));
  const serverKeys = serverState.finish();
  const serverCipher = new fca.MessengerNoiseFrameCipher(serverKeys.receiveKey, serverKeys.sendKey);
  const clientFrame = result.cipher.encryptFrame(Buffer.from("noise-xx-success"));
  assert.equal(serverCipher.decryptLengthPrefixedFrame(clientFrame).toString(), "noise-xx-success");

  await assert.rejects(fca.performMessengerNoiseXXHandshake({
    transport, staticPrivateKey: Buffer.alloc(32, 1), fbid: "123456789", deviceId: 7, fbCat: "cat",
    verifyCertificate: () => { throw new Error("fixture certificate rejected"); }
  }), /Messenger Noise server ephemeral key|handshake field 3 is missing|truncated|frame length/);
  assert.ok(transport.sent.length === 1);
  console.log("Messenger Noise framing/client-payload offline tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
