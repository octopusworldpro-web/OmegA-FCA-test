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
    await store.setDeviceRecord({ deviceId: "device-uuid-1", waDeviceId: 42, registeredAt: 1700000000, icdcSequence: 8 });
    await store.storeSignedPreKey({ keyId: 1, publicKey: "cHVi", privateKey: "cHJp", signature: "c2ln", createdAt: 1700000000 });
    await store.storePreKey(2, { publicKey: "cHViMg==", privateKey: "cHJpMg==" });
    await store.storeKyberPreKey(3, Buffer.from("kyber-record").toString("base64"));
    await store.storeKyberPreKey(4, Buffer.from("one-time-kyber-record").toString("base64"));
    const address = { name: "remote-user", deviceId: 1 };
    await store.storeSession(address, Buffer.from("serialized-session").toString("base64"));
    await store.storeSenderKey(address, "group-abc", Buffer.from("serialized-sender-key").toString("base64"));
    const localSender = { name: "local", deviceId: 1 };
    const recipient = { name: "member", deviceId: 2 };
    await store.markSenderKeyDistributionDelivered(localSender, "group-abc", recipient);
    assert.deepEqual(store.getSenderKeyDistributionRecipients(localSender, "group-abc"), ["member.2"]);
    assert.equal(store.getRegistrationId(), 4567);
    assert.deepEqual(store.listSignedPreKeyIds(), [1]);
    assert.deepEqual(store.listPreKeyIds(), [2]);
    assert.deepEqual(store.listKyberPreKeyIds(), [3, 4]);
    assert.equal(store.hasKyberPreKeyBeenUsed(3), false);
    assert.equal(
      await store.consumeKyberPreKey(4, 7, Buffer.from("claim-base-key").toString("base64")),
      Buffer.from("one-time-kyber-record").toString("base64")
    );
    assert.equal(store.hasKyberPreKeyBeenUsed(4), true);
    await assert.rejects(
      store.consumeKyberPreKey(4, 7, Buffer.from("claim-base-key").toString("base64")),
      /base key reuse/
    );
    await assert.rejects(
      store.consumeKyberPreKey(4, 8, Buffer.from("other-base-key").toString("base64")),
      /already been consumed/
    );
    await store.markKyberPreKeyUsed(3, 1, Buffer.from("base-key").toString("base64"));
    assert.equal(store.hasKyberPreKeyBeenUsed(3), true);
    await assert.rejects(
      store.markKyberPreKeyUsed(3, 2, Buffer.from("different-base-key").toString("base64")),
      /already been consumed/
    );
    await assert.rejects(
      store.markKyberPreKeyUsed(99, 2, Buffer.from("base-key").toString("base64")),
      /not found/
    );
    assert.deepEqual(store.getDeviceRecord(), { deviceId: "device-uuid-1", waDeviceId: 42, registeredAt: 1700000000, icdcSequence: 8 });
    assert.equal(store.loadPreKey(2).publicKey, "cHViMg==");
    assert.equal(store.isTrustedIdentity(address, "aWRlbnRpdHk="), true);
    assert.equal(await store.saveIdentity(address, "aWRlbnRpdHk="), true);
    assert.equal(await store.saveIdentity(address, "aWRlbnRpdHk="), false);
    await store.flush();
    await store.close();

    const encrypted = await fs.readFile(storagePath, "utf8");
    assert.equal(encrypted.includes("serialized-session"), false);
    const reopened = await fca.createSignalKeyStore({ accountId: "account-123", storagePath, encryptionKey });
    assert.equal(reopened.loadSession(address), Buffer.from("serialized-session").toString("base64"));
    assert.equal(reopened.loadSenderKey(address, "group-abc"), Buffer.from("serialized-sender-key").toString("base64"));
    assert.deepEqual(reopened.getSenderKeyDistributionRecipients(localSender, "group-abc"), ["member.2"]);
    await reopened.markSenderKeyDistributionDelivered(localSender, "group-abc", { name: "member", deviceId: 3 });
    assert.deepEqual(reopened.getSenderKeyDistributionRecipients(localSender, "group-abc"), ["member.2", "member.3"]);
    await reopened.clearSenderKeyDistribution(localSender, "group-abc");
    assert.deepEqual(reopened.getSenderKeyDistributionRecipients(localSender, "group-abc"), []);
    assert.equal(reopened.loadSignedPreKey(1).signature, "c2ln");
    assert.deepEqual(reopened.listPreKeyIds(), [2]);
    assert.deepEqual(reopened.listSignedPreKeyIds(), [1]);
    assert.deepEqual(reopened.listKyberPreKeyIds(), [3, 4]);
    assert.equal(reopened.hasKyberPreKeyBeenUsed(3), true);
    assert.equal(reopened.hasKyberPreKeyBeenUsed(4), true);
    await assert.rejects(reopened.consumeKyberPreKey(4, 9, Buffer.from("new-base-key").toString("base64")), /already been consumed/);
    assert.deepEqual(reopened.getDeviceRecord(), { deviceId: "device-uuid-1", waDeviceId: 42, registeredAt: 1700000000, icdcSequence: 8 });
    await reopened.setDeviceRecord({ deviceId: "device-uuid-1", waDeviceId: 42, registeredAt: 1700000000, icdcSequence: 8 });
    await reopened.removePreKey(2);
    await reopened.removeSession(address);
    await reopened.removeSenderKey(address, "group-abc");
    assert.equal(reopened.loadPreKey(2), undefined);
    assert.equal(reopened.loadSession(address), undefined);
    assert.equal(reopened.loadSenderKey(address, "group-abc"), undefined);
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
