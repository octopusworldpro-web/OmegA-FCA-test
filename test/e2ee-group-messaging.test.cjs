"use strict";
const assert = require("node:assert/strict");
const fca = require("../dist/index.js");

(async () => {
  const sender = { name: "alice", deviceId: 1 };
  const sent = [];
  const processed = [];
  const manager = {
    encrypt: async (groupId, peer, plaintext) => ({
      groupId, sender: peer, body: Buffer.from(plaintext).toString("base64")
    }),
    decrypt: async (ciphertext) => Buffer.from(ciphertext.body, "base64"),
    processIncomingDistribution: async (distribution) => processed.push(distribution)
  };
  const messaging = fca.createSignalEncryptedGroupMessaging({
    keyManager: manager,
    sendEnvelope: async (groupId, envelope) => sent.push({ groupId, envelope })
  });

  const envelope = await messaging.send("group-1", sender, "secret group message");
  assert.equal(envelope.version, 1);
  assert.equal(envelope.kind, "group_message");
  assert.notEqual(envelope.ciphertext.body, "secret group message");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].groupId, "group-1");
  assert.equal(Buffer.from(envelope.ciphertext.body, "base64").toString(), "secret group message");

  const plaintext = await messaging.receive(envelope, { groupId: "group-1", sender });
  assert.equal(Buffer.from(plaintext).toString(), "secret group message");
  await assert.rejects(messaging.receive(envelope, { groupId: "other" }), /expected group/);
  await assert.rejects(messaging.receive(envelope, { sender: { name: "mallory", deviceId: 1 } }), /expected sender/);
  await assert.rejects(messaging.receive({ ...envelope, version: 2 }), /unsupported/);
  await assert.rejects(messaging.receive({ ...envelope, ciphertext: { ...envelope.ciphertext, body: "not-base64!" } }), /valid base64/);
  await assert.rejects(messaging.send("", sender, "x"), /groupId/);
  await assert.rejects(messaging.send("group-1", sender, { bad: true }), /plaintext/);

  const distribution = { groupId: "group-1", sender, body: Buffer.from("distribution").toString("base64") };
  await messaging.receiveDistribution(distribution);
  assert.deepEqual(processed, [distribution]);
  console.log("Signal encrypted group messaging tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
