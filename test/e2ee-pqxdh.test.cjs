"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fca = require("../dist/index.js");
const pair = () => fca.generateOmegAX25519KeyPair();
const aliceIdentity = pair(), bobIdentity = pair(), bobSigned = pair(), bobOpk = pair();
const kemSecret = crypto.randomBytes(32);
const kemCiphertext = crypto.randomBytes(48);
const kemPublic = crypto.randomBytes(64);
const kemPrivate = crypto.randomBytes(64);
const kem = {
  parameter: "TEST-KEM-NOT-ML-KEM",
  encodePublicKey: value => Buffer.from(value),
  encapsulate: publicKey => {
    assert.deepEqual(Buffer.from(publicKey), kemPublic);
    return { ciphertext: kemCiphertext, sharedSecret: kemSecret };
  },
  decapsulate: (privateKey, ciphertext) => {
    assert.deepEqual(Buffer.from(privateKey), kemPrivate);
    assert.deepEqual(Buffer.from(ciphertext), kemCiphertext);
    return kemSecret;
  }
};
const bundle = {
  identityKey: bobIdentity.publicKey,
  signedPreKey: bobSigned.publicKey,
  signedPreKeySignature: crypto.randomBytes(64),
  kemPublicKey: kemPublic,
  kemPublicKeySignature: crypto.randomBytes(64),
  kemKeyId: 41,
  signedPreKeyId: 12,
  oneTimePreKey: bobOpk.publicKey,
  oneTimePreKeyId: 88,
  protocol: "OmegA-Test"
};
const initiator = fca.initiateOmegAPQXDH({
  identityKeyPair: aliceIdentity, bundle, kem, verifySignature: () => true
});
const responder = fca.respondOmegAPQXDH({
  identityKeyPair: bobIdentity,
  signedPreKeyPair: bobSigned,
  oneTimePreKeyPair: bobOpk,
  kemPrivateKey: kemPrivate,
  initialMessage: initiator.initialMessage,
  kem,
  protocol: bundle.protocol
});
assert.deepEqual(responder, initiator.sharedSecret);
assert.equal(responder.length, 32);
assert.throws(() => fca.initiateOmegAPQXDH({
  identityKeyPair: aliceIdentity, bundle, kem,
  verifySignature: (_identity, _message, signature) => signature.length === 0
}), /signature invalid/);
assert.throws(() => fca.initiateOmegAPQXDH({
  identityKeyPair: aliceIdentity, bundle: { ...bundle, kemPublicKeySignature: Buffer.alloc(0) },
  kem, verifySignature: () => true
}), /KEM prekey signature invalid/);
assert.throws(() => fca.initiateOmegAPQXDH({
  identityKeyPair: aliceIdentity, bundle, verifySignature: () => true
}), /KEM provider is required/);
assert.throws(() => fca.respondOmegAPQXDH({
  identityKeyPair: bobIdentity, signedPreKeyPair: bobSigned, kemPrivateKey: kemPrivate,
  initialMessage: { ...initiator.initialMessage, associatedData: Buffer.alloc(66).toString("base64") },
  kem, protocol: bundle.protocol, oneTimePreKeyPair: bobOpk
}), /associated data/);
console.log("OmegA PQXDH orchestration tests passed (test KEM only; no ML-KEM or interoperability claim)");
