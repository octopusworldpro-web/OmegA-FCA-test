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
  const retry = await manager.distribute("group-1", sender);
  assert.deepEqual(retry.recipients.map((item) => item.name), ["bob"], "retry reports only the recipient newly delivered after the earlier partial success");
  assert.deepEqual(sent.map((item) => item.recipient.name), ["alice", "bob"], "previously delivered SKDM is not sent again");
  const repeated = await manager.distribute("group-1", sender);
  assert.deepEqual(repeated.recipients, [], "already delivered SKDMs are not resent");

  const encrypted = await manager.encrypt("group-1", sender, "group hello");
  assert.equal(Buffer.from(encrypted.body, "base64").toString(), "group hello");
  const decrypted = await manager.decrypt(encrypted, { groupId: "group-1", sender });
  assert.equal(decrypted.toString(), "group hello");
  await assert.rejects(manager.decrypt(encrypted, { groupId: "another-group" }), /groupId does not match/);
  await assert.rejects(manager.decrypt(encrypted, { sender: { name: "mallory", deviceId: 1 } }), /sender does not match/);

  const incoming = { groupId: "group-1", sender: { name: "alice", deviceId: 1 }, body: Buffer.from("incoming").toString("base64") };
  await manager.processIncomingDistribution(incoming);
  assert.deepEqual(processed, [incoming]);

  members = [{ name: "alice", deviceId: 1 }, { name: "carol", deviceId: 3 }];
  const rotated = await manager.syncMembership("group-1", sender);
  assert.deepEqual(rotated.recipients.map((item) => item.name), ["alice", "carol"]);
  assert.equal(created.length, 2, "membership sync rotates local sender key");
  await assert.rejects(manager.distribute("", sender), /groupId/);

  let concurrentCreates = 0;
  let concurrentSends = 0;
  const concurrent = fca.createSignalGroupKeyManager({
    store: { removeSenderKey: async () => {} },
    groups: {
      ...groups,
      createDistribution: async (...args) => {
        concurrentCreates++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return groups.createDistribution(...args);
      }
    },
    listMemberDevices: async () => [{ name: "alice", deviceId: 1 }],
    sendDistribution: async () => {
      concurrentSends++;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });
  await Promise.all([
    concurrent.distribute("group-concurrent", sender),
    concurrent.distribute("group-concurrent", sender)
  ]);
  assert.equal(concurrentCreates, 1, "concurrent calls share one SKDM creation");
  assert.equal(concurrentSends, 1, "concurrent calls do not duplicate SKDM delivery");

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
