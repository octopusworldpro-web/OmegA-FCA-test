"use strict";
const assert = require("node:assert/strict");
const fca = require("../dist/index.js");

(async () => {
  const sender = { name: "alice", deviceId: 2 };
  const wrappedKeys = new Map();
  let uploads = 0;
  let downloads = 0;
  const groups = {
    encrypt: async (groupId, localSender, plaintext) => {
      const id = `${groupId}:${localSender.name}:${localSender.deviceId}`;
      wrappedKeys.set(id, Buffer.from(plaintext));
      return { groupId, sender: localSender, body: Buffer.from(id).toString("base64") };
    },
    decrypt: async (ciphertext) => {
      const id = Buffer.from(ciphertext.body, "base64").toString();
      const key = wrappedKeys.get(id);
      if (!key) throw new Error("unknown wrapped key");
      return key;
    }
  };
  const media = fca.createSignalEncryptedGroupMedia(groups);
  const plaintext = Buffer.from([0, 1, 2, 255, 10, 13, 42]);
  const encrypted = await media.encrypt("thread-1", sender, plaintext, {
    fileName: "photo.jpg", contentType: "image/jpeg"
  });
  assert.notDeepEqual(encrypted.ciphertext, plaintext);
  assert.equal(encrypted.descriptor.plaintextSize, plaintext.length);
  assert.equal(encrypted.descriptor.contentType, "image/jpeg");
  assert.deepEqual(await media.decrypt(encrypted.descriptor, encrypted.ciphertext), plaintext);

  let uploadedCiphertext;
  const uploaded = await media.encryptAndUpload("thread-1", sender, plaintext, async (body, metadata) => {
    uploads++;
    uploadedCiphertext = Buffer.from(body);
    assert.notDeepEqual(body, plaintext, "upload receives ciphertext only");
    assert.equal(metadata.contentType, "application/octet-stream");
    assert.equal(metadata.fileName, "photo.jpg.enc");
    return { mediaId: "opaque-upload-id" };
  }, { fileName: "photo.jpg", contentType: "image/jpeg" });
  assert.equal(uploads, 1);
  assert.equal(uploaded.upload.mediaId, "opaque-upload-id");

  const downloaded = await media.downloadAndDecrypt(uploaded.descriptor, async () => {
    downloads++;
    return uploadedCiphertext;
  }, { groupId: "thread-1", sender });
  assert.equal(downloads, 1);
  assert.deepEqual(downloaded, plaintext);

  await assert.rejects(media.downloadAndDecrypt(uploaded.descriptor, async () => {
    throw new Error("should not fetch for wrong group");
  }, { groupId: "other-thread" }), /groupId does not match/);
  await assert.rejects(media.decrypt(uploaded.descriptor, encrypted.ciphertext, {
    sender: { name: "mallory", deviceId: 3 }
  }), /sender does not match/);

  const tampered = Buffer.from(encrypted.ciphertext);
  tampered[0] ^= 1;
  await assert.rejects(media.decrypt(encrypted.descriptor, tampered), /digest or size mismatch/);
  await assert.rejects(media.decrypt(encrypted.descriptor, encrypted.ciphertext.subarray(0, -16)), /digest mismatch or size mismatch|dimensions/);

  const badMac = { ...encrypted.descriptor, mac: Buffer.alloc(10, 7).toString("base64") };
  await assert.rejects(media.decrypt(badMac, encrypted.ciphertext), /MAC verification failed/);
  const badRoute = { ...encrypted.descriptor, encryptedKey: { ...encrypted.descriptor.encryptedKey, groupId: "other-thread" } };
  await assert.rejects(media.decrypt(badRoute, encrypted.ciphertext), /key routing mismatch/);
  const malformedRoute = { ...encrypted.descriptor, encryptedKey: { groupId: "thread-1", sender: null, body: "AA==" } };
  await assert.rejects(media.decrypt(malformedRoute, encrypted.ciphertext), /key routing mismatch/);
  await assert.rejects(media.encrypt("thread-1", sender, plaintext, { fileName: " " }), /fileName/);
  await assert.rejects(media.encryptAndUpload("thread-1", sender, plaintext, async () => null), /returned no result/);
  await assert.rejects(media.downloadAndDecrypt(encrypted.descriptor, null), /download callback/);

  console.log("Signal encrypted group media tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
