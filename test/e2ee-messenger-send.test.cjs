"use strict";
const assert = require("node:assert/strict");
const fca = require("../dist/index.js");

class FakeSocket {
  constructor() { this.nodes = new Set(); this.closes = new Set(); this.frames = []; }
  onNode(fn) { this.nodes.add(fn); return () => this.nodes.delete(fn); }
  onClose(fn) { this.closes.add(fn); return () => this.closes.delete(fn); }
  async sendFrame(frame) {
    const bytes = Buffer.from(frame);
    this.frames.push(bytes);
    const node = fca.decodeMessengerNode(bytes);
    if (node.tag === "message" && node.attrs.id) {
      queueMicrotask(() => { for (const fn of [...this.nodes]) fn({ tag: "ack", attrs: { id: node.attrs.id } }); });
    }
  }
  async sendIQ(frame, id) {
    const node = fca.decodeMessengerNode(frame);
    if (node.attrs.xmlns === "fbid:devices") {
      const jid = node.content[0].content[0].attrs.jid;
      const user = jid.split("@")[0].split(".")[0];
      return { tag: "iq", attrs: { id, type: "result" }, content: [{
        tag: "users", attrs: {}, content: [{
          tag: "user", attrs: { jid: `${user}.0@msgr` }, content: [{
            tag: "devices", attrs: {}, content: [{ tag: "device", attrs: { id: user === "123456789" ? "43" : "17" } }]
          }]
        }]
      }] };
    }
    if (node.attrs.xmlns === "w:g2") {
      return { tag: "iq", attrs: { id, type: "result" }, content: [{
        tag: "group", attrs: {}, content: [{ tag: "participant", attrs: { jid: "987654321.0@msgr" } }]
      }] };
    }
    throw new Error("unexpected IQ namespace " + node.attrs.xmlns);
  }
  close() { for (const fn of [...this.closes]) fn(new Error("closed")); }
}
const socket = new FakeSocket();
const delivered = ["987654321.17", "123456789.43"];
const runtime = {
  registrationId: 7,
  identityKey: Buffer.concat([Buffer.from([5]), Buffer.alloc(32, 1)]).toString("base64"),
  signedPreKey: { keyId: 2, publicKey: Buffer.concat([Buffer.from([5]), Buffer.alloc(32, 2)]).toString("base64"), signature: Buffer.alloc(64, 3).toString("base64") },
  preKeys: [],
  store: {
    loadSession: () => true,
    listUnpublishedPreKeyIds: () => [],
    getSenderKeyDistributionRecipients: () => delivered,
    markSenderKeyDistributionDelivered: async () => {},
    clearSenderKeyDistribution: async () => {},
    removeSenderKey: async () => {}
  },
  directMessages: {
    establishSession: async () => {},
    encrypt: async () => ({ type: 2, body: Buffer.from("ciphertext").toString("base64") }),
    decrypt: async () => Buffer.alloc(0)
  },
  groups: {
    createDistribution: async () => ({ groupId: "123-456@g.us", sender: { name: "123456789", deviceId: 42 }, body: Buffer.from("skdm").toString("base64") }),
    processDistribution: async () => {},
    encrypt: async (groupId, sender, plaintext) => ({ groupId, sender, body: Buffer.from("group-cipher").toString("base64") }),
    decrypt: async () => Buffer.alloc(0)
  }
};
(async () => {
  const service = new fca.MessengerE2EEService({
    accountId: "123456789", localDeviceId: 42, runtime, socket,
    signal: { CiphertextMessageType: { PreKey: 3, Whisper: 2 } }
  });
  await service.ready;
  const directId = await service.sendDirectText("987654321", "hello direct");
  assert.ok(directId);
  const direct = socket.frames.map((frame) => fca.decodeMessengerNode(frame)).find((node) => node.tag === "message" && node.attrs.id === directId);
  assert.equal(direct.content[0].tag, "participants");
  assert.equal(direct.content[0].content.length, 2);
  assert.equal(direct.content[0].content[0].content[0].attrs.type, "msg");

  const groupId = await service.sendGroupText("123-456@g.us", "hello group");
  assert.ok(groupId);
  const group = socket.frames.map((frame) => fca.decodeMessengerNode(frame)).find((node) => node.tag === "message" && node.attrs.id === groupId);
  assert.equal(group.attrs.to, "123-456@g.us");
  assert.equal(group.content.find((child) => child.tag === "enc").attrs.type, "skmsg");
  assert.match(group.attrs.phash, /^2:/);
  service.close();
  console.log("Messenger direct and group text send fixtures passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
