"use strict";
const assert = require("node:assert/strict");
const fca = require("../dist/index.js");

(async () => {
  const signal = {
    ProtocolAddress: { new: (name, deviceId) => ({ name, deviceId }) },
    CiphertextMessageType: { Whisper: 2, PreKey: 3 },
    SignalMessage: { deserialize: (bytes) => Buffer.from(bytes) },
    signalEncrypt: async (plaintext) => ({
      type: () => 2,
      serialize: () => Buffer.from(plaintext)
    }),
    signalDecrypt: async (message) => Buffer.from(message)
  };
  const stores = {
    sessionStore: {}, identityKeyStore: {}, preKeyStore: {},
    signedPreKeyStore: {}, kyberPreKeyStore: {}
  };
  const deps = { signal, stores, localAddress: { name: "100", deviceId: 1 } };
  const peer = { name: "200", deviceId: 7 };
  const sent = [];
  let uploaded = Buffer.alloc(0);
  const media = fca.createSignalEncryptedDirectMediaMessaging({
    signal: deps,
    sendEnvelope: async (peerId, remote, envelope) => sent.push({ peerId, remote, envelope })
  });
  const original = Buffer.from([0, 1, 2, 255, 10, 13, 42]);
  const envelope = await media.send("200", peer, original, async (ciphertext, metadata) => {
    uploaded = Buffer.from(ciphertext);
    assert.notDeepEqual(uploaded, original, "only encrypted bytes are uploaded");
    assert.equal(metadata.contentType, "application/octet-stream");
    assert.equal(metadata.fileName, "image.png.enc");
    return { ids: [{ file_id: "opaque-attachment-id" }] };
  }, { fileName: "image.png", contentType: "image/png" });

  assert.equal(envelope.kind, "direct_media");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].peerId, "200");
  assert.deepEqual(sent[0].remote, peer);
  const plaintext = await media.receive(envelope, peer, async (upload, descriptor) => {
    assert.equal(upload.ids[0].file_id, "opaque-attachment-id");
    assert.equal(descriptor.contentType, "image/png");
    return uploaded;
  });
  assert.deepEqual(plaintext, original);

  // Binary-safe lifecycle coverage for video/file payloads and empty files.
  const videoFixture = Buffer.alloc(256 * 1024);
  for (let i = 0; i < videoFixture.length; i++) videoFixture[i] = (i * 31) & 255;
  let videoCiphertext;
  const videoEnvelope = await media.send("200", peer, videoFixture, async (ciphertext, metadata) => {
    videoCiphertext = Buffer.from(ciphertext);
    assert.notDeepEqual(videoCiphertext, videoFixture);
    assert.equal(metadata.fileName, "sample.mp4.enc");
    assert.equal(metadata.contentType, "application/octet-stream");
    return { ids: [{ file_id: "video-attachment" }] };
  }, { fileName: "sample.mp4", contentType: "video/mp4" });
  assert.equal(videoEnvelope.descriptor.contentType, "video/mp4");
  assert.equal(videoEnvelope.descriptor.plaintextSize, videoFixture.length);
  assert.deepEqual(await media.receive(videoEnvelope, peer, async () => videoCiphertext), videoFixture);

  let emptyCiphertext;
  const emptyEnvelope = await media.send("200", peer, Buffer.alloc(0), async (ciphertext) => {
    emptyCiphertext = Buffer.from(ciphertext);
    return { ids: [{ file_id: "empty-attachment" }] };
  }, { fileName: "empty.bin", contentType: "application/octet-stream" });
  assert.equal(emptyEnvelope.descriptor.plaintextSize, 0);
  assert.deepEqual(await media.receive(emptyEnvelope, peer, async () => emptyCiphertext), Buffer.alloc(0));

  await assert.rejects(media.receive(envelope, { name: "201", deviceId: 7 }, async () => uploaded), /expected peer/);
  await assert.rejects(media.send("200", { name: "201", deviceId: 7 }, original, async () => ({ id: "x" })), /does not match peerId/);
  await assert.rejects(media.receive({ ...envelope, descriptor: { ...envelope.descriptor, digest: "bad" } }, peer, async () => uploaded), /invalid encrypted direct media descriptor/);
  await assert.rejects(fca.downloadAndDecryptSignalMedia(deps, peer, { ...envelope.descriptor, upload: envelope.upload }, async () => Buffer.from("tampered")), /digest|dimensions/);

  console.log("Signal direct encrypted media upload/download tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
