"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createE2EEBootstrap } = require("../dist/index.js");

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omega-e2ee-bootstrap-"));
  const previousRoot = process.env.OMEGA_FCA_DATA_DIR;
  const previousKey = process.env.OMEGA_FCA_E2EE_MASTER_KEY;
  process.env.OMEGA_FCA_DATA_DIR = root;
  delete process.env.OMEGA_FCA_E2EE_MASTER_KEY;
  const signalModule = { PrivateKey: { generate() {} } };
  try {
    const first = await createE2EEBootstrap("account-100", { signalModule });
    const second = await createE2EEBootstrap("account-100", { signalModule });
    const other = await createE2EEBootstrap("account-200", { signalModule });
    assert.equal(first.storagePath, second.storagePath);
    assert.equal(first.localDeviceId, second.localDeviceId);
    assert.deepEqual(first.encryptionKey, second.encryptionKey);
    assert.equal(Buffer.from(first.encryptionKey).length, 32);
    assert.notEqual(first.storagePath, other.storagePath);
    assert.notEqual(first.localDeviceId, other.localDeviceId);
    assert.notDeepEqual(first.encryptionKey, other.encryptionKey);
    const metadataPath = path.join(root, "e2ee", crypto.createHash("sha256").update("account-100").digest("hex"), "identity.json");
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    assert.equal(metadata.version, 1);
    assert.equal(Buffer.from(metadata.encryptionKey, "base64").length, 32);
    assert.equal(metadata.encryptionKey, Buffer.from(first.encryptionKey).toString("base64"));
    await assert.rejects(createE2EEBootstrap(""), /account ID/);
    await assert.rejects(createE2EEBootstrap("account-100", { encryptionKey: "short", signalModule }), /at least 32 bytes/);
    console.log("E2EE bootstrap automatic key persistence and account-isolation tests passed");
  } finally {
    if (previousRoot === undefined) delete process.env.OMEGA_FCA_DATA_DIR; else process.env.OMEGA_FCA_DATA_DIR = previousRoot;
    if (previousKey === undefined) delete process.env.OMEGA_FCA_E2EE_MASTER_KEY; else process.env.OMEGA_FCA_E2EE_MASTER_KEY = previousKey;
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
