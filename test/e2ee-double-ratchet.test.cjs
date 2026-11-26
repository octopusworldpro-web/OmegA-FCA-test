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
const tamperedFirst = structuredClone(first);
tamperedFirst.body.tag = Buffer.from(crypto.randomBytes(16)).toString("base64");
const bobBeforeFailedAuth = JSON.stringify(bob.exportState());
assert.throws(() => bob.decrypt(tamperedFirst, aad));
assert.equal(JSON.stringify(bob.exportState()), bobBeforeFailedAuth,
  "failed authentication must not mutate ratchet state");
assert.equal(bob.decrypt(first, aad).toString(), "first");
const reply = bob.encrypt(Buffer.from("reply"), aad);
assert.equal(alice.decrypt(reply, aad).toString(), "reply");
const third = alice.encrypt(Buffer.from("third"), aad);
assert.equal(bob.decrypt(third, aad).toString(), "third");
assert.throws(() => bob.decrypt(third, aad), /authentication|Unsupported state|Invalid/);

// Out-of-order delivery: later messages are decrypted first and earlier skipped
// message keys remain usable exactly once.
const outAliceDh = fca.generateOmegAX25519KeyPair();
const outBobDh = fca.generateOmegAX25519KeyPair();
const outRoot = crypto.randomBytes(32);
const outA = crypto.randomBytes(32);
const outB = crypto.randomBytes(32);
const outAlice = fca.createOmegADoubleRatchet({
  rootKey: outRoot, localDh: outAliceDh, remoteDh: outBobDh.publicKey,
  sendChainKey: outA, receiveChainKey: outB
});
const outBob = fca.createOmegADoubleRatchet({
  rootKey: outRoot, localDh: outBobDh, remoteDh: outAliceDh.publicKey,
  sendChainKey: outB, receiveChainKey: outA
});
const ordered = [outAlice.encrypt(Buffer.from("one")), outAlice.encrypt(Buffer.from("two")), outAlice.encrypt(Buffer.from("three"))];
assert.equal(outBob.decrypt(ordered[2]).toString(), "three");
assert.equal(outBob.decrypt(ordered[0]).toString(), "one");
assert.equal(outBob.decrypt(ordered[1]).toString(), "two");
assert.throws(() => outBob.decrypt(ordered[0]), /authentication|Unsupported state|Invalid/);

const snapshot = alice.exportState();
const restored = fca.restoreOmegADoubleRatchet(snapshot);
const fourth = alice.encrypt(Buffer.from("persisted")), fourthPlain = restored.decrypt(fourth);
assert.equal(fourthPlain.toString(), "persisted");
assert.throws(() => fca.restoreOmegADoubleRatchet({ ...snapshot, rootKey: "bad" }), /32 bytes/);
assert.throws(() => fca.restoreOmegADoubleRatchet({
  ...snapshot, skippedMessageKeys: { "not-a-valid-id": crypto.randomBytes(32).toString("base64") }
}), /identifier/);
assert.throws(() => fca.restoreOmegADoubleRatchet({
  ...snapshot, skippedMessageKeys: { [aliceDh.publicKey.toString("base64") + ":0"]: "bad" }
}), /32 bytes/);
assert.throws(() => fca.restoreOmegADoubleRatchet({
  ...snapshot, skippedMessageKeys: Object.fromEntries(
    Array.from({ length: 2001 }, (_, i) => [aliceDh.publicKey.toString("base64") + ":" + i, crypto.randomBytes(32).toString("base64")])
  )
}), /Too many/);
console.log("OmegA Double Ratchet tests passed");
