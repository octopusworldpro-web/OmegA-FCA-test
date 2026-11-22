"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const fca = require("../dist/index.js");

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omega-signal-store-"));
  const storagePath = path.join(directory, "account.signal");
  const encryptionKey = "test-only-secret-material-that-is-at-least-32-bytes";
  try {
    const store = await fca.createSignalKeyStore({ accountId: "account-123", storagePath, encryptionKey });
    await store.setIdentityKeyPair({ publicKey: Buffer.from("public").toString("base64"), privateKey: Buffer.from("private").toString("base64") });
    await store.setRegistrationId(4567);
    await store.storeSignedPreKey({ keyId: 1, publicKey: "cHVi", privateKey: "cHJp", signature: "c2ln", createdAt: 1700000000 });
    await store.storePreKey(2, { publicKey: "cHViMg==", privateKey: "cHJpMg==" });
    const address = { name: "remote-user", deviceId: 1 };
    await store.storeSession(address, Buffer.from("serialized-session").toString("base64"));\n    await store.storeSenderKey(address, "group-abc", Buffer.from("serialized-sender-key").toString("base64"));
    assert.equal(store.getRegistrationId(), 4567);
    assert.equal(store.loadPreKey(2).publicKey, "cHViMg==");
    assert.equal(store.isTrustedIdentity(address, "aWRlbnRpdHk="), true);
    assert.equal(await store.saveIdentity(address, "aWRlbnRpdHk="), true);
    assert.equal(await store.saveIdentity(address, "aWRlbnRpdHk="), false);
    await store.flush();
    await store.close();

    const encrypted = await fs.readFile(storagePath, "utf8");
    assert.equal(encrypted.includes("serialized-session"), false);
    const reopened = await fca.createSignalKeyStore({ accountId: "account-123", storagePath, encryptionKey });
    assert.equal(reopened.loadSession(address), Buffer.from("serialized-session").toString("base64"));\n    assert.equal(reopened.loadSenderKey(address, "group-abc"), Buffer.from("serialized-sender-key").toString("base64"));
    assert.equal(reopened.loadSignedPreKey(1).signature, "c2ln");
    await reopened.removePreKey(2);
    await reopened.removeSession(address);\n    await reopened.removeSenderKey(address, "group-abc");
    assert.equal(reopened.loadPreKey(2), undefined);
    assert.equal(reopened.loadSession(address), undefined);\n    assert.equal(reopened.loadSenderKey(address, "group-abc"), undefined);
    await reopened.close();

    await assert.rejects(
      fca.createSignalKeyStore({ accountId: "different-account", storagePath, encryptionKey }),
      /different account/
    );
    await assert.rejects(
      fca.createSignalKeyStore({ accountId: "account-123", storagePath, encryptionKey: "wrong-secret-material-that-is-at-least-32-bytes" }),
      /authenticate|Unsupported state|bad decrypt/i
    );
    console.log("Signal key/session store tests passed");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
