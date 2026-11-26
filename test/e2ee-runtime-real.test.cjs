"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createE2EEBootstrap, createSignalE2EERuntime } = require("../dist/index.js");

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omega-real-libsignal-"));
  const previousRoot = process.env.OMEGA_FCA_DATA_DIR;
  const previousKey = process.env.OMEGA_FCA_E2EE_MASTER_KEY;
  process.env.OMEGA_FCA_DATA_DIR = root;
  process.env.OMEGA_FCA_E2EE_MASTER_KEY = "real-libsignal-test-master-secret-32-bytes-min";
  let first;
  let restored;
  try {
    const bootstrap = await createE2EEBootstrap("real-account-001");
    const signal = require("@signalapp/libsignal-client");
    assert.equal(typeof signal.PrivateKey.generate, "function");
    first = await createSignalE2EERuntime({
      accountId: "real-account-001",
      storagePath: bootstrap.storagePath,
      encryptionKey: bootstrap.encryptionKey,
      localDeviceId: bootstrap.localDeviceId,
      signal: bootstrap.signal
    });
    assert.ok(first.registrationId > 0);
    assert.ok(first.identityKey);
    assert.ok(first.signedPreKey.publicKey);
    assert.ok(first.signedPreKey.signature);
    assert.equal(first.preKeys.length, 25);
    assert.equal(first.kyberPreKeys.length, 1);
    const snapshot = {
      registrationId: first.registrationId,
      identityKey: first.identityKey,
      signedPreKey: first.signedPreKey,
      preKeys: first.preKeys,
      kyberPreKeys: first.kyberPreKeys
    };
    await first.close();
    first = null;

    const reopened = await createE2EEBootstrap("real-account-001");
    restored = await createSignalE2EERuntime({
      accountId: "real-account-001",
      storagePath: reopened.storagePath,
      encryptionKey: reopened.encryptionKey,
      localDeviceId: reopened.localDeviceId,
      signal: reopened.signal
    });
    assert.deepEqual({
      registrationId: restored.registrationId,
      identityKey: restored.identityKey,
      signedPreKey: restored.signedPreKey,
      preKeys: restored.preKeys,
      kyberPreKeys: restored.kyberPreKeys
    }, snapshot);
    await restored.close();
    restored = null;

    const other = await createE2EEBootstrap("real-account-002");
    assert.notEqual(other.storagePath, reopened.storagePath);
    assert.notEqual(other.localDeviceId, reopened.localDeviceId);
    console.log("Real @signalapp/libsignal-client runtime, encrypted persistence, restart and account isolation passed");
  } finally {
    if (first) await first.close().catch(() => {});
    if (restored) await restored.close().catch(() => {});
    if (previousRoot === undefined) delete process.env.OMEGA_FCA_DATA_DIR; else process.env.OMEGA_FCA_DATA_DIR = previousRoot;
    if (previousKey === undefined) delete process.env.OMEGA_FCA_E2EE_MASTER_KEY; else process.env.OMEGA_FCA_E2EE_MASTER_KEY = previousKey;
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
