"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const fca = require("../dist/index.js");

function fakeSignal() {
  class StoreBase {}
  const key = (value) => ({
    serialize: () => Buffer.from(value),
    getPublicKey: () => key("public-key"),
    sign: (bytes) => Buffer.from(bytes)
  });
  return {
    PrivateKey: { generate: () => key("private-key"), deserialize: () => key("private-key") },
    PublicKey: { deserialize: () => key("public-key") },
    SignedPreKeyRecord: { new: () => ({}) },
    KEMKeyPair: { generate: () => key("kyber-private-key") },
    KyberPreKeyRecord: {
      new: (id, timestamp, pair, signature) => ({
        serialize: () => Buffer.from(JSON.stringify({
          publicKey: pair.getPublicKey().serialize().toString("base64"),
          signature: Buffer.from(signature).toString("base64")
        })),
        publicKey: () => pair.getPublicKey(),
        signature: () => Buffer.from(signature)
      }),
      deserialize: (serialized) => {
        const record = JSON.parse(Buffer.from(serialized).toString("utf8"));
        return {
          publicKey: () => key(Buffer.from(record.publicKey, "base64").toString("utf8")),
          signature: () => Buffer.from(record.signature, "base64")
        };
      }
    },
    ProtocolAddress: { new: (name, deviceId) => ({ name: () => name, deviceId: () => deviceId }) },
    SessionStore: StoreBase,
    IdentityKeyStore: StoreBase,
    PreKeyStore: StoreBase,
    SignedPreKeyStore: StoreBase,
    KyberPreKeyStore: StoreBase,
    SenderKeyStore: StoreBase,
    SenderKeyRecord: { deserialize: () => ({}) },
    SenderKeyName: { new: () => ({}) },
    SenderKeyDistributionMessage: { deserialize: () => ({}) },
    SenderKeyMessage: { deserialize: () => ({}) },
    GroupSessionBuilder: class {},
    GroupCipher: class {}
  };
}

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omega-e2ee-runtime-"));
  try {
    await assert.rejects(fca.createSignalE2EERuntime({
      accountId: "123", storagePath: path.join(directory, "bad.signal"),
      encryptionKey: "this-is-a-test-secret-at-least-32-bytes", localDeviceId: 1,
      signal: {}
    }), /compatible libsignal module/);

    const runtime = await fca.createSignalE2EERuntime({
      accountId: "123456789", storagePath: path.join(directory, "account.signal"),
      encryptionKey: "this-is-a-test-secret-at-least-32-bytes", localDeviceId: 1,
      signal: fakeSignal(), kyberPreKeyCount: 1
    });
    assert.equal(typeof runtime.directMessages.encrypt, "function");
    assert.equal(typeof runtime.directMessages.establishSession, "function");
    assert.equal(typeof runtime.actions.sendReadReceipt, "function");
    assert.equal(typeof runtime.groups.createDistribution, "function");
    assert.equal(runtime.store.getRegistrationId() > 0, true);
    assert.equal(runtime.registrationId, runtime.store.getRegistrationId());
    assert.equal(runtime.identityKey, runtime.store.getIdentityKeyPair().publicKey);
    const noiseIdentity = runtime.store.getNoiseKeyPair();
    assert.equal(Buffer.from(noiseIdentity.publicKey, "base64").length, 32);
    assert.equal(Buffer.from(noiseIdentity.privateKey, "base64").length, 32);
    assert.notDeepEqual(noiseIdentity, runtime.store.getIdentityKeyPair());
    assert.equal(typeof runtime.identityKey, "string");
    assert.equal(Object.hasOwn(runtime, "privateKey"), false);
    assert.equal(Object.hasOwn(runtime, "identityPrivateKey"), false);
    assert.deepEqual(runtime.store.listSignedPreKeyIds(), [1]);
    assert.deepEqual(runtime.signedPreKey, {
      keyId: 1,
      publicKey: runtime.store.loadSignedPreKey(1).publicKey,
      signature: runtime.store.loadSignedPreKey(1).signature
    });
    assert.equal(runtime.store.listPreKeyIds().length, 25);
    assert.equal(runtime.preKeys.length, 25);
    const runtimePreKeys = runtime.preKeys;
    assert.equal(runtime.kyberPreKeys.length, 1);
    const runtimeKyberPreKeys = runtime.kyberPreKeys;
    await runtime.close();

    const restored = await fca.createSignalE2EERuntime({
      accountId: "123456789", storagePath: path.join(directory, "account.signal"),
      encryptionKey: "this-is-a-test-secret-at-least-32-bytes", localDeviceId: 1,
      signal: fakeSignal()
    });
    assert.equal(restored.store.listPreKeyIds().length, 25);
    assert.deepEqual(restored.signedPreKey, runtime.signedPreKey);
    assert.equal(restored.registrationId, runtime.registrationId);
    assert.equal(restored.identityKey, runtime.identityKey);
    assert.deepEqual(restored.store.getNoiseKeyPair(), noiseIdentity);
    assert.equal(restored.preKeys.length, 25);
    assert.deepEqual(restored.preKeys, runtimePreKeys);
    assert.deepEqual(restored.kyberPreKeys, runtimeKyberPreKeys);
    await restored.close();
    await assert.rejects(runtime.store.setRegistrationId(99), /closed/);
    console.log("Signal E2EE runtime lifecycle tests passed");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
