"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createE2EEBootstrap } = require("../dist/index.js");

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omega-e2ee-bootstrap-"));
  const previous = process.env.OMEGA_FCA_DATA_DIR;
  process.env.OMEGA_FCA_DATA_DIR = root;
  const signalModule = { PrivateKey: { generate() {} } };
  try {
    const first = await createE2EEBootstrap("account-100", { signalModule });
    const second = await createE2EEBootstrap("account-100", { signalModule });
    const other = await createE2EEBootstrap("account-200", { signalModule });
    assert.equal(first.storagePath, second.storagePath);
    assert.equal(first.localDeviceId, second.localDeviceId);
    assert.deepEqual(Buffer.from(first.encryptionKey), Buffer.from(second.encryptionKey));
    assert.notEqual(first.storagePath, other.storagePath);
    assert.notEqual(first.localDeviceId, other.localDeviceId);
    assert.notDeepEqual(Buffer.from(first.encryptionKey), Buffer.from(other.encryptionKey));
    assert.equal(first.signal, signalModule);
    const metadataPath = path.join(root, "e2ee", require("node:crypto").createHash("sha256").update("account-100").digest("hex"), "identity.json");
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    assert.equal(metadata.accountIdHash, require("node:crypto").createHash("sha256").update("account-100").digest("hex"));
    assert.equal(metadata.encryptionKey, Buffer.from(first.encryptionKey).toString("base64"));
    await assert.rejects(createE2EEBootstrap(""), /account ID/);
    await assert.rejects(createE2EEBootstrap("account-100", { encryptionKey: "short", signalModule }), /at least 32 bytes/);
    console.log("E2EE bootstrap persistence and account-isolation tests passed");
  } finally {
    if (previous === undefined) delete process.env.OMEGA_FCA_DATA_DIR;
    else process.env.OMEGA_FCA_DATA_DIR = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
