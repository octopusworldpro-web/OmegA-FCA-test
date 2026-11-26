"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fca = require("../dist/index.js");

const aliceDh = fca.generateOmegAX25519KeyPair();
const bobDh = fca.generateOmegAX25519KeyPair();
const root = crypto.randomBytes(32);
const aliceSend = crypto.randomBytes(32);
const bobSend = crypto.randomBytes(32);
const alice = fca.createOmegADoubleRatchet({
  rootKey: root, localDh: aliceDh, remoteDh: bobDh.publicKey,
  sendChainKey: aliceSend, receiveChainKey: bobSend
});
const bob = fca.createOmegADoubleRatchet({
  rootKey: root, localDh: bobDh, remoteDh: aliceDh.publicKey,
  sendChainKey: bobSend, receiveChainKey: aliceSend
});
const aad = Buffer.from("thread:123");
const first = alice.encrypt(Buffer.from("first"), aad);
assert.equal(bob.decrypt(first, aad).toString(), "first");
const reply = bob.encrypt(Buffer.from("reply"), aad);
assert.equal(alice.decrypt(reply, aad).toString(), "reply");
const third = alice.encrypt(Buffer.from("third"), aad);
assert.equal(bob.decrypt(third, aad).toString(), "third");
assert.throws(() => bob.decrypt(third, aad), /authentication|Unsupported state|Invalid/);

const snapshot = alice.exportState();
const restored = fca.restoreOmegADoubleRatchet(snapshot);
const fourth = alice.encrypt(Buffer.from("persisted")), fourthPlain = restored.decrypt(fourth);
assert.equal(fourthPlain.toString(), "persisted");
assert.throws(() => fca.restoreOmegADoubleRatchet({ ...snapshot, rootKey: "bad" }), /32 bytes/);
console.log("OmegA Double Ratchet tests passed");
