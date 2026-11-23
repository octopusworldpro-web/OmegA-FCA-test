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
      signal: fakeSignal()
    });
    assert.equal(typeof runtime.directMessages.encrypt, "function");
    assert.equal(typeof runtime.directMessages.establishSession, "function");
    assert.equal(typeof runtime.actions.sendReadReceipt, "function");
    assert.equal(typeof runtime.groups.createDistribution, "function");
    assert.equal(runtime.store.getRegistrationId() > 0, true);
    assert.deepEqual(runtime.store.listSignedPreKeyIds(), [1]);
    await runtime.close();
    await assert.rejects(runtime.store.setRegistrationId(99), /closed/);
    console.log("Signal E2EE runtime lifecycle tests passed");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
