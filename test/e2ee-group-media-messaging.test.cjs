"use strict";
const assert = require("node:assert/strict");
const fca = require("../dist/index.js");

(async () => {
  const sender = { name: "alice", deviceId: 2 };
  const sent = [];
  let uploaded = Buffer.alloc(0);
  const engine = {
    encryptAndUpload: async (groupId, peer, plaintext, upload, metadata) => {
      const ciphertext = Buffer.from(plaintext).map((byte) => byte ^ 0xff);
      const result = await upload(ciphertext, { fileName: (metadata.fileName || "attachment") + ".enc", contentType: "application/octet-stream" });
      return {
        descriptor: {
          version: 1, algorithm: "AES-256-CBC-HMAC-SHA256", groupId, sender: peer,
          iv: Buffer.alloc(16).toString("base64"), mac: Buffer.alloc(10).toString("base64"),
          digest: "a".repeat(64), plaintextSize: plaintext.length, ciphertextSize: ciphertext.length,
          encryptedKey: { groupId, sender: peer, body: "AA==" }, fileName: metadata.fileName
        },
        upload: result
      };
    },
    downloadAndDecrypt: async (descriptor, download, expected) => {
      const ciphertext = Buffer.from(await download(descriptor));
      return Buffer.from(ciphertext).map((byte) => byte ^ 0xff);
    }
  };
  const media = fca.createSignalEncryptedGroupMediaMessaging({
    media: engine,
    sendEnvelope: async (groupId, envelope) => sent.push({ groupId, envelope })
  });
  const original = Buffer.from("private group attachment");
  const envelope = await media.send("group-1", sender, original, async (ciphertext, metadata) => {
    uploaded = Buffer.from(ciphertext);
    assert.notDeepEqual(uploaded, original, "only encrypted bytes are uploaded");
    assert.equal(metadata.contentType, "application/octet-stream");
    return { id: "opaque-media-ref" };
  }, { fileName: "private.bin", contentType: "application/octet-stream" });
  assert.equal(envelope.kind, "group_media");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].groupId, "group-1");
  const plaintext = await media.receive(envelope, async (descriptor, upload) => {
    assert.equal(upload.id, "opaque-media-ref");
    return uploaded;
  }, { groupId: "group-1", sender });
  assert.deepEqual(plaintext, original);
  await assert.rejects(media.receive(envelope, async () => uploaded, { groupId: "wrong" }), /expected group/);
  await assert.rejects(media.receive(envelope, async () => uploaded, { sender: { name: "mallory", deviceId: 1 } }), /expected sender/);
  await assert.rejects(media.receive({ ...envelope, kind: "group_message" }, async () => uploaded), /unsupported/);
  await assert.rejects(media.send("", sender, original, async () => ({ id: "x" })), /groupId/);
  console.log("Signal encrypted group media messaging tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
