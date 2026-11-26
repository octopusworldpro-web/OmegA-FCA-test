"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fca = require("../dist/index.js");

function pair() { return fca.generateOmegAX25519KeyPair(); }
function runWithOneTimePreKey() {
  const aliceIdentity = pair();
  const bobIdentity = pair();
  const bobSigned = pair();
  const bobOneTime = pair();
  const bundle = {
    identityKey: bobIdentity.publicKey,
    signedPreKey: bobSigned.publicKey,
    signedPreKeySignature: crypto.randomBytes(64),
    oneTimePreKey: bobOneTime.publicKey,
    signedPreKeyId: 9,
    oneTimePreKeyId: 17,
    info: "OmegA-X3DH-test"
  };
  const initiated = fca.initiateOmegAX3DH({
    identityKeyPair: aliceIdentity,
    bundle,
    // Test seam only: production MUST provide a real XEdDSA verifier.
    verifySignedPreKey: () => true
  });
  const received = fca.respondOmegAX3DH({
    identityKeyPair: bobIdentity,
    signedPreKeyPair: bobSigned,
    oneTimePreKeyPair: bobOneTime,
    initialMessage: initiated.initialMessage,
    info: bundle.info
  });
  assert.deepEqual(received, initiated.sharedSecret);
  assert.equal(initiated.sharedSecret.length, 32);
  assert.equal(initiated.initialMessage.oneTimePreKeyId, 17);
}
function runWithoutOneTimePreKey() {
  const aliceIdentity = pair();
  const bobIdentity = pair();
  const bobSigned = pair();
  const bundle = {
    identityKey: bobIdentity.publicKey,
    signedPreKey: bobSigned.publicKey,
    signedPreKeySignature: crypto.randomBytes(64),
    signedPreKeyId: 2,
    info: "OmegA-X3DH-test"
  };
  const initiated = fca.initiateOmegAX3DH({
    identityKeyPair: aliceIdentity,
    bundle,
    verifySignedPreKey: () => true
  });
  const received = fca.respondOmegAX3DH({
    identityKeyPair: bobIdentity,
    signedPreKeyPair: bobSigned,
    initialMessage: initiated.initialMessage,
    info: bundle.info
  });
  assert.deepEqual(received, initiated.sharedSecret);
  assert.equal(initiated.initialMessage.oneTimePreKeyId, undefined);
}
runWithOneTimePreKey();
runWithoutOneTimePreKey();

const aliceIdentity = pair(), bobIdentity = pair(), bobSigned = pair();
const bundle = {
  identityKey: bobIdentity.publicKey,
  signedPreKey: bobSigned.publicKey,
  signedPreKeySignature: crypto.randomBytes(64),
  signedPreKeyId: 1,
  info: "OmegA-X3DH-test"
};
assert.throws(() => fca.initiateOmegAX3DH({
  identityKeyPair: aliceIdentity, bundle, verifySignedPreKey: () => false
}), /XEdDSA verification failed/);
const initial = fca.initiateOmegAX3DH({
  identityKeyPair: aliceIdentity, bundle, verifySignedPreKey: () => true
}).initialMessage;
assert.throws(() => fca.respondOmegAX3DH({
  identityKeyPair: bobIdentity, signedPreKeyPair: bobSigned,
  initialMessage: { ...initial, associatedData: Buffer.alloc(64).toString("base64") },
  info: bundle.info
}), /associated data/);
assert.throws(() => fca.initiateOmegAX3DH({
  identityKeyPair: aliceIdentity, bundle: { ...bundle, info: "" },
  verifySignedPreKey: () => true
}), /info is required/);
console.log("OmegA X3DH tests passed (synthetic verifier seam; no XEdDSA interoperability claim)");
