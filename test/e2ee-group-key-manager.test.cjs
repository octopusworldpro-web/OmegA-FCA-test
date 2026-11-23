"use strict";
const assert = require("node:assert/strict");
const fca = require("../dist/index.js");

(async () => {
  const sender = { name: "self", deviceId: 1 };
  let members = [
    { name: "alice", deviceId: 1 },
    { name: "bob", deviceId: 2 },
    { name: "self", deviceId: 1 }
  ];
  const activeKeys = new Set();
  const sent = [];
  const created = [];
  const processed = [];
  let failOnce = true;
  const groups = {
    createDistribution: async (groupId, local) => {
      created.push({ groupId, local });
      activeKeys.add(`${groupId}|${local.name}.${local.deviceId}`);
      return { groupId, sender: local, body: Buffer.from("skdm").toString("base64") };
    },
    processDistribution: async (distribution) => processed.push(distribution),
    encrypt: async (groupId, local, plaintext) => ({
      groupId, sender: local, body: Buffer.from(String(plaintext)).toString("base64")
    }),
    decrypt: async (ciphertext) => Buffer.from(ciphertext.body, "base64")
  };
  const manager = fca.createSignalGroupKeyManager({
    store: { removeSenderKey: async (local, groupId) => activeKeys.delete(`${groupId}|${local.name}.${local.deviceId}`) },
    groups,
    listMemberDevices: async () => members,
    sendDistribution: async (recipient, distribution) => {
      if (failOnce && recipient.name === "bob") {
        failOnce = false;
        throw new Error("temporary transport failure");
      }
      sent.push({ recipient, distribution });
    }
  });

  await assert.rejects(manager.distribute("group-1", sender), /temporary transport failure/);
  const first = await manager.distribute("group-1", sender);
  assert.deepEqual(first.recipients.map((item) => item.name), ["alice", "bob"]);
  assert.deepEqual(sent.map((item) => item.recipient.name), ["alice", "bob"]);
  const repeated = await manager.distribute("group-1", sender);
  assert.deepEqual(repeated.recipients, [], "already delivered SKDMs are not resent");

  const encrypted = await manager.encrypt("group-1", sender, "group hello");
  assert.equal(Buffer.from(encrypted.body, "base64").toString(), "group hello");
  const decrypted = await manager.decrypt(encrypted);
  assert.equal(decrypted.toString(), "group hello");

  const incoming = { groupId: "group-1", sender: { name: "alice", deviceId: 1 }, body: Buffer.from("incoming").toString("base64") };
  await manager.processIncomingDistribution(incoming);
  assert.deepEqual(processed, [incoming]);

  members = [{ name: "alice", deviceId: 1 }, { name: "carol", deviceId: 3 }];
  const rotated = await manager.syncMembership("group-1", sender);
  assert.deepEqual(rotated.recipients.map((item) => item.name), ["alice", "carol"]);
  assert.equal(created.length, 2, "membership sync rotates local sender key");
  await assert.rejects(manager.distribute("", sender), /groupId/);

  const duplicate = fca.createSignalGroupKeyManager({
    store: { removeSenderKey: async () => {} }, groups,
    listMemberDevices: async () => [{ name: "alice", deviceId: 1 }, { name: "alice", deviceId: 1 }],
    sendDistribution: async () => {}
  });
  await assert.rejects(duplicate.distribute("group-1", sender), /duplicate group member device/);
  console.log("Signal group Sender Key manager tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
